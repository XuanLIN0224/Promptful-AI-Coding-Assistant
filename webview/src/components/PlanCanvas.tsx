import {
  type Dispatch,
  type MouseEvent,
  type SetStateAction,
  useCallback,
  useEffect,
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
  type Edge,
  type Node,
  type NodeChange,
  type OnSelectionChangeParams,
  type ReactFlowInstance,
  type Viewport,
} from "@xyflow/react";
import { FileGraphCenterEdge } from "../flow/fileGraphEdge";
import { planNodeTypes } from "../flow/nodeTypes";
import { computeFileGraphLayout } from "../forceLayout";
import { buildAdjacency } from "../graphAdjacency";
import {
  clusterOverviewPack,
  fileGraphEdges,
  fileGraphNodes,
  kindFromNodeId,
  layoutClusterFramesForOverview,
  planKindFromClusterFrameId,
  PLAN_CLUSTER_TREE_ROOT_IDS,
  planTreeKindFromProgramTabId,
  type PlanTreeKind,
} from "../mock/flows";
import {
  buildIncomingParentsMap,
  edgeIdsOnPathResolved,
  pathNodeIdsFromRootResolved,
  resolvedParentForNode,
} from "../treePath";
import type { ClusterFrameData, FileGraphPayload, PlanCanvasMode } from "../types";
import { CLUSTERS } from "../types";

const planEdgeTypes = { fileGraphCenter: FileGraphCenterEdge };
const FILE_NODE_SIZE = 56;
const OPACITY_FOCUS = 1;
const OPACITY_NEIGHBOUR = 0.5;
const OPACITY_DISTANT = 0.22;

function hexForPlanKind(kind: PlanTreeKind): string {
  return CLUSTERS.find((c) => c.id === kind)?.hex ?? "#888888";
}

function parentIdsFromEdges(edges: readonly Edge[]): Set<string> {
  const parents = new Set<string>();
  for (const e of edges) {
    if (kindFromNodeId(String(e.source))) parents.add(String(e.source));
  }
  return parents;
}

function childrenByParent(edges: readonly Edge[]): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const e of edges) {
    const source = String(e.source);
    const target = String(e.target);
    const arr = children.get(source);
    if (arr) arr.push(target);
    else children.set(source, [target]);
  }
  return children;
}

function descendantsHiddenByCollapse(edges: readonly Edge[], collapsed: ReadonlySet<string>): Set<string> {
  const children = childrenByParent(edges);
  const hidden = new Set<string>();
  for (const rootId of collapsed) {
    const stack = [...(children.get(rootId) ?? [])];
    while (stack.length > 0) {
      const cur = stack.pop();
      if (!cur || hidden.has(cur)) continue;
      hidden.add(cur);
      for (const child of children.get(cur) ?? []) stack.push(child);
    }
  }
  return hidden;
}

function nodeKind(node: Node): PlanTreeKind | null {
  if (node.type === "clusterFrame") return planKindFromClusterFrameId(node.id);
  return kindFromNodeId(node.id);
}

function fileGraphPack(): { nodes: Node[]; edges: Edge[] } {
  const baseNodes = fileGraphNodes as Node<FileGraphPayload>[];
  const positions = computeFileGraphLayout(baseNodes, fileGraphEdges);
  return {
    edges: fileGraphEdges,
    nodes: baseNodes.map((n) => ({
      ...n,
      position: positions.get(n.id) ?? { x: 380, y: 320 },
      origin: [0.5, 0.5] as [number, number],
      width: FILE_NODE_SIZE,
      height: FILE_NODE_SIZE,
    })),
  };
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
  onViewportSave: (viewport: Viewport, mode: PlanCanvasMode) => void;
  onFlowReady?: (instance: ReactFlowInstance | null) => void;
}) {
  const isOverview = mode === "overview";
  const isGraph = mode === "nodegraph";
  const overviewPack = useMemo(() => clusterOverviewPack(), []);
  const graphPack = useMemo(() => fileGraphPack(), []);
  const allTreeParents = useMemo(() => parentIdsFromEdges(overviewPack.edges), [overviewPack.edges]);

  const [nodes, setNodes, onNodesChange] = useNodesState(
    isOverview ? overviewPack.nodes : graphPack.nodes
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    isOverview ? overviewPack.edges : graphPack.edges
  );
  const [focusId, setFocusId] = useState<string | null>(null);
  const [treeHoverId, setTreeHoverId] = useState<string | null>(null);
  const [collapsedTreeNodeIds, setCollapsedTreeNodeIds] = useState<Set<string>>(() => new Set(allTreeParents));
  const [treeParentChoiceByKind, setTreeParentChoiceByKind] = useState<Partial<Record<PlanTreeKind, Record<string, string>>>>({});
  const [graphDragging, setGraphDragging] = useState(false);
  const flowInstanceRef = useRef<ReactFlowInstance | null>(null);
  const treeLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewportSaveRaf = useRef<number | null>(null);

  const fitCurrentView = useCallback(
    (duration = 360) => {
      const inst = flowInstanceRef.current;
      if (!inst) return;
      if (isOverview) {
        const kind = planTreeKindFromProgramTabId(planExplorerTabId);
        const candidates = inst
          .getNodes()
          .filter((n) => !n.hidden && nodeKind(n) === kind)
          .map((n) => ({ id: n.id }));
        const nodesToFit = candidates.length > 0 ? candidates : [{ id: `cluster-overview-${kind}` }];
        void inst.fitView({ nodes: nodesToFit, padding: 0.24, maxZoom: 1.35, duration });
        return;
      }
      void inst.fitView({ padding: 0.32, duration });
    },
    [isOverview, planExplorerTabId]
  );

  useEffect(() => {
    if (isOverview) {
      setNodes(layoutClusterFramesForOverview(overviewPack.nodes));
      setEdges(overviewPack.edges);
      setCollapsedTreeNodeIds(new Set(allTreeParents));
      setTreeParentChoiceByKind({});
      setTreeHoverId(null);
    } else {
      setNodes(graphPack.nodes);
      setEdges(graphPack.edges);
      setFocusId(null);
    }
    requestAnimationFrame(() => requestAnimationFrame(() => fitCurrentView(0)));
  }, [isOverview, overviewPack, graphPack, allTreeParents, setNodes, setEdges, fitCurrentView]);

  useEffect(() => {
    if (!isOverview) return;
    requestAnimationFrame(() => requestAnimationFrame(() => fitCurrentView(300)));
  }, [isOverview, planExplorerTabId, showAllClusters, fitCurrentView]);

  useEffect(
    () => () => {
      if (treeLeaveTimerRef.current) clearTimeout(treeLeaveTimerRef.current);
      if (viewportSaveRaf.current != null) cancelAnimationFrame(viewportSaveRaf.current);
      flowInstanceRef.current = null;
      onFlowReady?.(null);
    },
    [onFlowReady]
  );

  const incomingParents = useMemo(() => buildIncomingParentsMap(edges), [edges]);

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

  const handleTreeToggleChildren = useCallback((nodeId: string) => {
    setCollapsedTreeNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const handleTreeUndo = useCallback(
    (fromNodeId: string) => {
      setTreeHoverId(null);
      const kind = kindFromNodeId(fromNodeId);
      if (!kind) return;
      setCollapsedTreeNodeIds((prev) => new Set(prev).add(fromNodeId));
      onPlanTreeSelectionsChange((prev) => {
        const cur = prev[kind];
        if (cur !== fromNodeId) return prev;
        const parent = resolvedParentForNode(fromNodeId, incomingParents, treeParentChoiceByKind[kind]);
        const nextVal = parent === undefined ? null : parent;
        return { ...prev, [kind]: nextVal };
      });
    },
    [incomingParents, onPlanTreeSelectionsChange, treeParentChoiceByKind]
  );

  const { viewNodes, viewEdges } = useMemo(() => {
    if (isGraph) {
      const adjacency = buildAdjacency(edges);
      const neighbours = focusId ? adjacency.get(focusId) : undefined;
      const graphNodes = nodes.map((n) => {
        let emphasis: NonNullable<FileGraphPayload["graphEmphasis"]> = "none";
        let opacity = OPACITY_FOCUS;
        if (focusId) {
          if (focusId === n.id) emphasis = "focus";
          else if (neighbours?.has(n.id)) {
            emphasis = "neighbor";
            opacity = OPACITY_NEIGHBOUR;
          } else {
            emphasis = "dim";
            opacity = OPACITY_DISTANT;
          }
        }
        return {
          ...n,
          data: { ...(n.data as FileGraphPayload), graphEmphasis: emphasis },
          style: {
            ...(n.style as Record<string, unknown> | undefined),
            opacity,
            transition: graphDragging ? "none" : "opacity 160ms ease",
          },
        };
      });
      const graphEdges = edges.map((e) => ({
        ...e,
        type: "fileGraphCenter" as const,
        style: { ...e.style, opacity: focusId ? 0.5 : 0.34, stroke: "rgba(29,29,31,0.18)", strokeWidth: 1.2 },
      }));
      return { viewNodes: graphNodes, viewEdges: graphEdges };
    }

    const visibleKind = planTreeKindFromProgramTabId(planExplorerTabId);
    const hiddenByCollapse = descendantsHiddenByCollapse(edges, collapsedTreeNodeIds);
    const childrenMap = childrenByParent(edges);
    const hiddenIds = new Set<string>();

    const overviewNodes = nodes.map((n) => {
      const kind = nodeKind(n);
      const hiddenByCluster = !showAllClusters && kind !== visibleKind;
      const hidden = hiddenByCluster || hiddenByCollapse.has(n.id);
      if (hidden) hiddenIds.add(n.id);

      if (n.type === "clusterFrame") {
        const d = n.data as ClusterFrameData;
        return {
          ...n,
          hidden,
          draggable: showAllClusters,
          data: { ...d, clusterMat: true },
        };
      }
      if (n.type !== "decision" && n.type !== "branch") return { ...n, hidden };

      const treeKind = kindFromNodeId(n.id);
      if (!treeKind) return { ...n, hidden };
      const leaf = planTreeSelections[treeKind] ?? null;
      const parentOverride = treeParentChoiceByKind[treeKind];
      const committedSet = leaf ? new Set(pathNodeIdsFromRootResolved(leaf, incomingParents, parentOverride)) : null;
      const committed = committedSet?.has(n.id) ?? false;
      const hoverKind = treeHoverId ? kindFromNodeId(treeHoverId) : null;
      const hoverOverride =
        treeHoverId && hoverKind === treeKind ? hoverParentOverrideForKind(treeKind, treeHoverId) : parentOverride;
      const hoverSet =
        treeHoverId && hoverKind === treeKind
          ? new Set(pathNodeIdsFromRootResolved(treeHoverId, incomingParents, hoverOverride))
          : null;
      const childCount = (childrenMap.get(n.id) ?? []).length;
      return {
        ...n,
        hidden,
        zIndex: 1,
        data: {
          ...(n.data as object),
          treeCommitted: committed,
          treeHoverPath: !committed && (hoverSet?.has(n.id) ?? false),
          treePathHover: treeHoverId === n.id,
          treeShowUndo: leaf === n.id && !PLAN_CLUSTER_TREE_ROOT_IDS.has(n.id),
          onTreeUndo: handleTreeUndo,
          treeCanToggleChildren: childCount > 0,
          treeChildrenExpanded: !collapsedTreeNodeIds.has(n.id),
          onTreeToggleChildren: handleTreeToggleChildren,
        },
      };
    });

    const baseStroke = "rgba(29,29,31,0.28)";
    const hoverKind = treeHoverId ? kindFromNodeId(treeHoverId) : null;
    const hoverOverride = treeHoverId && hoverKind ? hoverParentOverrideForKind(hoverKind, treeHoverId) : undefined;
    const hoverPathIds =
      treeHoverId && hoverKind ? edgeIdsOnPathResolved(treeHoverId, edges, incomingParents, hoverOverride) : new Set<string>();

    const overviewEdges = edges.map((e) => {
      const edgeKind = kindFromNodeId(String(e.source));
      const leaf = edgeKind ? planTreeSelections[edgeKind] ?? null : null;
      const committedIds =
        leaf && edgeKind ? edgeIdsOnPathResolved(leaf, edges, incomingParents, treeParentChoiceByKind[edgeKind]) : new Set<string>();
      const committed = committedIds.has(e.id);
      const hover = hoverPathIds.has(e.id);
      const pathActive = committed || hover;
      const hx = edgeKind ? hexForPlanKind(edgeKind) : baseStroke;
      return {
        ...e,
        hidden: e.hidden || hiddenIds.has(String(e.source)) || hiddenIds.has(String(e.target)),
        animated: false,
        type: "smoothstep",
        pathOptions: { offset: 26, borderRadius: 18 },
        zIndex: pathActive ? 2 : 0,
        className: hover && !committed ? "pf-tree-edge--hot" : undefined,
        style: {
          ...e.style,
          stroke: pathActive ? hx : baseStroke,
          strokeWidth: pathActive ? 2.1 : 1.2,
          strokeDasharray: hover && !committed ? "11 9" : undefined,
          opacity: pathActive ? 0.98 : 0.74,
          filter: pathActive ? `drop-shadow(0 0 3px ${hx}88)` : undefined,
          transition: "stroke 0.14s ease, stroke-width 0.14s ease, opacity 0.14s ease, filter 0.14s ease",
        },
      };
    });

    return { viewNodes: overviewNodes, viewEdges: overviewEdges };
  }, [
    isGraph,
    nodes,
    edges,
    focusId,
    graphDragging,
    planExplorerTabId,
    collapsedTreeNodeIds,
    showAllClusters,
    planTreeSelections,
    treeParentChoiceByKind,
    incomingParents,
    treeHoverId,
    hoverParentOverrideForKind,
    handleTreeUndo,
    handleTreeToggleChildren,
  ]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (isOverview) {
        setNodes((nds) => layoutClusterFramesForOverview(applyNodeChanges(changes, nds)));
        return;
      }
      onNodesChange(changes);
    },
    [isOverview, onNodesChange, setNodes]
  );

  const handleTreeClick = useCallback(
    (node: Node) => {
      if (!isOverview || (node.type !== "decision" && node.type !== "branch")) return;
      const kind = kindFromNodeId(node.id);
      if (!kind) return;

      setCollapsedTreeNodeIds((prev) => {
        const next = new Set(prev);
        next.delete(node.id);
        return next;
      });

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
          [kind]: { ...(prev[kind] ?? {}), [node.id]: chosen },
        }));
      }
      onPlanTreeSelectionsChange((prev) => ({ ...prev, [kind]: node.id }));
      requestAnimationFrame(() => requestAnimationFrame(() => fitCurrentView(320)));
    },
    [
      fitCurrentView,
      incomingParents,
      isOverview,
      onPlanTreeSelectionsChange,
      planTreeSelections,
      treeParentChoiceByKind,
    ]
  );

  return (
    <ReactFlow
      nodes={viewNodes}
      edges={viewEdges}
      onNodesChange={handleNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={planNodeTypes}
      edgeTypes={planEdgeTypes}
      style={{ width: "100%", height: "100%" }}
      fitView={false}
      defaultViewport={savedViewport ?? undefined}
      onSelectionChange={onSelection}
      onInit={(instance) => {
        flowInstanceRef.current = instance;
        onFlowReady?.(instance);
        requestAnimationFrame(() => requestAnimationFrame(() => fitCurrentView(0)));
      }}
      onMoveEnd={(_, viewport) => {
        if (viewportSaveRaf.current != null) cancelAnimationFrame(viewportSaveRaf.current);
        viewportSaveRaf.current = requestAnimationFrame(() => {
          viewportSaveRaf.current = null;
          onViewportSave(viewport, mode);
        });
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
          if (node.type === "decision" || node.type === "branch") setTreeHoverId(node.id);
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
        if (!isGraph) return;
        setGraphDragging(true);
        setFocusId(node.id);
      }}
      onNodeDragStop={() => {
        if (!isGraph) return;
        setGraphDragging(false);
      }}
      onNodeDrag={(_evt: MouseEvent, _node: Node) => undefined}
      onNodeClick={(_, node) => handleTreeClick(node)}
      onPaneMouseDown={() => {
        if (isOverview) setTreeHoverId(null);
        else if (!graphDragging) setFocusId(null);
      }}
      defaultEdgeOptions={
        isGraph
          ? { type: "fileGraphCenter", style: { stroke: "rgba(29,29,31,0.18)", strokeWidth: 1.2 } }
          : { type: "smoothstep", style: { stroke: "rgba(0,0,0,0.18)", strokeWidth: 1.5 } }
      }
    >
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
