export type ClusterId =
  | "core"
  | "account"
  | "groups"
  | "budgeting"
  | "security"
  | "compliance"
  | "compliance2"
  | "compliance3"
  | "compliance4"
  | "compliance5"
  | "compliance6"
  | "compliance7"
  | "compliance8"
  | "compliance9"
  | "compliance10"
  | "compliance11"
  | "compliance12";

export type WorkspaceTab = "plan" | "program" | "source";

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
  { id: "compliance", label: "Compliance", color: "var(--cluster-compliance)", hex: "#af52de" },
  { id: "compliance2", label: "Compliance 2", color: "var(--cluster-compliance-2)", hex: "#bf5af2" },
  { id: "compliance3", label: "Compliance 3", color: "var(--cluster-compliance-3)", hex: "#9b5de5" },
  { id: "compliance4", label: "Compliance 4", color: "var(--cluster-compliance-4)", hex: "#c77dff" },
  { id: "compliance5", label: "Compliance 5", color: "var(--cluster-compliance-5)", hex: "#b5179e" },
  { id: "compliance6", label: "Compliance 6", color: "var(--cluster-compliance-6)", hex: "#7209b7" },
  { id: "compliance7", label: "Compliance 7", color: "var(--cluster-compliance-7)", hex: "#7b2cbf" },
  { id: "compliance8", label: "Compliance 8", color: "var(--cluster-compliance-8)", hex: "#5a189a" },
  { id: "compliance9", label: "Compliance 9", color: "var(--cluster-compliance-9)", hex: "#e0aaff" },
  { id: "compliance10", label: "Compliance 10", color: "var(--cluster-compliance-10)", hex: "#c8b6ff" },
  { id: "compliance11", label: "Compliance 11", color: "var(--cluster-compliance-11)", hex: "#a06cd5" },
  { id: "compliance12", label: "Compliance 12", color: "var(--cluster-compliance-12)", hex: "#6247aa" },
];

export interface FeatureItem {
  id: string;
  label: string;
}

export interface DecisionSource {
  id: string;
  label: string;
  kind: "prompt" | "file" | "assumption" | "feature" | "link" | "document" | "video" | "image";
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
  /** Mock editing affordance for the decision tree content */
  onEditNode?: (nodeId: string) => void;
  /** Mock move affordance for moving the node/subtree into another cluster */
  onMoveNode?: (nodeId: string, clusterId: ClusterId) => void;
  /** Remove this node and its descendants from the decision tree */
  onDeleteNode?: (nodeId: string, clusterId: ClusterId) => void;
  /** Confirmation checkbox for selected route/manual inclusion in code generation */
  onToggleConfirm?: (nodeId: string) => void;
  nodeConfirmed?: boolean;
  /** Count of participant prompts attached to this node's chat history */
  chatPromptCount?: number;
}

export interface FileGraphPayload {
  path: string;
  clusterShare: Partial<Record<ClusterId, number>>;
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
  /** Overview mode: frame receives clicks to zoom into this cluster */
  overviewSelectable?: boolean;
}

export interface MockPromptRecord {
  id: string;
  text: string;
  clusterId: ClusterId;
  createdAt: number;
}

export interface DynamicDecisionNode {
  clusterId: ClusterId;
  nodeId: string;
  title: string;
  summary: string;
  depth: number;
  parentNodeId?: string;
}
