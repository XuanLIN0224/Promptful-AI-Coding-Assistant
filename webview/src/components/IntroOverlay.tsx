import { useEffect, useRef, useState } from "react";
import type { WorkspaceTab } from "../types";

/** Placeholder names only - this mock never calls a real model or API. */
const MOCK_MODELS = ["Promptful Mock", "Structure Assistant", "Decision Mapper", "Context Reviewer"] as const;

export type IntroAttachment = {
  id: string;
  kind: "link" | "document" | "video" | "image";
  label: string;
};

export function IntroOverlay({
  onBegin,
  prompt,
  onPromptChange,
  onPromptSend,
  attachments,
  onAddAttachment,
  onRemoveAttachment,
}: {
  onBegin: (tab: WorkspaceTab) => void;
  prompt: string;
  onPromptChange: (v: string) => void;
  onPromptSend: () => void;
  attachments: readonly IntroAttachment[];
  onAddAttachment: (action: "link" | "upload") => void;
  onRemoveAttachment: (id: string) => void;
}) {
  const [modelId, setModelId] = useState<string>(MOCK_MODELS[0]);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
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

          <div className="pf-intro__modes">
            <button type="button" className="pf-intro__mode" onClick={() => onBegin("plan")}>
              Plan
            </button>
            <button type="button" className="pf-intro__mode" onClick={() => onBegin("program")}>
              Program
            </button>
            <button type="button" className="pf-intro__mode pf-intro__mode--ghost" onClick={() => onBegin("plan")}>
              Chat
            </button>
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
                  if (prompt.trim()) onPromptSend();
                }}
              />
              <button
                type="button"
                className="pf-intro__send"
                aria-label="Send prompt"
                onClick={() => onPromptSend()}
                disabled={!prompt.trim()}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
