export type ClusterId = "core" | "account" | "groups" | "budgeting" | "security";

export type WorkspaceTab = "plan" | "program";

export type PlanCanvasMode = "overview" | "nodegraph";

export interface ClusterMeta {
  id: ClusterId;
  label: string;
  color: string;
  /** Solid colour for inline shadows / charts */
  hex: string;
}

export const CLUSTERS: ClusterMeta[] = [
  { id: "core", label: "Core", color: "var(--cluster-core)", hex: "#ffcc00" },
  { id: "account", label: "User Account & Access", color: "var(--cluster-account)", hex: "#0a84ff" },
  { id: "groups", label: "Groups", color: "var(--cluster-groups)", hex: "#34c759" },
  { id: "budgeting", label: "Budgeting", color: "var(--cluster-budgeting)", hex: "#ff9500" },
  { id: "security", label: "Security", color: "var(--cluster-security)", hex: "#5856d6" },
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

export interface GeneratedFeatureRequest {
  nodeId: string;
  title: string;
  summary: string;
  clusterId: ClusterId;
  target: "global" | "local";
}

export interface DecisionNodePayload {
  title: string;
  summary: string;
  clusterId: ClusterId;
  /** Explorer program-tab id this decision belongs to (plan tree scoping) */
  planSourceTabId?: string;
  sources: DecisionSource[];
  options?: DecisionOption[];
  /** Branch: `options` are represented as explicit child branch nodes - hide inline % tiles here. */
  optionsAsSeparateBranches?: boolean;
  confirmed?: boolean;
  /** Tree canvas: committed click selection - stationary yellow border */
  treeCommitted?: boolean;
  /** Tree canvas: on hover-preview path (dashed edges), not yet committed */
  treeHoverPath?: boolean;
  /** Tree canvas: pointer is directly over this node */
  treePathHover?: boolean;
  /** Tree canvas: show revert beside sources only on the clicked node */
  treeShowUndo?: boolean;
  /** Called with this node's id - rolls selection back one step toward root */
  onTreeUndo?: (nodeId: string) => void;
  /** Tree canvas: node has children that can be collapsed/expanded */
  treeCanToggleChildren?: boolean;
  /** Tree canvas: subtree visibility state for children */
  treeChildrenExpanded?: boolean;
  /** Called with this node's id - toggles descendant visibility */
  onTreeToggleChildren?: (nodeId: string) => void;
  /** Tree canvas: generated sidebar features from this decision node */
  featuresGenerated?: boolean;
  /** Called when the user asks the mock assistant to generate feature chips */
  onGenerateFeatures?: (nodeId: string, target: "global" | "local") => void;
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
  /** 0-1; stronger when zoomed in or when a root node is focused */
  treeTint?: number;
  /** Cluster canvas tab: same hue, light mat; frames do not clip nodes (see flows - no extent) */
  clusterMat?: boolean;
}

export interface MockPromptRecord {
  id: string;
  text: string;
  clusterId: ClusterId;
  createdAt: number;
}
