import { useEffect, useRef, useState } from "react";
import type { ClusterId } from "../types";
import { CLUSTERS } from "../types";

export function PromptDock({
  clusterId,
  value,
  onChange,
  onSubmit,
  contextChip,
  onAddAttachment,
  disabled,
}: {
  clusterId: ClusterId;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  contextChip: string | null;
  onAddAttachment: (action: "link" | "upload") => void;
  disabled?: boolean;
}) {
  const c = CLUSTERS.find((x) => x.id === clusterId);
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
    <div className="pf-dock">
      {contextChip && (
        <div className="pf-dock__chip" title="Prompt is scoped to this context">
          <span className="pf-dock__chip-dot" style={{ background: c?.color }} />
          {contextChip}
        </div>
      )}
      <div className="pf-dock__bar">
        <div className="pf-intro__field pf-dock__composer">
          <div className="pf-plus-wrap" ref={plusMenuRef}>
            <button
              type="button"
              className="pf-intro__plus"
              aria-label="Add metadata reference"
              title="Add link or upload from computer"
              aria-expanded={plusMenuOpen}
              onClick={() => setPlusMenuOpen((v) => !v)}
              disabled={disabled}
            >
              +
            </button>
            {plusMenuOpen && !disabled && (
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
            className="pf-intro__input pf-dock__input"
            placeholder="Send follow-up…"
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                onSubmit();
              }
            }}
          />
          <button type="button" className="pf-intro__send pf-dock__send" onClick={onSubmit} disabled={disabled}>
            Send
          </button>
        </div>
      </div>
      <div className="pf-dock__hint">
        <span className="pf-dock__kbd">↵</span>
        <span>to run (mock AI)</span>
      </div>
    </div>
  );
}
