import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import type { OnSelectionChangeParams, Viewport } from "@xyflow/react";
import type { ClusterId, DecisionNodePayload, DynamicDecisionNode, FeatureItem, FileGraphPayload, GeneratedFeatureRequest, PlanCanvasMode, WorkspaceTab } from "./types";
import { CLUSTERS } from "./types";
import { FeatureSidebar } from "./components/FeatureSidebar";
import { IntroOverlay } from "./components/IntroOverlay";
import type { IntroAttachment } from "./components/IntroOverlay";
import { CanvasContextPanels } from "./components/CanvasContextPanels";
import { PlanCanvas } from "./components/PlanCanvas";
import { ProgramPane } from "./components/ProgramPane";
import { assistantLineForProgramTab } from "./assistantLine";
import { mimicAi } from "./mimicAi";
import type { DecisionOutlineItem, PlanTreeKind } from "./mock/flows";
import { decisionOutlineForCluster } from "./mock/flows";
import { canonicalProgramTabId, clusterForProgramEditorTab, PROGRAM_EDITOR_TABS } from "./programTabs";
import "./app.css";

const INITIAL_PROGRAM_TAB = PROGRAM_EDITOR_TABS[0]?.id ?? "split-ts";
const ATTACHMENT_ACTIONS = ["link", "upload"] as const;
const RIGHT_SIDEBAR_MIN = 240;
const RIGHT_SIDEBAR_MAX = 520;
const GENERATED_CLUSTER_IDS: ClusterId[] = [
  "security",
  "compliance",
  "compliance2",
  "compliance3",
  "compliance4",
  "compliance5",
  "compliance6",
  "compliance7",
  "compliance8",
  "compliance9",
  "compliance10",
  "compliance11",
  "compliance12",
];
type ChatMode = "general" | "node" | "move" | "create";
type ChatHistoryItem = {
  id: string;
  mode: ChatMode;
  role: "user" | "assistant";
  text: string;
};
type SourceAssignment = Record<string, string[]>;

const PROGRAM_TAB_BY_CLUSTER: Partial<Record<ClusterId, string>> = {
  core: "split-ts",
  account: "auth-ts",
  groups: "groups-ts",
  budgeting: "budgeting-ts",
  security: "security-ts",
  compliance: "security-ts",
};
function programTabForCluster(cluster: ClusterId): string {
  return PROGRAM_TAB_BY_CLUSTER[cluster] ?? "security-ts";
}
const WEBVIEW_VSCODE = (() => {
  const g = globalThis as unknown as { acquireVsCodeApi?: () => { postMessage: (msg: unknown) => void } };
  return typeof g.acquireVsCodeApi === "function" ? g.acquireVsCodeApi() : null;
})();

function baseName(path: string): string {
  const norm = path.replace(/\\/g, "/");
  const last = norm.split("/").pop();
  return last && last.length > 0 ? last : path;
}

function linkHref(label: string): string {
  const t = label.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return t;
  return `https://${t}`;
}

function pickFiles(accept: string): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = true;
    input.style.position = "fixed";
    input.style.opacity = "0";
    input.style.pointerEvents = "none";
    input.style.left = "-9999px";
    document.body.appendChild(input);
    input.addEventListener(
      "change",
      () => {
        const files = input.files ? Array.from(input.files) : [];
        input.remove();
        resolve(files);
      },
      { once: true }
    );
    input.click();
  });
}

function inferUploadKind(file: File): IntroAttachment["kind"] {
  const mime = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  if (mime.startsWith("video/") || /\.(mp4|mov|avi|mkv|webm|m4v)$/i.test(name)) return "video";
  if (mime.startsWith("image/") || /\.(png|jpg|jpeg|gif|webp|svg|bmp|heic)$/i.test(name)) return "image";
  return "document";
}

const initialGlobal: FeatureItem[] = [];

function viewportNearlyEqual(a: Viewport | null, b: Viewport): boolean {
  if (!a) return false;
  const epsilon = 0.35;
  return Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon && Math.abs(a.zoom - b.zoom) < 0.004;
}

const initialLocal = (): Record<ClusterId, FeatureItem[]> =>
  Object.fromEntries(CLUSTERS.map((cluster) => [cluster.id, [] as FeatureItem[]])) as Record<ClusterId, FeatureItem[]>;

const GENERATED_FEATURE_LABELS: Record<string, string> = {
  "co-root": "Cost split calculation model",
  "co-equal": "Equal share default",
  "co-custom": "Custom allocation rules",
  "co-cents": "Exact-cent participant shares",
  "co-percent": "Percentage split allocation",
  "co-settle": "Settlement status tracking",
  "ua-root": "Account access model",
  "ua-signin": "Mock session sign-in",
  "ua-subscription": "Subscription tier access",
  "ua-free": "Free tier limits",
  "ua-plus": "Plus tier entitlement",
  "gr-root": "Group workspace model",
  "gr-household": "Household bill group",
  "gr-event": "Event expense group",
  "gr-invite": "Member invitation flow",
  "gr-balances": "Member balance view",
  "bu-root": "Monthly budget model",
  "bu-categories": "Budget categories",
  "bu-auth-drift": "Misallocated sign-in review",
  "bu-alerts": "Budget limit alerts",
  "bu-summary": "Monthly spending summary",
  "se-root": "Security boundary overview",
  "se-access": "Financial record access control",
  "se-audit": "Audit trail policy",
  "se-budget-summary": "Misplaced budget reporting suggestion",
  "se-invite-ui": "Misplaced group invite suggestion",
  "se-encrypt": "Sensitive data encryption",
  "cm-root": "Generated compliance cluster",
  "cm-retention": "Retention rule review",
  "cm-export": "Export readiness",
  "cm-consent": "Consent checkpoint",
};

function generatedFeatureLabel(request: GeneratedFeatureRequest): string {
  const mapped = GENERATED_FEATURE_LABELS[request.nodeId];
  if (mapped) return mapped;
  const cleanedTitle = request.title.replace(/\s*-\s*\d+%/g, "").trim();
  return cleanedTitle || request.summary.split(".")[0] || "Generated feature";
}

const BASE_TERMINAL_NODE_IDS_BY_KIND: Partial<Record<PlanTreeKind, ReadonlySet<string>>> = {
  core: new Set(["co-equal", "co-cents", "co-percent", "co-settle"]),
  account: new Set(["ua-signin", "ua-free", "ua-plus", "ua-family"]),
  groups: new Set(["gr-household", "gr-invite", "gr-balances"]),
  budgeting: new Set(["bu-alerts", "bu-summary"]),
  security: new Set(["se-access", "se-budget-summary", "se-invite-ui", "se-encrypt"]),
  compliance: new Set(["cm-retention", "cm-export", "cm-consent"]),
};

function terminalNodeIdsForKind(kind: PlanTreeKind): ReadonlySet<string> {
  const base = BASE_TERMINAL_NODE_IDS_BY_KIND[kind];
  if (base) return base;
  return new Set([`${kind}-retention`, `${kind}-export`, `${kind}-consent`]);
}

function featureIdsForNode(nodeId: string): string[] {
  return [`feat-local-${nodeId}`, `feat-global-${nodeId}`];
}

function nodePrefixForCluster(cluster: ClusterId): string {
  if (cluster === "core") return "co";
  if (cluster === "account") return "ua";
  if (cluster === "groups") return "gr";
  if (cluster === "budgeting") return "bu";
  if (cluster === "security") return "se";
  if (cluster === "compliance") return "cm";
  return cluster;
}

function safeNodePart(value: string): string {
  return value.replace(/[^a-z0-9-]/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function nodePromptReply(text: string, label: string, cluster: string, turn: number): string {
  const lower = text.toLowerCase();
  if (lower.includes("why") || lower.includes("because")) {
    return `For ${label}, I would treat that as a rationale check: the ${cluster} decision should explain why this branch is stronger than its sibling, then keep the rejected option visible for traceability.`;
  }
  if (lower.includes("risk") || lower.includes("issue") || lower.includes("problem")) {
    return `I see a risk thread in ${label}: mark the assumption, connect it to the affected feature, and ask one yes/no decision before writing code so the participant has a clear control point.`;
  }
  if (lower.includes("file") || lower.includes("code") || lower.includes("implement")) {
    return `For implementation, ${label} should map to one starter file plus a highlighted decision marker. I would keep the generated code small until this node is confirmed.`;
  }
  if (turn % 3 === 1) {
    return `${label} now has a follow-up decision: keep the current path, or split it into a separate branch if the participant thinks it affects another cluster. Confidence is highest for keeping it local first.`;
  }
  if (turn % 3 === 2) {
    return `I would summarise this as a traceability update for ${label}: source prompt, assumption, and affected feature are now linked so the participant can revisit the reasoning later.`;
  }
  return `For ${label}, the next useful move is to ask whether this should stay local to ${cluster} or be escalated globally. I would present that as a two-option decision with confidence ratings.`;
}

function generalPromptReply(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("security") || lower.includes("privacy")) {
    return "Mock reply: this should probably become a dedicated Security decision cluster, with access control, audit trail, and data protection separated from budgeting features.";
  }
  if (lower.includes("budget") || lower.includes("split")) {
    return "Mock reply: I would separate cost splitting from monthly budgeting, then connect them later through generated file impacts rather than merging the concepts too early.";
  }
  if (lower.includes("cluster")) {
    return "Mock reply: I would first name the cluster, then create one root decision and two competing branches so the participant can inspect the trade-off.";
  }
  return "Mock reply: I would compare this prompt against prior decisions, identify whether it is local or global, then offer one high-confidence next step and one lower-confidence alternative.";
}

function rootOnlyOutlineItem(clusterId: ClusterId, label: string): DecisionOutlineItem {
  const root = decisionOutlineForCluster(clusterId)[0];
  return {
    clusterId,
    nodeId: root?.nodeId ?? `${nodePrefixForCluster(clusterId)}-root`,
    title: label,
    summary: "Empty root node. Prompt this node to generate the first decision tree.",
    depth: 0,
  };
}

function outlineHasDirectChild(outline: readonly DecisionOutlineItem[], nodeId: string): boolean {
  const index = outline.findIndex((item) => item.nodeId === nodeId);
  if (index < 0) return false;
  const depth = outline[index].depth;
  const next = outline[index + 1];
  return Boolean(next && next.depth > depth);
}

function expansionTitle(seed: string, index: number): string {
  const cleaned = seed
    .replace(/[^a-z0-9\s-]/gi, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join(" ");
  const base = cleaned || (index === 0 ? "Generated option" : "Alternative option");
  const confidence = index === 0 ? 64 : 36;
  return `${base.toUpperCase()} - ${confidence}%`;
}

function expansionSummary(promptText: string, clusterLabel: string, index: number): string {
  const topic = promptText.trim() || "the participant prompt";
  if (index === 0) {
    return `Mock AI expands "${topic}" into a concrete ${clusterLabel} decision for participant review.`;
  }
  return `Alternative branch keeps the same prompt visible, but asks whether the decision should stay local before code is generated.`;
}

export default function App() {
  const [showIntro, setShowIntro] = useState(true);
  const [tab, setTab] = useState<WorkspaceTab>("plan");
  const [planMode, setPlanMode] = useState<PlanCanvasMode>("overview");
  const [planExplorerTabId, setPlanExplorerTabId] = useState<string>(INITIAL_PROGRAM_TAB);
  const [planTreeSelections, setPlanTreeSelections] = useState<Partial<Record<PlanTreeKind, string | null>>>({});
  const [showAllClusters, setShowAllClusters] = useState(true);
  const [legendCollapsed, setLegendCollapsed] = useState(false);
  const planCanvasWrapRef = useRef<HTMLDivElement>(null);
  const [planViewportOverview, setPlanViewportOverview] = useState<Viewport | null>(null);
  const [planViewportNodegraph, setPlanViewportNodegraph] = useState<Viewport | null>(null);
  const [clusterFocus, setClusterFocus] = useState<ClusterId>("core");
  const [globalFeatures, setGlobalFeatures] = useState(initialGlobal);
  const [localByCluster, setLocalByCluster] = useState(initialLocal);
  const [completedClusterIds, setCompletedClusterIds] = useState<Set<PlanTreeKind>>(() => new Set());
  const [generatedFeatureNodeIds, setGeneratedFeatureNodeIds] = useState<Set<string>>(() => new Set());
  const [generatedClusterIds, setGeneratedClusterIds] = useState<ClusterId[]>([]);
  const [generatedClusterTreeReady, setGeneratedClusterTreeReady] = useState<Set<ClusterId>>(() => new Set());
  const [deletedClusterIds, setDeletedClusterIds] = useState<Set<ClusterId>>(() => new Set());
  const [dynamicDecisionNodes, setDynamicDecisionNodes] = useState<Partial<Record<ClusterId, DynamicDecisionNode[]>>>({});
  const [clusterLabelOverrides, setClusterLabelOverrides] = useState<Partial<Record<ClusterId, string>>>({});
  const [clusterRenameDraft, setClusterRenameDraft] = useState<null | { id: ClusterId; label: string }>(null);
  const [clusterDeleteDraft, setClusterDeleteDraft] = useState<null | { id: ClusterId; label: string }>(null);
  const [planApplied, setPlanApplied] = useState(false);
  const [activeContext, setActiveContext] = useState<
    | { kind: "global" | "local"; id: string }
    | { kind: "node"; id: string; clusterId: ClusterId; label: string }
    | null
  >(null);
  const [scopeLabel, setScopeLabel] = useState<string | null>("Terminus");
  const [prompt, setPrompt] = useState("");
  const [chatMode, setChatMode] = useState<ChatMode>("general");
  const [expandNodeTool, setExpandNodeTool] = useState(false);
  const [canvasContextOpen, setCanvasContextOpen] = useState({ global: true, local: true });
  const [confirmedNodeIds, setConfirmedNodeIds] = useState<Set<string>>(() => new Set());
  const [movedRootNodes, setMovedRootNodes] = useState<Partial<Record<ClusterId, DecisionOutlineItem[]>>>({});
  const [moveDraft, setMoveDraft] = useState<null | { fromCluster: ClusterId; fromNode: string; toCluster: ClusterId; toNode: string }>(null);
  const [clusterCreateDraft, setClusterCreateDraft] = useState<null | { label: string }>(null);
  const [featureMenu, setFeatureMenu] = useState<null | { kind: "global" | "local"; id: string; label: string; clusterId: ClusterId; top: number; left: number }>(null);
  const [clusterMenu, setClusterMenu] = useState<null | { clusterId: ClusterId; top: number; left: number }>(null);
  const clusterMenuRef = useRef<HTMLDivElement>(null);
  const featureMenuRef = useRef<HTMLDivElement>(null);
  const [featureActionDraft, setFeatureActionDraft] = useState<null | {
    action: "rename" | "delete";
    kind: "global" | "local";
    id: string;
    label: string;
    draft: string;
    clusterId: ClusterId;
  }>(null);
  const [attachments, setAttachments] = useState<IntroAttachment[]>([]);
  const [sourceAssignments, setSourceAssignments] = useState<SourceAssignment>({});
  const [openSourceCards, setOpenSourceCards] = useState<Set<string>>(() => new Set());
  const [openSourceLayers, setOpenSourceLayers] = useState<Set<string>>(() => new Set());
  const [topSearch, setTopSearch] = useState("");
  const [linkCaptureOpen, setLinkCaptureOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const [pendingLinks, setPendingLinks] = useState<string[]>([]);
  const [sourceViewerId, setSourceViewerId] = useState<string | null>(null);
  const [assistantLine, setAssistantLine] = useState(() => assistantLineForProgramTab(INITIAL_PROGRAM_TAB));
  const [chatHistory, setChatHistory] = useState<ChatHistoryItem[]>(() => [
    {
      id: "chat-seed",
      mode: "general",
      role: "assistant",
      text: assistantLineForProgramTab(INITIAL_PROGRAM_TAB),
    },
  ]);
  const [nodeChatHistoryById, setNodeChatHistoryById] = useState<Record<string, ChatHistoryItem[]>>({});
  const [featuresOpen, setFeaturesOpen] = useState(true);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(320);
  const [programOpenIds, setProgramOpenIds] = useState<string[]>([]);
  const [programTabId, setProgramTabId] = useState("");
  const [workspaceProgramTabs, setWorkspaceProgramTabs] = useState<Array<{ id: string; label: string; path: string; code: string }>>([]);

  const programCatalog = useMemo(() => workspaceProgramTabs, [workspaceProgramTabs]);
  const topSearchNorm = topSearch.trim().toLowerCase();
  const topSearchMatches = useCallback((value: string) => !topSearchNorm || value.toLowerCase().includes(topSearchNorm), [topSearchNorm]);
  const visibleClusters = useMemo(
    () =>
      CLUSTERS.filter((cluster) => !deletedClusterIds.has(cluster.id) && (!GENERATED_CLUSTER_IDS.includes(cluster.id) || generatedClusterIds.includes(cluster.id))).map((cluster) => {
        const override = clusterLabelOverrides[cluster.id]?.trim();
        return override ? { ...cluster, label: override } : cluster;
      }),
    [clusterLabelOverrides, deletedClusterIds, generatedClusterIds]
  );
  const visibleClusterIds = useMemo(() => visibleClusters.map((cluster) => cluster.id), [visibleClusters]);
  const clusterLabel = useCallback(
    (cluster: ClusterId) => clusterLabelOverrides[cluster]?.trim() || CLUSTERS.find((c) => c.id === cluster)?.label || "Cluster",
    [clusterLabelOverrides]
  );
  const rootOnlyClusterIds = useMemo(
    () => generatedClusterIds.filter((cluster) => !generatedClusterTreeReady.has(cluster)),
    [generatedClusterIds, generatedClusterTreeReady]
  );
  const decisionOutline = useMemo(
    () =>
      Object.fromEntries(
        visibleClusterIds.map((kind) => {
          const moved = movedRootNodes[kind] ?? [];
          const base = rootOnlyClusterIds.includes(kind)
            ? [rootOnlyOutlineItem(kind, clusterLabel(kind))]
            : decisionOutlineForCluster(kind).map((item, index) =>
                index === 0 && clusterLabelOverrides[kind] ? { ...item, title: clusterLabel(kind) } : item
              );
          return [kind, [...moved, ...base, ...(dynamicDecisionNodes[kind] ?? [])]];
        })
      ) as Partial<Record<ClusterId, DecisionOutlineItem[]>>,
    [clusterLabel, clusterLabelOverrides, dynamicDecisionNodes, movedRootNodes, rootOnlyClusterIds, visibleClusterIds]
  );

  const completedClusterCount = visibleClusterIds.filter((kind) => completedClusterIds.has(kind)).length;
  const clusterTotal = visibleClusters.length;
  const allVisibleClustersComplete = clusterTotal > 0 && completedClusterCount >= clusterTotal;
  const visibleGlobalFeatures = useMemo(
    () => (topSearchNorm ? globalFeatures.filter((item) => topSearchMatches(item.label)) : globalFeatures),
    [globalFeatures, topSearchMatches, topSearchNorm]
  );
  const visibleLocalFeatures = useMemo(
    () => (topSearchNorm ? (localByCluster[clusterFocus] ?? []).filter((item) => topSearchMatches(item.label)) : (localByCluster[clusterFocus] ?? [])),
    [clusterFocus, localByCluster, topSearchMatches, topSearchNorm]
  );

  const pushChatHistory = useCallback((role: ChatHistoryItem["role"], text: string, mode: ChatMode = chatMode) => {
    setChatHistory((prev) => [
      ...prev,
      {
        id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        mode,
        role,
        text,
      },
    ]);
  }, [chatMode]);
  const pushNodeChatHistory = useCallback((nodeId: string, role: ChatHistoryItem["role"], text: string, mode: ChatMode = "node") => {
    setNodeChatHistoryById((prev) => ({
      ...prev,
      [nodeId]: [
        ...(prev[nodeId] ?? []),
        {
          id: `chat-${nodeId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          mode,
          role,
          text,
        },
      ],
    }));
  }, []);
  const seedNodeChatHistory = useCallback((nodeId: string, text: string) => {
    setNodeChatHistoryById((prev) => {
      if (prev[nodeId]?.length) return prev;
      return {
        ...prev,
        [nodeId]: [
          {
            id: `chat-${nodeId}-seed`,
            mode: "node",
            role: "assistant",
            text,
          },
        ],
      };
    });
  }, []);
  const activeNodeId = activeContext?.kind === "node" ? activeContext.id : null;
  const activeChatHistory = activeNodeId ? nodeChatHistoryById[activeNodeId] ?? [] : chatHistory;
  const chatPromptCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [nodeId, history] of Object.entries(nodeChatHistoryById)) {
      const count = history.filter((entry) => entry.role === "user").length;
      if (count > 0) out[nodeId] = count;
    }
    return out;
  }, [nodeChatHistoryById]);

  useEffect(() => {
    setCompletedClusterIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      visibleClusterIds.forEach((kind) => {
        const selection = planTreeSelections[kind] ?? null;
        const outline = decisionOutline[kind] ?? [];
        const complete = selection
          ? !rootOnlyClusterIds.includes(kind) && (terminalNodeIdsForKind(kind).has(selection) || !outlineHasDirectChild(outline, selection))
          : false;
        if (complete && !next.has(kind)) {
          next.add(kind);
          changed = true;
        } else if (!complete && next.has(kind)) {
          next.delete(kind);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [decisionOutline, planTreeSelections, rootOnlyClusterIds, visibleClusterIds]);

  const handlePlanTreeSelectionsChange = useCallback(
    (update: SetStateAction<Partial<Record<PlanTreeKind, string | null>>>) => {
      setPlanTreeSelections((prev) => {
        const next = typeof update === "function" ? update(prev) : update;

        setCompletedClusterIds((completedPrev) => {
          const completedNext = new Set(completedPrev);
          let changed = false;

          const coreTerminalNodeIds = terminalNodeIdsForKind("core");
          const groupsTerminalNodeIds = terminalNodeIdsForKind("groups");
          const coreComplete = next.core ? coreTerminalNodeIds.has(next.core) : false;
          const groupsComplete = next.groups ? groupsTerminalNodeIds.has(next.groups) : false;

          if (coreComplete && !completedNext.has("core")) {
            completedNext.add("core");
            changed = true;
          } else if (!coreComplete && completedNext.has("core")) {
            completedNext.delete("core");
            changed = true;
          }

          if (groupsComplete && !completedNext.has("groups")) {
            completedNext.add("groups");
            changed = true;
          } else if (!groupsComplete && completedNext.has("groups")) {
            completedNext.delete("groups");
            changed = true;
          }

          return changed ? completedNext : completedPrev;
        });

        return next;
      });
    },
    []
  );

  const savedPlanViewport = planMode === "overview" ? planViewportOverview : planViewportNodegraph;

  const handlePlanViewportSave = useCallback((viewport: Viewport, mode: PlanCanvasMode) => {
    if (mode === "overview") {
      setPlanViewportOverview((prev) => (viewportNearlyEqual(prev, viewport) ? prev : viewport));
    } else {
      setPlanViewportNodegraph((prev) => (viewportNearlyEqual(prev, viewport) ? prev : viewport));
    }
  }, []);

  const begin = useCallback((t: WorkspaceTab) => {
    setShowIntro(false);
    setTab(t);
  }, []);

  const beginClusterFromIntro = useCallback((cluster: ClusterId) => {
    setShowIntro(false);
    setTab("plan");
    setPlanMode("overview");
    setClusterFocus(cluster);
    setShowAllClusters(false);
    setPlanExplorerTabId(programTabForCluster(cluster));
  }, []);

  const beginAllClustersFromIntro = useCallback(() => {
    setShowIntro(false);
    setTab("plan");
    setPlanMode("overview");
    setShowAllClusters(true);
    setPlanTreeSelections({});
    setActiveContext(null);
    setChatMode("general");
    setAssistantLine("General project view opened. The mock assistant will answer across all clusters.");
  }, []);

  const selectClusterOverview = useCallback(() => {
    setTab("plan");
    setPlanMode("overview");
    setShowAllClusters(true);
    setPlanTreeSelections({});
    setActiveContext(null);
  }, []);

  const onFlowSelection = useCallback((p: OnSelectionChangeParams) => {
    const n = p.nodes[0];
    if (!n) {
      setScopeLabel(null);
      return;
    }
    const d = n.data as Partial<DecisionNodePayload & FileGraphPayload & { label?: string }>;
    if ("path" in d && d.path) {
      setScopeLabel(d.path);
      if (d.clusterShare) {
        const ranked = (Object.entries(d.clusterShare) as [ClusterId, number][]).sort((a, b) => b[1] - a[1]);
        if (ranked[0]) setClusterFocus(ranked[0][0]);
      }
      return;
    }
    if ("title" in d && d.title) {
      setScopeLabel(d.title);
      if (d.clusterId) setClusterFocus(d.clusterId);
      if (d.clusterId) {
        setActiveContext({ kind: "node", id: n.id, clusterId: d.clusterId, label: d.title });
        setChatMode("node");
        seedNodeChatHistory(n.id, `Opened chat history for ${d.title}.`);
      }
      const payload = d as DecisionNodePayload;
      if (payload.planSourceTabId) {
        setPlanExplorerTabId(payload.planSourceTabId);
        setAssistantLine(assistantLineForProgramTab(payload.planSourceTabId));
      }
      return;
    }
    setScopeLabel(n.id);
  }, [seedNodeChatHistory]);

  const headerCrumb = useMemo(() => {
    switch (tab) {
      case "source":
        return "Source";
      case "program": {
        const p = programCatalog.find((t) => t.id === programTabId);
        return p?.label ?? programCatalog[0]?.label ?? "Program";
      }
      case "plan": {
        if (planMode === "nodegraph") return "Node graph";
        return clusterLabel(clusterFocus);
      }
    }
  }, [tab, planMode, clusterFocus, programTabId, programCatalog, clusterLabel]);

  const syncContextToProgramTab = useCallback((programTabId: string) => {
    const t = programCatalog.find((x) => x.id === programTabId);
    if (t) setScopeLabel(t.label);
    setAssistantLine(assistantLineForProgramTab(programTabId));
    setClusterFocus(clusterForProgramEditorTab(programTabId));
  }, [programCatalog]);

  const handleProgramTabChange = useCallback(
    (id: string) => {
      setProgramTabId(id);
      if (!WEBVIEW_VSCODE) return;
      if (!workspaceProgramTabs.some((t) => t.id === id)) return;
      WEBVIEW_VSCODE.postMessage({ type: "promptful/openFile", path: id });
    },
    [workspaceProgramTabs]
  );

  useEffect(() => {
    if (tab !== "program") return;
    if (!programTabId) return;
    syncContextToProgramTab(programTabId);
  }, [tab, programTabId, syncContextToProgramTab]);

  useEffect(() => {
    if (!WEBVIEW_VSCODE) return;
    const onMessage = (ev: MessageEvent) => {
      const msg = ev.data as { type?: string; files?: Array<{ path?: string; content?: string }>; activePath?: string | null };
      if (msg?.type !== "promptful/files" || !Array.isArray(msg.files)) return;
      const tabs = msg.files
        .filter((f) => typeof f.path === "string" && typeof f.content === "string")
        .map((f) => ({
          id: f.path as string,
          label: baseName(f.path as string),
          path: f.path as string,
          code: f.content as string,
      }));
      setWorkspaceProgramTabs(tabs);
      if (tabs.length === 0) {
        setProgramOpenIds([]);
        setProgramTabId("");
        return;
      }
      setProgramOpenIds((prev) => {
        const ids = tabs.map((t) => t.id);
        const kept = prev.filter((id) => ids.includes(id));
        return kept.length > 0 ? kept : ids;
      });
      if (typeof msg.activePath === "string" && tabs.some((t) => t.id === msg.activePath)) {
        setProgramTabId(msg.activePath);
        setPlanExplorerTabId(canonicalProgramTabId(msg.activePath));
        setClusterFocus(clusterForProgramEditorTab(msg.activePath));
        setScopeLabel(baseName(msg.activePath));
        setShowAllClusters(false);
      } else if (!tabs.some((t) => t.id === programTabId)) {
        setProgramTabId(tabs[0].id);
      }
    };
    window.addEventListener("message", onMessage);
    WEBVIEW_VSCODE.postMessage({ type: "promptful/requestFiles" });
    return () => window.removeEventListener("message", onMessage);
  }, [programTabId]);

  const reorderProgramTabs = useCallback((next: string[]) => {
    setProgramOpenIds(next);
  }, []);

  const closeProgramTab = useCallback(
    (id: string) => {
      const snapshot = programOpenIds;
      if (snapshot.length <= 1) return;
      const idx = snapshot.indexOf(id);
      if (idx < 0) return;
      const nextIds = snapshot.filter((x) => x !== id);
      setProgramOpenIds(nextIds);
      setProgramTabId((cur) => {
        if (cur !== id) return cur;
        const land = snapshot[idx - 1] ?? snapshot[idx + 1];
        return land ?? nextIds[0] ?? cur;
      });
    },
    [programOpenIds]
  );

  const consumePromptForMock = useCallback(() => {
    const text = prompt.trim();
    if (!text) return false;
    if (activeContext?.kind === "node") {
      setAssistantLine(`Expanded the ${activeContext.label} decision thread with a mock follow-up.`);
      setPrompt("");
      return true;
    }
    const out = mimicAi(text, clusterFocus);
    setAssistantLine(out.assistantLine);
    if (out.newLocalLabel) {
      const label = out.newLocalLabel;
      setLocalByCluster((prev) => ({
        ...prev,
        [clusterFocus]: [{ id: `gen-${Date.now()}`, label }, ...prev[clusterFocus]],
      }));
    }
    setPrompt("");
    return true;
  }, [activeContext, clusterFocus, prompt]);

  const handleGenerateFeatures = useCallback((request: GeneratedFeatureRequest) => {
    const featureId = `feat-${request.target}-${request.nodeId}`;
    const feature = {
      id: featureId,
      label: generatedFeatureLabel(request),
    };
    setGeneratedFeatureNodeIds((prev) => {
      if (prev.has(request.nodeId)) return prev;
      const next = new Set(prev);
      next.add(request.nodeId);
      return next;
    });
    if (request.target === "global") {
      setGlobalFeatures((prev) => (prev.some((item) => item.id === featureId) ? prev : [feature, ...prev]));
    } else {
      setLocalByCluster((prev) => {
        if (prev[request.clusterId].some((item) => item.id === featureId)) return prev;
        return {
          ...prev,
          [request.clusterId]: [feature, ...prev[request.clusterId]],
        };
      });
    }
    setClusterFocus(request.clusterId);
    setFeaturesOpen(true);
    setActiveContext({ kind: request.target, id: featureId });
    setAssistantLine(`Added "${feature.label}" to ${request.target} features.`);
  }, []);

  const toggleShowAllClusters = useCallback(() => {
    setShowAllClusters((value) => {
      const next = !value;
      if (next) {
        setPlanTreeSelections({});
        setActiveContext(null);
      }
      return next;
    });
  }, []);

  const handleClusterComplete = useCallback((kind: PlanTreeKind) => {
    setCompletedClusterIds((prev) => {
      if (prev.has(kind)) return prev;
      const next = new Set(prev);
      next.add(kind);
      return next;
    });
  }, []);

  const handleTreeUndoNode = useCallback((nodeId: string, kind: PlanTreeKind) => {
    const idsToRemove = new Set(featureIdsForNode(nodeId));
    setGeneratedFeatureNodeIds((prev) => {
      if (!prev.has(nodeId)) return prev;
      const next = new Set(prev);
      next.delete(nodeId);
      return next;
    });
    setGlobalFeatures((prev) => prev.filter((item) => !idsToRemove.has(item.id)));
    setLocalByCluster((prev) => ({
      ...prev,
      [kind]: prev[kind].filter((item) => !idsToRemove.has(item.id)),
    }));
    setActiveContext((prev) =>
      prev && idsToRemove.has(prev.id) ? null : prev
    );
    setCompletedClusterIds((prev) => {
      if (!prev.has(kind)) return prev;
      const next = new Set(prev);
      next.delete(kind);
      return next;
    });
  }, []);

  const handleTreeNodesCollapsed = useCallback((nodeIds: string[], kind: PlanTreeKind) => {
    if (nodeIds.length === 0) return;
    const nodeIdSet = new Set(nodeIds);
    const idsToRemove = new Set(nodeIds.flatMap(featureIdsForNode));
    setGeneratedFeatureNodeIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const nodeId of nodeIdSet) {
        if (next.delete(nodeId)) changed = true;
      }
      return changed ? next : prev;
    });
    setGlobalFeatures((prev) => prev.filter((item) => !idsToRemove.has(item.id)));
    setLocalByCluster((prev) => ({
      ...prev,
      [kind]: prev[kind].filter((item) => !idsToRemove.has(item.id)),
    }));
    setActiveContext((prev) => (prev && idsToRemove.has(prev.id) ? null : prev));
  }, []);

  const applyPlan = useCallback(() => {
    if (!allVisibleClustersComplete || planApplied) return;
    WEBVIEW_VSCODE?.postMessage({
      type: "promptful/applyPlan",
      files: PROGRAM_EDITOR_TABS.map(({ path, code }) => ({ path, content: code })),
    });
    setPlanApplied(true);
    setPlanExplorerTabId(INITIAL_PROGRAM_TAB);
    setClusterFocus("core");
    setShowIntro(false);
    setTab("program");
    const response = "Plan applied. Starter files have been generated from the confirmed clusters.";
    setAssistantLine(response);
    pushChatHistory("assistant", response, "general");
  }, [allVisibleClustersComplete, planApplied, pushChatHistory]);

  const sendFromIntro = useCallback(() => {
    if (!consumePromptForMock()) return;
  }, [consumePromptForMock]);

  const pushPendingLink = useCallback(() => {
    const next = linkDraft.trim();
    if (!next) return;
    setPendingLinks((prev) => [...prev, next]);
    setLinkDraft("");
  }, [linkDraft]);

  const confirmPendingLinks = useCallback(() => {
    if (pendingLinks.length === 0) {
      setLinkCaptureOpen(false);
      setLinkDraft("");
      return;
    }
    setAttachments((prev) => [
      ...prev,
      ...pendingLinks.map((url, idx) => ({
        id: `att-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
        kind: "link" as const,
        label: url,
      })),
    ]);
    setPendingLinks([]);
    setLinkDraft("");
    setLinkCaptureOpen(false);
  }, [pendingLinks]);

  const closeLinkCapture = useCallback(() => {
    setLinkCaptureOpen(false);
    setLinkDraft("");
    setPendingLinks([]);
  }, []);

  const addAttachmentMetadata = useCallback(async (action: (typeof ATTACHMENT_ACTIONS)[number]) => {
    if (action === "link") {
      setLinkCaptureOpen(true);
      return;
    }
    const files = await pickFiles("*/*");
    if (files.length > 0) {
      setAttachments((prev) => [
        ...prev,
        ...files.map((file, idx) => ({
          id: `att-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
          kind: inferUploadKind(file),
          label: file.name,
        })),
      ]);
    }
  }, []);

  const removeAttachmentMetadata = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const removeSourceFromPanel = useCallback(
    (id: string) => {
      removeAttachmentMetadata(id);
      setSourceAssignments((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setSourceViewerId((prev) => (prev === id ? null : prev));
    },
    [removeAttachmentMetadata]
  );

  const cleanupGeneratedFeatureState = useCallback((featureId: string) => {
    const nodeId = featureId.replace(/^feat-(local|global)-/, "");
    if (nodeId === featureId) return;
    setGeneratedFeatureNodeIds((prev) => {
      if (!prev.has(nodeId)) return prev;
      const next = new Set(prev);
      next.delete(nodeId);
      return next;
    });
  }, []);

  const renameGlobalFeature = useCallback((featureId: string, label: string) => {
    setGlobalFeatures((prev) => prev.map((item) => (item.id === featureId ? { ...item, label } : item)));
  }, []);

  const removeGlobalFeature = useCallback(
    (featureId: string) => {
      setGlobalFeatures((prev) => prev.filter((item) => item.id !== featureId));
      setActiveContext((prev) => (prev?.kind === "global" && prev.id === featureId ? null : prev));
      cleanupGeneratedFeatureState(featureId);
    },
    [cleanupGeneratedFeatureState]
  );

  const renameLocalFeature = useCallback((cluster: ClusterId, featureId: string, label: string) => {
    setLocalByCluster((prev) => ({
      ...prev,
      [cluster]: prev[cluster].map((item) => (item.id === featureId ? { ...item, label } : item)),
    }));
  }, []);

  const removeLocalFeature = useCallback(
    (cluster: ClusterId, featureId: string) => {
      setLocalByCluster((prev) => ({
        ...prev,
        [cluster]: prev[cluster].filter((item) => item.id !== featureId),
      }));
      setActiveContext((prev) => (prev?.kind === "local" && prev.id === featureId ? null : prev));
      cleanupGeneratedFeatureState(featureId);
    },
    [cleanupGeneratedFeatureState]
  );

  const sourceViewerAttachment = useMemo(
    () => (sourceViewerId ? attachments.find((a) => a.id === sourceViewerId) ?? null : null),
    [sourceViewerId, attachments]
  );

  useEffect(() => {
    if (sourceViewerId && !attachments.some((a) => a.id === sourceViewerId)) {
      setSourceViewerId(null);
    }
  }, [sourceViewerId, attachments]);

  const openBrowserForViewerLink = useCallback(() => {
    if (!sourceViewerAttachment || sourceViewerAttachment.kind !== "link") return;
    const url = linkHref(sourceViewerAttachment.label);
    WEBVIEW_VSCODE?.postMessage({ type: "promptful/openExternal", url });
  }, [sourceViewerAttachment]);

  const copyViewerLink = useCallback(async () => {
    if (!sourceViewerAttachment || sourceViewerAttachment.kind !== "link") return;
    const url = linkHref(sourceViewerAttachment.label);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* ignore */
    }
  }, [sourceViewerAttachment]);

  const openViewerFileInHost = useCallback(() => {
    if (!sourceViewerAttachment || sourceViewerAttachment.kind === "link") return;
    WEBVIEW_VSCODE?.postMessage({
      type: "promptful/openWorkspaceFileByName",
      fileName: sourceViewerAttachment.label,
    });
  }, [sourceViewerAttachment]);

  const sourceItems = useMemo(
    () => attachments.map((a) => ({ id: a.id, kind: a.kind, label: a.label })),
    [attachments]
  );

  useEffect(() => {
    setOpenSourceCards((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const source of sourceItems) {
        if (!next.has(source.id)) {
          next.add(source.id);
          changed = true;
        }
      }
      for (const id of [...next]) {
        if (!sourceItems.some((source) => source.id === id)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [sourceItems]);

  useEffect(() => {
    setOpenSourceLayers((prev) => {
      const next = new Set(prev);
      let changed = false;
      const valid = new Set<string>();
      for (const source of sourceItems) {
        for (const clusterId of visibleClusterIds) {
          const key = `${source.id}:${clusterId}`;
          valid.add(key);
          if (!next.has(key)) {
            next.add(key);
            changed = true;
          }
        }
      }
      for (const key of [...next]) {
        if (!valid.has(key)) {
          next.delete(key);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [sourceItems, visibleClusterIds]);

  const toggleSourceCard = useCallback((id: string) => {
    setOpenSourceCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSourceLayer = useCallback((sourceId: string, clusterId: ClusterId) => {
    const key = `${sourceId}:${clusterId}`;
    setOpenSourceLayers((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const programFileItems = useMemo(
    () => (planApplied ? programCatalog.map((file) => ({ id: file.id, label: file.label, path: file.path })) : []),
    [planApplied, programCatalog]
  );
  const sourceClusterGroups = useMemo(
    () =>
      visibleClusters.map((cluster) => ({
        cluster,
        nodes: decisionOutline[cluster.id] ?? [],
      })),
    [decisionOutline, visibleClusters]
  );

  const pickProgramFileFromSidebar = useCallback(
    (fileId: string) => {
      setShowIntro(false);
      setTab("program");
      handleProgramTabChange(fileId);
    },
    [handleProgramTabChange]
  );

  const navigateLocalFeature = useCallback((cluster: ClusterId, featureId: string) => {
    setClusterFocus(cluster);
    setActiveContext({ kind: "local", id: featureId });
    setShowAllClusters(false);
  }, []);

  const navigateCluster = useCallback((cluster: ClusterId) => {
    setClusterFocus(cluster);
    setShowAllClusters(false);
    setPlanExplorerTabId(programTabForCluster(cluster));
    setTab("plan");
    const rootNode = decisionOutlineForCluster(cluster)[0];
    if (rootNode) {
      setActiveContext({ kind: "node", id: rootNode.nodeId, clusterId: cluster, label: rootNode.title });
      setScopeLabel(rootNode.title);
    }
  }, []);

  const navigateProgramDecision = useCallback((cluster: ClusterId, nodeId: string) => {
    setShowIntro(false);
    setTab("plan");
    setPlanMode("overview");
    setClusterFocus(cluster);
    setShowAllClusters(false);
    setPlanExplorerTabId(programTabForCluster(cluster));
    setPlanTreeSelections((prev) => ({ ...prev, [cluster]: nodeId }));
    setAssistantLine(`Showing the linked ${clusterLabel(cluster)} decision in Plan.`);
  }, [clusterLabel]);

  const navigateDecisionNode = useCallback((cluster: ClusterId, item: DecisionOutlineItem) => {
    setShowIntro(false);
    setTab("plan");
    setPlanMode("overview");
    setClusterFocus(cluster);
    setShowAllClusters(false);
    setPlanExplorerTabId(programTabForCluster(cluster));
    if (!item.nodeId.includes("-moved-")) {
      setPlanTreeSelections((prev) => ({ ...prev, [cluster]: item.nodeId }));
    }
    setActiveContext({ kind: "node", id: item.nodeId, clusterId: cluster, label: item.title });
    setScopeLabel(item.title);
    const response = `Opened chat history for ${item.title}.`;
    setAssistantLine(response);
    setChatMode("node");
    seedNodeChatHistory(item.nodeId, response);
  }, [seedNodeChatHistory]);

  const addGeneratedCluster = useCallback(() => {
    const nextCluster = GENERATED_CLUSTER_IDS.find((id) => !generatedClusterIds.includes(id));
    if (!nextCluster) {
      const response = "Mock AI has generated the available clusters for this study build.";
      setAssistantLine(response);
      pushChatHistory("assistant", response, "create");
      return;
    }
    setGeneratedClusterIds((prev) => [...prev, nextCluster]);
    setShowIntro(false);
    setTab("plan");
    setPlanMode("overview");
    setClusterFocus(nextCluster);
    setShowAllClusters(false);
    setPlanExplorerTabId(programTabForCluster(nextCluster));
    const rootNode = decisionOutlineForCluster(nextCluster)[0];
    if (rootNode) {
      setPlanTreeSelections((prev) => ({ ...prev, [nextCluster]: rootNode.nodeId }));
      setActiveContext({ kind: "node", id: rootNode.nodeId, clusterId: nextCluster, label: rootNode.title });
      setScopeLabel(rootNode.title);
    }
    const response = `Mock AI generated ${clusterLabel(nextCluster)} with editable decision nodes.`;
    setAssistantLine(response);
    pushChatHistory("assistant", response, "create");
  }, [clusterLabel, generatedClusterIds, pushChatHistory]);

  const expandDecisionNodeFromPrompt = useCallback((clusterId: ClusterId, nodeId: string, text: string): string => {
    const outline = decisionOutline[clusterId] ?? [];
    const parent = outline.find((item) => item.nodeId === nodeId);
    const isLeaf = parent ? !outlineHasDirectChild(outline, nodeId) : true;
    const count = isLeaf ? 2 : 1;
    const timestamp = Date.now();
    const prefix = nodePrefixForCluster(clusterId);
    const additions: DynamicDecisionNode[] = Array.from({ length: count }, (_, index) => ({
      clusterId,
      nodeId: `${prefix}-ai-${timestamp}-${index}`,
      ...(
        clusterId === "budgeting" && nodeId === "bu-root" && index === 0
          ? {
              title: "Income streams",
              summary: "Track salary, irregular income, and household contributions so monthly budgets can be judged against money coming in.",
            }
          : {
              title: expansionTitle(text, index),
              summary: expansionSummary(text, clusterLabel(clusterId), index),
            }
      ),
      depth: (parent?.depth ?? 0) + 1,
      parentNodeId: nodeId,
    }));
    setDynamicDecisionNodes((prev) => ({
      ...prev,
      [clusterId]: [...(prev[clusterId] ?? []), ...additions],
    }));
    const suffix = count === 2 ? "two alternative child nodes" : "one child decision node";
    return `Expanded ${parent?.title ?? "this node"} with ${suffix} from the participant prompt.`;
  }, [clusterLabel, decisionOutline]);

  const runMock = useCallback(() => {
    const text = prompt.trim();
    if (!text) return;
    if (chatMode === "create") {
      pushChatHistory("user", text, chatMode);
      addGeneratedCluster();
      setPrompt("");
      setChatMode("node");
      return;
    }
    if (chatMode === "move") {
      pushChatHistory("user", text, chatMode);
      const response = "Mock move prepared. The selected node will become a new root in the target cluster after participant confirmation.";
      setAssistantLine(response);
      pushChatHistory("assistant", response, "move");
      setPrompt("");
      return;
    }
    if (chatMode === "node" || activeContext?.kind === "node") {
      const label = activeContext?.kind === "node" ? activeContext.label : clusterLabel(clusterFocus);
      const nodeId = activeContext?.kind === "node" ? activeContext.id : null;
      const activeClusterId = activeContext?.kind === "node" ? activeContext.clusterId : clusterFocus;
      const cluster = clusterLabel(activeClusterId);
      const nextTurn = nodeId ? (nodeChatHistoryById[nodeId]?.filter((entry) => entry.role === "user").length ?? 0) + 1 : 1;
      const outlineRoot = decisionOutline[activeClusterId]?.[0]?.nodeId;
      const isEmptyGeneratedRoot = Boolean(nodeId && nodeId === outlineRoot && rootOnlyClusterIds.includes(activeClusterId));
      let response = "";
      if (isEmptyGeneratedRoot) {
        setGeneratedClusterTreeReady((prev) => new Set(prev).add(activeClusterId));
        setPlanTreeSelections((prev) => ({ ...prev, [activeClusterId]: nodeId }));
        response = `Generated an initial ${cluster} decision tree from this root prompt. The branches are still mock data for the evaluation workflow.`;
      } else if (nodeId && expandNodeTool) {
        response = expandDecisionNodeFromPrompt(activeClusterId, nodeId, text);
      } else {
        response = nodePromptReply(text, label, cluster, nextTurn);
      }
      setAssistantLine(response);
      if (nodeId) {
        pushNodeChatHistory(nodeId, "user", text, "node");
        pushNodeChatHistory(nodeId, "assistant", response, "node");
      } else {
        pushChatHistory("user", text, "node");
        pushChatHistory("assistant", response, "node");
      }
      setPrompt("");
      return;
    }
    pushChatHistory("user", text, chatMode);
    const response = generalPromptReply(text);
    setAssistantLine(response);
    pushChatHistory("assistant", response, "general");
    setPrompt("");
  }, [
    activeContext,
    addGeneratedCluster,
    chatMode,
    clusterFocus,
    clusterLabel,
    decisionOutline,
    expandDecisionNodeFromPrompt,
    expandNodeTool,
    nodeChatHistoryById,
    prompt,
    pushChatHistory,
    pushNodeChatHistory,
    rootOnlyClusterIds,
  ]);

  const prepareCreateCluster = useCallback(() => {
    setClusterCreateDraft({ label: "" });
  }, []);

  const submitMoveNode = useCallback((from: { clusterId: ClusterId; nodeId: string }, to: { clusterId: ClusterId; nodeId: string }) => {
    const sourceNodes = decisionOutline[from.clusterId] ?? [];
    const fromNode = sourceNodes.find((item) => item.nodeId === from.nodeId);
    const toNode = decisionOutline[to.clusterId]?.find((item) => item.nodeId === to.nodeId);
    if (!fromNode) return;
    const prefix = `${nodePrefixForCluster(to.clusterId)}-moved-${safeNodePart(from.nodeId)}`;
    const startIndex = sourceNodes.findIndex((item) => item.nodeId === from.nodeId);
    const sourceDepth = fromNode.depth;
    const subtree: DecisionOutlineItem[] = [];
    if (startIndex >= 0) {
      for (let index = startIndex; index < sourceNodes.length; index += 1) {
        const item = sourceNodes[index];
        if (index > startIndex && item.depth <= sourceDepth) break;
        subtree.push(item);
      }
    }
    if (subtree.length === 0) subtree.push(fromNode);
    const movedNodes = subtree.map((item, index): DecisionOutlineItem => ({
      ...item,
      clusterId: to.clusterId,
      nodeId: `${prefix}-${safeNodePart(item.nodeId)}`,
      depth: Math.max(0, item.depth - sourceDepth),
      title: item.title,
      summary: index === 0
        ? `Moved from ${clusterLabel(from.clusterId)} as a separate root tree. ${item.summary}`
        : item.summary,
    }));
    const movedRoot = movedNodes[0];
    setMovedRootNodes((prev) => {
      const existing = prev[to.clusterId] ?? [];
      const nextForCluster = [...movedNodes, ...existing.filter((node) => !node.nodeId.startsWith(`${prefix}-`))];
      return { ...prev, [to.clusterId]: nextForCluster };
    });
    setChatMode("node");
    setClusterFocus(to.clusterId);
    setShowAllClusters(false);
    setActiveContext({
      kind: "node",
      id: movedRoot.nodeId,
      clusterId: to.clusterId,
      label: fromNode.title,
    });
    const response = `Mock move: ${fromNode.title} and its child decisions are now a new root tree in ${clusterLabel(to.clusterId)}${toNode ? `, referenced against ${toNode.title}` : ""}.`;
    setAssistantLine(response);
    setNodeChatHistoryById((prev) => {
      const next = { ...prev };
      movedNodes.forEach((movedNode, index) => {
        const originalNode = subtree[index];
        next[movedNode.nodeId] = [...(prev[originalNode.nodeId] ?? [])];
      });
      next[movedRoot.nodeId] = [
        ...(next[movedRoot.nodeId] ?? []),
        {
          id: `chat-${movedRoot.nodeId}-move`,
          mode: "move",
          role: "assistant",
          text: response,
        },
      ];
      return next;
    });
  }, [clusterLabel, decisionOutline]);

  const openClusterCanvasMenu = useCallback((clusterId: ClusterId, event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 136;
    const gap = 10;
    const preferredLeft = rect.right + gap;
    const left = Math.max(12, Math.min(preferredLeft, window.innerWidth - menuWidth - 12));
    const top = Math.max(12, Math.min(rect.top, window.innerHeight - 120));
    setClusterMenu({ clusterId, top, left });
  }, []);

  const openClusterRename = useCallback((cluster: ClusterId) => {
    setClusterRenameDraft({ id: cluster, label: clusterLabel(cluster) });
  }, [clusterLabel]);

  const applyClusterRename = useCallback(() => {
    if (!clusterRenameDraft) return;
    const nextLabel = clusterRenameDraft.label.trim() || clusterLabel(clusterRenameDraft.id);
    setClusterLabelOverrides((prev) => ({ ...prev, [clusterRenameDraft.id]: nextLabel }));
    setAssistantLine(`Renamed cluster to ${nextLabel}.`);
    setClusterRenameDraft(null);
  }, [clusterLabel, clusterRenameDraft]);

  const openClusterDelete = useCallback((cluster: ClusterId) => {
    setClusterDeleteDraft({ id: cluster, label: clusterLabel(cluster) });
  }, [clusterLabel]);

  const handleClusterMenuAction = useCallback(
    (action: "rename" | "delete") => {
      if (!clusterMenu) return;
      if (action === "rename") openClusterRename(clusterMenu.clusterId);
      else openClusterDelete(clusterMenu.clusterId);
      setClusterMenu(null);
    },
    [clusterMenu, openClusterRename, openClusterDelete]
  );

  useEffect(() => {
    if (!clusterMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (clusterMenuRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(".pf-cluster-frame__menu")) return;
      setClusterMenu(null);
    };
    const timer = window.setTimeout(() => {
      document.addEventListener("pointerdown", onPointerDown, true);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [clusterMenu]);

  useEffect(() => {
    if (!featureMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (featureMenuRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(".pf-context-chip__menu")) return;
      setFeatureMenu(null);
    };
    const timer = window.setTimeout(() => {
      document.addEventListener("pointerdown", onPointerDown, true);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [featureMenu]);

  const confirmClusterDelete = useCallback(() => {
    if (!clusterDeleteDraft) return;
    const id = clusterDeleteDraft.id;
    const remaining = visibleClusterIds.filter((cluster) => cluster !== id);
    setDeletedClusterIds((prev) => {
      const next = new Set(prev);
      if (!GENERATED_CLUSTER_IDS.includes(id)) next.add(id);
      return next;
    });
    if (GENERATED_CLUSTER_IDS.includes(id)) {
      setGeneratedClusterIds((prev) => prev.filter((cluster) => cluster !== id));
      setGeneratedClusterTreeReady((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
    setDynamicDecisionNodes((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setMovedRootNodes((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setLocalByCluster((prev) => ({ ...prev, [id]: [] }));
    setCompletedClusterIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setClusterLabelOverrides((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (clusterFocus === id && remaining[0]) setClusterFocus(remaining[0]);
    if (remaining.length === 0) setShowAllClusters(true);
    setAssistantLine(`Deleted cluster ${clusterDeleteDraft.label}.`);
    setClusterDeleteDraft(null);
  }, [clusterDeleteDraft, clusterFocus, visibleClusterIds]);

  const toggleConfirmNode = useCallback((nodeId: string) => {
    setConfirmedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const requestMoveNode = useCallback((nodeId: string, fromCluster: ClusterId) => {
    const toCluster = clusterFocus;
    const toNode = decisionOutline[toCluster]?.[0]?.nodeId ?? "";
    setMoveDraft({ fromCluster, fromNode: nodeId, toCluster, toNode });
  }, [clusterFocus, decisionOutline]);

  const toggleSourceAssignment = useCallback((sourceId: string, nodeId: string) => {
    setSourceAssignments((prev) => {
      const current = new Set(prev[sourceId] ?? []);
      if (current.has(nodeId)) current.delete(nodeId);
      else current.add(nodeId);
      return { ...prev, [sourceId]: [...current] };
    });
  }, []);

  const handleFeatureMenuAction = useCallback((action: "rename" | "delete") => {
    if (!featureMenu) return;
    setFeatureActionDraft({
      action,
      kind: featureMenu.kind,
      id: featureMenu.id,
      label: featureMenu.label,
      draft: featureMenu.label,
      clusterId: featureMenu.clusterId,
    });
    setFeatureMenu(null);
  }, [featureMenu]);

  const applyFeatureRename = useCallback(() => {
    if (!featureActionDraft) return;
    const next = featureActionDraft.draft.trim();
    if (!next) return;
    if (featureActionDraft.kind === "global") {
      renameGlobalFeature(featureActionDraft.id, next);
    } else {
      renameLocalFeature(featureActionDraft.clusterId, featureActionDraft.id, next);
    }
    setFeatureActionDraft(null);
  }, [featureActionDraft, renameGlobalFeature, renameLocalFeature]);

  const confirmFeatureDelete = useCallback(() => {
    if (!featureActionDraft) return;
    if (featureActionDraft.kind === "global") {
      removeGlobalFeature(featureActionDraft.id);
    } else {
      removeLocalFeature(featureActionDraft.clusterId, featureActionDraft.id);
    }
    setFeatureActionDraft(null);
  }, [featureActionDraft, removeGlobalFeature, removeLocalFeature]);

  const openFeatureMenu = useCallback((
    event: MouseEvent<HTMLButtonElement>,
    feature: { kind: "global" | "local"; id: string; label: string; clusterId?: ClusterId }
  ) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 136;
    const gap = 10;
    const preferredLeft = rect.right + gap;
    const left = Math.max(12, Math.min(preferredLeft, window.innerWidth - menuWidth - 12));
    const top = Math.max(12, Math.min(rect.top - 8, window.innerHeight - 120));
    setFeatureMenu((prev) => (
      prev?.id === feature.id && prev.kind === feature.kind
        ? null
        : { ...feature, clusterId: feature.clusterId ?? clusterFocus, top, left }
    ));
  }, [clusterFocus]);

  const createNamedCluster = useCallback(() => {
    const label = clusterCreateDraft?.label.trim();
    if (!label) return;
    const nextCluster = GENERATED_CLUSTER_IDS.find((id) => !generatedClusterIds.includes(id));
    if (!nextCluster) return;
    setGeneratedClusterIds((prev) => [...prev, nextCluster]);
    setGeneratedClusterTreeReady((prev) => {
      const next = new Set(prev);
      next.delete(nextCluster);
      return next;
    });
    setClusterLabelOverrides((prev) => ({ ...prev, [nextCluster]: label }));
    setClusterCreateDraft(null);
    setShowIntro(false);
    setTab("plan");
    setPlanMode("overview");
    setClusterFocus(nextCluster);
    setShowAllClusters(false);
    setPlanExplorerTabId(programTabForCluster(nextCluster));
    const rootNode = decisionOutlineForCluster(nextCluster)[0];
    if (rootNode) {
      setPlanTreeSelections((prev) => ({ ...prev, [nextCluster]: null }));
      setActiveContext({ kind: "node", id: rootNode.nodeId, clusterId: nextCluster, label });
      setScopeLabel(label);
      seedNodeChatHistory(rootNode.nodeId, `Created ${label}. Prompt the empty root node to generate its decision tree.`);
    }
  }, [clusterCreateDraft, generatedClusterIds, seedNodeChatHistory]);

  const startSidebarResize = useCallback(
    (startX: number) => {
      const base = rightSidebarWidth;
      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const next = Math.max(RIGHT_SIDEBAR_MIN, Math.min(RIGHT_SIDEBAR_MAX, base - dx));
        setRightSidebarWidth(next);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [rightSidebarWidth]
  );

  const workGridTemplate = useMemo(() => {
    const rightCol = featuresOpen ? `${rightSidebarWidth}px` : "44px";
    const rightHandle = featuresOpen ? "6px" : "0px";
    return `minmax(0, 1fr) ${rightHandle} ${rightCol}`;
  }, [featuresOpen, rightSidebarWidth]);

  return (
    <div className="pf-shell">
      {featureMenu && createPortal(
        <div
          ref={featureMenuRef}
          className="pf-context-chip__portal-menu"
          role="menu"
          aria-label={`${featureMenu.label} actions`}
          style={{ top: featureMenu.top, left: featureMenu.left }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button type="button" role="menuitem" onClick={() => handleFeatureMenuAction("rename")}>
            Rename
          </button>
          <button type="button" role="menuitem" onClick={() => handleFeatureMenuAction("delete")}>
            Delete
          </button>
        </div>,
        document.body
      )}
      {clusterMenu && createPortal(
        <div
          ref={clusterMenuRef}
          className="pf-context-chip__portal-menu"
          role="menu"
          aria-label="Cluster actions"
          style={{ top: clusterMenu.top, left: clusterMenu.left }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button type="button" role="menuitem" onClick={() => handleClusterMenuAction("rename")}>
            Rename
          </button>
          <button type="button" role="menuitem" onClick={() => handleClusterMenuAction("delete")}>
            Delete
          </button>
        </div>,
        document.body
      )}
      {featureActionDraft?.action === "rename" && (
        <div className="pf-link-modal-backdrop" role="presentation" onMouseDown={() => setFeatureActionDraft(null)}>
          <div
            className="pf-link-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pf-feature-rename-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div id="pf-feature-rename-title" className="pf-link-modal__title">Rename feature</div>
            <label className="pf-tree-edit-modal__field">
              <span>{featureActionDraft.kind === "global" ? "Global feature" : "Local feature"}</span>
              <input
                value={featureActionDraft.draft}
                autoFocus
                onChange={(event) => setFeatureActionDraft((prev) => (prev ? { ...prev, draft: event.target.value } : prev))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") applyFeatureRename();
                  if (event.key === "Escape") setFeatureActionDraft(null);
                }}
              />
            </label>
            <div className="pf-link-modal__actions">
              <button type="button" className="pf-link-modal__cancel" onClick={() => setFeatureActionDraft(null)}>Cancel</button>
              <button type="button" className="pf-link-modal__confirm" onClick={applyFeatureRename} disabled={!featureActionDraft.draft.trim()}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      {featureActionDraft?.action === "delete" && (
        <div className="pf-link-modal-backdrop" role="presentation" onMouseDown={() => setFeatureActionDraft(null)}>
          <div
            className="pf-link-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pf-feature-delete-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div id="pf-feature-delete-title" className="pf-link-modal__title">Delete feature?</div>
            <p className="pf-link-modal__body">
              Delete <strong>{featureActionDraft.label}</strong> from {featureActionDraft.kind === "global" ? "global" : "local"} features?
            </p>
            <div className="pf-link-modal__actions">
              <button type="button" className="pf-link-modal__cancel" onClick={() => setFeatureActionDraft(null)}>Cancel</button>
              <button type="button" className="pf-link-modal__confirm pf-link-modal__confirm--danger" onClick={confirmFeatureDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
      {linkCaptureOpen && (
        <div className="pf-link-modal-backdrop" role="presentation" onMouseDown={closeLinkCapture}>
          <div
            className="pf-link-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Add links"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="pf-link-modal__title">Add links</div>
            <div className="pf-link-modal__row">
              <input
                className="pf-link-modal__input"
                placeholder="Paste a link and press Enter"
                value={linkDraft}
                autoFocus
                onChange={(e) => setLinkDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    pushPendingLink();
                  }
                }}
              />
              <button type="button" className="pf-link-modal__add" onClick={pushPendingLink} disabled={!linkDraft.trim()}>
                Add
              </button>
            </div>
            {pendingLinks.length > 0 && (
              <div className="pf-link-modal__list" aria-label="Links ready to save">
                {pendingLinks.map((url, i) => (
                  <div key={`${url}-${i}`} className="pf-link-modal__item" title={url}>
                    {url}
                  </div>
                ))}
              </div>
            )}
            <div className="pf-link-modal__actions">
              <button type="button" className="pf-link-modal__cancel" onClick={closeLinkCapture}>
                Cancel
              </button>
              <button type="button" className="pf-link-modal__confirm" onClick={confirmPendingLinks}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
      {sourceViewerAttachment && (
        <div className="pf-link-modal-backdrop" role="presentation" onMouseDown={() => setSourceViewerId(null)}>
          <div
            className="pf-link-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pf-source-viewer-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div id="pf-source-viewer-title" className="pf-link-modal__title">
              Source - {sourceViewerAttachment.kind.charAt(0).toUpperCase()}
              {sourceViewerAttachment.kind.slice(1)}
            </div>
            {sourceViewerAttachment.kind === "link" ? (
              <>
                <div className="pf-source-viewer__url" title={linkHref(sourceViewerAttachment.label)}>
                  {linkHref(sourceViewerAttachment.label)}
                </div>
                <div className="pf-source-viewer__actions">
                  <button type="button" className="pf-link-modal__confirm" onClick={openBrowserForViewerLink}>
                    Open in browser
                  </button>
                  <button type="button" className="pf-link-modal__add" onClick={() => void copyViewerLink()}>
                    Copy URL
                  </button>
                  <button type="button" className="pf-link-modal__cancel" onClick={() => setSourceViewerId(null)}>
                    Close
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="pf-source-viewer__url">{sourceViewerAttachment.label}</div>
                <p className="pf-source-viewer__hint">
                  Uploaded files are kept as references here. Try opening by file name if the same file exists in your VS Code workspace.
                </p>
                <div className="pf-source-viewer__actions">
                  <button type="button" className="pf-link-modal__confirm" onClick={openViewerFileInHost}>
                    Open in VS Code (by name)
                  </button>
                  <button type="button" className="pf-link-modal__cancel" onClick={() => setSourceViewerId(null)}>
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {moveDraft && (
        <div className="pf-link-modal-backdrop" role="presentation" onMouseDown={() => setMoveDraft(null)}>
          <div className="pf-link-modal" role="dialog" aria-modal="true" aria-labelledby="pf-move-title" onMouseDown={(event) => event.stopPropagation()}>
            <div id="pf-move-title" className="pf-link-modal__title">Move node</div>
            <label className="pf-tree-edit-modal__field">
              <span>To cluster</span>
              <select
                value={moveDraft.toCluster}
                onChange={(event) => {
                  const toCluster = event.target.value as ClusterId;
                  setMoveDraft((prev) => prev ? { ...prev, toCluster, toNode: decisionOutline[toCluster]?.[0]?.nodeId ?? "" } : prev);
                }}
              >
                {visibleClusters.map((cluster) => (
                  <option key={cluster.id} value={cluster.id}>{cluster.label}</option>
                ))}
              </select>
            </label>
            <label className="pf-tree-edit-modal__field">
              <span>Reference node</span>
              <select
                value={moveDraft.toNode}
                onChange={(event) => setMoveDraft((prev) => prev ? { ...prev, toNode: event.target.value } : prev)}
              >
                {(decisionOutline[moveDraft.toCluster] ?? []).map((node) => (
                  <option key={node.nodeId} value={node.nodeId}>{node.title}</option>
                ))}
              </select>
            </label>
            <div className="pf-link-modal__actions">
              <button type="button" className="pf-link-modal__cancel" onClick={() => setMoveDraft(null)}>Cancel</button>
              <button
                type="button"
                className="pf-link-modal__confirm"
                onClick={() => {
                  submitMoveNode(
                    { clusterId: moveDraft.fromCluster, nodeId: moveDraft.fromNode },
                    { clusterId: moveDraft.toCluster, nodeId: moveDraft.toNode }
                  );
                  setMoveDraft(null);
                }}
                disabled={!moveDraft.toNode}
              >
                Move
              </button>
            </div>
          </div>
        </div>
      )}
      {clusterCreateDraft && (
        <div className="pf-link-modal-backdrop" role="presentation" onMouseDown={() => setClusterCreateDraft(null)}>
          <div className="pf-link-modal" role="dialog" aria-modal="true" aria-labelledby="pf-create-cluster-title" onMouseDown={(event) => event.stopPropagation()}>
            <div id="pf-create-cluster-title" className="pf-link-modal__title">Create cluster</div>
            <label className="pf-tree-edit-modal__field">
              <span>Cluster name</span>
              <input
                value={clusterCreateDraft.label}
                autoFocus
                placeholder="Cluster name"
                onChange={(event) => setClusterCreateDraft({ label: event.target.value })}
              />
            </label>
            <div className="pf-link-modal__actions">
              <button type="button" className="pf-link-modal__cancel" onClick={() => setClusterCreateDraft(null)}>Cancel</button>
              <button type="button" className="pf-link-modal__confirm" onClick={createNamedCluster} disabled={!clusterCreateDraft.label.trim()}>
                Create
              </button>
            </div>
          </div>
        </div>
      )}
      {showIntro && (
        <IntroOverlay
          prompt={prompt}
          onPromptChange={setPrompt}
          onPromptSend={sendFromIntro}
          attachments={attachments}
          onAddAttachment={addAttachmentMetadata}
          onRemoveAttachment={removeAttachmentMetadata}
          clusters={visibleClusters}
          onChooseCluster={beginClusterFromIntro}
          onViewAllClusters={beginAllClustersFromIntro}
        />
      )}

      <header className="pf-top">
        <div className="pf-top__row">
          <div className="pf-tabs">
            {(
              [
                ["plan", "Plan"],
                ["program", "Program"],
                ["source", "Source"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`pf-tab ${tab === id ? "pf-tab--on" : ""}`}
                onClick={() => {
                  setShowIntro(false);
                  setTab(id);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            className="pf-top-search"
            type="search"
            placeholder="Search prompts, files, clusters..."
            value={topSearch}
            onChange={(event) => setTopSearch(event.target.value)}
            aria-label="Search prompts, files, and clusters"
          />
        </div>
        <div className="pf-crumb">{headerCrumb}</div>
      </header>

      <div className="pf-work" style={{ gridTemplateColumns: workGridTemplate }}>
        <div className="pf-center">
          <main className="pf-main">
            {tab === "plan" && (
              <>
                <div className="pf-toolbar">
                  <div className="pf-toolbar__left">
                    <div className="pf-seg" role="tablist" aria-label="Canvas mode">
                      {(
                        [
                          ["overview", "Overview"],
                          ["nodegraph", "Node graph"],
                        ] as const
                      ).map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          className={`pf-seg__btn ${planMode === id ? "pf-seg__btn--on" : ""}`}
                          onClick={() => setPlanMode(id)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="pf-toolbar__right">
                    <button
                      type="button"
                      className={`pf-toolbar__apply ${completedClusterCount === clusterTotal && !planApplied ? "pf-toolbar__apply--ready" : ""}`}
                      disabled={completedClusterCount < clusterTotal || planApplied}
                      onClick={applyPlan}
                      title={planApplied ? "Plan applied" : completedClusterCount === clusterTotal ? "Generate starter files" : "Complete each cluster decision tree"}
                    >
                      {planApplied
                        ? `Plan applied ${clusterTotal}/${clusterTotal}`
                        : completedClusterCount === clusterTotal
                          ? `Apply plan ${completedClusterCount}/${clusterTotal}`
                          : `Confirm clusters ${completedClusterCount}/${clusterTotal}`}
                    </button>
                  </div>
                </div>
                <div className="pf-plan-canvas-wrap" ref={planCanvasWrapRef}>
                  <div className={`pf-canvas-legend ${legendCollapsed ? "pf-canvas-legend--collapsed" : ""}`} aria-label="Cluster legend">
                    <button
                      type="button"
                      className="pf-legend__collapse"
                      onClick={() => setLegendCollapsed((value) => !value)}
                      aria-label={legendCollapsed ? "Expand cluster indicators" : "Collapse cluster indicators"}
                      title={legendCollapsed ? "Show indicators" : "Hide indicators"}
                    >
                      {legendCollapsed ? "+" : "−"}
                    </button>
                    {!legendCollapsed && visibleClusters.map((c) => (
                      <span key={c.id} className="pf-legend__item">
                        <span className="pf-legend__dot" style={{ background: c.color }} />
                        <span>{c.label}</span>
                      </span>
                    ))}
                  </div>
                  <CanvasContextPanels
                    boundsRef={planCanvasWrapRef}
                    open={canvasContextOpen}
                    onToggleOpen={(panel) => setCanvasContextOpen((prev) => ({ ...prev, [panel]: !prev[panel] }))}
                    globalFeatures={visibleGlobalFeatures}
                    localFeatures={visibleLocalFeatures}
                    activeContext={activeContext}
                    onSelectContext={(ctx) => setActiveContext(ctx)}
                    onOpenFeatureMenu={openFeatureMenu}
                    emptyGlobal={topSearchNorm ? "No global feature matches." : "No global features yet."}
                    emptyLocal={topSearchNorm ? "No local feature matches." : "Generate features from a decision node."}
                    localTitle={
                      <>
                        Local{" "}
                        <span
                          style={
                            visibleClusters.find((cluster) => cluster.id === clusterFocus)?.hex
                              ? { color: visibleClusters.find((cluster) => cluster.id === clusterFocus)?.hex }
                              : undefined
                          }
                        >
                          {clusterLabel(clusterFocus)}
                        </span>
                      </>
                    }
                  />
                  <PlanCanvas
                    mode={planMode}
                    workspaceFilePaths={programCatalog.map((f) => f.path)}
                    planExplorerTabId={planExplorerTabId}
                    planClusterFocus={clusterFocus}
                    enabledClusterIds={visibleClusterIds}
                    clusterLabels={clusterLabelOverrides}
                    onSelection={onFlowSelection}
                    planTreeSelections={planTreeSelections}
                    onPlanTreeSelectionsChange={handlePlanTreeSelectionsChange}
                    onClusterFocusChange={setClusterFocus}
                    onNavigateCluster={navigateCluster}
                    showAllClusters={showAllClusters}
                    onToggleShowAllClusters={toggleShowAllClusters}
                    savedViewport={savedPlanViewport}
                    onViewportSave={handlePlanViewportSave}
                    onGenerateFeatures={handleGenerateFeatures}
                    generatedFeatureNodeIds={generatedFeatureNodeIds}
                    movedRootNodes={movedRootNodes}
                    dynamicDecisionNodes={dynamicDecisionNodes}
                    rootOnlyClusterIds={rootOnlyClusterIds}
                    chatPromptCounts={chatPromptCounts}
                    confirmedNodeIds={confirmedNodeIds}
                    onToggleConfirmNode={toggleConfirmNode}
                    onRequestMoveNode={requestMoveNode}
                    onClusterComplete={handleClusterComplete}
                    onTreeUndoNode={handleTreeUndoNode}
                    onTreeNodesCollapsed={handleTreeNodesCollapsed}
                    onOpenClusterMenu={openClusterCanvasMenu}
                  />
                </div>
              </>
            )}
            {tab === "program" && (
              <ProgramPane
                catalog={programCatalog}
                openTabIds={programOpenIds}
                activeId={programTabId}
                onChangeTab={handleProgramTabChange}
                onReorderTabs={reorderProgramTabs}
                onCloseTab={closeProgramTab}
                onOpenDecisionNode={navigateProgramDecision}
              />
            )}
            {tab === "source" && (
              <section className="pf-source-page" aria-label="Source manager">
                <div className="pf-source-page__head">
                  <div>
                    <h2>Source</h2>
                    <p>Add references and assign each source to one or more decision nodes.</p>
                  </div>
                  <div className="pf-source-page__actions">
                    <button type="button" onClick={() => addAttachmentMetadata("link")}>Add link</button>
                    <button type="button" onClick={() => addAttachmentMetadata("upload")}>Upload</button>
                  </div>
                </div>
                <div className="pf-source-page__grid">
                  <div className="pf-source-page__list">
                    {sourceItems.length === 0 ? (
                      <div className="pf-source-page__empty">No sources yet.</div>
                    ) : (
                      sourceItems.map((source) => (
                        <article key={source.id} className={`pf-source-page__card ${openSourceCards.has(source.id) ? "" : "pf-source-page__card--closed"}`}>
                          <div className="pf-source-page__card-head">
                            <button
                              type="button"
                              className="pf-source-page__toggle"
                              onClick={() => toggleSourceCard(source.id)}
                              aria-label={openSourceCards.has(source.id) ? `Collapse ${source.label}` : `Expand ${source.label}`}
                            >
                              {openSourceCards.has(source.id) ? "⌄" : "›"}
                            </button>
                            <div>
                              <span className="pf-source-page__kind">{source.kind}</span>
                              <strong>{source.label}</strong>
                            </div>
                            <button
                              type="button"
                              className="pf-source-page__remove"
                              aria-label={`Remove ${source.label}`}
                              title="Remove source"
                              onClick={() => removeSourceFromPanel(source.id)}
                            >
                              ×
                            </button>
                          </div>
                          {openSourceCards.has(source.id) && (
                            <div className="pf-source-page__layers" aria-label={`${source.label} node assignments`}>
                              {sourceClusterGroups.map(({ cluster, nodes }) => {
                                const layerKey = `${source.id}:${cluster.id}`;
                                const open = openSourceLayers.has(layerKey);
                                const assignedCount = nodes.filter((node) => (sourceAssignments[source.id] ?? []).includes(node.nodeId)).length;
                                return (
                                  <section key={layerKey} className={`pf-source-layer ${open ? "" : "pf-source-layer--closed"}`}>
                                    <div className="pf-source-layer__head">
                                      <button
                                        type="button"
                                        className="pf-source-layer__fold"
                                        aria-label={open ? `Collapse ${cluster.label}` : `Expand ${cluster.label}`}
                                        onClick={() => toggleSourceLayer(source.id, cluster.id)}
                                      >
                                        {open ? "⌄" : "›"}
                                      </button>
                                      <span className="pf-source-layer__dot" style={{ background: cluster.color }} />
                                      <strong>{cluster.label}</strong>
                                      <span className="pf-source-layer__count">{assignedCount}/{nodes.length}</span>
                                    </div>
                                    {open && (
                                      <div className="pf-source-layer__nodes">
                                        {nodes.length === 0 ? (
                                          <div className="pf-source-layer__empty">No nodes yet.</div>
                                        ) : (
                                          nodes.map((node) => (
                                            <label
                                              key={`${source.id}-${node.nodeId}`}
                                              className="pf-source-layer__node"
                                              style={{ paddingLeft: `${10 + node.depth * 18}px` }}
                                            >
                                              <input
                                                type="checkbox"
                                                checked={(sourceAssignments[source.id] ?? []).includes(node.nodeId)}
                                                onChange={() => toggleSourceAssignment(source.id, node.nodeId)}
                                              />
                                              <span title={node.title}>{node.title}</span>
                                              <em>{node.depth === 0 ? "root" : "node"}</em>
                                            </label>
                                          ))
                                        )}
                                      </div>
                                    )}
                                  </section>
                                );
                              })}
                            </div>
                          )}
                        </article>
                      ))
                    )}
                  </div>
                </div>
              </section>
            )}
          </main>

        </div>

        <div
          className={`pf-work__resize-handle ${featuresOpen ? "" : "pf-work__resize-handle--off"}`}
          role="separator"
          aria-label="Resize context sidebar"
          aria-orientation="vertical"
          onMouseDown={(e) => {
            if (!featuresOpen) return;
            e.preventDefault();
            startSidebarResize(e.clientX);
          }}
        />

        <FeatureSidebar
          clusterId={clusterFocus}
          globalItems={globalFeatures}
          localByCluster={localByCluster}
          clusters={visibleClusters}
          decisionOutline={decisionOutline}
          activeNodeId={activeContext?.kind === "node" ? activeContext.id : null}
          programFiles={programFileItems}
          onPickProgramFile={pickProgramFileFromSidebar}
          onNavigateLocalFeature={navigateLocalFeature}
          onNavigateCluster={navigateCluster}
          onNavigateDecisionNode={navigateDecisionNode}
          onRenameCluster={openClusterRename}
          onDeleteCluster={openClusterDelete}
          onAddCluster={prepareCreateCluster}
          onViewAllLayers={selectClusterOverview}
          showAllLayers={showAllClusters}
          searchValue={topSearch}
          onSearchChange={setTopSearch}
          composerPrompt={prompt}
          onComposerPromptChange={setPrompt}
          onComposerSubmit={runMock}
          chatMode={chatMode}
          onChatModeChange={setChatMode}
          assistantLine={assistantLine}
          chatHistory={activeChatHistory}
          onMoveNode={submitMoveNode}
          onReorderGlobal={setGlobalFeatures}
          onReorderLocal={(cluster, items) => setLocalByCluster((p) => ({ ...p, [cluster]: items }))}
          activeContext={activeContext}
          onSelectContext={setActiveContext}
          onAddSource={(kind) => void addAttachmentMetadata(kind === "link" ? "link" : "upload")}
          expandNodeTool={expandNodeTool}
          onExpandNodeToolChange={setExpandNodeTool}
          onRenameGlobal={renameGlobalFeature}
          onRemoveGlobal={removeGlobalFeature}
          onRenameLocal={renameLocalFeature}
          onRemoveLocal={removeLocalFeature}
          collapsed={!featuresOpen}
          onToggleCollapsed={() => setFeaturesOpen((o) => !o)}
        />
      </div>
      {clusterRenameDraft && (
        <div className="pf-tree-edit-modal-backdrop" role="presentation" onMouseDown={() => setClusterRenameDraft(null)}>
          <div
            className="pf-tree-edit-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pf-cluster-rename-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div id="pf-cluster-rename-title" className="pf-tree-edit-modal__title">Rename cluster</div>
            <label className="pf-tree-edit-modal__field">
              <span>Cluster name</span>
              <input
                value={clusterRenameDraft.label}
                onChange={(event) => setClusterRenameDraft((prev) => (prev ? { ...prev, label: event.target.value } : prev))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") applyClusterRename();
                  if (event.key === "Escape") setClusterRenameDraft(null);
                }}
                autoFocus
              />
            </label>
            <div className="pf-tree-edit-modal__actions">
              <button type="button" className="pf-tree-edit-modal__ghost" onClick={() => setClusterRenameDraft(null)}>Cancel</button>
              <button type="button" className="pf-tree-edit-modal__confirm" onClick={applyClusterRename}>Save</button>
            </div>
          </div>
        </div>
      )}
      {clusterDeleteDraft && (
        <div className="pf-tree-edit-modal-backdrop" role="presentation" onMouseDown={() => setClusterDeleteDraft(null)}>
          <div
            className="pf-tree-edit-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pf-cluster-delete-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div id="pf-cluster-delete-title" className="pf-tree-edit-modal__title">Delete cluster?</div>
            <p className="pf-tree-edit-modal__body">
              Delete <strong>{clusterDeleteDraft.label}</strong> from the mock workflow? Its local features and generated nodes will be removed from this session.
            </p>
            <div className="pf-tree-edit-modal__actions">
              <button type="button" className="pf-tree-edit-modal__ghost" onClick={() => setClusterDeleteDraft(null)}>Cancel</button>
              <button type="button" className="pf-tree-edit-modal__confirm pf-tree-edit-modal__confirm--danger" onClick={confirmClusterDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
