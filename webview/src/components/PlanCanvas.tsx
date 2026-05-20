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
  ControlButton,
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
import { ClusterCanvasActionsContext, type ClusterCanvasActions } from "../flow/clusterCanvasContext";
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
  nodesArgForClusterFit,
  planKindFromClusterFrameId,
  PLAN_CLUSTER_TREE_ROOT_IDS,
  type DecisionOutlineItem,
  type PlanTreeKind,
} from "../mock/flows";
import {
  buildIncomingParentsMap,
  edgeIdsOnPathResolved,
  pathNodeIdsFromRootResolved,
  resolvedParentForNode,
} from "../treePath";
import type { ClusterFrameData, ClusterId, DecisionNodePayload, DecisionSource, DynamicDecisionNode, FileGraphPayload, GeneratedFeatureRequest, PlanCanvasMode } from "../types";
import { CLUSTERS } from "../types";

const planEdgeTypes = { fileGraphCenter: FileGraphCenterEdge };
const NEIGHBOR_PULL = 0.52;
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

function initiallyCollapsedParentIds(allParents: ReadonlySet<string>): Set<string> {
  const collapsed = new Set(allParents);
  for (const rootId of PLAN_CLUSTER_TREE_ROOT_IDS) {
    collapsed.delete(rootId);
  }
  return collapsed;
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

function descendantIdsForRoots(edges: readonly Edge[], rootIds: Iterable<string>): Set<string> {
  const children = childrenByParent(edges);
  const hidden = new Set<string>();
  for (const rootId of rootIds) {
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
  const fromId = kindFromNodeId(node.id);
  if (fromId) return fromId;
  const data = node.data as Partial<DecisionNodePayload>;
  return data.clusterId ?? null;
}

function contentBoundsForKind(nodes: readonly Node[], kind: PlanTreeKind): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const content = nodes.filter((node) => node.type === "decision" || node.type === "branch").filter((node) => nodeKind(node) === kind);
  if (content.length === 0) return null;
  return content.reduce(
    (acc, node) => {
      const width = Number((node.style as { width?: number } | undefined)?.width ?? node.width ?? 220);
      const height = Number((node.style as { height?: number } | undefined)?.height ?? node.height ?? 112);
      return {
        minX: Math.min(acc.minX, node.position.x),
        minY: Math.min(acc.minY, node.position.y),
        maxX: Math.max(acc.maxX, node.position.x + width),
        maxY: Math.max(acc.maxY, node.position.y + height),
      };
    },
    { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY }
  );
}

function rootIdForKind(kind: PlanTreeKind): string {
  return [...PLAN_CLUSTER_TREE_ROOT_IDS].find((rootId) => kindFromNodeId(rootId) === kind) ?? `${kind}-root`;
}

function applyRootOnlyClusters(
  base: { nodes: Node[]; edges: Edge[] },
  rootOnlyClusterIds: readonly ClusterId[],
  clusterLabels: Partial<Record<ClusterId, string>>
): { nodes: Node[]; edges: Edge[] } {
  const rootOnly = new Set(rootOnlyClusterIds);
  if (rootOnly.size === 0) return base;
  const rootIds = new Set([...rootOnly].map((kind) => rootIdForKind(kind)));
  const nodes = base.nodes
    .filter((node) => {
      const kind = nodeKind(node);
      if (!kind || !rootOnly.has(kind)) return true;
      return node.type === "clusterFrame" || rootIds.has(node.id);
    })
    .map((node) => {
      const kind = nodeKind(node);
      if (!kind || !rootOnly.has(kind)) return node;
      if (node.type === "decision" || node.type === "branch") {
        const data = node.data as DecisionNodePayload;
        return {
          ...node,
          type: "decision",
          data: {
            ...data,
            title: clusterLabels[kind] ?? data.title,
            summary: "Empty root node. Prompt this node to generate the first decision tree.",
            options: [],
            confirmed: false,
          },
        } as Node<DecisionNodePayload>;
      }
      if (node.type === "clusterFrame") {
        const data = node.data as ClusterFrameData;
        return {
          ...node,
          data: { ...data, label: clusterLabels[kind] ?? data.label },
        } as Node<ClusterFrameData>;
      }
      return node;
    });
  const edges = base.edges.filter((edge) => {
    const sourceKind = kindFromNodeId(String(edge.source));
    const targetKind = kindFromNodeId(String(edge.target));
    return !(sourceKind && rootOnly.has(sourceKind)) && !(targetKind && rootOnly.has(targetKind));
  });
  return { nodes: layoutClusterFramesForOverview(nodes), edges };
}

function mergeNodeSources(base: DecisionSource[] | undefined, assigned: DecisionSource[] | undefined): DecisionSource[] {
  const assignedList = assigned ?? [];
  const baseList = base ?? [];
  if (assignedList.length === 0) return baseList;
  const seen = new Set(assignedList.map((source) => source.id));
  return [...assignedList, ...baseList.filter((source) => !seen.has(source.id))];
}

function collectDescendantNodeIds(nodeId: string, edges: Edge[]): Set<string> {
  const result = new Set<string>([nodeId]);
  const queue = [nodeId];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const edge of edges) {
      if (edge.source !== current || result.has(edge.target)) continue;
      result.add(edge.target);
      queue.push(edge.target);
    }
  }
  return result;
}

function appendMovedRootNodes(base: { nodes: Node[]; edges: Edge[] }, movedRootNodes: Partial<Record<ClusterId, DecisionOutlineItem[]>>): { nodes: Node[]; edges: Edge[] } {
  const extra: Node<DecisionNodePayload>[] = [];
  const extraEdges: Edge[] = [];
  for (const [kind, movedNodes] of Object.entries(movedRootNodes) as [PlanTreeKind, DecisionOutlineItem[]][]) {
    const bounds = contentBoundsForKind([...base.nodes, ...extra], kind);
    const startX = bounds ? bounds.minX : 120;
    const startY = bounds ? bounds.maxY + 96 : 120;
    const parentStack: string[] = [];
    movedNodes.forEach((item, index) => {
      const depth = Math.max(0, item.depth);
      parentStack.length = depth;
      const parentId = depth > 0 ? parentStack[depth - 1] : undefined;
      extra.push({
        id: item.nodeId,
        type: depth === 0 ? "decision" : "branch",
        position: { x: startX + depth * 284, y: startY + index * 150 },
        data: {
          title: item.title,
          summary: item.summary,
          clusterId: kind,
          planSourceTabId: "security-ts",
          sources: [{ id: `s-${item.nodeId}-move`, label: "Moved node query", kind: "prompt" }],
        },
        draggable: true,
        zIndex: 1,
      });
      if (parentId) {
        extraEdges.push({
          id: `moved-edge-${parentId}-${item.nodeId}`,
          source: parentId,
          target: item.nodeId,
          type: "smoothstep",
          animated: false,
        });
      }
      parentStack[depth] = item.nodeId;
    });
  }
  return extra.length > 0 ? { nodes: [...base.nodes, ...extra], edges: [...base.edges, ...extraEdges] } : base;
}

function appendDynamicDecisionNodes(base: { nodes: Node[]; edges: Edge[] }, dynamicNodes: Partial<Record<ClusterId, DynamicDecisionNode[]>>): { nodes: Node[]; edges: Edge[] } {
  const extra: Node<DecisionNodePayload>[] = [];
  const extraEdges: Edge[] = [];
  const childCounts = new Map<string, number>();

  for (const [kind, items] of Object.entries(dynamicNodes) as [PlanTreeKind, DynamicDecisionNode[]][]) {
    const bounds = contentBoundsForKind([...base.nodes, ...extra], kind);
    let rootOffset = 0;
    for (const item of items) {
      const parentId = item.parentNodeId;
      const parent = parentId ? [...base.nodes, ...extra].find((node) => node.id === parentId) : undefined;
      const siblingIndex = parentId ? childCounts.get(parentId) ?? 0 : rootOffset;
      if (parentId) childCounts.set(parentId, siblingIndex + 1);
      else rootOffset += 1;

      const parentWidth = Number((parent?.style as { width?: number } | undefined)?.width ?? parent?.width ?? 260);
      const xNudge = siblingIndex === 0 ? -160 : siblingIndex === 1 ? 170 : -160 + siblingIndex * 170;
      const position = parent
        ? { x: parent.position.x + xNudge + parentWidth * 0.16, y: parent.position.y + 190 + Math.floor(siblingIndex / 2) * 130 }
        : { x: bounds ? bounds.minX + rootOffset * 42 : 120, y: bounds ? bounds.maxY + 120 + rootOffset * 150 : 120 };

      extra.push({
        id: item.nodeId,
        type: item.depth === 0 ? "decision" : "branch",
        position,
        data: {
          title: item.title,
          summary: item.summary,
          clusterId: kind,
          planSourceTabId: "security-ts",
          sources: [{ id: `s-${item.nodeId}-prompt`, label: "Participant expansion prompt", kind: "prompt" }],
        },
        draggable: true,
        zIndex: 1,
      });
      if (parentId) {
        extraEdges.push({
          id: `dynamic-edge-${parentId}-${item.nodeId}`,
          source: parentId,
          target: item.nodeId,
          type: "smoothstep",
          animated: false,
        });
      }
    }
  }

  return extra.length > 0 ? { nodes: [...base.nodes, ...extra], edges: [...base.edges, ...extraEdges] } : base;
}

function fileBaseName(path: string): string {
  const norm = path.replace(/\\/g, "/");
  const last = norm.split("/").pop();
  return last && last.length > 0 ? last : path;
}

/** File graph reflects workspace files only (empty until Apply plan writes sources). */
function fileGraphPack(workspaceFilePaths: readonly string[]): { nodes: Node[]; edges: Edge[] } {
  if (workspaceFilePaths.length === 0) {
    return { nodes: [], edges: [] };
  }
  const presentNames = new Set(workspaceFilePaths.map((p) => fileBaseName(p).toLowerCase()));
  const baseNodes = (fileGraphNodes as Node<FileGraphPayload>[]).filter((n) =>
    presentNames.has(n.data.path.toLowerCase())
  );
  const nodeIds = new Set(baseNodes.map((n) => n.id));
  const graphEdges = fileGraphEdges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
  const positions = computeFileGraphLayout(baseNodes, graphEdges);
  return {
    edges: graphEdges,
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
  workspaceFilePaths,
  planExplorerTabId,
  planClusterFocus,
  enabledClusterIds,
  clusterLabels,
  onSelection,
  planTreeSelections,
  onPlanTreeSelectionsChange,
  onClusterFocusChange,
  onNavigateCluster,
  showAllClusters,
  onToggleShowAllClusters,
  savedViewport,
  onViewportSave,
  onFlowReady,
  onGenerateFeatures,
  generatedFeatureNodeIds,
  movedRootNodes,
  dynamicDecisionNodes,
  rootOnlyClusterIds,
  chatPromptCounts,
  confirmedNodeIds,
  onToggleConfirmNode,
  onRequestMoveNode,
  onClusterComplete,
  onTreeUndoNode,
  onTreeNodesCollapsed,
  onOpenClusterMenu,
  deletedNodeIds,
  onDeleteTreeNodes,
  sourcesByNodeId,
}: {
  mode: PlanCanvasMode;
  onOpenClusterMenu?: ClusterCanvasActions["openClusterMenu"];
  workspaceFilePaths: readonly string[];
  planExplorerTabId: string;
  planClusterFocus: ClusterId;
  enabledClusterIds: readonly ClusterId[];
  clusterLabels: Partial<Record<ClusterId, string>>;
  onSelection: (p: OnSelectionChangeParams) => void;
  planTreeSelections: Partial<Record<PlanTreeKind, string | null>>;
  onPlanTreeSelectionsChange: Dispatch<SetStateAction<Partial<Record<PlanTreeKind, string | null>>>>;
  onClusterFocusChange: (cluster: ClusterId) => void;
  onNavigateCluster?: (cluster: ClusterId) => void;
  showAllClusters: boolean;
  onToggleShowAllClusters: () => void;
  savedViewport: Viewport | null;
  onViewportSave: (viewport: Viewport, mode: PlanCanvasMode) => void;
  onFlowReady?: (instance: ReactFlowInstance | null) => void;
  onGenerateFeatures: (request: GeneratedFeatureRequest) => void;
  generatedFeatureNodeIds: ReadonlySet<string>;
  movedRootNodes: Partial<Record<ClusterId, DecisionOutlineItem[]>>;
  dynamicDecisionNodes: Partial<Record<ClusterId, DynamicDecisionNode[]>>;
  rootOnlyClusterIds: readonly ClusterId[];
  chatPromptCounts: Record<string, number>;
  confirmedNodeIds: ReadonlySet<string>;
  onToggleConfirmNode: (nodeId: string) => void;
  onRequestMoveNode: (nodeId: string, clusterId: ClusterId) => void;
  onClusterComplete: (kind: PlanTreeKind) => void;
  onTreeUndoNode: (nodeId: string, kind: PlanTreeKind) => void;
  onTreeNodesCollapsed: (nodeIds: string[], kind: PlanTreeKind) => void;
  deletedNodeIds: ReadonlySet<string>;
  onDeleteTreeNodes: (nodeIds: string[], kind: PlanTreeKind, label: string) => void;
  sourcesByNodeId: Record<string, DecisionSource[]>;
}) {
  const isOverview = mode === "overview";
  const isGraph = mode === "nodegraph";
  const clusterCanvasActions = useMemo<ClusterCanvasActions | null>(
    () => (isOverview && onOpenClusterMenu ? { openClusterMenu: onOpenClusterMenu } : null),
    [isOverview, onOpenClusterMenu]
  );
  const overviewPack = useMemo(() => {
    const rootScoped = applyRootOnlyClusters(clusterOverviewPack(enabledClusterIds), rootOnlyClusterIds, clusterLabels);
    const withMoved = appendMovedRootNodes(rootScoped, movedRootNodes);
    return appendDynamicDecisionNodes(withMoved, dynamicDecisionNodes);
  }, [enabledClusterIds, rootOnlyClusterIds, clusterLabels, movedRootNodes, dynamicDecisionNodes]);
  const enabledClusterSet = useMemo(() => new Set(enabledClusterIds), [enabledClusterIds]);
  const graphPack = useMemo(() => fileGraphPack(workspaceFilePaths), [workspaceFilePaths]);
  const allTreeParents = useMemo(() => parentIdsFromEdges(overviewPack.edges), [overviewPack.edges]);

  const [nodes, setNodes, onNodesChange] = useNodesState(
    isOverview ? overviewPack.nodes : graphPack.nodes
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    isOverview ? overviewPack.edges : graphPack.edges
  );
  const [focusId, setFocusId] = useState<string | null>(null);
  const [treeHoverId, setTreeHoverId] = useState<string | null>(null);
  const [collapsedTreeNodeIds, setCollapsedTreeNodeIds] = useState<Set<string>>(() =>
    initiallyCollapsedParentIds(allTreeParents)
  );
  const [nodeTextEdits, setNodeTextEdits] = useState<Record<string, { title: string; summary: string }>>({});
  const [editDraft, setEditDraft] = useState<null | { nodeId: string; title: string; summary: string }>(null);
  const [deleteDraft, setDeleteDraft] = useState<null | { nodeId: string; kind: PlanTreeKind; label: string }>(null);
  const [treeParentChoiceByKind, setTreeParentChoiceByKind] = useState<Partial<Record<PlanTreeKind, Record<string, string>>>>({});
  const [graphDragging, setGraphDragging] = useState(false);
  const dragLastPosRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const flowInstanceRef = useRef<ReactFlowInstance | null>(null);
  const treeLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewportSaveRaf = useRef<number | null>(null);

  const fitCurrentView = useCallback(
    (duration = 360) => {
      const inst = flowInstanceRef.current;
      if (!inst) return;
      if (isOverview) {
        if (showAllClusters) {
          const frameIds = inst
            .getNodes()
            .filter((n) => n.type === "clusterFrame" && (n.data as ClusterFrameData)?.clusterMat)
            .map((n) => ({ id: n.id }));
          if (frameIds.length > 0) {
            void inst.fitView({ nodes: frameIds, padding: 0.1, maxZoom: 1.12, duration });
            return;
          }
          void inst.fitView({ padding: 0.1, maxZoom: 1.12, duration });
          return;
        }
        const kind = planClusterFocus as PlanTreeKind;
        const candidates = nodesArgForClusterFit(kind, inst.getNodes()).filter(({ id }) => {
          const node = inst.getNode(id);
          return node && !node.hidden;
        });
        const nodesToFit = candidates.length > 0 ? candidates : [{ id: `cluster-overview-${kind}` }];
        void inst.fitView({ nodes: nodesToFit, padding: 0.24, maxZoom: 1.35, duration });
        return;
      }
      void inst.fitView({ padding: 0.32, duration });
    },
    [isOverview, planClusterFocus, showAllClusters]
  );

  useEffect(() => {
    if (isOverview) {
      setNodes(layoutClusterFramesForOverview(overviewPack.nodes));
      setEdges(overviewPack.edges);
      setCollapsedTreeNodeIds(initiallyCollapsedParentIds(allTreeParents));
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
  }, [isOverview, planExplorerTabId, planClusterFocus, showAllClusters, fitCurrentView]);

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
  const graphAdjacency = useMemo(() => (isGraph ? buildAdjacency(edges) : new Map<string, Set<string>>()), [edges, isGraph]);

  useEffect(() => {
    if (!isOverview) return;
    setCollapsedTreeNodeIds(() => {
      const next = initiallyCollapsedParentIds(allTreeParents);
      for (const [kind, nodeId] of Object.entries(planTreeSelections) as [PlanTreeKind, string | null | undefined][]) {
        if (!nodeId || kindFromNodeId(nodeId) !== kind) continue;
        const path = pathNodeIdsFromRootResolved(nodeId, incomingParents, treeParentChoiceByKind[kind]);
        for (const id of path) next.delete(id);
      }
      return next;
    });
  }, [allTreeParents, incomingParents, isOverview, planTreeSelections, treeParentChoiceByKind]);

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

  const handleTreeEditNode = useCallback(
    (nodeId: string) => {
      const node = nodes.find((candidate) => candidate.id === nodeId);
      if (!node || (node.type !== "decision" && node.type !== "branch")) return;
      const data = node.data as DecisionNodePayload;
      const current = nodeTextEdits[nodeId] ?? { title: data.title, summary: data.summary };
      setEditDraft({ nodeId, title: current.title, summary: current.summary });
    },
    [nodeTextEdits, nodes]
  );

  const applyEditDraft = useCallback(() => {
    if (!editDraft) return;
    setNodeTextEdits((prev) => ({
      ...prev,
      [editDraft.nodeId]: {
        title: editDraft.title.trim() || "Untitled decision",
        summary: editDraft.summary.trim() || "Describe this decision.",
      },
    }));
    setEditDraft(null);
  }, [editDraft]);

  const handleTreeDeleteNode = useCallback(
    (nodeId: string, clusterId: ClusterId) => {
      if (PLAN_CLUSTER_TREE_ROOT_IDS.has(nodeId)) return;
      const node = nodes.find((candidate) => candidate.id === nodeId);
      if (!node || (node.type !== "decision" && node.type !== "branch")) return;
      const data = node.data as DecisionNodePayload;
      const current = nodeTextEdits[nodeId] ?? { title: data.title, summary: data.summary };
      const kind = kindFromNodeId(nodeId) ?? (clusterId as PlanTreeKind);
      setDeleteDraft({ nodeId, kind, label: current.title.trim() || "Untitled decision" });
    },
    [nodeTextEdits, nodes]
  );

  const applyDeleteDraft = useCallback(() => {
    if (!deleteDraft) return;
    const ids = collectDescendantNodeIds(deleteDraft.nodeId, edges);
    onDeleteTreeNodes([...ids], deleteDraft.kind, deleteDraft.label);
    setDeleteDraft(null);
    setTreeHoverId(null);
  }, [deleteDraft, edges, onDeleteTreeNodes]);

  const handleTreeUndo = useCallback(
    (fromNodeId: string) => {
      setTreeHoverId(null);
      const kind = kindFromNodeId(fromNodeId);
      if (!kind) return;
      setCollapsedTreeNodeIds((prev) => new Set(prev).add(fromNodeId));
      onTreeUndoNode(fromNodeId, kind);
      onPlanTreeSelectionsChange((prev) => {
        const cur = prev[kind];
        if (cur !== fromNodeId) return prev;
        const parent = resolvedParentForNode(fromNodeId, incomingParents, treeParentChoiceByKind[kind]);
        const nextVal = parent === undefined ? null : parent;
        return { ...prev, [kind]: nextVal };
      });
    },
    [incomingParents, onPlanTreeSelectionsChange, onTreeUndoNode, treeParentChoiceByKind]
  );

  const { viewNodes, viewEdges } = useMemo(() => {
    if (isGraph) {
      const neighbours = focusId ? graphAdjacency.get(focusId) : undefined;
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
      const graphEdges = edges.map((e) => {
        const direct = focusId ? e.source === focusId || e.target === focusId : false;
        return {
          ...e,
          type: "fileGraphCenter" as const,
          hidden: focusId ? !direct : false,
          style: {
            ...e.style,
            opacity: focusId ? (direct ? 0.62 : 0) : 0.34,
            stroke: direct ? "rgba(29,29,31,0.36)" : "rgba(29,29,31,0.18)",
            strokeWidth: direct ? 1.45 : 1.2,
          },
        };
      });
      return { viewNodes: graphNodes, viewEdges: graphEdges };
    }

      const visibleKind = planClusterFocus as PlanTreeKind;
      const hiddenByCollapse = descendantsHiddenByCollapse(edges, collapsedTreeNodeIds);
      const childrenMap = childrenByParent(edges);
    const hiddenIds = new Set<string>();

    const overviewNodes = nodes.map((n) => {
      const kind = nodeKind(n);
      const hiddenByEnabledCluster = kind ? !enabledClusterSet.has(kind) : false;
      const hiddenByCluster = !showAllClusters && kind !== visibleKind;
      const hiddenByDeleted = deletedNodeIds.has(n.id);
      const hidden = hiddenByDeleted || hiddenByEnabledCluster || hiddenByCluster || hiddenByCollapse.has(n.id);
      if (hidden) hiddenIds.add(n.id);
      const canDeleteNode =
        (n.type === "decision" || n.type === "branch") && !PLAN_CLUSTER_TREE_ROOT_IDS.has(n.id) && !hiddenByDeleted;

      if (n.type === "clusterFrame") {
        const d = n.data as ClusterFrameData;
        return {
          ...n,
          hidden,
          draggable: showAllClusters,
          data: {
            ...d,
            label: clusterLabels[d.clusterId] ?? d.label,
            clusterMat: true,
            overviewSelectable: showAllClusters,
          },
        };
      }
      if (n.type !== "decision" && n.type !== "branch") return { ...n, hidden };

      const treeKind = kindFromNodeId(n.id);
      if (!treeKind) {
        const fallbackKind = (n.data as Partial<DecisionNodePayload>).clusterId;
        if (!fallbackKind) return { ...n, hidden };
        const d = n.data as DecisionNodePayload;
        return {
          ...n,
          hidden,
          zIndex: 1,
          data: {
            ...(n.data as object),
            ...(nodeTextEdits[n.id] ?? {}),
            sources: mergeNodeSources(d.sources, sourcesByNodeId[n.id]),
            treeCommitted: false,
            treeHoverPath: false,
            treePathHover: treeHoverId === n.id,
            treeShowUndo: false,
            treeCanToggleChildren: false,
            treeChildrenExpanded: true,
            featuresGenerated: generatedFeatureNodeIds.has(n.id),
            chatPromptCount: chatPromptCounts[n.id] ?? 0,
            nodeConfirmed: confirmedNodeIds.has(n.id),
            onToggleConfirm: onToggleConfirmNode,
            onMoveNode: onRequestMoveNode,
            onEditNode: handleTreeEditNode,
            onDeleteNode: canDeleteNode ? handleTreeDeleteNode : undefined,
            onGenerateFeatures: (_nodeId: string, target: "global" | "local") =>
              onGenerateFeatures({
                nodeId: n.id,
                title: d.title,
                summary: d.summary,
                clusterId: d.clusterId,
                target,
              }),
          },
        };
      }
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
      const d = n.data as DecisionNodePayload;
      const rootTitleOverride = PLAN_CLUSTER_TREE_ROOT_IDS.has(n.id) ? clusterLabels[treeKind] : undefined;
      return {
        ...n,
        hidden,
        zIndex: 1,
        data: {
          ...(n.data as object),
          ...(rootTitleOverride ? { title: rootTitleOverride } : {}),
          ...(nodeTextEdits[n.id] ?? {}),
          sources: mergeNodeSources(d.sources, sourcesByNodeId[n.id]),
          treeCommitted: committed,
          treeHoverPath: !committed && (hoverSet?.has(n.id) ?? false),
          treePathHover: treeHoverId === n.id,
          treeShowUndo: leaf === n.id && !PLAN_CLUSTER_TREE_ROOT_IDS.has(n.id),
          onTreeUndo: handleTreeUndo,
          treeCanToggleChildren: childCount > 0,
          treeChildrenExpanded: !collapsedTreeNodeIds.has(n.id),
          onTreeToggleChildren: handleTreeToggleChildren,
          featuresGenerated: generatedFeatureNodeIds.has(n.id),
          chatPromptCount: chatPromptCounts[n.id] ?? 0,
          nodeConfirmed: committed || confirmedNodeIds.has(n.id),
          onToggleConfirm: onToggleConfirmNode,
          onMoveNode: onRequestMoveNode,
          onEditNode: handleTreeEditNode,
          onDeleteNode: canDeleteNode ? handleTreeDeleteNode : undefined,
          onGenerateFeatures: (_nodeId: string, target: "global" | "local") =>
            onGenerateFeatures({
              nodeId: n.id,
              title: d.title,
              summary: d.summary,
              clusterId: d.clusterId,
              target,
            }),
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
    graphAdjacency,
    planExplorerTabId,
    collapsedTreeNodeIds,
    showAllClusters,
    planTreeSelections,
    treeParentChoiceByKind,
    planClusterFocus,
    enabledClusterSet,
    clusterLabels,
    incomingParents,
    treeHoverId,
    hoverParentOverrideForKind,
    handleTreeUndo,
    handleTreeToggleChildren,
    handleTreeEditNode,
    handleTreeDeleteNode,
    deletedNodeIds,
    sourcesByNodeId,
    generatedFeatureNodeIds,
    chatPromptCounts,
    confirmedNodeIds,
    onToggleConfirmNode,
    onRequestMoveNode,
    nodeTextEdits,
    onGenerateFeatures,
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

  const propagateNeighborDrag = useCallback(
    (_event: MouseEvent, node: Node) => {
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
      const followers = graphAdjacency.get(node.id);
      if (!followers?.size) return;
      setNodes((nds) =>
        nds.map((n) =>
          followers.has(n.id)
            ? {
                ...n,
                position: {
                  x: n.position.x + dx * NEIGHBOR_PULL,
                  y: n.position.y + dy * NEIGHBOR_PULL,
                },
              }
            : n
        )
      );
    },
    [graphAdjacency, isGraph, setNodes]
  );

  const handleTreeClick = useCallback(
    (node: Node) => {
      if (isOverview && showAllClusters && onNavigateCluster) {
        let kind: PlanTreeKind | null = null;
        if (node.type === "clusterFrame") {
          kind = planKindFromClusterFrameId(node.id);
        } else if (node.type === "decision" || node.type === "branch") {
          kind =
            kindFromNodeId(node.id) ??
            ((node.data as Partial<DecisionNodePayload>).clusterId as PlanTreeKind | undefined) ??
            null;
        }
        if (kind) {
          onNavigateCluster(kind as ClusterId);
          return;
        }
      }
      if (!isOverview || (node.type !== "decision" && node.type !== "branch")) return;
      const kind = kindFromNodeId(node.id) ?? (node.data as Partial<DecisionNodePayload>).clusterId;
      if (!kind) return;
      const childCount = (childrenByParent(edges).get(node.id) ?? []).length;
      const isRootOnlyKind = rootOnlyClusterIds.includes(kind);
      const isTerminal = !isRootOnlyKind && (childCount === 0 || Boolean((node.data as { confirmed?: boolean }).confirmed));

      const candidates = (incomingParents.get(node.id) ?? []).filter((p) => kindFromNodeId(p) === kind);
      let nextParentChoiceForKind = treeParentChoiceByKind[kind] ?? {};
      if (candidates.length > 1) {
        let chosen = candidates[0];
        const currentLeaf = planTreeSelections[kind] ?? null;
        const parentOverride = nextParentChoiceForKind;
        if (currentLeaf && candidates.includes(currentLeaf)) {
          chosen = currentLeaf;
        } else if (currentLeaf) {
          const currentPath = new Set(pathNodeIdsFromRootResolved(currentLeaf, incomingParents, parentOverride));
          const ancestor = candidates.find((p) => currentPath.has(p));
          if (ancestor) chosen = ancestor;
        }
        nextParentChoiceForKind = { ...nextParentChoiceForKind, [node.id]: chosen };
        setTreeParentChoiceByKind((prev) => ({
          ...prev,
          [kind]: nextParentChoiceForKind,
        }));
      }
      const selectedPath = new Set(pathNodeIdsFromRootResolved(node.id, incomingParents, nextParentChoiceForKind));
      setCollapsedTreeNodeIds((prevCollapsed) => {
        const next = initiallyCollapsedParentIds(allTreeParents);
        const newlyCollapsedParents: string[] = [];
        for (const parentId of allTreeParents) {
          if (kindFromNodeId(parentId) !== kind) continue;
          if (selectedPath.has(parentId)) {
            next.delete(parentId);
          } else {
            next.add(parentId);
            if (!prevCollapsed.has(parentId)) newlyCollapsedParents.push(parentId);
          }
        }
        const collapsedDescendants = [...descendantIdsForRoots(edges, newlyCollapsedParents)].filter(
          (id) => kindFromNodeId(id) === kind
        );
        if (collapsedDescendants.length > 0) onTreeNodesCollapsed(collapsedDescendants, kind);
        return next;
      });
      if (!node.id.includes("-moved-")) {
        onPlanTreeSelectionsChange((prev) => ({ ...prev, [kind]: node.id }));
        if (isTerminal) onClusterComplete(kind);
        if (["co-equal", "co-cents", "co-percent", "co-settle"].includes(node.id)) onClusterComplete("core");
        if (["gr-household", "gr-invite", "gr-balances"].includes(node.id)) onClusterComplete("groups");
      }
      requestAnimationFrame(() => requestAnimationFrame(() => fitCurrentView(320)));
    },
    [
      fitCurrentView,
      allTreeParents,
      incomingParents,
      isOverview,
      onPlanTreeSelectionsChange,
      onClusterComplete,
      onTreeNodesCollapsed,
      edges,
      collapsedTreeNodeIds,
      planTreeSelections,
      treeParentChoiceByKind,
      onClusterFocusChange,
      onNavigateCluster,
      rootOnlyClusterIds,
      showAllClusters,
    ]
  );

  return (
  <ClusterCanvasActionsContext.Provider value={clusterCanvasActions}>
    <>
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
          dragLastPosRef.current = { id: node.id, x: node.position.x, y: node.position.y };
        }}
        onNodeDragStop={() => {
          if (!isGraph) return;
          setGraphDragging(false);
          dragLastPosRef.current = null;
        }}
        onNodeDrag={(evt: MouseEvent, node: Node) => propagateNeighborDrag(evt, node)}
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
        <Controls showInteractive={false} className={isOverview ? "pf-controls-with-overview-eye" : undefined}>
          {isOverview && (
            <ControlButton
              className="pf-flow-controls-eye"
              onClick={onToggleShowAllClusters}
              title={showAllClusters ? "Hide others" : "Show all"}
              data-tip={showAllClusters ? "Hide other clusters" : "Show all clusters"}
              aria-label={showAllClusters ? "Hide other clusters" : "Show all clusters"}
            >
              {showAllClusters ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M3 3 21 21" />
                  <path d="M10.58 10.58A3 3 0 1 0 13.42 13.42" />
                  <path d="M9.88 5.09A10.94 10.94 0 0 1 12 5c7 0 10 7 10 7a13.05 13.05 0 0 1-2.35 3.88" />
                  <path d="M6.61 6.61A13.95 13.95 0 0 0 2 12s4 7 10 7a9.74 9.74 0 0 0 4.52-1.22" />
                </svg>
              )}
            </ControlButton>
          )}
        </Controls>
        <MiniMap
          pannable
          zoomable
          maskColor="rgba(255,255,255,0.82)"
          nodeStrokeWidth={2}
          nodeColor={() => "rgba(0,0,0,0.12)"}
        />
      </ReactFlow>
      {editDraft && (
        <div className="pf-tree-edit-modal-backdrop" role="presentation" onMouseDown={() => setEditDraft(null)}>
          <div
            className="pf-tree-edit-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pf-tree-edit-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div id="pf-tree-edit-title" className="pf-tree-edit-modal__title">Edit decision node</div>
            <label className="pf-tree-edit-modal__field">
              <span>Title</span>
              <input
                value={editDraft.title}
                onChange={(event) => setEditDraft((prev) => (prev ? { ...prev, title: event.target.value } : prev))}
                autoFocus
              />
            </label>
            <label className="pf-tree-edit-modal__field">
              <span>Summary</span>
              <textarea
                value={editDraft.summary}
                onChange={(event) => setEditDraft((prev) => (prev ? { ...prev, summary: event.target.value } : prev))}
                rows={4}
              />
            </label>
            <div className="pf-tree-edit-modal__actions">
              <button type="button" className="pf-tree-edit-modal__ghost" onClick={() => setEditDraft(null)}>Cancel</button>
              <button type="button" className="pf-tree-edit-modal__confirm" onClick={applyEditDraft}>Save</button>
            </div>
          </div>
        </div>
      )}
      {deleteDraft && (
        <div className="pf-tree-edit-modal-backdrop" role="presentation" onMouseDown={() => setDeleteDraft(null)}>
          <div
            className="pf-tree-edit-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pf-tree-delete-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div id="pf-tree-delete-title" className="pf-tree-edit-modal__title">Delete decision node?</div>
            <p className="pf-tree-edit-modal__body">
              Delete <strong>{deleteDraft.label}</strong> and its child decisions from the tree? This cannot be undone.
            </p>
            <div className="pf-tree-edit-modal__actions">
              <button type="button" className="pf-tree-edit-modal__ghost" onClick={() => setDeleteDraft(null)}>Cancel</button>
              <button type="button" className="pf-tree-edit-modal__confirm pf-tree-edit-modal__confirm--danger" onClick={applyDeleteDraft}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  </ClusterCanvasActionsContext.Provider>
  );
}

export function PlanCanvas({
  mode,
  workspaceFilePaths,
  planExplorerTabId,
  planClusterFocus,
  enabledClusterIds,
  clusterLabels,
  onSelection,
  planTreeSelections,
  onPlanTreeSelectionsChange,
  onClusterFocusChange,
  onNavigateCluster,
  showAllClusters,
  onToggleShowAllClusters,
  savedViewport,
  onViewportSave,
  onFlowReady,
  onGenerateFeatures,
  generatedFeatureNodeIds,
  movedRootNodes,
  dynamicDecisionNodes,
  rootOnlyClusterIds,
  chatPromptCounts,
  confirmedNodeIds,
  onToggleConfirmNode,
  onRequestMoveNode,
  onClusterComplete,
  onTreeUndoNode,
  onTreeNodesCollapsed,
  onOpenClusterMenu,
  deletedNodeIds,
  onDeleteTreeNodes,
  sourcesByNodeId,
}: {
  mode: PlanCanvasMode;
  onOpenClusterMenu?: ClusterCanvasActions["openClusterMenu"];
  workspaceFilePaths: readonly string[];
  planExplorerTabId: string;
  planClusterFocus: ClusterId;
  enabledClusterIds: readonly ClusterId[];
  clusterLabels: Partial<Record<ClusterId, string>>;
  onSelection: (p: OnSelectionChangeParams) => void;
  planTreeSelections: Partial<Record<PlanTreeKind, string | null>>;
  onPlanTreeSelectionsChange: Dispatch<SetStateAction<Partial<Record<PlanTreeKind, string | null>>>>;
  onClusterFocusChange: (cluster: ClusterId) => void;
  onNavigateCluster?: (cluster: ClusterId) => void;
  showAllClusters: boolean;
  onToggleShowAllClusters: () => void;
  savedViewport: Viewport | null;
  onViewportSave: (viewport: Viewport, mode: PlanCanvasMode) => void;
  onFlowReady?: (instance: ReactFlowInstance | null) => void;
  onGenerateFeatures: (request: GeneratedFeatureRequest) => void;
  generatedFeatureNodeIds: ReadonlySet<string>;
  movedRootNodes: Partial<Record<ClusterId, DecisionOutlineItem[]>>;
  dynamicDecisionNodes: Partial<Record<ClusterId, DynamicDecisionNode[]>>;
  rootOnlyClusterIds: readonly ClusterId[];
  chatPromptCounts: Record<string, number>;
  confirmedNodeIds: ReadonlySet<string>;
  onToggleConfirmNode: (nodeId: string) => void;
  onRequestMoveNode: (nodeId: string, clusterId: ClusterId) => void;
  onClusterComplete: (kind: PlanTreeKind) => void;
  onTreeUndoNode: (nodeId: string, kind: PlanTreeKind) => void;
  onTreeNodesCollapsed: (nodeIds: string[], kind: PlanTreeKind) => void;
  deletedNodeIds: ReadonlySet<string>;
  onDeleteTreeNodes: (nodeIds: string[], kind: PlanTreeKind, label: string) => void;
  sourcesByNodeId: Record<string, DecisionSource[]>;
}) {
  const stableOnSelection = useCallback((p: OnSelectionChangeParams) => onSelection(p), [onSelection]);
  return (
    <div className="pf-canvas">
      <div className="pf-canvas__flow-host">
        <ReactFlowProvider>
          <Inner
            mode={mode}
            workspaceFilePaths={workspaceFilePaths}
            planExplorerTabId={planExplorerTabId}
            planClusterFocus={planClusterFocus}
            enabledClusterIds={enabledClusterIds}
            clusterLabels={clusterLabels}
            onSelection={stableOnSelection}
            planTreeSelections={planTreeSelections}
            onPlanTreeSelectionsChange={onPlanTreeSelectionsChange}
            onClusterFocusChange={onClusterFocusChange}
            onNavigateCluster={onNavigateCluster}
            showAllClusters={showAllClusters}
            onToggleShowAllClusters={onToggleShowAllClusters}
            savedViewport={savedViewport}
            onViewportSave={onViewportSave}
            onFlowReady={onFlowReady}
            onGenerateFeatures={onGenerateFeatures}
            generatedFeatureNodeIds={generatedFeatureNodeIds}
            movedRootNodes={movedRootNodes}
            dynamicDecisionNodes={dynamicDecisionNodes}
            rootOnlyClusterIds={rootOnlyClusterIds}
            chatPromptCounts={chatPromptCounts}
            confirmedNodeIds={confirmedNodeIds}
            onToggleConfirmNode={onToggleConfirmNode}
            onRequestMoveNode={onRequestMoveNode}
            onClusterComplete={onClusterComplete}
            onTreeUndoNode={onTreeUndoNode}
            onTreeNodesCollapsed={onTreeNodesCollapsed}
            onOpenClusterMenu={onOpenClusterMenu}
            deletedNodeIds={deletedNodeIds}
            onDeleteTreeNodes={onDeleteTreeNodes}
            sourcesByNodeId={sourcesByNodeId}
          />
        </ReactFlowProvider>
      </div>
    </div>
  );
}
