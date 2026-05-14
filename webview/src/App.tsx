import { useCallback, useEffect, useMemo, useState, type SetStateAction } from "react";
import type { OnSelectionChangeParams, Viewport } from "@xyflow/react";
import type { ClusterId, DecisionNodePayload, FeatureItem, FileGraphPayload, GeneratedFeatureRequest, PlanCanvasMode, WorkspaceTab } from "./types";
import { CLUSTERS } from "./types";
import { FeatureSidebar } from "./components/FeatureSidebar";
import { IntroOverlay } from "./components/IntroOverlay";
import type { IntroAttachment } from "./components/IntroOverlay";
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

export default function App() {
  const [showIntro, setShowIntro] = useState(true);
  const [tab, setTab] = useState<WorkspaceTab>("plan");
  const [planMode, setPlanMode] = useState<PlanCanvasMode>("overview");
  const [planExplorerTabId, setPlanExplorerTabId] = useState<string>(INITIAL_PROGRAM_TAB);
  const [planTreeSelections, setPlanTreeSelections] = useState<Partial<Record<PlanTreeKind, string | null>>>({});
  const [showAllClusters, setShowAllClusters] = useState(true);
  const [planViewportOverview, setPlanViewportOverview] = useState<Viewport | null>(null);
  const [planViewportNodegraph, setPlanViewportNodegraph] = useState<Viewport | null>(null);
  const [clusterFocus, setClusterFocus] = useState<ClusterId>("core");
  const [globalFeatures, setGlobalFeatures] = useState(initialGlobal);
  const [localByCluster, setLocalByCluster] = useState(initialLocal);
  const [completedClusterIds, setCompletedClusterIds] = useState<Set<PlanTreeKind>>(() => new Set());
  const [generatedFeatureNodeIds, setGeneratedFeatureNodeIds] = useState<Set<string>>(() => new Set());
  const [generatedClusterIds, setGeneratedClusterIds] = useState<ClusterId[]>([]);
  const [clusterLabelOverrides, setClusterLabelOverrides] = useState<Partial<Record<ClusterId, string>>>({});
  const [clusterRenameDraft, setClusterRenameDraft] = useState<null | { id: ClusterId; label: string }>(null);
  const [planApplied, setPlanApplied] = useState(false);
  const [activeContext, setActiveContext] = useState<
    | { kind: "global" | "local"; id: string }
    | { kind: "node"; id: string; clusterId: ClusterId; label: string }
    | null
  >(null);
  const [scopeLabel, setScopeLabel] = useState<string | null>("Terminus");
  const [prompt, setPrompt] = useState("");
  const [chatMode, setChatMode] = useState<ChatMode>("general");
  const [canvasContextOpen, setCanvasContextOpen] = useState({ global: true, local: true });
  const [attachments, setAttachments] = useState<IntroAttachment[]>([]);
  const [linkCaptureOpen, setLinkCaptureOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const [pendingLinks, setPendingLinks] = useState<string[]>([]);
  const [sourceViewerId, setSourceViewerId] = useState<string | null>(null);
  const [assistantLine, setAssistantLine] = useState(() => assistantLineForProgramTab(INITIAL_PROGRAM_TAB));
  const [featuresOpen, setFeaturesOpen] = useState(true);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(320);
  const [programOpenIds, setProgramOpenIds] = useState<string[]>([]);
  const [programTabId, setProgramTabId] = useState("");
  const [workspaceProgramTabs, setWorkspaceProgramTabs] = useState<Array<{ id: string; label: string; path: string; code: string }>>([]);

  const programCatalog = useMemo(() => workspaceProgramTabs, [workspaceProgramTabs]);
  const visibleClusters = useMemo(
    () =>
      CLUSTERS.filter((cluster) => !GENERATED_CLUSTER_IDS.includes(cluster.id) || generatedClusterIds.includes(cluster.id)).map((cluster) => {
        const override = clusterLabelOverrides[cluster.id]?.trim();
        return override ? { ...cluster, label: override } : cluster;
      }),
    [clusterLabelOverrides, generatedClusterIds]
  );
  const visibleClusterIds = useMemo(() => visibleClusters.map((cluster) => cluster.id), [visibleClusters]);
  const clusterLabel = useCallback(
    (cluster: ClusterId) => clusterLabelOverrides[cluster]?.trim() || CLUSTERS.find((c) => c.id === cluster)?.label || "Cluster",
    [clusterLabelOverrides]
  );
  const decisionOutline = useMemo(
    () =>
      Object.fromEntries(
        visibleClusterIds.map((kind) => [kind, decisionOutlineForCluster(kind)])
      ) as Partial<Record<ClusterId, DecisionOutlineItem[]>>,
    [visibleClusterIds]
  );

  const completedClusterCount = completedClusterIds.size;
  const clusterTotal = visibleClusters.length;

  useEffect(() => {
    setCompletedClusterIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      visibleClusterIds.forEach((kind) => {
        const selection = planTreeSelections[kind] ?? null;
        const complete = selection ? terminalNodeIdsForKind(kind).has(selection) : false;
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
  }, [planTreeSelections, visibleClusterIds]);

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
      const payload = d as DecisionNodePayload;
      if (payload.planSourceTabId) {
        setPlanExplorerTabId(payload.planSourceTabId);
        setAssistantLine(assistantLineForProgramTab(payload.planSourceTabId));
      }
      return;
    }
    setScopeLabel(n.id);
  }, []);

  const headerCrumb = useMemo(() => {
    switch (tab) {
      case "program": {
        const p = programCatalog.find((t) => t.id === programTabId);
        return p?.label ?? programCatalog[0]?.label ?? "Files";
      }
      case "plan": {
        if (planMode === "nodegraph") return "Node graph";
        return clusterLabel(clusterFocus);
      }
      default:
        return programCatalog[0]?.label ?? "Plan";
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
    if (completedClusterIds.size < visibleClusterIds.length || planApplied) return;
    WEBVIEW_VSCODE?.postMessage({
      type: "promptful/applyPlan",
      files: PROGRAM_EDITOR_TABS.map(({ path, code }) => ({ path, content: code })),
    });
    setPlanApplied(true);
    setPlanExplorerTabId(INITIAL_PROGRAM_TAB);
    setClusterFocus("core");
    setShowIntro(false);
    setTab("program");
    setAssistantLine("Plan applied. Starter files have been generated from the confirmed clusters.");
  }, [completedClusterIds.size, planApplied, visibleClusterIds.length]);

  const sendFromIntro = useCallback(() => {
    if (!consumePromptForMock()) return;
    setShowIntro(false);
    setTab("plan");
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

  const programFileItems = useMemo(
    () => (planApplied ? programCatalog.map((file) => ({ id: file.id, label: file.label, path: file.path })) : []),
    [planApplied, programCatalog]
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
    setPlanTreeSelections((prev) => ({ ...prev, [cluster]: item.nodeId }));
    setActiveContext({ kind: "node", id: item.nodeId, clusterId: cluster, label: item.title });
    setScopeLabel(item.title);
    setAssistantLine(`Opened chat history for ${item.title}.`);
  }, []);

  const addGeneratedCluster = useCallback(() => {
    const nextCluster = GENERATED_CLUSTER_IDS.find((id) => !generatedClusterIds.includes(id));
    if (!nextCluster) {
      setAssistantLine("Mock AI has generated the available clusters for this study build.");
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
    setAssistantLine(`Mock AI generated ${clusterLabel(nextCluster)} with editable decision nodes.`);
  }, [clusterLabel, generatedClusterIds]);

  const runMock = useCallback(() => {
    const text = prompt.trim();
    if (!text) return;
    if (chatMode === "create") {
      addGeneratedCluster();
      setPrompt("");
      setChatMode("node");
      return;
    }
    if (chatMode === "move") {
      setAssistantLine("Mock move prepared. The selected node would be re-homed after participant confirmation.");
      setPrompt("");
      return;
    }
    if (chatMode === "node" || activeContext?.kind === "node") {
      const label = activeContext?.kind === "node" ? activeContext.label : clusterLabel(clusterFocus);
      setAssistantLine(`Expanded the ${label} decision thread with a mock follow-up.`);
      setPrompt("");
      return;
    }
    setAssistantLine("Mock reply: I would compare the current prompt against prior decisions, then suggest the next decision point with confidence ratings.");
    setPrompt("");
  }, [activeContext, addGeneratedCluster, chatMode, clusterFocus, clusterLabel, prompt]);

  const prepareCreateCluster = useCallback(() => {
    setChatMode("create");
    setPrompt("");
    setAssistantLine("Describe the cluster to create. The mock assistant will generate it after Send.");
  }, []);

  const submitMoveNode = useCallback((from: { clusterId: ClusterId; nodeId: string }, to: { clusterId: ClusterId; nodeId: string }) => {
    const fromNode = decisionOutline[from.clusterId]?.find((item) => item.nodeId === from.nodeId);
    const toNode = decisionOutline[to.clusterId]?.find((item) => item.nodeId === to.nodeId);
    setChatMode("move");
    setClusterFocus(to.clusterId);
    setShowAllClusters(false);
    setPlanTreeSelections((prev) => ({ ...prev, [to.clusterId]: to.nodeId }));
    setActiveContext({
      kind: "node",
      id: to.nodeId,
      clusterId: to.clusterId,
      label: toNode?.title ?? "target node",
    });
    setAssistantLine(`Mock move: ${fromNode?.title ?? "selected node"} is staged under ${toNode?.title ?? "target node"}.`);
  }, [decisionOutline]);

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
      {showIntro && (
        <IntroOverlay
          prompt={prompt}
          onPromptChange={setPrompt}
          onPromptSend={sendFromIntro}
          attachments={attachments}
          onAddAttachment={addAttachmentMetadata}
          onRemoveAttachment={removeAttachmentMetadata}
          onBegin={begin}
        />
      )}

      <header className="pf-top">
        <div className="pf-top__row">
          <button
            type="button"
            className="pf-home"
            aria-label="Back to start"
            title="Back to start"
            onClick={() => setShowIntro(true)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5z" />
            </svg>
          </button>
          <div className="pf-tabs">
            {(
              [
                ["plan", "Plan"],
                ["program", "Program"],
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
                <div className="pf-plan-canvas-wrap">
                  <div className="pf-canvas-legend" aria-label="Cluster legend">
                    {visibleClusters.map((c) => (
                      <span key={c.id} className="pf-legend__item">
                        <span className="pf-legend__dot" style={{ background: c.color }} />
                        <span>{c.label}</span>
                      </span>
                    ))}
                  </div>
                  <div className="pf-canvas-context" onMouseDown={(event) => event.stopPropagation()}>
                    <section className="pf-context-card pf-context-card--global" aria-label="Global features">
                      <button
                        type="button"
                        className="pf-context-card__head pf-context-card__head--button"
                        onClick={() => setCanvasContextOpen((prev) => ({ ...prev, global: !prev.global }))}
                      >
                        <span>Global</span>
                        <span>{canvasContextOpen.global ? "−" : "+"}</span>
                      </button>
                      {canvasContextOpen.global && (
                        <div className="pf-context-card__list">
                          {globalFeatures.length === 0 ? (
                            <div className="pf-context-card__empty">No global features yet.</div>
                          ) : (
                            globalFeatures.map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                className={`pf-context-chip ${activeContext?.kind === "global" && activeContext.id === item.id ? "pf-context-chip--active" : ""}`}
                                onClick={() => setActiveContext({ kind: "global", id: item.id })}
                              >
                                <span>{item.label}</span>
                                <span
                                  className="pf-context-chip__remove"
                                  role="button"
                                  tabIndex={0}
                                  aria-label={`Remove ${item.label}`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    removeGlobalFeature(item.id);
                                  }}
                                >
                                  x
                                </span>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </section>
                    <section className="pf-context-card pf-context-card--local" aria-label="Local features">
                      <button
                        type="button"
                        className="pf-context-card__head pf-context-card__head--button"
                        onClick={() => setCanvasContextOpen((prev) => ({ ...prev, local: !prev.local }))}
                      >
                        <span>
                          Local <span style={visibleClusters.find((cluster) => cluster.id === clusterFocus)?.hex ? { color: visibleClusters.find((cluster) => cluster.id === clusterFocus)?.hex } : undefined}>{clusterLabel(clusterFocus)}</span>
                        </span>
                        <span>{canvasContextOpen.local ? "−" : "+"}</span>
                      </button>
                      {canvasContextOpen.local && (
                        <div className="pf-context-card__list">
                          {(localByCluster[clusterFocus] ?? []).length === 0 ? (
                            <div className="pf-context-card__empty">Generate features from a decision node.</div>
                          ) : (
                            (localByCluster[clusterFocus] ?? []).map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                className={`pf-context-chip pf-context-chip--local ${activeContext?.kind === "local" && activeContext.id === item.id ? "pf-context-chip--active" : ""}`}
                                onClick={() => setActiveContext({ kind: "local", id: item.id })}
                              >
                                <span>{item.label}</span>
                                <span
                                  className="pf-context-chip__remove"
                                  role="button"
                                  tabIndex={0}
                                  aria-label={`Remove ${item.label}`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    removeLocalFeature(clusterFocus, item.id);
                                  }}
                                >
                                  x
                                </span>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </section>
                  </div>
                  <PlanCanvas
                    mode={planMode}
                    planExplorerTabId={planExplorerTabId}
                    planClusterFocus={clusterFocus}
                    enabledClusterIds={visibleClusterIds}
                    clusterLabels={clusterLabelOverrides}
                    onSelection={onFlowSelection}
                    planTreeSelections={planTreeSelections}
                    onPlanTreeSelectionsChange={handlePlanTreeSelectionsChange}
                    onClusterFocusChange={setClusterFocus}
                    showAllClusters={showAllClusters}
                    onToggleShowAllClusters={() => setShowAllClusters((value) => !value)}
                    savedViewport={savedPlanViewport}
                    onViewportSave={handlePlanViewportSave}
                    onGenerateFeatures={handleGenerateFeatures}
                    generatedFeatureNodeIds={generatedFeatureNodeIds}
                    onClusterComplete={handleClusterComplete}
                    onTreeUndoNode={handleTreeUndoNode}
                    onTreeNodesCollapsed={handleTreeNodesCollapsed}
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
          sources={sourceItems}
          programFiles={programFileItems}
          onPickProgramFile={pickProgramFileFromSidebar}
          onNavigateLocalFeature={navigateLocalFeature}
          onNavigateCluster={navigateCluster}
          onNavigateDecisionNode={navigateDecisionNode}
          onRenameCluster={openClusterRename}
          onAddCluster={prepareCreateCluster}
          composerPrompt={prompt}
          onComposerPromptChange={setPrompt}
          onComposerSubmit={runMock}
          chatMode={chatMode}
          onChatModeChange={setChatMode}
          assistantLine={assistantLine}
          onMoveNode={submitMoveNode}
          onReorderGlobal={setGlobalFeatures}
          onReorderLocal={(cluster, items) => setLocalByCluster((p) => ({ ...p, [cluster]: items }))}
          activeContext={activeContext}
          onSelectContext={setActiveContext}
          onOpenSource={setSourceViewerId}
          onRemoveSource={removeSourceFromPanel}
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
    </div>
  );
}
