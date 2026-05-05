export type ClusterId = "security" | "core" | "infra";

export type WorkspaceTab = "plan" | "program" | "coordinate";

export type PlanCanvasMode = "overview" | "nodegraph";

export interface ClusterMeta {
  id: ClusterId;
  label: string;
  color: string;
  /** Solid color for inline shadows / charts */
  hex: string;
}

export const CLUSTERS: ClusterMeta[] = [
  { id: "security", label: "Security", color: "var(--cluster-security)", hex: "#5856d6" },
  { id: "core", label: "Core", color: "var(--cluster-core)", hex: "#ffcc00" },
  { id: "infra", label: "Infra", color: "var(--cluster-infra)", hex: "#34c759" },
];

export interface FeatureItem {
  id: string;
  label: string;
}

export interface DecisionSource {
  id: string;
  label: string;
  kind: "prompt" | "file" | "assumption" | "feature";
}

export interface DecisionOption {
  id: string;
  label: string;
  confidence: number;
  summary: string;
}

export interface DecisionNodePayload {
  title: string;
  summary: string;
  clusterId: ClusterId;
  /** Explorer program-tab id this decision belongs to (plan tree scoping) */
  planSourceTabId?: string;
  sources: DecisionSource[];
  options?: DecisionOption[];
  /** Branch: `options` are represented as explicit child branch nodes — hide inline % tiles here. */
  optionsAsSeparateBranches?: boolean;
  confirmed?: boolean;
  /** Tree canvas: committed click selection — stationary yellow border */
  treeCommitted?: boolean;
  /** Tree canvas: on hover-preview path (dashed edges), not yet committed */
  treeHoverPath?: boolean;
  /** Tree canvas: pointer is directly over this node */
  treePathHover?: boolean;
  /** Tree canvas: show revert beside sources only on the clicked node */
  treeShowUndo?: boolean;
  /** Called with this node's id — rolls selection back one step toward root */
  onTreeUndo?: (nodeId: string) => void;
  /** Tree canvas: node has children that can be collapsed/expanded */
  treeCanToggleChildren?: boolean;
  /** Tree canvas: subtree visibility state for children */
  treeChildrenExpanded?: boolean;
  /** Called with this node's id — toggles descendant visibility */
  onTreeToggleChildren?: (nodeId: string) => void;
}

export interface FileGraphPayload {
  path: string;
  clusterShare: Record<ClusterId, number>;
  /** Node graph (Obsidian-style) visual state */
  graphEmphasis?: "none" | "focus" | "neighbor" | "dim";
}

export interface ClusterFrameData {
  label: string;
  clusterId: ClusterId;
  /** Decision tree: cluster wash behind all nodes; pointer-events none */
  treeBackdrop?: boolean;
  /** 0–1; stronger when zoomed in or when Calendar (root) is focused */
  treeTint?: number;
  /** Cluster canvas tab: same hue, light mat; frames do not clip nodes (see flows — no extent) */
  clusterMat?: boolean;
}

export interface MockPromptRecord {
  id: string;
  text: string;
  clusterId: ClusterId;
  createdAt: number;
}
