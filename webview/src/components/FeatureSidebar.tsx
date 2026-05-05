import { useMemo, type CSSProperties } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import type { ClusterId, FeatureItem } from "../types";
import { CLUSTERS } from "../types";

function rgbaFromHex(hex: string, alpha: number): string {
  const raw = hex.replace("#", "");
  const full = raw.length === 3 ? raw.split("").map((ch) => ch + ch).join("") : raw;
  const n = parseInt(full, 16);
  if (Number.isNaN(n) || full.length !== 6) return `rgba(0,0,0,${alpha})`;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function SortableRow({
  item,
  variant,
  active,
  onPick,
  localSurface,
}: {
  item: FeatureItem;
  variant: "global" | "local";
  active: boolean;
  onPick: () => void;
  localSurface?: { background: string; borderColor: string; color: string };
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.65 : 1,
    ...(variant === "local" && localSurface
      ? {
          background: localSurface.background,
          borderColor: localSurface.borderColor,
          color: localSurface.color,
        }
      : {}),
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`pf-feat ${variant === "global" ? "pf-feat--global" : "pf-feat--local"} ${active ? "pf-feat--active" : ""}`}
      onClick={onPick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick();
        }
      }}
    >
      <button type="button" className="pf-feat__grip" aria-label="Reorder" {...attributes} {...listeners}>
        ⣿
      </button>
      <span className="pf-feat__label">{item.label}</span>
      <button type="button" className="pf-feat__more" aria-label="More">
        ···
      </button>
    </div>
  );
}

export function FeatureSidebar({
  clusterId,
  globalItems,
  localByCluster,
  sources,
  onReorderGlobal,
  onReorderLocal,
  activeContext,
  onSelectContext,
  collapsed,
  onToggleCollapsed,
}: {
  clusterId: ClusterId;
  globalItems: FeatureItem[];
  localByCluster: Record<ClusterId, FeatureItem[]>;
  sources: Array<{ id: string; kind: "link" | "document" | "video" | "image"; label: string }>;
  onReorderGlobal: (items: FeatureItem[]) => void;
  onReorderLocal: (cluster: ClusterId, items: FeatureItem[]) => void;
  activeContext: { kind: "global" | "local"; id: string } | null;
  onSelectContext: (ctx: { kind: "global" | "local"; id: string }) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const localItems = localByCluster[clusterId];
  const c = CLUSTERS.find((x) => x.id === clusterId);

  const localSurface = useMemo(() => {
    if (!c?.hex) return undefined;
    const h = c.hex;
    return {
      background: `linear-gradient(180deg, ${rgbaFromHex(h, 0.11)} 0%, ${rgbaFromHex(h, 0.22)} 100%)`,
      borderColor: rgbaFromHex(h, 0.42),
      color: "var(--text)",
    };
  }, [c?.hex]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const onDragEndGlobal = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = globalItems.findIndex((i) => i.id === active.id);
    const newIndex = globalItems.findIndex((i) => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onReorderGlobal(arrayMove(globalItems, oldIndex, newIndex));
  };

  const onDragEndLocal = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = localItems.findIndex((i) => i.id === active.id);
    const newIndex = localItems.findIndex((i) => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onReorderLocal(clusterId, arrayMove(localItems, oldIndex, newIndex));
  };

  if (collapsed) {
    return (
      <aside className="pf-side pf-side--collapsed" aria-label="Context" aria-expanded={false}>
        <button type="button" className="pf-side-rail-hit" onClick={onToggleCollapsed} title="Expand context panel">
          <span className="pf-side-rail-icon" aria-hidden>
            ◀
          </span>
          <span className="pf-side-rail-label">Context</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="pf-side" aria-expanded={true}>
      <div className="pf-side-chrome">
        <span className="pf-side-chrome__title">Context</span>
        <button type="button" className="pf-side-chrome__collapse" onClick={onToggleCollapsed} title="Collapse context panel" aria-label="Collapse context panel">
          <span aria-hidden>▶</span>
        </button>
      </div>
      <PanelGroup id="promptful-feature-panels" autoSaveId="promptful-features-v3" direction="vertical" className="pf-side-panels">
        <Panel defaultSize={30} minSize={12} className="pf-side-panel pf-side-panel--top">
          <div className="pf-side-scroll">
            <div className="pf-side__head">Global</div>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEndGlobal}>
              <SortableContext items={globalItems.map((g) => g.id)} strategy={verticalListSortingStrategy}>
                <div className="pf-side__list">
                  {globalItems.map((item) => (
                    <SortableRow
                      key={item.id}
                      item={item}
                      variant="global"
                      active={activeContext?.kind === "global" && activeContext.id === item.id}
                      onPick={() => onSelectContext({ kind: "global", id: item.id })}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        </Panel>

        <PanelResizeHandle className="pf-side-resizer" aria-label="Resize Global / Local">

          <div className="pf-side-resizer__line" />
        </PanelResizeHandle>

        <Panel defaultSize={38} minSize={16} className="pf-side-panel pf-side-panel--middle">
          <div
            className="pf-side-scroll"
            style={c?.hex ? { borderLeft: `3px solid ${c.hex}40`, paddingLeft: 8 } : undefined}
          >
            <div className="pf-side__head pf-side__head--local">
              Local ·{" "}
              <span className="pf-side__cluster" style={c?.hex ? { color: c.hex } : undefined}>
                {c?.label}
              </span>
            </div>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEndLocal}>
              <SortableContext items={localItems.map((g) => g.id)} strategy={verticalListSortingStrategy}>
                <div className="pf-side__list">
                  {localItems.map((item) => (
                    <SortableRow
                      key={item.id}
                      item={item}
                      variant="local"
                      active={activeContext?.kind === "local" && activeContext.id === item.id}
                      onPick={() => onSelectContext({ kind: "local", id: item.id })}
                      localSurface={localSurface}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        </Panel>

        <PanelResizeHandle className="pf-side-resizer" aria-label="Resize Local / Source">

          <div className="pf-side-resizer__line" />
        </PanelResizeHandle>

        <Panel defaultSize={16} minSize={10} className="pf-side-panel pf-side-panel--source">
          <div className="pf-side-scroll">
            <div className="pf-side__head">Source</div>
            <div className="pf-source-list">
              {sources.length === 0 ? (
                <div className="pf-source-empty">No resources yet.</div>
              ) : (
                sources.map((s) => (
                  <div key={s.id} className="pf-source-item" title={s.label}>
                    <span className="pf-source-item__kind">
                      {s.kind.toUpperCase()}
                    </span>
                    <span className="pf-source-item__label">{s.label}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </Panel>

        <PanelResizeHandle className="pf-side-resizer" aria-label="Resize Source / Analytics">
          <div className="pf-side-resizer__line" />
        </PanelResizeHandle>

        <Panel defaultSize={16} minSize={8} className="pf-side-panel pf-side-panel--analytics">
          <div className="pf-side-scroll pf-side-scroll--analytics">
            <div className="pf-side__head">Analytics</div>
            <div className="pf-analytics-icons">
              <span className="pf-analytics-icons__sq" />
              <span className="pf-analytics-icons__ci" />
              <span className="pf-analytics-icons__tr" />
              <span className="pf-analytics-icons__dm" />
            </div>
            <div className="pf-cluster-dots">
              {CLUSTERS.map((cl) => (
                <span key={cl.id} className="pf-cluster-dots__dot" style={{ background: cl.color }} title={cl.label} />
              ))}
            </div>
          </div>
        </Panel>
      </PanelGroup>
    </aside>
  );
}
