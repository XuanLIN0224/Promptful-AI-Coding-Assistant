import { useEffect, useRef, useState } from "react";
import type { ClusterId, ClusterMeta } from "../types";

/** Placeholder names only - this mock never calls a real model or API. */
const MOCK_MODELS = ["ChatGPT", "Gemini", "Claude", "Copilot", "Promptful Mock"] as const;

function AnalysisStatusLine({ done, pending, complete }: { done: boolean; pending: string; complete: string }) {
  return (
    <div className={`pf-intro__analysis-line${done ? " pf-intro__analysis-line--done" : ""}`}>
      {done ? <span className="pf-intro__done" aria-hidden /> : <span className="pf-intro__spinner" aria-hidden />}
      <span>{done ? complete : pending}</span>
    </div>
  );
}

export type IntroAttachment = {
  id: string;
  kind: "link" | "document" | "video" | "image";
  label: string;
};

export function IntroOverlay({
  prompt,
  onPromptChange,
  onPromptSend,
  attachments,
  onAddAttachment,
  onRemoveAttachment,
  clusters,
  onChooseCluster,
  onViewAllClusters,
}: {
  prompt: string;
  onPromptChange: (v: string) => void;
  onPromptSend: () => void;
  attachments: readonly IntroAttachment[];
  onAddAttachment: (action: "link" | "upload") => void;
  onRemoveAttachment: (id: string) => void;
  clusters: readonly ClusterMeta[];
  onChooseCluster: (cluster: ClusterId) => void;
  onViewAllClusters: () => void;
}) {
  const [modelId, setModelId] = useState<string>(MOCK_MODELS[0]);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [analysisStarted, setAnalysisStarted] = useState(false);
  const [analysisStep, setAnalysisStep] = useState<0 | 1 | 2>(0);
  const plusMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!plusMenuOpen) return;
    const onDown = (ev: MouseEvent) => {
      if (!plusMenuRef.current) return;
      if (plusMenuRef.current.contains(ev.target as Node)) return;
      setPlusMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [plusMenuOpen]);

  const startAnalysis = () => {
    if (!prompt.trim()) return;
    onPromptSend();
    setAnalysisStarted(true);
    setAnalysisStep(0);
    window.setTimeout(() => setAnalysisStep(1), 1800);
    window.setTimeout(() => setAnalysisStep(2), 3800);
  };

  return (
    <div className="pf-intro">
      <div className="pf-intro__stack">
        <div className="pf-intro__above">
          <header className="pf-intro__hero">
            <h1 className="pf-intro__title">What are you planning?</h1>
          </header>

          <div className="pf-intro__model-panel">
            <select
              id="pf-intro-model"
              className="pf-intro__model-select"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              aria-label="Select assistant mode"
              aria-describedby="pf-intro-model-desc"
            >
              {MOCK_MODELS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <p id="pf-intro-model-desc" className="pf-intro__model-sr-hint">
              Demo names only; not a live model picker.
            </p>
          </div>

        </div>

        <div className="pf-node pf-node--decision pf-intro__session-node pf-intro__session-node--workspace">
          <div className="pf-intro__session-footer">
            {attachments.length > 0 && (
              <div className="pf-intro__attachments" aria-label="Attached metadata">
                {attachments.map((a) => (
                  <span key={a.id} className="pf-attachment-chip">
                    <span className="pf-attachment-chip__kind">{a.kind}</span>
                    <span className="pf-attachment-chip__label" title={a.label}>
                      {a.label}
                    </span>
                    <button
                      type="button"
                      className="pf-attachment-chip__remove"
                      aria-label={`Remove ${a.kind} metadata`}
                      onClick={() => onRemoveAttachment(a.id)}
                    >
                      x
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="pf-intro__field">
              <div className="pf-plus-wrap" ref={plusMenuRef}>
                <button
                  type="button"
                  className="pf-intro__plus"
                  aria-label="Add metadata reference"
                  title="Add link or upload from computer"
                  aria-expanded={plusMenuOpen}
                  onClick={() => setPlusMenuOpen((v) => !v)}
                >
                  +
                </button>
                {plusMenuOpen && (
                  <div className="pf-plus-menu" role="menu" aria-label="Add metadata">
                    {(
                      [
                        ["link", "Add link"],
                        ["upload", "Upload from my computer"],
                      ] as const
                    ).map(([action, label]) => (
                      <button
                        key={action}
                        type="button"
                        className="pf-plus-menu__item"
                        role="menuitem"
                        onClick={() => {
                          onAddAttachment(action);
                          setPlusMenuOpen(false);
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <input
                className="pf-intro__input"
                placeholder="Let's build something..."
                aria-label="Describe what you want to build"
                type="text"
                autoComplete="off"
                value={prompt}
                onChange={(e) => onPromptChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  if (prompt.trim()) startAnalysis();
                }}
              />
              <button
                type="button"
                className="pf-intro__send"
                aria-label="Send prompt"
                onClick={startAnalysis}
                disabled={!prompt.trim()}
              >
                Send
              </button>
            </div>
            {analysisStarted && (
              <div className="pf-intro__analysis" aria-live="polite">
                <AnalysisStatusLine
                  done={analysisStep >= 1}
                  pending="Processing your query"
                  complete="Processing complete"
                />
                {attachments.length === 0 && analysisStep >= 1 && (
                  <div className="pf-intro__source-nudge">
                    <span>No source attached yet. Add a reference now, or continue without one.</span>
                    <button type="button" onClick={() => onAddAttachment("link")}>Add link</button>
                    <button type="button" onClick={() => onAddAttachment("upload")}>Upload</button>
                  </div>
                )}
                {analysisStep >= 1 && (
                  <AnalysisStatusLine
                    done={analysisStep >= 2}
                    pending="Clustering core themes"
                    complete="Clustering complete"
                  />
                )}
                {analysisStep >= 2 && (
                  <div className="pf-intro__cluster-choice">
                    <p>There appear to be four core clusters. Where would you like to start?</p>
                    <div className="pf-intro__cluster-grid">
                      {clusters.slice(0, 4).map((cluster) => (
                        <button
                          key={cluster.id}
                          type="button"
                          className="pf-intro__cluster-btn"
                          style={{ borderColor: cluster.hex }}
                          onClick={() => onChooseCluster(cluster.id)}
                        >
                          <span className="pf-intro__cluster-dot" style={{ background: cluster.color }} />
                          {cluster.label}
                        </button>
                      ))}
                      <button type="button" className="pf-intro__cluster-btn pf-intro__cluster-btn--all" onClick={onViewAllClusters}>
                        View all
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
