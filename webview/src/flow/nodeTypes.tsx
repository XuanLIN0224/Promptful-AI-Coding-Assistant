import { useMemo, useState, type CSSProperties } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ClusterFrameData, ClusterId, DecisionNodePayload, FileGraphPayload } from "../types";
import { CLUSTERS } from "../types";
import { SourceIcon } from "../components/SourceIcon";

function clusterColor(id: DecisionNodePayload["clusterId"]): string {
  return CLUSTERS.find((c) => c.id === id)?.color ?? "var(--text-secondary)";
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function TreeUndoButton({ onUndo }: { onUndo?: () => void }) {
  return (
    <button
      type="button"
      className="pf-tree-undo nodrag"
      aria-label="Step back one level along this branch"
      title="Step back one level"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onUndo?.();
      }}
    >
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M9 14 4 9l5-5" />
        <path d="M4 9h10.5A5.5 5.5 0 0 1 20 14.5V16" />
      </svg>
    </button>
  );
}

function TreeExpandButton({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle?: () => void;
}) {
  return (
    <button
      type="button"
      className="pf-tree-expand nodrag"
      aria-label={expanded ? "Collapse children" : "Expand children"}
      title={expanded ? "Collapse children" : "Expand children"}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onToggle?.();
      }}
    >
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {expanded ? <path d="m6 9 6 6 6-6" /> : <path d="m9 6 6 6-6 6" />}
      </svg>
    </button>
  );
}

function TreeGenerateButton({
  generated,
  onGenerate,
}: {
  generated?: boolean;
  onGenerate?: (target: "global" | "local") => void;
}) {
  return (
    <div className="pf-tree-generate-wrap nodrag">
      <button
        type="button"
        className={`pf-tree-generate ${generated ? "pf-tree-generate--done" : ""}`}
        aria-label="Add generated feature"
        title="Add generated feature"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <span aria-hidden>+</span>
      </button>
      <div className="pf-tree-generate-menu" role="menu" aria-label="Generate feature destination">
        <button
          type="button"
          role="menuitem"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onGenerate?.("local");
          }}
        >
          add to local features
        </button>
        <button
          type="button"
          role="menuitem"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onGenerate?.("global");
          }}
        >
          add to global features
        </button>
      </div>
    </div>
  );
}

function TreeEditButton({ onEdit }: { onEdit: () => void }) {
  return (
    <button
      type="button"
      className="pf-tree-edit nodrag"
      aria-label="Edit decision node"
      title="Edit node text"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onEdit();
      }}
    >
      <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    </button>
  );
}

export function DecisionNode({ id, data, selected }: NodeProps<DecisionNodePayload>) {
  const accent = clusterColor(data.clusterId);
  const committed = data.treeCommitted;
  const hoverPath = data.treeHoverPath;
  const pathHover = data.treePathHover;
  const cMeta = CLUSTERS.find((x) => x.id === data.clusterId);
  const hex = cMeta?.hex ?? "#888888";
  const ringStyle = useMemo((): CSSProperties => {
    if (committed) {
      return {
        borderColor: hex,
        boxShadow: `0 0 0 2px ${hex}55, var(--shadow-md)`,
        transition: "border-color 0.14s ease, box-shadow 0.14s ease",
      };
    }
    if (!committed && pathHover) {
      return {
        borderColor: hex,
        boxShadow: `0 0 0 2px ${hex}66, 0 6px 24px ${hex}33`,
        transition: "border-color 0.14s ease, box-shadow 0.14s ease",
      };
    }
    if (!committed && hoverPath) {
      return {
        borderColor: hex,
        boxShadow: `0 0 0 1px ${hex}66, var(--shadow-md)`,
        transition: "border-color 0.14s ease, box-shadow 0.14s ease",
      };
    }
    return { borderColor: accent };
  }, [accent, committed, hex, hoverPath, pathHover]);
  return (
    <div
      className={`pf-node pf-node--decision ${selected ? "pf-node--selected" : ""}`}
      style={ringStyle}
    >
      <Handle type="target" position={Position.Top} className="pf-handle" />
      <div className="pf-node__head">
        <span className="pf-node__title">{data.title}</span>
        <div className="pf-node__tools nodrag">
          <TreeGenerateButton generated={data.featuresGenerated} onGenerate={(target) => data.onGenerateFeatures?.(id, target)} />
          {data.onEditNode ? <TreeEditButton onEdit={() => data.onEditNode?.(id)} /> : null}
          {data.treeCanToggleChildren ? (
            <TreeExpandButton expanded={data.treeChildrenExpanded !== false} onToggle={() => data.onTreeToggleChildren?.(id)} />
          ) : null}
          {data.treeShowUndo ? <TreeUndoButton onUndo={() => data.onTreeUndo?.(id)} /> : null}
          <SourceIcon sources={data.sources} />
        </div>
      </div>
      <p className="pf-node__summary">{data.summary}</p>
      {data.confirmed && <span className="pf-node__badge">Confirmed</span>}
      <Handle type="source" position={Position.Bottom} className="pf-handle" />
    </div>
  );
}

export function BranchNode({ id, data, selected }: NodeProps<DecisionNodePayload>) {
  const accent = clusterColor(data.clusterId);
  const committed = data.treeCommitted;
  const hoverPath = data.treeHoverPath;
  const pathHover = data.treePathHover;
  const cMeta = CLUSTERS.find((x) => x.id === data.clusterId);
  const hex = cMeta?.hex ?? "#888888";
  const ringStyle = useMemo((): CSSProperties => {
    if (committed) {
      return {
        borderColor: hex,
        boxShadow: `0 0 0 2px ${hex}55, var(--shadow-md)`,
        transition: "border-color 0.14s ease, box-shadow 0.14s ease",
      };
    }
    if (!committed && pathHover) {
      return {
        borderColor: hex,
        boxShadow: `0 0 0 2px ${hex}66, 0 6px 24px ${hex}33`,
        transition: "border-color 0.14s ease, box-shadow 0.14s ease",
      };
    }
    if (!committed && hoverPath) {
      return {
        borderColor: hex,
        boxShadow: `0 0 0 1px ${hex}66, var(--shadow-md)`,
        transition: "border-color 0.14s ease, box-shadow 0.14s ease",
      };
    }
    return { borderColor: accent };
  }, [accent, committed, hex, hoverPath, pathHover]);
  const pillBorder =
    committed || hoverPath || pathHover ? hex : accent;
  return (
    <div className={`pf-node pf-node--branch ${selected ? "pf-node--selected" : ""}`} style={ringStyle}>
      <Handle type="target" position={Position.Top} className="pf-handle" />
      <div className="pf-node__head pf-node__head--compact">
        <span className="pf-node__pill" style={{ borderColor: pillBorder }}>
          {data.title}
        </span>
        <div className="pf-node__tools nodrag">
          <TreeGenerateButton generated={data.featuresGenerated} onGenerate={(target) => data.onGenerateFeatures?.(id, target)} />
          {data.onEditNode ? <TreeEditButton onEdit={() => data.onEditNode?.(id)} /> : null}
          {data.treeCanToggleChildren ? (
            <TreeExpandButton expanded={data.treeChildrenExpanded !== false} onToggle={() => data.onTreeToggleChildren?.(id)} />
          ) : null}
          {data.treeShowUndo ? <TreeUndoButton onUndo={() => data.onTreeUndo?.(id)} /> : null}
          <SourceIcon sources={data.sources} />
        </div>
      </div>
      <p className="pf-node__summary pf-node__summary--sm">{data.summary}</p>
      {data.options &&
        data.options.length > 0 &&
        !data.optionsAsSeparateBranches && (
          <div className="pf-node__mini-grid">
            {data.options.map((o) => (
              <div key={o.id} className="pf-mini-opt">
                <span>{o.confidence}%</span>
              </div>
            ))}
          </div>
        )}
      <Handle type="source" position={Position.Bottom} className="pf-handle" />
    </div>
  );
}

export function ClusterFrameNode({ data }: NodeProps<ClusterFrameData>) {
  const c = CLUSTERS.find((x) => x.id === data.clusterId);
  const treeBackdrop = !!(data.treeBackdrop && c);
  const clusterMat = !!(data.clusterMat && c);
  const tint = data.treeTint ?? 0.1;
  const { r, g, b } = hexToRgb(c?.hex ?? "#ffcc00");

  /** Decision tree: same hue as cluster, extremely subtle */
  const treeWash = Math.min(0.048, 0.01 + tint * 0.14);
  const treeWashSoft = Math.min(0.028, treeWash * 0.38);

  /** Cluster tab: readable mats that still don’t clip nodes */
  const matWash = 0.068;
  const matWashSoft = 0.036;

  let frameClass = "pf-cluster-frame";
  const style: CSSProperties & { ["--cluster"]?: string } = {
    ["--cluster"]: c?.color,
  };

  if (treeBackdrop) {
    frameClass += " pf-cluster-frame--tree-backdrop";
    style.background = `linear-gradient(168deg, rgba(${r},${g},${b},${treeWash}), rgba(${r},${g},${b},${treeWashSoft}), rgba(255,255,255,0.992))`;
    style.boxShadow = `inset 0 0 180px rgba(${r},${g},${b},0.022)`;
  } else if (clusterMat) {
    frameClass += " pf-cluster-frame--cluster-mat";
    style.background = `linear-gradient(168deg, rgba(${r},${g},${b},${matWash}), rgba(${r},${g},${b},${matWashSoft}), rgba(255,255,255,0.96))`;
    style.boxShadow = `inset 0 0 130px rgba(${r},${g},${b},0.048)`;
  } else {
    style.boxShadow = `inset 0 0 0 1px rgba(0,0,0,0.06), inset 0 0 50px ${c?.hex}22`;
  }

  return (
    <div className={frameClass} style={style}>
      <div className="pf-cluster-frame__label">{data.label}</div>
    </div>
  );
}

function Pie({ share }: { share: FileGraphPayload["clusterShare"] }) {
  const [hovered, setHovered] = useState<ClusterId | null>(null);
  const total = CLUSTERS.reduce((acc, k) => acc + (share[k.id] ?? 0), 0) || 1;
  let angle = 0;
  const radius = 22;
  const cx = 26;
  const cy = 26;
  const labelPad = 15;
  const labelPos: Partial<Record<ClusterId, { lx: number; ly: number }>> = {};
  const slices = CLUSTERS.map((c) => {
    const frac = (share[c.id] ?? 0) / total;
    const a0 = angle;
    angle += frac * Math.PI * 2;
    const a1 = angle;
    if (frac > 0) {
      const mid = (a0 + a1) / 2;
      labelPos[c.id] = {
        lx: cx + (radius + labelPad) * Math.cos(mid - Math.PI / 2),
        ly: cy + (radius + labelPad) * Math.sin(mid - Math.PI / 2),
      };
    }
    if (frac >= 0.999) {
      return (
        <circle
          key={c.id}
          cx={cx}
          cy={cy}
          r={radius}
          fill={c.hex}
          opacity={0.92}
          className="pf-pie__slice"
          onMouseEnter={() => setHovered(c.id)}
        />
      );
    }
    const x0 = cx + radius * Math.cos(a0 - Math.PI / 2);
    const y0 = cy + radius * Math.sin(a0 - Math.PI / 2);
    const x1 = cx + radius * Math.cos(a1 - Math.PI / 2);
    const y1 = cy + radius * Math.sin(a1 - Math.PI / 2);
    const large = frac > 0.5 ? 1 : 0;
    const d = `M ${cx} ${cy} L ${x0} ${y0} A ${radius} ${radius} 0 ${large} 1 ${x1} ${y1} Z`;
    if (frac <= 0) {
      return null;
    }
    return (
      <path
        key={c.id}
        d={d}
        fill={c.hex}
        opacity={0.92}
        className="pf-pie__slice"
        onMouseEnter={() => setHovered(c.id)}
      />
    );
  });
  const hoverMeta = hovered ? CLUSTERS.find((x) => x.id === hovered) : undefined;
  const hp = hovered ? labelPos[hovered] : undefined;
  return (
    <div className="pf-file-node__pie-host" onMouseLeave={() => setHovered(null)}>
      <svg width={52} height={52} viewBox="0 0 52 52" className="pf-pie">
        {slices}
        <circle cx={cx} cy={cy} r={8} fill="var(--surface)" pointerEvents="none" />
      </svg>
      {hoverMeta && hp && (
        <span
          className="pf-file-node__slice-label"
          style={{
            left: `${(hp.lx / 52) * 100}%`,
            top: `${(hp.ly / 52) * 100}%`,
          }}
        >
          {hoverMeta.label}
        </span>
      )}
    </div>
  );
}

export function FileNode({ data, selected }: NodeProps<FileGraphPayload>) {
  const [hovered, setHovered] = useState(false);
  const em = data.graphEmphasis ?? "none";
  const focus = em === "focus";
  const neighbor = em === "neighbor";
  const dim = em === "dim";
  const showChart = hovered || focus;
  return (
    <div
      className={`pf-file-node pf-file-node--obsidian ${selected ? "pf-file-node--selected" : ""} ${
        focus ? "pf-file-node--hot" : ""
      } ${neighbor ? "pf-file-node--neighbor-ring" : ""} ${dim ? "pf-file-node--dim" : ""}`}
    >
      {/* Core row is the only in-flow block: RF measures this for edge intersection (stable box). */}
      <div
        className="pf-file-node__stack"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div className="pf-file-node__core">
          <Handle type="target" position={Position.Left} className="pf-handle pf-handle--obs" />
          <div className="pf-file-node__glyph">
            {showChart ? (
              <div className="pf-file-node__pie-swap">
                <Pie share={data.clusterShare} />
              </div>
            ) : (
              <span
                className={`pf-file-node__dot ${focus ? "pf-file-node__dot--hot" : ""} ${neighbor ? "pf-file-node__dot--neighbor" : ""}`}
                aria-hidden
              />
            )}
          </div>
          <Handle type="source" position={Position.Right} className="pf-handle pf-handle--obs" />
        </div>
        <span className="pf-file-node__name">{data.path}</span>
      </div>
    </div>
  );
}

export const planNodeTypes = {
  decision: DecisionNode,
  branch: BranchNode,
  clusterFrame: ClusterFrameNode,
  file: FileNode,
};
