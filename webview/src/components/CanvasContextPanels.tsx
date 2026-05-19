import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type { ClusterId, FeatureItem } from "../types";

type PanelId = "global" | "local";

const DEFAULT_POSITIONS: Record<PanelId, { x: number; y: number }> = {
  global: { x: 18, y: 18 },
  local: { x: 18, y: 64 },
};

const DEFAULT_PANEL_HEIGHTS: Record<PanelId, number> = {
  global: 196,
  local: 196,
};

const MIN_PANEL_HEIGHT = 112;
const CANVAS_PAD = 8;

function maxPanelHeightForPosition(positionY: number, boundsH: number): number {
  return Math.max(MIN_PANEL_HEIGHT, boundsH - CANVAS_PAD * 2 - positionY);
}

function clampPanelHeight(height: number, positionY: number, boundsH: number): number {
  const maxH = maxPanelHeightForPosition(positionY, boundsH);
  return Math.min(Math.max(MIN_PANEL_HEIGHT, height), maxH);
}

function clampPosition(
  x: number,
  y: number,
  panelW: number,
  panelH: number,
  boundsW: number,
  boundsH: number
): { x: number; y: number } {
  const maxX = Math.max(CANVAS_PAD, boundsW - panelW - CANVAS_PAD);
  const maxY = Math.max(CANVAS_PAD, boundsH - panelH - CANVAS_PAD);
  return {
    x: Math.min(Math.max(CANVAS_PAD, x), maxX),
    y: Math.min(Math.max(CANVAS_PAD, y), maxY),
  };
}

function useClampedPanelPosition(
  boundsRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
  position: { x: number; y: number },
  onPositionChange: (next: { x: number; y: number }) => void
) {
  const clampToBounds = useCallback(() => {
    const bounds = boundsRef.current;
    const panel = panelRef.current;
    if (!bounds || !panel) return;
    const { width: boundsW, height: boundsH } = bounds.getBoundingClientRect();
    const { width: panelW, height: panelH } = panel.getBoundingClientRect();
    const next = clampPosition(position.x, position.y, panelW, panelH, boundsW, boundsH);
    if (next.x !== position.x || next.y !== position.y) onPositionChange(next);
  }, [boundsRef, panelRef, position.x, position.y, onPositionChange]);

  useLayoutEffect(() => {
    clampToBounds();
  }, [clampToBounds]);

  useEffect(() => {
    const bounds = boundsRef.current;
    if (!bounds || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => clampToBounds());
    ro.observe(bounds);
    return () => ro.disconnect();
  }, [boundsRef, clampToBounds]);

  return clampToBounds;
}

function DraggableContextPanel({
  open,
  onToggleOpen,
  position,
  onPositionChange,
  expandedHeight,
  onExpandedHeightChange,
  boundsRef,
  minimizedLabel,
  ariaLabel,
  className,
  children,
}: {
  open: boolean;
  onToggleOpen: () => void;
  position: { x: number; y: number };
  onPositionChange: (next: { x: number; y: number }) => void;
  expandedHeight: number;
  onExpandedHeightChange: (height: number) => void;
  boundsRef: RefObject<HTMLElement | null>;
  minimizedLabel: ReactNode;
  ariaLabel: string;
  className: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const resizeRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);
  const moveHandlerRef = useRef<(event: PointerEvent) => void>(() => undefined);
  const upHandlerRef = useRef<(event: PointerEvent) => void>(() => undefined);
  const resizeMoveHandlerRef = useRef<(event: PointerEvent) => void>(() => undefined);
  const resizeUpHandlerRef = useRef<(event: PointerEvent) => void>(() => undefined);

  const clampToBounds = useClampedPanelPosition(boundsRef, panelRef, position, onPositionChange);

  const clampHeightToCanvas = useCallback(() => {
    const bounds = boundsRef.current;
    if (!bounds) return;
    const boundsH = bounds.getBoundingClientRect().height;
    const next = clampPanelHeight(expandedHeight, position.y, boundsH);
    if (next !== expandedHeight) onExpandedHeightChange(next);
  }, [boundsRef, expandedHeight, onExpandedHeightChange, position.y]);

  const clearWindowListeners = useCallback(() => {
    window.removeEventListener("pointermove", moveHandlerRef.current);
    window.removeEventListener("pointerup", upHandlerRef.current);
    window.removeEventListener("pointercancel", upHandlerRef.current);
  }, []);

  const clearResizeListeners = useCallback(() => {
    window.removeEventListener("pointermove", resizeMoveHandlerRef.current);
    window.removeEventListener("pointerup", resizeUpHandlerRef.current);
    window.removeEventListener("pointercancel", resizeUpHandlerRef.current);
  }, []);

  useEffect(() => {
    moveHandlerRef.current = (event: PointerEvent) => {
      const drag = dragRef.current;
      const bounds = boundsRef.current;
      const panel = panelRef.current;
      if (!drag || event.pointerId !== drag.pointerId || !bounds || !panel) return;

      const boundsRect = bounds.getBoundingClientRect();
      const { width: panelW, height: panelH } = panel.getBoundingClientRect();
      const rawX = event.clientX - boundsRect.left - drag.offsetX;
      const rawY = event.clientY - boundsRect.top - drag.offsetY;
      const next = clampPosition(rawX, rawY, panelW, panelH, boundsRect.width, boundsRect.height);
      onPositionChange(next);
    };

    upHandlerRef.current = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      dragRef.current = null;
      clearWindowListeners();
    };
  }, [boundsRef, clearWindowListeners, onPositionChange]);

  useEffect(() => () => clearWindowListeners(), [clearWindowListeners]);

  useEffect(() => {
    resizeMoveHandlerRef.current = (event: PointerEvent) => {
      const resize = resizeRef.current;
      const bounds = boundsRef.current;
      if (!resize || event.pointerId !== resize.pointerId || !bounds) return;
      const boundsH = bounds.getBoundingClientRect().height;
      const deltaY = event.clientY - resize.startY;
      const next = clampPanelHeight(resize.startHeight + deltaY, position.y, boundsH);
      onExpandedHeightChange(next);
    };

    resizeUpHandlerRef.current = (event: PointerEvent) => {
      const resize = resizeRef.current;
      if (!resize || event.pointerId !== resize.pointerId) return;
      resizeRef.current = null;
      clearResizeListeners();
    };
  }, [boundsRef, clearResizeListeners, onExpandedHeightChange, position.y]);

  useEffect(() => () => clearResizeListeners(), [clearResizeListeners]);

  const onResizePointerDown = useCallback(
    (event: ReactPointerEvent) => {
      const bounds = boundsRef.current;
      if (!bounds) return;
      event.preventDefault();
      event.stopPropagation();
      resizeRef.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startHeight: expandedHeight,
      };
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // ignore
      }
      window.addEventListener("pointermove", resizeMoveHandlerRef.current);
      window.addEventListener("pointerup", resizeUpHandlerRef.current);
      window.addEventListener("pointercancel", resizeUpHandlerRef.current);
    },
    [boundsRef, expandedHeight]
  );

  const onDragPointerDown = useCallback(
    (event: ReactPointerEvent) => {
      const bounds = boundsRef.current;
      if (!bounds) return;
      event.preventDefault();
      const boundsRect = bounds.getBoundingClientRect();
      dragRef.current = {
        pointerId: event.pointerId,
        offsetX: event.clientX - boundsRect.left - position.x,
        offsetY: event.clientY - boundsRect.top - position.y,
      };
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // ignore
      }
      window.addEventListener("pointermove", moveHandlerRef.current);
      window.addEventListener("pointerup", upHandlerRef.current);
      window.addEventListener("pointercancel", upHandlerRef.current);
    },
    [boundsRef, position.x, position.y]
  );

  useLayoutEffect(() => {
    clampToBounds();
    if (open) clampHeightToCanvas();
  }, [open, clampToBounds, clampHeightToCanvas]);

  return (
    <section
      ref={panelRef}
      className={`pf-context-panel ${className} ${open ? "pf-context-panel--open" : "pf-context-panel--minimized"}`}
      style={open ? { left: position.x, top: position.y, height: expandedHeight } : { left: position.x, top: position.y }}
      aria-label={ariaLabel}
    >
      {open ? (
        <>
          <div className="pf-context-card__head pf-context-card__head--drag">
            <span className="pf-context-card__head-title pf-context-card__head-grip" onPointerDown={onDragPointerDown}>
              {minimizedLabel}
            </span>
            <button type="button" className="pf-context-card__head-toggle" onClick={onToggleOpen} aria-label={`Minimize ${ariaLabel}`}>
              −
            </button>
          </div>
          <div className="pf-context-panel__body">{children}</div>
          <button
            type="button"
            className="pf-context-panel__resize"
            aria-label={`Resize ${ariaLabel} height`}
            onPointerDown={onResizePointerDown}
          />
        </>
      ) : (
        <div className="pf-context-tag" onPointerDown={onDragPointerDown} role="group" aria-label={ariaLabel}>
          <span className="pf-context-tag__label">{minimizedLabel}</span>
          <button
            type="button"
            className="pf-context-tag__expand"
            aria-label={`Expand ${ariaLabel}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onToggleOpen();
            }}
          >
            +
          </button>
        </div>
      )}
    </section>
  );
}

export function CanvasContextPanels({
  boundsRef,
  open,
  onToggleOpen,
  globalFeatures,
  localFeatures,
  activeContext,
  onSelectContext,
  onOpenFeatureMenu,
  emptyGlobal,
  emptyLocal,
  localTitle,
}: {
  boundsRef: RefObject<HTMLElement | null>;
  open: { global: boolean; local: boolean };
  onToggleOpen: (panel: PanelId) => void;
  globalFeatures: FeatureItem[];
  localFeatures: FeatureItem[];
  activeContext: { kind: "global" | "local"; id: string } | { kind: "node"; id: string; clusterId: ClusterId; label: string } | null;
  onSelectContext: (ctx: { kind: "global" | "local"; id: string }) => void;
  onOpenFeatureMenu: (event: MouseEvent<HTMLButtonElement>, ctx: { kind: "global" | "local"; id: string; label: string }) => void;
  emptyGlobal: string;
  emptyLocal: string;
  localTitle: ReactNode;
}) {
  const [positions, setPositions] = useState(DEFAULT_POSITIONS);
  const [heights, setHeights] = useState(DEFAULT_PANEL_HEIGHTS);

  const setPanelPosition = useCallback((panel: PanelId, next: { x: number; y: number }) => {
    setPositions((prev) => ({ ...prev, [panel]: next }));
  }, []);

  const setPanelHeight = useCallback((panel: PanelId, next: number) => {
    setHeights((prev) => ({ ...prev, [panel]: next }));
  }, []);

  return (
    <div className="pf-canvas-context-layer" onMouseDown={(event) => event.stopPropagation()}>
      <DraggableContextPanel
        open={open.global}
        onToggleOpen={() => onToggleOpen("global")}
        position={positions.global}
        onPositionChange={(next) => setPanelPosition("global", next)}
        expandedHeight={heights.global}
        onExpandedHeightChange={(next) => setPanelHeight("global", next)}
        boundsRef={boundsRef}
        minimizedLabel={<span>Global</span>}
        ariaLabel="Global features"
        className="pf-context-card pf-context-card--global"
      >
        <div className="pf-context-card__list">
          {globalFeatures.length === 0 ? (
            <div className="pf-context-card__empty">{emptyGlobal}</div>
          ) : (
            globalFeatures.map((item) => (
              <div
                key={item.id}
                className={`pf-context-chip ${activeContext?.kind === "global" && activeContext.id === item.id ? "pf-context-chip--active" : ""}`}
              >
                <button type="button" className="pf-context-chip__label" onClick={() => onSelectContext({ kind: "global", id: item.id })}>
                  {item.label}
                </button>
                <button
                  type="button"
                  className="pf-context-chip__menu"
                  aria-label={`Edit ${item.label}`}
                  onClick={(event) => onOpenFeatureMenu(event, { kind: "global", id: item.id, label: item.label })}
                >
                  ⋯
                </button>
              </div>
            ))
          )}
        </div>
      </DraggableContextPanel>

      <DraggableContextPanel
        open={open.local}
        onToggleOpen={() => onToggleOpen("local")}
        position={positions.local}
        onPositionChange={(next) => setPanelPosition("local", next)}
        expandedHeight={heights.local}
        onExpandedHeightChange={(next) => setPanelHeight("local", next)}
        boundsRef={boundsRef}
        minimizedLabel={localTitle}
        ariaLabel="Local features"
        className="pf-context-card pf-context-card--local"
      >
        <div className="pf-context-card__list">
          {localFeatures.length === 0 ? (
            <div className="pf-context-card__empty">{emptyLocal}</div>
          ) : (
            localFeatures.map((item) => (
              <div
                key={item.id}
                className={`pf-context-chip pf-context-chip--local ${activeContext?.kind === "local" && activeContext.id === item.id ? "pf-context-chip--active" : ""}`}
              >
                <button type="button" className="pf-context-chip__label" onClick={() => onSelectContext({ kind: "local", id: item.id })}>
                  {item.label}
                </button>
                <button
                  type="button"
                  className="pf-context-chip__menu"
                  aria-label={`Edit ${item.label}`}
                  onClick={(event) => onOpenFeatureMenu(event, { kind: "local", id: item.id, label: item.label })}
                >
                  ⋯
                </button>
              </div>
            ))
          )}
        </div>
      </DraggableContextPanel>
    </div>
  );
}