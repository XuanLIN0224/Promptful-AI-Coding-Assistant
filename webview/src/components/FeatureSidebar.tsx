import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
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
import type { DecisionOutlineItem } from "../mock/flows";

type ChatMode = "general" | "node" | "move" | "create";
type ChatHistoryItem = {
  id: string;
  mode: ChatMode;
  role: "user" | "assistant";
  text: string;
};

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
  onOpenRenameModal,
  onOpenDeleteConfirm,
  localSurface,
}: {
  item: FeatureItem;
  variant: "global" | "local";
  active: boolean;
  onPick: () => void;
  onOpenRenameModal: () => void;
  onOpenDeleteConfirm: () => void;
  localSurface?: { background: string; borderColor: string; color: string };
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const [featMenuOpen, setFeatMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!featMenuOpen) return;
    const updateAnchor = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuAnchor({
        top: rect.bottom + 8,
        left: rect.right,
      });
    };
    updateAnchor();
    const onDown = (ev: MouseEvent) => {
      const target = ev.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setFeatMenuOpen(false);
    };
    const onLayoutShift = () => updateAnchor();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onLayoutShift);
    window.addEventListener("scroll", onLayoutShift, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onLayoutShift);
      window.removeEventListener("scroll", onLayoutShift, true);
    };
  }, [featMenuOpen]);

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
      className={`pf-feat ${variant === "global" ? "pf-feat--global" : "pf-feat--local"} ${active ? "pf-feat--active" : ""} ${featMenuOpen ? "pf-feat--menu-open" : ""}`}
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
      <div className="pf-feat-more-wrap">
        <button
          ref={triggerRef}
          type="button"
          className="pf-feat__more"
          aria-label={`More actions for ${item.label}`}
          aria-expanded={featMenuOpen}
          aria-haspopup="menu"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setFeatMenuOpen((open) => !open);
          }}
        >
          ···
        </button>
        {featMenuOpen &&
          menuAnchor &&
          createPortal(
            <div
              ref={menuRef}
              className="pf-feat-menu pf-feat-menu--portal"
              role="menu"
              aria-label="Feature actions"
              style={{ top: menuAnchor.top, left: menuAnchor.left, transform: "translateX(-100%)" }}
            >
            <button
              type="button"
              className="pf-feat-menu__item"
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                setFeatMenuOpen(false);
                onOpenRenameModal();
              }}
            >
              Rename
            </button>
            <button
              type="button"
              className="pf-feat-menu__item pf-feat-menu__item--danger"
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                setFeatMenuOpen(false);
                onOpenDeleteConfirm();
              }}
            >
              Delete
            </button>
            </div>,
            document.body
          )}
      </div>
    </div>
  );
}

/** Filter mode: no drag handles (avoids reordering against a partial list). */
function StaticFeatRow({
  item,
  variant,
  active,
  onPick,
  onOpenRenameModal,
  onOpenDeleteConfirm,
  localSurface,
}: {
  item: FeatureItem;
  variant: "global" | "local";
  active: boolean;
  onPick: () => void;
  onOpenRenameModal: () => void;
  onOpenDeleteConfirm: () => void;
  localSurface?: { background: string; borderColor: string; color: string };
}) {
  const [featMenuOpen, setFeatMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!featMenuOpen) return;
    const updateAnchor = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuAnchor({
        top: rect.bottom + 8,
        left: rect.right,
      });
    };
    updateAnchor();
    const onDown = (ev: MouseEvent) => {
      const target = ev.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setFeatMenuOpen(false);
    };
    const onLayoutShift = () => updateAnchor();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onLayoutShift);
    window.addEventListener("scroll", onLayoutShift, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onLayoutShift);
      window.removeEventListener("scroll", onLayoutShift, true);
    };
  }, [featMenuOpen]);

  const style: CSSProperties =
    variant === "local" && localSurface
      ? {
          background: localSurface.background,
          borderColor: localSurface.borderColor,
          color: localSurface.color,
        }
      : {};

  return (
    <div
      style={style}
      className={`pf-feat pf-feat--static ${variant === "global" ? "pf-feat--global" : "pf-feat--local"} ${active ? "pf-feat--active" : ""} ${featMenuOpen ? "pf-feat--menu-open" : ""}`}
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
      <span className="pf-feat__label pf-feat__label--grow">{item.label}</span>
      <div className="pf-feat-more-wrap">
        <button
          ref={triggerRef}
          type="button"
          className="pf-feat__more"
          aria-label={`More actions for ${item.label}`}
          aria-expanded={featMenuOpen}
          aria-haspopup="menu"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setFeatMenuOpen((open) => !open);
          }}
        >
          ···
        </button>
        {featMenuOpen &&
          menuAnchor &&
          createPortal(
            <div
              ref={menuRef}
              className="pf-feat-menu pf-feat-menu--portal"
              role="menu"
              aria-label="Feature actions"
              style={{ top: menuAnchor.top, left: menuAnchor.left, transform: "translateX(-100%)" }}
            >
              <button
                type="button"
                className="pf-feat-menu__item"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  setFeatMenuOpen(false);
                  onOpenRenameModal();
                }}
              >
                Rename
              </button>
              <button
                type="button"
                className="pf-feat-menu__item pf-feat-menu__item--danger"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  setFeatMenuOpen(false);
                  onOpenDeleteConfirm();
                }}
              >
                Delete
              </button>
            </div>,
            document.body
          )}
      </div>
    </div>
  );
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function matchesQuery(queryNorm: string, text: string): boolean {
  if (!queryNorm) return true;
  return norm(text).includes(queryNorm);
}

export function FeatureSidebar({
  clusterId,
  globalItems,
  localByCluster,
  decisionOutline,
  activeNodeId,
  sources,
  programFiles,
  onPickProgramFile,
  onNavigateLocalFeature,
  onNavigateCluster,
  onNavigateDecisionNode,
  onRenameCluster,
  onAddCluster,
  onViewAllLayers,
  showAllLayers,
  searchValue,
  onSearchChange,
  clusters,
  composerPrompt,
  onComposerPromptChange,
  onComposerSubmit,
  chatMode,
  onChatModeChange,
  assistantLine,
  chatHistory,
  onMoveNode,
  onReorderGlobal,
  onReorderLocal,
  activeContext,
  onSelectContext,
  onOpenSource,
  onRemoveSource,
  onAddSource,
  expandNodeTool,
  onExpandNodeToolChange,
  onRenameGlobal,
  onRemoveGlobal,
  onRenameLocal,
  onRemoveLocal,
  collapsed,
  onToggleCollapsed,
}: {
  clusterId: ClusterId;
  globalItems: FeatureItem[];
  localByCluster: Record<ClusterId, FeatureItem[]>;
  decisionOutline?: Partial<Record<ClusterId, DecisionOutlineItem[]>>;
  activeNodeId?: string | null;
  sources: Array<{ id: string; kind: "link" | "document" | "video" | "image"; label: string }>;
  /** Workspace files (Program tab) — searchable from the sidebar. */
  programFiles?: Array<{ id: string; label: string; path: string }>;
  onPickProgramFile?: (fileId: string) => void;
  /** Jump to a local row in another cluster (search). */
  onNavigateLocalFeature?: (cluster: ClusterId, featureId: string) => void;
  /** Analytics cluster navigator: focus + zoom to a cluster. */
  onNavigateCluster?: (cluster: ClusterId) => void;
  /** Open a concrete node in the plan and scope the composer to its chat history. */
  onNavigateDecisionNode?: (cluster: ClusterId, item: DecisionOutlineItem) => void;
  /** Rename the visible label for a cluster. */
  onRenameCluster?: (cluster: ClusterId) => void;
  /** Mock AI: add a generated cluster to the navigator. */
  onAddCluster?: () => void;
  onViewAllLayers?: () => void;
  showAllLayers?: boolean;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  clusters?: typeof CLUSTERS;
  /** Current composer text — included when searching “prompts”. */
  composerPrompt?: string;
  onComposerPromptChange?: (value: string) => void;
  onComposerSubmit?: () => void;
  chatMode?: ChatMode;
  onChatModeChange?: (mode: ChatMode) => void;
  assistantLine?: string;
  chatHistory?: ChatHistoryItem[];
  onMoveNode?: (from: { clusterId: ClusterId; nodeId: string }, to: { clusterId: ClusterId; nodeId: string }) => void;
  onReorderGlobal: (items: FeatureItem[]) => void;
  onReorderLocal: (cluster: ClusterId, items: FeatureItem[]) => void;
  activeContext:
    | { kind: "global" | "local"; id: string }
    | { kind: "node"; id: string; clusterId: ClusterId; label: string }
    | null;
  onSelectContext: (ctx: { kind: "global" | "local"; id: string }) => void;
  onOpenSource: (attachmentId: string) => void;
  onRemoveSource: (attachmentId: string) => void;
  onAddSource: (kind: "link" | "upload") => void;
  expandNodeTool: boolean;
  onExpandNodeToolChange: (value: boolean) => void;
  onRenameGlobal: (featureId: string, label: string) => void;
  onRemoveGlobal: (featureId: string) => void;
  onRenameLocal: (cluster: ClusterId, featureId: string, label: string) => void;
  onRemoveLocal: (cluster: ClusterId, featureId: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const [localSearch, setLocalSearch] = useState("");
  const contextSearch = searchValue ?? localSearch;
  const setContextSearch = onSearchChange ?? setLocalSearch;
  const queryNorm = useMemo(() => norm(contextSearch), [contextSearch]);
  const filterActive = queryNorm.length > 0;

  const localItems = localByCluster[clusterId];
  const analyticsClusters = clusters ?? CLUSTERS;
  const c = analyticsClusters.find((x) => x.id === clusterId);

  const globalFiltered = useMemo(
    () => (filterActive ? globalItems.filter((i) => matchesQuery(queryNorm, i.label)) : globalItems),
    [globalItems, filterActive, queryNorm]
  );

  const localFiltered = useMemo(
    () => (filterActive ? localItems.filter((i) => matchesQuery(queryNorm, i.label)) : localItems),
    [localItems, filterActive, queryNorm]
  );

  const programFilesFiltered = useMemo(() => {
    const list = programFiles ?? [];
    if (!filterActive) return [];
    return list.filter((f) => matchesQuery(queryNorm, f.label) || matchesQuery(queryNorm, f.path));
  }, [programFiles, filterActive, queryNorm]);

  const clustersForAnalytics = useMemo(
    () =>
      filterActive
        ? analyticsClusters.filter((cl) => matchesQuery(queryNorm, cl.label) || matchesQuery(queryNorm, cl.id))
        : showAllLayers
          ? analyticsClusters
          : analyticsClusters.filter((cl) => cl.id === clusterId),
    [analyticsClusters, clusterId, filterActive, queryNorm, showAllLayers]
  );

  const composerMatches = useMemo(
    () => filterActive && (composerPrompt?.trim() ?? "") !== "" && matchesQuery(queryNorm, composerPrompt ?? ""),
    [composerPrompt, filterActive, queryNorm]
  );

  /** Local feature rows matching the query in any cluster (for quick jump while searching). */
  const localSearchHits = useMemo(() => {
    if (!filterActive) return [];
    const out: Array<{ clusterId: ClusterId; clusterLabel: string; clusterHex?: string; item: FeatureItem }> = [];
    for (const cl of analyticsClusters) {
      for (const item of localByCluster[cl.id] ?? []) {
        if (matchesQuery(queryNorm, item.label)) {
          out.push({ clusterId: cl.id, clusterLabel: cl.label, clusterHex: cl.hex, item });
        }
      }
    }
    return out.slice(0, 10);
  }, [analyticsClusters, filterActive, queryNorm, localByCluster]);

  const globalSearchHits = useMemo(() => {
    if (!filterActive) return [];
    return globalItems.filter((item) => matchesQuery(queryNorm, item.label)).slice(0, 8);
  }, [filterActive, globalItems, queryNorm]);

  const [renameTarget, setRenameTarget] = useState<null | { variant: "global" | "local"; id: string; initialLabel: string }>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<null | { variant: "global" | "local"; id: string; label: string }>(null);
  const [openLayerIds, setOpenLayerIds] = useState<Set<ClusterId>>(() => new Set([clusterId]));
  const firstCluster = analyticsClusters[0]?.id ?? clusterId;
  const firstNode = decisionOutline?.[firstCluster]?.[0]?.nodeId ?? "";
  const [moveFromCluster, setMoveFromCluster] = useState<ClusterId>(clusterId);
  const [moveFromNode, setMoveFromNode] = useState(firstNode);
  const [moveToCluster, setMoveToCluster] = useState<ClusterId>(firstCluster);
  const [moveToNode, setMoveToNode] = useState(firstNode);
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [closedLayerNodeIds, setClosedLayerNodeIds] = useState<Set<string>>(() => new Set());
  const chatHistoryRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setOpenLayerIds((prev) => {
      if (prev.has(clusterId)) return prev;
      const next = new Set(prev);
      next.add(clusterId);
      return next;
    });
  }, [clusterId]);

  useEffect(() => {
    setMoveFromCluster((prev) => (analyticsClusters.some((cluster) => cluster.id === prev) ? prev : firstCluster));
    setMoveToCluster((prev) => (analyticsClusters.some((cluster) => cluster.id === prev) ? prev : firstCluster));
  }, [analyticsClusters, firstCluster]);

  useEffect(() => {
    const fromNodes = decisionOutline?.[moveFromCluster] ?? [];
    if (fromNodes.length > 0 && !fromNodes.some((node) => node.nodeId === moveFromNode)) setMoveFromNode(fromNodes[0].nodeId);
    const toNodes = decisionOutline?.[moveToCluster] ?? [];
    if (toNodes.length > 0 && !toNodes.some((node) => node.nodeId === moveToNode)) setMoveToNode(toNodes[0].nodeId);
  }, [decisionOutline, moveFromCluster, moveFromNode, moveToCluster, moveToNode]);

  useEffect(() => {
    setClosedLayerNodeIds((prev) => {
      const next = new Set(prev);
      for (const nodes of Object.values(decisionOutline ?? {})) {
        nodes?.forEach((item, index) => {
          const hasChildren = Boolean(nodes[index + 1] && nodes[index + 1].depth > item.depth);
          if (hasChildren && item.depth > 0 && !next.has(item.nodeId)) next.add(item.nodeId);
        });
      }
      return next;
    });
  }, [decisionOutline]);

  const toggleLayer = (id: ClusterId) => {
    setOpenLayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleLayerNode = (nodeId: string) => {
    setClosedLayerNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  useEffect(() => {
    if (renameTarget) setRenameDraft(renameTarget.initialLabel);
  }, [renameTarget]);

  useEffect(() => {
    const el = chatHistoryRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatHistory?.length]);

  const confirmFeatureRename = () => {
    if (!renameTarget) return;
    const t = renameDraft.trim();
    if (!t) return;
    if (renameTarget.variant === "global") onRenameGlobal(renameTarget.id, t);
    else onRenameLocal(clusterId, renameTarget.id, t);
    setRenameTarget(null);
  };

  const confirmFeatureDelete = () => {
    if (!deleteTarget) return;
    if (deleteTarget.variant === "global") onRemoveGlobal(deleteTarget.id);
    else onRemoveLocal(clusterId, deleteTarget.id);
    setDeleteTarget(null);
  };

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

  const renameModal =
    renameTarget !== null ? (
      <div className="pf-link-modal-backdrop" role="presentation" onMouseDown={() => setRenameTarget(null)}>
        <div
          className="pf-link-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pf-feat-rename-title"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div id="pf-feat-rename-title" className="pf-link-modal__title">
            Rename · {renameTarget.variant === "global" ? "Global" : "Local"}
          </div>
          <div className="pf-link-modal__row">
            <input
              className="pf-link-modal__input"
              aria-label="New label"
              value={renameDraft}
              autoFocus
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  confirmFeatureRename();
                }
              }}
            />
          </div>
          <div className="pf-link-modal__actions">
            <button type="button" className="pf-link-modal__cancel" onClick={() => setRenameTarget(null)}>
              Cancel
            </button>
            <button type="button" className="pf-link-modal__confirm" onClick={confirmFeatureRename} disabled={!renameDraft.trim()}>
              Save
            </button>
          </div>
        </div>
      </div>
    ) : null;

  const deleteModal =
    deleteTarget !== null ? (
      <div className="pf-link-modal-backdrop" role="presentation" onMouseDown={() => setDeleteTarget(null)}>
        <div
          className="pf-link-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pf-feat-delete-title"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div id="pf-feat-delete-title" className="pf-link-modal__title">
            Delete {deleteTarget.variant === "global" ? "global" : "local"} item
          </div>
          <p className="pf-link-modal__body">
            Are you sure you want to delete <strong>{deleteTarget.label}</strong>? This cannot be undone.
          </p>
          <div className="pf-link-modal__actions">
            <button type="button" className="pf-link-modal__cancel" onClick={() => setDeleteTarget(null)}>
              Cancel
            </button>
            <button type="button" className="pf-link-modal__confirm pf-link-modal__confirm--danger" onClick={confirmFeatureDelete}>
              Delete
            </button>
          </div>
        </div>
      </div>
    ) : null;

  if (collapsed) {
    return (
      <>
        {renameModal}
        {deleteModal}
        <aside className="pf-side pf-side--collapsed" aria-label="Context" aria-expanded={false}>
          <button type="button" className="pf-side-rail-hit" onClick={onToggleCollapsed} title="Expand context panel">
            <span className="pf-side-rail-icon" aria-hidden>
              ◀
            </span>
            <span className="pf-side-rail-label">Context</span>
          </button>
        </aside>
      </>
    );
  }

  return (
    <>
      {renameModal}
      {deleteModal}
      <aside className="pf-side" aria-expanded={true}>
      <div className="pf-side-chrome">
        <span className="pf-side-chrome__title">Context</span>
        <button type="button" className="pf-side-chrome__collapse" onClick={onToggleCollapsed} title="Collapse context panel" aria-label="Collapse context panel">
          <span aria-hidden>▶</span>
        </button>
      </div>
      <div className="pf-side-search">
        <input
          id="pf-context-search"
          className="pf-side-search__input"
          type="search"
          placeholder="Search prompts, files, clusters…"
          value={contextSearch}
          onChange={(e) => setContextSearch(e.target.value)}
          autoComplete="off"
          enterKeyHint="search"
          aria-label="Search prompts, files, and clusters"
        />
        {filterActive && programFilesFiltered.length > 0 && (
          <div className="pf-side-search__sub" aria-label="Workspace files">
            <div className="pf-side-search__sub-label">Files</div>
            <div className="pf-side-search__sub-list">
              {programFilesFiltered.slice(0, 8).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`pf-side-search__chip ${onPickProgramFile ? "" : "pf-side-search__chip--disabled"}`}
                  title={f.path}
                  disabled={!onPickProgramFile}
                  onClick={() => onPickProgramFile?.(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {filterActive && globalSearchHits.length > 0 && (
          <div className="pf-side-search__sub" aria-label="Global features">
            <div className="pf-side-search__sub-label">Global</div>
            <div className="pf-side-search__sub-list pf-side-search__sub-list--stack">
              {globalSearchHits.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="pf-side-search__row"
                  onClick={() => {
                    onSelectContext({ kind: "global", id: item.id });
                    setContextSearch("");
                  }}
                >
                  <span className="pf-side-search__row-k">Global</span>
                  <span className="pf-side-search__row-t">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {filterActive && localSearchHits.length > 0 && (
          <div className="pf-side-search__sub" aria-label="Local prompts across clusters">
            <div className="pf-side-search__sub-label">Local</div>
            <div className="pf-side-search__sub-list pf-side-search__sub-list--stack">
              {localSearchHits.map(({ clusterId: cid, clusterLabel, clusterHex, item }) => (
                <button
                  key={`${cid}-${item.id}`}
                  type="button"
                  className="pf-side-search__row"
                  disabled={!onNavigateLocalFeature}
                  onClick={() => {
                    onNavigateLocalFeature?.(cid, item.id);
                    setContextSearch("");
                  }}
                >
                  <span className="pf-side-search__row-k" style={clusterHex ? { color: clusterHex } : undefined}>
                    {clusterLabel}
                  </span>
                  <span className="pf-side-search__row-t">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {filterActive && composerMatches && (
          <div className="pf-side-search__hint" role="status">
            Matches text in the composer
          </div>
        )}
      </div>
      <PanelGroup direction="vertical" className="pf-side-layers" autoSaveId="promptful-right-sidebar-panels-v1">
        <Panel defaultSize={46} minSize={20} className="pf-side-panel-slot">
          <section className="pf-layer-panel pf-layer-panel--clusters" aria-label="Cluster navigator">
          <div className="pf-layer-panel__head">
            <span>Cluster layers</span>
          </div>
          <div className="pf-layer-navigator" aria-label="Cluster navigator">
            {(filterActive ? clustersForAnalytics : analyticsClusters).map((cl) => (
              <button
                key={cl.id}
                type="button"
                className={`pf-layer-nav-dot ${!showAllLayers && cl.id === clusterId ? "pf-layer-nav-dot--active" : ""}`}
                style={{ background: cl.color }}
                title={`Navigate to ${cl.label}`}
                aria-label={`Navigate to ${cl.label}`}
                onClick={() => onNavigateCluster?.(cl.id)}
              />
            ))}
            {onAddCluster && !filterActive ? (
              <button type="button" className="pf-layer-add" title="Create cluster" aria-label="Create cluster" onClick={onAddCluster}>
                +
              </button>
            ) : null}
            {onViewAllLayers ? (
              <button
                type="button"
                className={`pf-layer-viewall ${showAllLayers ? "pf-layer-viewall--active" : ""}`}
                title="View all clusters"
                aria-label="View all clusters"
                onClick={onViewAllLayers}
              >
                ⛶
              </button>
            ) : null}
          </div>
          <div className="pf-layer-stack">
            {clustersForAnalytics.length === 0 ? (
              <div className="pf-side__empty">{filterActive ? "No cluster matches" : "No clusters"}</div>
            ) : (
              clustersForAnalytics.map((cl) => {
                const nodes = (decisionOutline?.[cl.id] ?? []).filter((item) =>
                  filterActive ? matchesQuery(queryNorm, item.title) || matchesQuery(queryNorm, item.summary) || matchesQuery(queryNorm, cl.label) : true
                );
                const nodeRows: Array<{ item: DecisionOutlineItem; hasChildren: boolean; folded: boolean }> = [];
                let hiddenBelowDepth: number | null = null;
                nodes.forEach((item, index) => {
                  if (hiddenBelowDepth !== null && item.depth > hiddenBelowDepth) return;
                  if (hiddenBelowDepth !== null && item.depth <= hiddenBelowDepth) hiddenBelowDepth = null;
                  const hasChildren = Boolean(nodes[index + 1] && nodes[index + 1].depth > item.depth);
                  const folded = hasChildren && closedLayerNodeIds.has(item.nodeId);
                  nodeRows.push({ item, hasChildren, folded });
                  if (folded) hiddenBelowDepth = item.depth;
                });
                const open = openLayerIds.has(cl.id);
                return (
                  <div key={cl.id} className={`pf-layer ${!showAllLayers && cl.id === clusterId ? "pf-layer--active" : ""}`}>
                    <div className="pf-layer__row">
                      <button type="button" className="pf-layer__fold" aria-label={open ? `Collapse ${cl.label}` : `Expand ${cl.label}`} onClick={() => toggleLayer(cl.id)}>
                        {open ? "⌄" : "›"}
                      </button>
                      <button
                        type="button"
                        className="pf-layer__main"
                        onClick={() => {
                          onNavigateCluster?.(cl.id);
                          setOpenLayerIds((prev) => new Set(prev).add(cl.id));
                        }}
                      >
                        <span className="pf-layer__dot" style={{ background: cl.color }} />
                        <span className="pf-layer__label">{cl.label}</span>
                      </button>
                      {onRenameCluster ? (
                        <button type="button" className="pf-layer__edit" title={`Rename ${cl.label}`} aria-label={`Rename ${cl.label}`} onClick={() => onRenameCluster(cl.id)}>
                          ✎
                        </button>
                      ) : null}
                    </div>
                    {open && (
                      <div className="pf-layer__children">
                        {nodes.length === 0 ? (
                          <div className="pf-layer__empty">No matching nodes</div>
                        ) : (
                          nodeRows.map(({ item, hasChildren, folded }) => (
                            <div
                              key={item.nodeId}
                              className={`pf-layer-node ${activeNodeId === item.nodeId ? "pf-layer-node--active" : ""}`}
                              style={{ paddingLeft: 8 + item.depth * 12 }}
                              title={item.summary}
                            >
                              <button
                                type="button"
                                className={`pf-layer-node__fold ${hasChildren ? "" : "pf-layer-node__fold--blank"}`}
                                aria-label={folded ? `Expand ${item.title}` : `Collapse ${item.title}`}
                                disabled={!hasChildren}
                                onClick={() => toggleLayerNode(item.nodeId)}
                              >
                                {hasChildren ? (folded ? "›" : "⌄") : ""}
                              </button>
                              <button
                                type="button"
                                className="pf-layer-node__hit"
                                onClick={() => onNavigateDecisionNode?.(cl.id, item)}
                              >
                                <span className="pf-layer-node__name">{item.title}</span>
                                <span className="pf-layer-node__meta">{item.depth === 0 ? "root" : "node"}</span>
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
          </section>
        </Panel>

        <PanelResizeHandle className="pf-side-resizer" aria-label="Resize cluster and chat panels">
          <span />
        </PanelResizeHandle>

        <Panel defaultSize={54} minSize={24} className="pf-side-panel-slot">
          <section className="pf-layer-panel pf-layer-panel--chat" aria-label="Mock assistant chat">
          <div className="pf-layer-panel__head">Chat</div>
          <div className="pf-chat-card">
            {sources.length > 0 && (
              <div className="pf-chat-sources" aria-label="Sources added to chat">
                {sources.slice(0, 4).map((s) => (
                  <span key={s.id} className="pf-chat-source">
                    <button type="button" onClick={() => onOpenSource(s.id)} title={s.label}>
                      {s.kind}
                    </button>
                    <span>{s.label}</span>
                    <button type="button" aria-label={`Remove ${s.label}`} onClick={() => onRemoveSource(s.id)}>
                      ×
                    </button>
                  </span>
                ))}
                {sources.length > 4 ? <span className="pf-chat-source pf-chat-source--more">+{sources.length - 4}</span> : null}
              </div>
            )}
            {chatMode === "move" && (
              <div className="pf-move-box" aria-label="Move node controls">
                <div className="pf-move-row">
                  <span>From</span>
                  <select value={moveFromCluster} onChange={(event) => setMoveFromCluster(event.target.value as ClusterId)}>
                    {analyticsClusters.map((cluster) => (
                      <option key={cluster.id} value={cluster.id}>{cluster.label}</option>
                    ))}
                  </select>
                  <select value={moveFromNode} onChange={(event) => setMoveFromNode(event.target.value)}>
                    {(decisionOutline?.[moveFromCluster] ?? []).map((node) => (
                      <option key={node.nodeId} value={node.nodeId}>{node.title}</option>
                    ))}
                  </select>
                </div>
                <div className="pf-move-row">
                  <span>To</span>
                  <select value={moveToCluster} onChange={(event) => setMoveToCluster(event.target.value as ClusterId)}>
                    {analyticsClusters.map((cluster) => (
                      <option key={cluster.id} value={cluster.id}>{cluster.label}</option>
                    ))}
                  </select>
                  <select value={moveToNode} onChange={(event) => setMoveToNode(event.target.value)}>
                    {(decisionOutline?.[moveToCluster] ?? []).map((node) => (
                      <option key={node.nodeId} value={node.nodeId}>{node.title}</option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  className="pf-move-apply"
                  onClick={() => onMoveNode?.({ clusterId: moveFromCluster, nodeId: moveFromNode }, { clusterId: moveToCluster, nodeId: moveToNode })}
                  disabled={!moveFromNode || !moveToNode}
                >
                  Stage move
                </button>
              </div>
            )}
            <div className="pf-chat-history" ref={chatHistoryRef} aria-label="Chat history">
              {(chatHistory?.length ? chatHistory : [{ id: "fallback", mode: chatMode ?? "general", role: "assistant" as const, text: assistantLine ?? "Mock assistant ready." }]).map((entry) => (
                <div key={entry.id} className={`pf-chat-line pf-chat-line--${entry.role}`}>
                  <span className="pf-chat-line__meta">{entry.role === "user" ? "You" : entry.mode}</span>
                  <span className="pf-chat-line__text">{entry.text}</span>
                </div>
              ))}
            </div>
            <div className="pf-chat-input">
              <textarea
                value={composerPrompt ?? ""}
                onChange={(event) => onComposerPromptChange?.(event.target.value)}
                placeholder={chatMode === "create" ? "Describe the cluster to create..." : chatMode === "move" ? "Describe why this move is needed..." : "Ask a mock follow-up..."}
                rows={3}
              />
              <div className="pf-chat-input__side">
                <div className="pf-chat-source-menu">
                  <button
                    type="button"
                    className="pf-chat-plus"
                    aria-label="Add source"
                    aria-expanded={sourceMenuOpen}
                    onClick={() => setSourceMenuOpen((open) => !open)}
                  >
                    +
                  </button>
                  {sourceMenuOpen && (
                    <div className="pf-chat-source-menu__pop" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setSourceMenuOpen(false);
                          onAddSource("link");
                        }}
                      >
                        Add link
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setSourceMenuOpen(false);
                          onAddSource("upload");
                        }}
                      >
                        Add file
                      </button>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className={`pf-chat-expand-button ${expandNodeTool ? "pf-chat-expand-button--on" : ""}`}
                  aria-pressed={expandNodeTool}
                  title="Expand node"
                  onClick={() => onExpandNodeToolChange(!expandNodeTool)}
                >
                  Expand node
                </button>
                <button type="button" onClick={onComposerSubmit} disabled={!composerPrompt?.trim()}>
                  Send
                </button>
              </div>
            </div>
          </div>
          </section>
        </Panel>

      </PanelGroup>
    </aside>
    </>
  );
}
