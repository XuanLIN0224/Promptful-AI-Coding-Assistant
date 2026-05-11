import { useCallback, useEffect, useMemo, useState } from "react";
import type { OnSelectionChangeParams, Viewport } from "@xyflow/react";
import type { ClusterId, DecisionNodePayload, FeatureItem, FileGraphPayload, PlanCanvasMode, WorkspaceTab } from "./types";
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

const INITIAL_PROGRAM_TAB = PROGRAM_EDITOR_TABS[0]?.id ?? "cal-java";
const ATTACHMENT_ACTIONS = ["link", "upload"] as const;
const RIGHT_SIDEBAR_MIN = 240;
const RIGHT_SIDEBAR_MAX = 520;
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

const initialGlobal: FeatureItem[] = [
  { id: "g1", label: "Security conscious" },
  { id: "g2", label: "Peak load < 500 rps" },
  { id: "g3", label: "Payment provider boundaries" },
];

function viewportNearlyEqual(a: Viewport | null, b: Viewport): boolean {
  if (!a) return false;
  const ε = 0.35;
  return Math.abs(a.x - b.x) < ε && Math.abs(a.y - b.y) < ε && Math.abs(a.zoom - b.zoom) < 0.004;
}

const initialLocal = (): Record<ClusterId, FeatureItem[]> => ({
  security: [
    { id: "ls1", label: "Rotate refresh tokens" },
    { id: "ls2", label: "Scope calendar to read-only" },
    { id: "ls3", label: "Audit OAuth redirects" },
  ],
  core: [
    { id: "lc1", label: "Clear definitions" },
    { id: "lc2", label: "Recurring exceptions" },
    { id: "lc3", label: "Overlap policy" },
  ],
  infra: [
    { id: "li1", label: "Idempotent webhooks" },
    { id: "li2", label: "Back-pressure on fan-out" },
    { id: "li3", label: "Structured logs" },
  ],
});

export default function App() {
  const [showIntro, setShowIntro] = useState(true);
  const [tab, setTab] = useState<WorkspaceTab>("plan");
  const [planMode, setPlanMode] = useState<PlanCanvasMode>("overview");
  /** Which explorer file scopes highlights / zoom in Plan (tab ids e.g. cal-java, sec-py). */
  const [planExplorerTabId, setPlanExplorerTabId] = useState<string>(INITIAL_PROGRAM_TAB);
  /** Committed selection per mock tree slice (three clusters on one canvas). */
  const [planTreeSelections, setPlanTreeSelections] = useState<Partial<Record<PlanTreeKind, string | null>>>({});
  /** When false, only the cluster for the current file is visible (overlapping layout preserved when shown). */
  const [showAllClusters, setShowAllClusters] = useState(true);
  /** Last pan/zoom per Plan canvas mode when switching Overview ↔ Node graph. */
  const [planViewportOverview, setPlanViewportOverview] = useState<Viewport | null>(null);
  const [planViewportNodegraph, setPlanViewportNodegraph] = useState<Viewport | null>(null);
  const [clusterFocus, setClusterFocus] = useState<ClusterId>("core");
  const [globalFeatures, setGlobalFeatures] = useState(initialGlobal);
  const [localByCluster, setLocalByCluster] = useState(initialLocal);
  const [activeContext, setActiveContext] = useState<{ kind: "global" | "local"; id: string } | null>(null);
  const [scopeLabel, setScopeLabel] = useState<string | null>(() => PROGRAM_EDITOR_TABS.find((t) => t.id === INITIAL_PROGRAM_TAB)?.label ?? null);
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

  const savedPlanViewport = planMode === "overview" ? planViewportOverview : planViewportNodegraph;

  /** Mode comes from the canvas that emitted the event so we never write Overview pan/zoom into the Node graph slot (or vice versa) when switching tabs. */
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

  /** Subtitle under Plan / Program: Files (Program), cluster or Overview (Plan overview), or Node graph. */
  const headerCrumb = useMemo(() => {
    if (tab === "program") {
      const p = programCatalog.find((t) => t.id === programTabId);
      return p?.label ?? programCatalog[0]?.label ?? "Files";
    }
    if (tab === "plan") {
      if (planMode === "nodegraph") return "Node graph";
      const cl = CLUSTERS.find((c) => c.id === clusterFocus);
      return cl?.label ?? "Overview";
    }
    return "Plan";
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
      if (f) return `${activeContext.kind === "global" ? "Global" : "Local"} · ${f.label}`;
    }
    if (scopeLabel) return `Selection · ${scopeLabel}`;
    return null;
  }, [activeContext, clusterFocus, globalFeatures, localByCluster, scopeLabel]);

  /** Shared mock submission for dock and intro composer. */
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
      return;
    }
  }, []);

  const removeAttachmentMetadata = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const renameGlobalFeature = useCallback((id: string, label: string) => {
    const t = label.trim();
    if (!t) return;
    setGlobalFeatures((prev) => prev.map((x) => (x.id === id ? { ...x, label: t } : x)));
  }, []);

  const removeGlobalFeature = useCallback((id: string) => {
    setGlobalFeatures((prev) => prev.filter((x) => x.id !== id));
    setActiveContext((ctx) => (ctx?.kind === "global" && ctx.id === id ? null : ctx));
  }, []);

  const renameLocalFeature = useCallback((cluster: ClusterId, id: string, label: string) => {
    const t = label.trim();
    if (!t) return;
    setLocalByCluster((prev) => ({
      ...prev,
      [cluster]: prev[cluster].map((x) => (x.id === id ? { ...x, label: t } : x)),
    }));
  }, []);

  const removeLocalFeature = useCallback((cluster: ClusterId, id: string) => {
    setLocalByCluster((prev) => ({
      ...prev,
      [cluster]: prev[cluster].filter((x) => x.id !== id),
    }));
    setActiveContext((ctx) => (ctx?.kind === "local" && ctx.id === id ? null : ctx));
  }, []);

  const removeSourceFromPanel = useCallback(
    (id: string) => {
      removeAttachmentMetadata(id);
      setSourceViewerId((prev) => (prev === id ? null : prev));
    },
    [removeAttachmentMetadata]
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

  const navigateToCluster = useCallback(
    (cluster: ClusterId) => {
      const preferredTab =
        workspaceProgramTabs.find((t) => clusterForProgramEditorTab(t.id) === cluster)?.id ??
        PROGRAM_EDITOR_TABS.find((t) => clusterForProgramEditorTab(t.id) === cluster)?.id ??
        planExplorerTabId;
      setShowIntro(false);
      setTab("plan");
      setPlanMode("overview");
      setClusterFocus(cluster);
      setPlanExplorerTabId(preferredTab);
      // "Eye closed": keep only the chosen cluster visible; PlanCanvas auto-fits that cluster.
      setShowAllClusters(false);
    },
    [workspaceProgramTabs, planExplorerTabId]
  );

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
              Source · {sourceViewerAttachment.kind.charAt(0).toUpperCase()}
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
                    className="pf-toolbar__apply"
                    aria-label="Apply plan"
                    onClick={() => {
                      // TODO: wire real apply plan action
                    }}
                  >
                    Apply plan
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
                  onPlanTreeSelectionsChange={setPlanTreeSelections}
                  onClusterFocusChange={setClusterFocus}
                  showAllClusters={showAllClusters}
                  onToggleShowAllClusters={() => setShowAllClusters((v) => !v)}
                  savedViewport={savedPlanViewport}
                  onViewportSave={handlePlanViewportSave}
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
          programFiles={workspaceProgramTabs.map((t) => ({ id: t.id, label: t.label, path: t.path }))}
          onPickProgramFile={(id) => {
            setShowIntro(false);
            setTab("program");
            handleProgramTabChange(id);
          }}
          onNavigateLocalFeature={(cluster, featureId) => {
            setClusterFocus(cluster);
            setActiveContext({ kind: "local", id: featureId });
          }}
          onNavigateCluster={navigateToCluster}
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
