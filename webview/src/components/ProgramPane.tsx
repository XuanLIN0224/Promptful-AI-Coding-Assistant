import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { decisionHudSlotsForProgramTab } from "../mock/flows";
import type { ProgramEditorTab } from "../programTabs";
import type { ClusterId } from "../types";
import { CLUSTERS } from "../types";

function hexForCluster(id: ClusterId): string {
  return CLUSTERS.find((c) => c.id === id)?.hex ?? "#86868b";
}

function decisionLineIndices(lines: readonly string[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (/\/\/ decision:|#\s*decision:/i.test(ln)) out.push(i);
  }
  return out.slice(0, 3);
}

type ProgramPaneProps = {
  catalog: readonly ProgramEditorTab[];
  activeId: string;
  openTabIds?: string[];
  onChangeTab?: (id: string) => void;
  onReorderTabs?: (next: string[]) => void;
  onCloseTab?: (id: string) => void;
  onOpenDecisionNode?: (clusterId: ClusterId, nodeId: string) => void;
};

export function ProgramPane({ catalog, activeId, onOpenDecisionNode }: ProgramPaneProps) {
  const [openLine, setOpenLine] = useState<number | null>(null);

  useEffect(() => {
    setOpenLine(null);
  }, [activeId]);

  const active = useMemo(
    () => catalog.find((t) => t.id === activeId) ?? catalog[0],
    [catalog, activeId]
  );

  const lines = useMemo(() => active?.code.split("\n") ?? [], [active?.code]);
  const markers = useMemo(() => decisionLineIndices(lines), [lines]);
  const hudSlots = useMemo(() => (active?.id ? decisionHudSlotsForProgramTab(active.id) : []), [active?.id]);

  const toggleHud = useCallback((i: number) => {
    setOpenLine((prev) => (prev === i ? null : i));
  }, []);

  if (!active) {
    return (
      <div className="pf-program-wrap">
        <div className="pf-program-meta">
          <span className="pf-program-meta__path">Open a file in VS Code to view it here.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="pf-program-wrap">
      <div className="pf-program-meta">
        <span className="pf-program-meta__path">{active.path}</span>
      </div>
      <div className="pf-program">
        <div className="pf-program__sheet">
          {lines.map((line, i) => {
            const markOrd = markers.indexOf(i);
            const marked = markOrd >= 0;
            const slot =
              marked && hudSlots.length > 0 ? hudSlots[Math.min(markOrd, hudSlots.length - 1)] : null;
            const clusterHex = slot ? hexForCluster(slot.clusterId) : marked ? hexForCluster("core") : null;
            const rowWash =
              marked && clusterHex
                ? {
                    background: `linear-gradient(90deg, ${clusterHex}2b 0%, ${clusterHex}0d 52%, transparent 78%)`,
                  }
                : undefined;
            const dotGlow = marked && clusterHex ? `${clusterHex}26` : undefined;

            const hudSlot =
              openLine === i && slot
                ? slot
                : openLine === i && hudSlots.length > 0
                  ? hudSlots[hudSlots.length - 1]
                  : openLine === i
                    ? null
                    : null;

            const hudHex = hudSlot ? hexForCluster(hudSlot.clusterId) : null;

            return (
              <Fragment key={i}>
                <div className="pf-program__sheet-line">
                  <div className="pf-program__ln">{i + 1}</div>
                  <div className="pf-program__row" style={rowWash}>
                    <pre className="pf-program__pre">{line}</pre>
                    {marked && clusterHex && (
                      <button
                        type="button"
                        className="pf-program__node"
                        style={{
                          borderColor: clusterHex,
                          backgroundColor: clusterHex,
                          boxShadow: `0 0 0 4px ${dotGlow ?? "transparent"}`,
                        }}
                        aria-label="Open decision details"
                        aria-expanded={openLine === i}
                        onClick={() => toggleHud(i)}
                      />
                    )}
                  </div>
                </div>

                {hudSlot && hudHex && (
                  <div className="pf-program__sheet-hud">
                    <div className="pf-program__ln pf-program__ln--hud-gap" aria-hidden />
                    <div
                      className={`pf-program__hud ${onOpenDecisionNode ? "pf-program__hud--link" : ""}`}
                      role={onOpenDecisionNode ? "button" : undefined}
                      tabIndex={onOpenDecisionNode ? 0 : undefined}
                      title={onOpenDecisionNode ? "Open this decision in Plan" : undefined}
                      onClick={() => onOpenDecisionNode?.(hudSlot.clusterId, hudSlot.nodeId)}
                      onKeyDown={(e) => {
                        if (!onOpenDecisionNode) return;
                        if (e.key !== "Enter" && e.key !== " ") return;
                        e.preventDefault();
                        onOpenDecisionNode(hudSlot.clusterId, hudSlot.nodeId);
                      }}
                    >
                      <div className="pf-program__hud-title">
                        Tree · <span style={{ color: hudHex }}>{hudSlot.title}</span>
                      </div>
                      {hudSlot.options.map((o) => (
                        <div key={o.id} className="pf-program__hud-row">
                          <span className="pf-program__hud-pct">{o.confidence}%</span>
                          <div className="pf-program__hud-opt">
                            <span className="pf-program__hud-opt-label">{o.label}</span>
                            <div className="pf-program__hud-bar">
                              <span
                                style={{
                                  width: `${o.confidence}%`,
                                  background: `linear-gradient(90deg, ${hudHex}, ${hudHex}99)`,
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
