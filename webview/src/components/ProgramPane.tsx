import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Fragment, type MouseEvent, useCallback, useEffect, useMemo, useState } from "react";
import { decisionHudSlotsForProgramTab } from "../mock/flows";
import type { ClusterId } from "../types";
import { CLUSTERS } from "../types";
import type { ProgramEditorTab } from "../programTabs";

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

function SortableEditorTab({
  id,
  label,
  active,
  closeEnabled,
  onSelect,
  onClose,
}: {
  id: string;
  label: string;
  active: boolean;
  closeEnabled: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
    opacity: isDragging ? 0.9 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`pf-program-tab-wrap ${active ? "pf-program-tab-wrap--active" : ""}`}
      data-active={active || undefined}
    >
      <button
        type="button"
        role="tab"
        className={`pf-program-tab-inner ${active ? "pf-program-tab-inner--active" : ""}`}
        aria-selected={active}
        onClick={(e: MouseEvent) => {
          e.stopPropagation();
          onSelect();
        }}
        {...attributes}
        {...listeners}
      >
        <span className="pf-program-tab-label">{label}</span>
      </button>
      <button
        type="button"
        className={`pf-program-tab-close ${!closeEnabled ? "pf-program-tab-close--blocked" : ""}`}
        aria-label={`Close ${label}`}
        title={closeEnabled ? "Close editor" : "Keep at least one tab open"}
        disabled={!closeEnabled}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          if (!closeEnabled) return;
          onClose();
        }}
      >
        ×
      </button>
    </div>
  );
}

export function ProgramPane({
  catalog,
  openTabIds,
  activeId,
  onChangeTab,
  onReorderTabs,
  onCloseTab,
}: {
  catalog: readonly ProgramEditorTab[];
  openTabIds: string[];
  activeId: string;
  onChangeTab: (id: string) => void;
  onReorderTabs: (next: string[]) => void;
  onCloseTab: (id: string) => void;
}) {
  const [openLine, setOpenLine] = useState<number | null>(null);

  useEffect(() => {
    setOpenLine(null);
  }, [activeId]);

  const active = useMemo(() => {
    const direct = catalog.find((t) => t.id === activeId);
    if (direct) return direct;
    for (const id of openTabIds) {
      const f = catalog.find((t) => t.id === id);
      if (f) return f;
    }
    return catalog[0];
  }, [catalog, activeId, openTabIds]);

  const lines = useMemo(() => active?.code.split("\n") ?? [], [active?.code]);
  const markers = useMemo(() => decisionLineIndices(lines), [lines]);
  const hudSlots = useMemo(() => (active?.id ? decisionHudSlotsForProgramTab(active.id) : []), [active?.id]);
  const canCloseAny = openTabIds.length > 1;

  const closeHud = useCallback(() => setOpenLine(null), []);
  const toggleHud = useCallback((i: number) => {
    setOpenLine((prev) => (prev === i ? null : i));
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      const { active, over } = e;
      if (!over || active.id === over.id) return;
      const oldIndex = openTabIds.indexOf(String(active.id));
      const newIndex = openTabIds.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return;
      onReorderTabs(arrayMove(openTabIds, oldIndex, newIndex));
    },
    [openTabIds, onReorderTabs]
  );

  if (!active) return null;

  return (
    <div className="pf-program-wrap">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={openTabIds} strategy={horizontalListSortingStrategy}>
          <div className="pf-program-tabs" role="tablist" aria-label="Open editors">
            {openTabIds.map((tid) => {
              const meta = catalog.find((t) => t.id === tid);
              if (!meta) return null;
              return (
                <SortableEditorTab
                  key={tid}
                  id={tid}
                  label={meta.label}
                  active={activeId === tid}
                  closeEnabled={canCloseAny}
                  onSelect={() => {
                    closeHud();
                    onChangeTab(tid);
                  }}
                  onClose={() => {
                    closeHud();
                    onCloseTab(tid);
                  }}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
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
                    <div className="pf-program__hud">
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
