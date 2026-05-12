import { useCallback, useEffect, useMemo, useState, type SetStateAction } from "react";
import type { OnSelectionChangeParams, Viewport } from "@xyflow/react";
import type { ClusterId, DecisionNodePayload, FeatureItem, FileGraphPayload, GeneratedFeatureRequest, PlanCanvasMode, WorkspaceTab } from "./types";
import { CLUSTERS } from "./types";
import { FeatureSidebar } from "./components/FeatureSidebar";
import { IntroOverlay } from "./components/IntroOverlay";
import type { IntroAttachment } from "./components/IntroOverlay";
import { PlanCanvas } from "./components/PlanCanvas";
import { ProgramPane } from "./components/ProgramPane";
import { PromptDock } from "./components/PromptDock";
import { assistantLineForProgramTab } from "./assistantLine";
import { mimicAi } from "./mimicAi";
import type { PlanTreeKind } from "./mock/flows";
import { canonicalProgramTabId, clusterForProgramEditorTab, PROGRAM_EDITOR_TABS } from "./programTabs";
import "./app.css";

const INITIAL_PROGRAM_TAB = PROGRAM_EDITOR_TABS[0]?.id ?? "split-ts";
const ATTACHMENT_ACTIONS = ["link", "upload"] as const;
const RIGHT_SIDEBAR_MIN = 240;
const RIGHT_SIDEBAR_MAX = 520;
const PROGRAM_TAB_BY_CLUSTER: Record<ClusterId, string> = {
  core: "split-ts",
  account: "auth-ts",
  groups: "groups-ts",
  budgeting: "budgeting-ts",
  security: "security-ts",
};
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

const initialLocal = (): Record<ClusterId, FeatureItem[]> => ({
  core: [],
  account: [],
  groups: [],
  budgeting: [],
  security: [],
});

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
};

function generatedFeatureLabel(request: GeneratedFeatureRequest): string {
  const mapped = GENERATED_FEATURE_LABELS[request.nodeId];
  if (mapped) return mapped;
  const cleanedTitle = request.title.replace(/\s*-\s*\d+%/g, "").trim();
  return cleanedTitle || request.summary.split(".")[0] || "Generated feature";
}

const TERMINAL_NODE_IDS_BY_KIND: Record<PlanTreeKind, ReadonlySet<string>> = {
  core: new Set(["co-equal", "co-cents", "co-percent", "co-settle"]),
  account: new Set(["ua-signin", "ua-free", "ua-plus"]),
  groups: new Set(["gr-household", "gr-invite", "gr-balances"]),
  budgeting: new Set(["bu-alerts", "bu-summary"]),
  security: new Set(["se-access", "se-budget-summary", "se-invite-ui", "se-encrypt"]),
};

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
  const [planApplied, setPlanApplied] = useState(false);
  const [activeContext, setActiveContext] = useState<{ kind: "global" | "local"; id: string } | null>(null);
  const [scopeLabel, setScopeLabel] = useState<string | null>("Terminus");
  const [prompt, setPrompt] = useState("");
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

  const completedClusterCount = completedClusterIds.size;
  const clusterTotal = CLUSTERS.length;

  useEffect(() => {
    setCompletedClusterIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      (Object.keys(TERMINAL_NODE_IDS_BY_KIND) as PlanTreeKind[]).forEach((kind) => {
        const selection = planTreeSelections[kind] ?? null;
        const complete = selection ? TERMINAL_NODE_IDS_BY_KIND[kind].has(selection) : false;
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
  }, [planTreeSelections]);

  const handlePlanTreeSelectionsChange = useCallback(
    (update: SetStateAction<Partial<Record<PlanTreeKind, string | null>>>) => {
      setPlanTreeSelections((prev) => {
        const next = typeof update === "function" ? update(prev) : update;

        setCompletedClusterIds((completedPrev) => {
          const completedNext = new Set(completedPrev);
          let changed = false;

          const coreComplete = next.core ? TERMINAL_NODE_IDS_BY_KIND.core.has(next.core) : false;
          const groupsComplete = next.groups ? TERMINAL_NODE_IDS_BY_KIND.groups.has(next.groups) : false;

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
        return CLUSTERS.find((c) => c.id === clusterFocus)?.label ?? "Overview";
      }
      default:
        return programCatalog[0]?.label ?? "Plan";
    }
  }, [tab, planMode, clusterFocus, programTabId, programCatalog]);

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

  const chip = useMemo(() => {
    if (activeContext) {
      const list = activeContext.kind === "global" ? globalFeatures : localByCluster[clusterFocus];
      const f = list.find((x) => x.id === activeContext.id);
      if (f) return `${activeContext.kind === "global" ? "Global" : "Local"} - ${f.label}`;
    }
    if (scopeLabel) return `Selection - ${scopeLabel}`;
    return null;
  }, [activeContext, clusterFocus, globalFeatures, localByCluster, scopeLabel]);

  const consumePromptForMock = useCallback(() => {
    const text = prompt.trim();
    if (!text) return false;
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
  }, [clusterFocus, prompt]);

  const runMock = useCallback(() => {
    consumePromptForMock();
  }, [consumePromptForMock]);

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
    if (completedClusterIds.size < CLUSTERS.length || planApplied) return;
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
  }, [completedClusterIds.size, planApplied]);

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
    setPlanExplorerTabId(PROGRAM_TAB_BY_CLUSTER[cluster]);
    setTab("plan");
  }, []);

  const navigateProgramDecision = useCallback((cluster: ClusterId, nodeId: string) => {
    setShowIntro(false);
    setTab("plan");
    setPlanMode("overview");
    setClusterFocus(cluster);
    setShowAllClusters(false);
    setPlanExplorerTabId(PROGRAM_TAB_BY_CLUSTER[cluster]);
    setPlanTreeSelections((prev) => ({ ...prev, [cluster]: nodeId }));
    setAssistantLine(`Showing the linked ${CLUSTERS.find((c) => c.id === cluster)?.label ?? "cluster"} decision in Plan.`);
  }, []);

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
                    {planMode === "overview" && (
                      <button
                        type="button"
                        className="pf-toolbar__eye"
                        title={showAllClusters ? "Hide others" : "Show all"}
                        data-tip={showAllClusters ? "Hide other clusters" : "Show all clusters"}
                        aria-label={showAllClusters ? "Hide other clusters" : "Show all clusters"}
                        onClick={() => setShowAllClusters((v) => !v)}
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
                      </button>
                    )}
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
                    {CLUSTERS.map((c) => (
                      <span key={c.id} className="pf-legend__item">
                        <span className="pf-legend__dot" style={{ background: c.color }} />
                        {c.label}
                      </span>
                    ))}
                  </div>
                  <PlanCanvas
                    mode={planMode}
                    planExplorerTabId={planExplorerTabId}
                    planClusterFocus={clusterFocus}
                    onSelection={onFlowSelection}
                    planTreeSelections={planTreeSelections}
                    onPlanTreeSelectionsChange={handlePlanTreeSelectionsChange}
                    onClusterFocusChange={setClusterFocus}
                    showAllClusters={showAllClusters}
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

          <footer className="pf-footer">
            <div className="pf-footer__assist">{assistantLine}</div>
            <PromptDock
              clusterId={clusterFocus}
              value={prompt}
              onChange={setPrompt}
              onSubmit={runMock}
              contextChip={chip}
              onAddAttachment={addAttachmentMetadata}
              disabled={showIntro}
            />
          </footer>
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
          sources={sourceItems}
          programFiles={programFileItems}
          onPickProgramFile={pickProgramFileFromSidebar}
          onNavigateLocalFeature={navigateLocalFeature}
          onNavigateCluster={navigateCluster}
          composerPrompt={prompt}
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
    </div>
  );
}
