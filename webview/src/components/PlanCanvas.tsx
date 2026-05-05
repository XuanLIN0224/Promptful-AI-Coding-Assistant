import {
  type Dispatch,
  type MouseEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useOnSelectionChange,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type OnSelectionChangeParams,
  type ReactFlowInstance,
  type Viewport,
} from "@xyflow/react";
import type { ClusterId, ClusterFrameData, DecisionNodePayload, FileGraphPayload, PlanCanvasMode } from "../types";
import { CLUSTERS } from "../types";
import { computeFileGraphLayout } from "../forceLayout";
import { buildAdjacency } from "../graphAdjacency";
import {
  clusterOverviewPack,
  fileGraphEdges,
  fileGraphNodes,
  kindFromNodeId,
  layoutClusterFramesForOverview,
  nodesArgForClusterFit,
  planKindFromClusterFrameId,
  PLAN_CLUSTER_TREE_ROOT_IDS,
  planTreeKindFromProgramTabId,
  type PlanTreeKind,
} from "../mock/flows";
import { FileGraphCenterEdge } from "../flow/fileGraphEdge";
import { planNodeTypes } from "../flow/nodeTypes";
import {
  buildIncomingParentsMap,
  edgeIdsOnPathResolved,
  pathNodeIdsFromRootResolved,
  resolvedParentForNode,
} from "../treePath";

const planEdgeTypes = { fileGraphCenter: FileGraphCenterEdge };

const NEIGHBOR_PULL = 0.52;
const FILE_NODE_SIZE = 56;

const OPACITY_FOCUS = 1;
const OPACITY_NEIGHBOR = 0.5;
const OPACITY_DISTANT = 0.22;

function hexForPlanKind(kind: PlanTreeKind): string {
  const oid = kind as ClusterId;
  return CLUSTERS.find((c) => c.id === oid)?.hex ?? "#888888";
}

function snapshotPlanNodes(nodes: Node[]): Node[] {
  return nodes.map((n) => ({ ...n }));
}

/**
 * “Hide others” must use React Flow’s `hidden` flag so nodes are removed from the scene graph
 * and the MiniMap (filtering the `nodes` prop alone left stale ids in the store → three minimap blobs).
 */
function applyClusterVisibility(
  mode: PlanCanvasMode,
  showAllClusters: boolean,
  planExplorerTabId: string,
  nodes: Node[],
  edges: Edge[]
): { nodes: Node[]; edges: Edge[] } {
  if (mode !== "overview") {
    return {
      nodes: nodes.map((n) => ({ ...n, hidden: false })),
      edges: edges.map((e) => ({ ...e, hidden: false })),
    };
  }
  if (showAllClusters) {
    return {
      nodes: nodes.map((n) => ({ ...n, hidden: false })),
      edges: edges.map((e) => ({ ...e, hidden: false })),
    };
  }
  const fk = planTreeKindFromProgramTabId(planExplorerTabId);
  const n2 = nodes.map((n) => {
    let hide = true;
    if (n.type === "clusterFrame") {
      const k = planKindFromClusterFrameId(n.id);
      hide = k !== fk;
    } else {
      const k = kindFromNodeId(n.id);
      hide = k !== fk;
    }
    return { ...n, hidden: hide };
  });
  const hiddenId = new Set(n2.filter((n) => n.hidden).map((n) => n.id));
  const e2 = edges.map((e) => ({
    ...e,
    hidden: hiddenId.has(e.source) || hiddenId.has(e.target),
  }));
  return { nodes: n2, edges: e2 };
}

/** When “hide others” is on, refit so the visible cluster is centered; when showing all, zoom out. */
function RefitOnEyeToggle({
  showAllClusters,
  planExplorerTabId,
  active,
}: {
  showAllClusters: boolean;
  planExplorerTabId: string;
  active: boolean;
}) {
  const { fitView, getNodes } = useReactFlow();
  const prev = useRef<boolean | null>(null);
  useEffect(() => {
    if (!active) return;
    if (prev.current === null) {
      prev.current = showAllClusters;
      return;
    }
    if (prev.current === showAllClusters) return;
    prev.current = showAllClusters;

    const run = () => {
      if (showAllClusters) {
        void fitView({ padding: 0.12, duration: 380, maxZoom: 1.15 });
        return;
      }
      const kind = planTreeKindFromProgramTabId(planExplorerTabId);
      const measured = nodesArgForClusterFit(kind, getNodes());
      const fallback = { id: `cluster-overview-${kind}` };
      void fitView({
        padding: 0.2,
        duration: 400,
        maxZoom: 1.35,
        nodes: measured.length > 0 ? measured : [fallback],
      });
    };
    requestAnimationFrame(() => requestAnimationFrame(run));
  }, [showAllClusters, planExplorerTabId, active, fitView, getNodes]);
  return null;
}

/**
 * When the Plan explorer file changes, zoom Overview to that file’s cluster.
 * Skips the first run after mount so mode switches / viewport restore are not overwritten
 * (`handleFlowInit` or `defaultViewport` owns the first frame).
 */
function FitOverviewOnExplorerTabChange({ planExplorerTabId, active }: { planExplorerTabId: string; active: boolean }) {
  const { fitView, getNodes } = useReactFlow();
  const prevTabRef = useRef<string | null>(null);
  useEffect(() => {
    if (!active) {
      prevTabRef.current = planExplorerTabId;
      return;
    }
    if (prevTabRef.current === null) {
      prevTabRef.current = planExplorerTabId;
      return;
    }
    if (prevTabRef.current === planExplorerTabId) return;
    prevTabRef.current = planExplorerTabId;

    const run = () => {
      const kind = planTreeKindFromProgramTabId(planExplorerTabId);
      const measured = nodesArgForClusterFit(kind, getNodes());
      const fallback = { id: `cluster-overview-${kind}` };
      void fitView({
        padding: 0.22,
        duration: 380,
        maxZoom: 1.35,
        nodes: measured.length > 0 ? measured : [fallback],
      });
    };
    requestAnimationFrame(() => requestAnimationFrame(run));
  }, [planExplorerTabId, active, fitView, getNodes]);
  return null;
}

function Inner({
  mode,
  planExplorerTabId,
  onSelection,
  planTreeSelections,
  onPlanTreeSelectionsChange,
  showAllClusters,
  savedViewport,
  onViewportSave,
  onFlowReady,
}: {
  mode: PlanCanvasMode;
  planExplorerTabId: string;
  onSelection: (p: OnSelectionChangeParams) => void;
  planTreeSelections: Partial<Record<PlanTreeKind, string | null>>;
  onPlanTreeSelectionsChange: Dispatch<SetStateAction<Partial<Record<PlanTreeKind, string | null>>>>;
  showAllClusters: boolean;
  savedViewport: Viewport | null;
  /** Include `mode` so parent stores into the correct slot when switching Overview ↔ Node graph (avoids stale planMode). */
  onViewportSave: (viewport: Viewport, mode: PlanCanvasMode) => void;
  onFlowReady?: (instance: ReactFlowInstance | null) => void;
}) {
  const isOverview = mode === "overview";
  const isGraph = mode === "nodegraph";
  const [vpZoom, setVpZoom] = useState(1);

  const overviewPackStable = useMemo(() => clusterOverviewPack(), []);
  const nodegraphPack = useMemo(() => {
    const p = { nodes: fileGraphNodes as Node[], edges: fileGraphEdges };
    const positions = computeFileGraphLayout(p.nodes as Node<FileGraphPayload>[], p.edges);
    return {
      edges: p.edges,
      nodes: p.nodes.map((n) => ({
        ...n,
        position: positions.get(n.id) ?? { x: 380, y: 320 },
        origin: [0.5, 0.5] as [number, number],
        width: FILE_NODE_SIZE,
        height: FILE_NODE_SIZE,
      })),
    };
  }, [planExplorerTabId]);

  const [nodes, setNodes, onNodesChange] = useNodesState(
    mode === "overview" ? overviewPackStable.nodes : nodegraphPack.nodes
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    mode === "overview" ? overviewPackStable.edges : nodegraphPack.edges
  );

  const flowInstanceRef = useRef<ReactFlowInstance | null>(null);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const savedViewportRef = useRef(savedViewport);
  savedViewportRef.current = savedViewport;
  const overviewSnapshotRef = useRef<Node[] | null>(null);
  const nodegraphSnapshotByTabRef = useRef<Record<string, Node[]>>({});
  const prevModeRef = useRef<PlanCanvasMode | null>(null);
  const prevExplorerForNodegraphRef = useRef(planExplorerTabId);

  useLayoutEffect(() => {
    const inst = flowInstanceRef.current;

    if (prevModeRef.current === null) {
      prevModeRef.current = mode;
      prevExplorerForNodegraphRef.current = planExplorerTabId;
      return;
    }

    const modeChanged = prevModeRef.current !== mode;

    if (modeChanged) {
      /** Replacing nodes resets the viewport briefly; ignore saves until restore/fit finishes. */
      allowViewportPublishRef.current = false;
      const outgoing = prevModeRef.current;
      if (inst) {
        onViewportSave(inst.getViewport(), outgoing);
      }
      if (outgoing === "overview") {
        overviewSnapshotRef.current = snapshotPlanNodes(nodesRef.current);
      } else if (outgoing === "nodegraph") {
        const outgoingTab = prevExplorerForNodegraphRef.current;
        nodegraphSnapshotByTabRef.current[outgoingTab] = snapshotPlanNodes(nodesRef.current);
      }

      if (mode === "overview") {
        const snap = overviewSnapshotRef.current;
        const base = snap ?? overviewPackStable.nodes;
        setNodes(layoutClusterFramesForOverview(base));
        setEdges(overviewPackStable.edges);
      } else {
        const snap = nodegraphSnapshotByTabRef.current[planExplorerTabId];
        setNodes(snap ?? nodegraphPack.nodes);
        setEdges(nodegraphPack.edges);
      }

      prevModeRef.current = mode;
      prevExplorerForNodegraphRef.current = planExplorerTabId;

      const releasePublish = () => {
        requestAnimationFrame(() => {
          allowViewportPublishRef.current = true;
        });
      };

      if (inst) {
        const vp = savedViewportRef.current;
        const nextMode = mode;
        const explorerTab = planExplorerTabId;
        requestAnimationFrame(() => {
          const i = flowInstanceRef.current;
          if (!i) {
            releasePublish();
            return;
          }
          if (vp) {
            i.setViewport(vp, { duration: 0 });
            requestAnimationFrame(() => {
              i.setViewport(vp, { duration: 0 });
              releasePublish();
            });
          } else if (nextMode === "overview") {
            const kind = planTreeKindFromProgramTabId(explorerTab);
            const measured = nodesArgForClusterFit(kind, i.getNodes());
            const fallback = { id: `cluster-overview-${kind}` };
            void i
              .fitView({
                padding: 0.22,
                duration: 0,
                maxZoom: 1.35,
                nodes: measured.length > 0 ? measured : [fallback],
              })
              .finally(releasePublish);
          } else {
            void i.fitView({ padding: 0.32, duration: 420 }).finally(releasePublish);
          }
        });
      } else {
        releasePublish();
      }
      return;
    }

    if (mode === "nodegraph" && prevExplorerForNodegraphRef.current !== planExplorerTabId) {
      allowViewportPublishRef.current = false;
      const prevTab = prevExplorerForNodegraphRef.current;
      nodegraphSnapshotByTabRef.current[prevTab] = snapshotPlanNodes(nodesRef.current);
      prevExplorerForNodegraphRef.current = planExplorerTabId;
      const snap = nodegraphSnapshotByTabRef.current[planExplorerTabId];
      setNodes(snap ?? nodegraphPack.nodes);
      setEdges(nodegraphPack.edges);
      if (inst) {
        requestAnimationFrame(() => {
          const i = flowInstanceRef.current;
          if (!i) {
            requestAnimationFrame(() => {
              allowViewportPublishRef.current = true;
            });
            return;
          }
          void i.fitView({ padding: 0.32, duration: 380 }).finally(() => {
            requestAnimationFrame(() => {
              allowViewportPublishRef.current = true;
            });
          });
        });
      } else {
        requestAnimationFrame(() => {
          allowViewportPublishRef.current = true;
        });
      }
    }
  }, [mode, planExplorerTabId, overviewPackStable, nodegraphPack, setNodes, setEdges, onViewportSave]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [treeHoverId, setTreeHoverId] = useState<string | null>(null);
  const [collapsedTreeNodeIds, setCollapsedTreeNodeIds] = useState<Set<string>>(() => new Set());
  const [treeParentChoiceByKind, setTreeParentChoiceByKind] = useState<Partial<Record<PlanTreeKind, Record<string, string>>>>({});
  const [graphDragging, setGraphDragging] = useState(false);
  const [clusterDragKind, setClusterDragKind] = useState<PlanTreeKind | null>(null);
  const dragLastPosRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const clusterDragLastRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const treeLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewportSaveRaf = useRef<number | null>(null);
  /** React Flow often emits a default viewport during mount before `defaultViewport` sticks; saving that would wipe App state. */
  const allowViewportPublishRef = useRef(!savedViewport);

  const publishViewport = useCallback(
    (vp: Viewport) => {
      if (!allowViewportPublishRef.current) return;
      if (viewportSaveRaf.current != null) cancelAnimationFrame(viewportSaveRaf.current);
      viewportSaveRaf.current = requestAnimationFrame(() => {
        viewportSaveRaf.current = null;
        onViewportSave(vp, mode);
      });
    },
    [onViewportSave, mode]
  );

  useEffect(
    () => () => {
      if (viewportSaveRaf.current != null) cancelAnimationFrame(viewportSaveRaf.current);
    },
    []
  );

  const { nodes: viewNodes, edges: viewEdges } = useMemo(
    () => applyClusterVisibility(mode, showAllClusters, planExplorerTabId, nodes, edges),
    [mode, showAllClusters, planExplorerTabId, nodes, edges]
  );

  const adjacency = useMemo(() => (isGraph ? buildAdjacency(edges) : new Map()), [isGraph, edges]);

  const fitViewOptions = useMemo(
    () => ({
      padding: isGraph ? 0.32 : isOverview ? 0.14 : 0.2,
      duration: isGraph ? 420 : 360,
    }),
    [isGraph, isOverview]
  );

  const handleFlowInit = useCallback(
    (instance: ReactFlowInstance) => {
      flowInstanceRef.current = instance;
      onFlowReady?.(instance);
      const vp0 = savedViewportRef.current;
      /** Restored camera: block spurious `onViewportChange` during init, then re-apply once the pane is measured. */
      if (vp0) {
        allowViewportPublishRef.current = false;
        requestAnimationFrame(() => {
          instance.setViewport(vp0, { duration: 0 });
          requestAnimationFrame(() => {
            instance.setViewport(vp0, { duration: 0 });
            allowViewportPublishRef.current = true;
          });
        });
        return;
      }
      allowViewportPublishRef.current = true;
      if (isOverview) {
        const kind = planTreeKindFromProgramTabId(planExplorerTabId);
        const fit = () => {
          const measured = nodesArgForClusterFit(kind, instance.getNodes());
          const fallback = { id: `cluster-overview-${kind}` };
          void instance.fitView({
            padding: 0.22,
            maxZoom: 1.35,
            duration: 0,
            nodes: measured.length > 0 ? measured : [fallback],
          });
        };
        requestAnimationFrame(() => requestAnimationFrame(fit));
        return;
      }
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          void instance.fitView(fitViewOptions);
        });
      });
    },
    [fitViewOptions, isOverview, planExplorerTabId, onFlowReady]
  );

  useEffect(() => {
    return () => {
      flowInstanceRef.current = null;
      onFlowReady?.(null);
    };
  }, [onFlowReady]);

  useEffect(() => {
    setFocusId(null);
    setTreeHoverId(null);
  }, [mode, planExplorerTabId]);

  useEffect(() => {
    if (!isOverview) return;
    setCollapsedTreeNodeIds(new Set());
    setTreeParentChoiceByKind({});
  }, [isOverview, planExplorerTabId]);

  const handleTreeToggleChildren = useCallback((nodeId: string) => {
    setCollapsedTreeNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const incomingParents = useMemo(() => buildIncomingParentsMap(viewEdges), [viewEdges]);

  const hoverParentOverrideForKind = useCallback(
    (kind: PlanTreeKind, hoverNodeId: string): Readonly<Record<string, string>> | undefined => {
      const base = treeParentChoiceByKind[kind] ?? {};
      const candidates = (incomingParents.get(hoverNodeId) ?? []).filter((p) => kindFromNodeId(p) === kind);
      if (candidates.length <= 1) return base;

      let chosen = candidates[0];
      const currentLeaf = planTreeSelections[kind] ?? null;
      if (currentLeaf && candidates.includes(currentLeaf)) {
        chosen = currentLeaf;
      } else if (currentLeaf) {
        const currentPath = new Set(pathNodeIdsFromRootResolved(currentLeaf, incomingParents, base));
        const ancestor = candidates.find((p) => currentPath.has(p));
        if (ancestor) chosen = ancestor;
      }
      return { ...base, [hoverNodeId]: chosen };
    },
    [incomingParents, planTreeSelections, treeParentChoiceByKind]
  );

  const handleTreeUndo = useCallback(
    (fromNodeId: string) => {
      setTreeHoverId(null);
      const kind = kindFromNodeId(fromNodeId);
      if (!kind) return;
      onPlanTreeSelectionsChange((prev) => {
        const cur = prev[kind];
        if (cur !== fromNodeId) return prev;
        const parent = resolvedParentForNode(fromNodeId, incomingParents, treeParentChoiceByKind[kind]);
        const nextVal = parent === undefined ? null : parent;
        return { ...prev, [kind]: nextVal };
      });
    },
    [onPlanTreeSelectionsChange, incomingParents, treeParentChoiceByKind]
  );

  useEffect(
    () => () => {
      if (treeLeaveTimerRef.current) clearTimeout(treeLeaveTimerRef.current);
    },
    []
  );

  useOnSelectionChange({
    onChange: onSelection,
  });

  const styledNodes = useMemo(() => {
    if (isOverview) {
      const childrenMap = new Map<string, string[]>();
      for (const e of viewEdges) {
        const arr = childrenMap.get(e.source);
        if (arr) arr.push(e.target);
        else childrenMap.set(e.source, [e.target]);
      }
      const hiddenByCollapse = new Set<string>();
      for (const rootId of collapsedTreeNodeIds) {
        const stack = [...(childrenMap.get(rootId) ?? [])];
        while (stack.length > 0) {
          const cur = stack.pop();
          if (!cur || hiddenByCollapse.has(cur)) continue;
          hiddenByCollapse.add(cur);
          for (const ch of childrenMap.get(cur) ?? []) stack.push(ch);
        }
      }
      const zoomWash = Math.max(0, Math.min(0.12, (vpZoom - 0.38) * 0.16));
      return viewNodes.map((n) => {
        if (n.type === "clusterFrame") {
          const d = n.data as ClusterFrameData;
          const k = planKindFromClusterFrameId(n.id);
          const raised = k && clusterDragKind === k;
          return {
            ...n,
            draggable: showAllClusters,
            zIndex: raised ? 12 : 0,
            data: {
              ...d,
              clusterMat: true,
            },
          };
        }
        if (n.type !== "decision" && n.type !== "branch") {
          return n;
        }
        const kind = kindFromNodeId(n.id);
        if (!kind) return n;
        const leaf = planTreeSelections[kind] ?? null;
        const parentOverride = treeParentChoiceByKind[kind];
        const committedSet = leaf ? new Set(pathNodeIdsFromRootResolved(leaf, incomingParents, parentOverride)) : null;
        const committed = committedSet?.has(n.id) ?? false;
        const hoverKind = treeHoverId ? kindFromNodeId(treeHoverId) : null;
        const hoverOverride =
          treeHoverId && hoverKind === kind ? hoverParentOverrideForKind(kind, treeHoverId) : parentOverride;
        const hoverSet =
          treeHoverId && hoverKind === kind
            ? new Set(pathNodeIdsFromRootResolved(treeHoverId, incomingParents, hoverOverride))
            : null;
        const onHoverPath = !committed && (hoverSet?.has(n.id) ?? false);
        const pathHover = treeHoverId === n.id;
        const d = n.data as DecisionNodePayload;
        const raised = kind && clusterDragKind === kind;
        const childCount = (childrenMap.get(n.id) ?? []).length;
        return {
          ...n,
          hidden: n.hidden || hiddenByCollapse.has(n.id),
          zIndex: raised ? 13 : 1,
          data: {
            ...d,
            treeCommitted: committed,
            treeHoverPath: onHoverPath,
            treePathHover: pathHover,
            treeShowUndo: leaf === n.id && !PLAN_CLUSTER_TREE_ROOT_IDS.has(n.id),
            onTreeUndo: handleTreeUndo,
            treeCanToggleChildren: childCount > 0,
            treeChildrenExpanded: !collapsedTreeNodeIds.has(n.id),
            onTreeToggleChildren: handleTreeToggleChildren,
          },
        };
      });
    }
    if (isGraph) {
      const neighbors = focusId ? adjacency.get(focusId) : undefined;
      return viewNodes.map((n) => {
        let emphasize: NonNullable<FileGraphPayload["graphEmphasis"]> = "none";
        let opacity = OPACITY_FOCUS;
        if (focusId) {
          if (focusId === n.id) emphasize = "focus";
          else if (neighbors?.has(n.id)) {
            emphasize = "neighbor";
            opacity = OPACITY_NEIGHBOR;
          } else {
            emphasize = "dim";
            opacity = OPACITY_DISTANT;
          }
        }
        const payload = { ...(n.data as FileGraphPayload), graphEmphasis: emphasize };
        return {
          ...n,
          data: payload,
          style: {
            ...(n.style as Record<string, unknown> | undefined),
            opacity,
            transition: graphDragging ? "none" : "opacity 160ms ease",
          },
        };
      });
    }
    return viewNodes;
  }, [
    isOverview,
    isGraph,
    viewNodes,
    viewEdges,
    planTreeSelections,
    treeHoverId,
    handleTreeUndo,
    collapsedTreeNodeIds,
    treeParentChoiceByKind,
    hoverParentOverrideForKind,
    handleTreeToggleChildren,
    incomingParents,
    clusterDragKind,
    showAllClusters,
    adjacency,
    focusId,
    graphDragging,
    vpZoom,
  ]);

  const styledEdges = useMemo(() => {
    if (isOverview) {
      const childrenMap = new Map<string, string[]>();
      for (const e of viewEdges) {
        const arr = childrenMap.get(e.source);
        if (arr) arr.push(e.target);
        else childrenMap.set(e.source, [e.target]);
      }
      const hiddenByCollapse = new Set<string>();
      for (const rootId of collapsedTreeNodeIds) {
        const stack = [...(childrenMap.get(rootId) ?? [])];
        while (stack.length > 0) {
          const cur = stack.pop();
          if (!cur || hiddenByCollapse.has(cur)) continue;
          hiddenByCollapse.add(cur);
          for (const ch of childrenMap.get(cur) ?? []) stack.push(ch);
        }
      }
      const baseStroke = "rgba(29,29,31,0.28)";
      const hoverKind = treeHoverId ? kindFromNodeId(treeHoverId) : null;
      const hoverOverride = treeHoverId && hoverKind ? hoverParentOverrideForKind(hoverKind, treeHoverId) : undefined;
      const hoverPathIds =
        treeHoverId && hoverKind
          ? edgeIdsOnPathResolved(treeHoverId, viewEdges, incomingParents, hoverOverride)
          : new Set<string>();
      return viewEdges.map((e) => {
        const edgeKind = kindFromNodeId(e.source);
        if (!edgeKind) {
          return {
            ...e,
            animated: false,
            type: "smoothstep",
            pathOptions: { offset: 26, borderRadius: 18 },
            zIndex: 0,
            style: {
              ...e.style,
              stroke: baseStroke,
              strokeWidth: 1.2,
              opacity: 0.74,
            },
          };
        }
        const hx = hexForPlanKind(edgeKind);
        const leaf = planTreeSelections[edgeKind] ?? null;
        const committedIds = leaf
          ? edgeIdsOnPathResolved(leaf, viewEdges, incomingParents, treeParentChoiceByKind[edgeKind])
          : new Set<string>();
        const committed = committedIds.has(e.id);
        const hover = hoverPathIds.has(e.id);
        const pathActive = committed || hover;
        const stroke = pathActive ? hx : baseStroke;
        const filter = pathActive ? `drop-shadow(0 0 3px ${hx}88)` : undefined;
        let className: string | undefined;
        if (hover && !committed) className = "pf-tree-edge--hot";
        return {
          ...e,
          hidden: e.hidden || hiddenByCollapse.has(String(e.source)) || hiddenByCollapse.has(String(e.target)),
          animated: false,
          type: "smoothstep",
          pathOptions: { offset: 26, borderRadius: 18 },
          zIndex: pathActive ? 2 : 0,
          className,
          style: {
            ...e.style,
            stroke,
            strokeWidth: pathActive ? 2.1 : 1.2,
            strokeDasharray: hover && !committed ? "11 9" : undefined,
            opacity: pathActive ? 0.98 : 0.74,
            filter,
            transition: "stroke 0.14s ease, stroke-width 0.14s ease, opacity 0.14s ease, filter 0.14s ease",
          },
        };
      });
    }
    if (isGraph) {
      const strokeMuted = "rgba(29,29,31,0.14)";
      const strokeBright = "rgba(29,29,31,0.34)";
      const strokeMid = "rgba(29,29,31,0.24)";
      if (!focusId) {
        return viewEdges.map((e) => ({
          ...e,
          type: "fileGraphCenter" as const,
          style: { ...e.style, opacity: 0.34, stroke: strokeMuted, strokeWidth: 1.2 },
        }));
      }
      const nbr = adjacency.get(focusId) ?? new Set<string>();
      return viewEdges.map((e) => {
        const touchesFocus = e.source === focusId || e.target === focusId;
        const touchesNeighbor = nbr.has(String(e.source)) || nbr.has(String(e.target));
        const secondary = !touchesFocus && touchesNeighbor;

        let opacity = 0.055;
        let stroke = strokeMuted;
        let strokeWidth = 1;
        if (touchesFocus) {
          opacity = 0.78;
          stroke = strokeBright;
          strokeWidth = 1.55;
        } else if (secondary) {
          opacity = 0.45;
          stroke = strokeMid;
          strokeWidth = 1.3;
        }
        return {
          ...e,
          type: "fileGraphCenter" as const,
          style: { ...e.style, opacity, stroke, strokeWidth },
        };
      });
    }
    return viewEdges;
  }, [
    isOverview,
    isGraph,
    viewEdges,
    planTreeSelections,
    treeHoverId,
    collapsedTreeNodeIds,
    incomingParents,
    treeParentChoiceByKind,
    hoverParentOverrideForKind,
    adjacency,
    focusId,
  ]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (isOverview) {
        setNodes((nds) => {
          const applied = applyNodeChanges(changes, nds);
          return layoutClusterFramesForOverview(applied);
        });
        return;
      }
      onNodesChange(changes);
    },
    [isOverview, onNodesChange, setNodes]
  );

  const propagateNeighborDrag = useCallback(
    (_: MouseEvent, node: Node) => {
      if (!isGraph) return;
      const prev = dragLastPosRef.current;
      if (!prev || prev.id !== node.id) {
        dragLastPosRef.current = { id: node.id, x: node.position.x, y: node.position.y };
        return;
      }
      const dx = node.position.x - prev.x;
      const dy = node.position.y - prev.y;
      dragLastPosRef.current = { id: node.id, x: node.position.x, y: node.position.y };
      if (dx === 0 && dy === 0) return;

      const followers = adjacency.get(node.id);
      if (!followers?.size) return;

      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === node.id) return n;
          if (!followers.has(n.id)) return n;
          return {
            ...n,
            position: {
              x: n.position.x + dx * NEIGHBOR_PULL,
              y: n.position.y + dy * NEIGHBOR_PULL,
            },
          };
        })
      );
    },
    [isGraph, adjacency, setNodes]
  );

  return (
    <ReactFlow
      nodes={styledNodes}
      edges={styledEdges}
      onNodesChange={handleNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={planNodeTypes}
      edgeTypes={planEdgeTypes}
      style={{ width: "100%", height: "100%" }}
      fitView={false}
      fitViewOptions={fitViewOptions}
      onViewportChange={publishViewport}
      onInit={handleFlowInit}
      onMove={(_, v) => {
        if (isOverview) setVpZoom(v.zoom);
      }}
      onMoveEnd={(_, viewport) => {
        if (!allowViewportPublishRef.current) return;
        if (viewportSaveRaf.current != null) cancelAnimationFrame(viewportSaveRaf.current);
        viewportSaveRaf.current = null;
        onViewportSave(viewport, mode);
      }}
      minZoom={0.08}
      maxZoom={2}
      nodesDraggable
      nodesConnectable={false}
      elementsSelectable
      elevateNodesOnSelect
      proOptions={{ hideAttribution: true }}
      onNodeMouseEnter={(_, node) => {
        if (isOverview) {
          if (treeLeaveTimerRef.current) {
            clearTimeout(treeLeaveTimerRef.current);
            treeLeaveTimerRef.current = null;
          }
          if (node.type === "decision" || node.type === "branch") {
            setTreeHoverId(node.id);
          }
          return;
        }
        if (!isGraph || graphDragging) return;
        setFocusId(node.id);
      }}
      onNodeMouseLeave={() => {
        if (isOverview) {
          treeLeaveTimerRef.current = setTimeout(() => {
            setTreeHoverId(null);
            treeLeaveTimerRef.current = null;
          }, 56);
          return;
        }
        if (!isGraph || graphDragging) return;
        setFocusId(null);
      }}
      onNodeDragStart={(_, node) => {
        if (isGraph) {
          setGraphDragging(true);
          setFocusId(node.id);
          dragLastPosRef.current = { id: node.id, x: node.position.x, y: node.position.y };
          return;
        }
        if (isOverview && node.type === "clusterFrame" && showAllClusters) {
          const k = planKindFromClusterFrameId(node.id);
          if (k) setClusterDragKind(k);
          clusterDragLastRef.current = { id: node.id, x: node.position.x, y: node.position.y };
        }
      }}
      onNodeDrag={(evt, node) => {
        if (isGraph) {
          propagateNeighborDrag(evt as unknown as MouseEvent, node);
          return;
        }
        if (!isOverview || node.type !== "clusterFrame" || !showAllClusters) return;
        const prev = clusterDragLastRef.current;
        if (!prev || prev.id !== node.id) {
          clusterDragLastRef.current = { id: node.id, x: node.position.x, y: node.position.y };
          return;
        }
        const dx = node.position.x - prev.x;
        const dy = node.position.y - prev.y;
        clusterDragLastRef.current = { id: node.id, x: node.position.x, y: node.position.y };
        if (dx === 0 && dy === 0) return;
        const kind = planKindFromClusterFrameId(node.id);
        if (!kind) return;
        setNodes((nds) =>
          nds.map((n) => {
            if (n.id === node.id) return n;
            const nk = n.type === "clusterFrame" ? planKindFromClusterFrameId(n.id) : kindFromNodeId(n.id);
            if (nk === kind) {
              return {
                ...n,
                position: { x: n.position.x + dx, y: n.position.y + dy },
              };
            }
            return n;
          })
        );
      }}
      onNodeDragStop={() => {
        if (isGraph) {
          setGraphDragging(false);
          dragLastPosRef.current = null;
          return;
        }
        setClusterDragKind(null);
        clusterDragLastRef.current = null;
      }}
      onNodeClick={(_, node) => {
        if (node.type !== "decision" && node.type !== "branch") return;
        if (!isOverview) return;
        const kind = kindFromNodeId(node.id);
        if (!kind) return;
        const candidates = (incomingParents.get(node.id) ?? []).filter((p) => kindFromNodeId(p) === kind);
        if (candidates.length > 1) {
          let chosen = candidates[0];
          const currentLeaf = planTreeSelections[kind] ?? null;
          const parentOverride = treeParentChoiceByKind[kind];
          if (currentLeaf && candidates.includes(currentLeaf)) {
            chosen = currentLeaf;
          } else if (currentLeaf) {
            const currentPath = new Set(pathNodeIdsFromRootResolved(currentLeaf, incomingParents, parentOverride));
            const ancestor = candidates.find((p) => currentPath.has(p));
            if (ancestor) chosen = ancestor;
          }
          setTreeParentChoiceByKind((prev) => ({
            ...prev,
            [kind]: {
              ...(prev[kind] ?? {}),
              [node.id]: chosen,
            },
          }));
        }
        onPlanTreeSelectionsChange((prev) => ({ ...prev, [kind]: node.id }));
      }}
      onPaneMouseDown={() => {
        if (isOverview) {
          setTreeHoverId(null);
          return;
        }
        if (!isGraph || graphDragging) return;
        setFocusId(null);
      }}
      defaultEdgeOptions={
        isGraph
          ? {
              type: "fileGraphCenter",
              style: {
                stroke: "rgba(29,29,31,0.18)",
                strokeWidth: 1.2,
              },
            }
          : {
              type: "smoothstep",
              style: { stroke: "rgba(0,0,0,0.18)", strokeWidth: 1.5 },
            }
      }
    >
      <RefitOnEyeToggle showAllClusters={showAllClusters} planExplorerTabId={planExplorerTabId} active={isOverview} />
      <FitOverviewOnExplorerTabChange planExplorerTabId={planExplorerTabId} active={isOverview} />
      <Background gap={18} size={1} color="rgba(0,0,0,0.06)" variant={BackgroundVariant.Dots} />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        maskColor="rgba(255,255,255,0.82)"
        nodeStrokeWidth={2}
        nodeColor={() => "rgba(0,0,0,0.12)"}
      />
    </ReactFlow>
  );
}

export function PlanCanvas({
  mode,
  planExplorerTabId,
  onSelection,
  planTreeSelections,
  onPlanTreeSelectionsChange,
  showAllClusters,
  savedViewport,
  onViewportSave,
  onFlowReady,
}: {
  mode: PlanCanvasMode;
  planExplorerTabId: string;
  onSelection: (p: OnSelectionChangeParams) => void;
  planTreeSelections: Partial<Record<PlanTreeKind, string | null>>;
  onPlanTreeSelectionsChange: Dispatch<SetStateAction<Partial<Record<PlanTreeKind, string | null>>>>;
  showAllClusters: boolean;
  savedViewport: Viewport | null;
  onViewportSave: (viewport: Viewport, mode: PlanCanvasMode) => void;
  onFlowReady?: (instance: ReactFlowInstance | null) => void;
}) {
  const stableOnSelection = useCallback((p: OnSelectionChangeParams) => onSelection(p), [onSelection]);
  return (
    <div className="pf-canvas">
      <div className="pf-canvas__flow-host">
        <ReactFlowProvider>
          <Inner
            mode={mode}
            planExplorerTabId={planExplorerTabId}
            onSelection={stableOnSelection}
            planTreeSelections={planTreeSelections}
            onPlanTreeSelectionsChange={onPlanTreeSelectionsChange}
            showAllClusters={showAllClusters}
            savedViewport={savedViewport}
            onViewportSave={onViewportSave}
            onFlowReady={onFlowReady}
          />
        </ReactFlowProvider>
      </div>
    </div>
  );
}
