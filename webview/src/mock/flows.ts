import type { Edge, Node } from "@xyflow/react";
import type { ClusterFrameData, ClusterId, DecisionNodePayload, DecisionOption, FileGraphPayload } from "../types";

const src = (label: string, kind: DecisionNodePayload["sources"][0]["kind"]): DecisionNodePayload["sources"][0] => ({
  id: `s-${label}`,
  label,
  kind,
});

export const decisionTreeNodes: Node<DecisionNodePayload>[] = [
  {
    id: "dt-root",
    type: "decision",
    position: { x: 220, y: 24 },
    data: {
      title: "Calendar…",
      summary: "Define how events reconcile across daylight-saving transitions.",
      clusterId: "core",
      planSourceTabId: "cal-java",
      sources: [
        src("Prompt #12 — timezone scope", "prompt"),
        src("docs/product/calendar.md", "file"),
        src("Assumption: single org calendar", "assumption"),
      ],
      options: [
        {
          id: "opt-yes",
          label: "Yes",
          confidence: 95,
          summary: "Normalize to UTC at storage; render with user locale.",
        },
        {
          id: "opt-no",
          label: "No",
          confidence: 5,
          summary: "Store local wall time only (higher DST risk).",
        },
      ],
      confirmed: false,
    },
  },
  {
    id: "dt-no",
    type: "branch",
    position: { x: 40, y: 220 },
    data: {
      title: "NO · 5%",
      summary: "Defer normalization; revisit after MVP.",
      clusterId: "core",
      planSourceTabId: "cal-java",
      sources: [src("Risk register — DST", "feature")],
    },
  },
  {
    id: "dt-yes",
    type: "branch",
    position: { x: 420, y: 200 },
    data: {
      title: "YES · 95%",
      summary: "Adopt UTC storage + explicit IANA zone on each row.",
      clusterId: "core",
      planSourceTabId: "cal-java",
      sources: [src("Prompt #13 — storage model", "prompt"), src("Calendar.java", "file")],
      optionsAsSeparateBranches: true,
      options: [
        { id: "y2", label: "Yes", confidence: 68, summary: "Add `zone_id` column + migration." },
        { id: "y2n", label: "No", confidence: 12, summary: "Embed offset minutes only." },
        { id: "y2o", label: "Alt", confidence: 15, summary: "Hybrid: zone + cached offset." },
        { id: "y2s", label: "Spike", confidence: 5, summary: "Time-box spike first." },
      ],
    },
  },
  {
    id: "dt-yes-yes",
    type: "branch",
    position: { x: 260, y: 315 },
    data: {
      title: "YES · 68%",
      summary: "Add `zone_id` column + migration.",
      clusterId: "core",
      planSourceTabId: "cal-java",
      sources: [src("Migration draft", "file")],
    },
  },
  {
    id: "dt-yes-no",
    type: "branch",
    position: { x: 390, y: 315 },
    data: {
      title: "NO · 12%",
      summary: "Embed offset minutes only.",
      clusterId: "core",
      planSourceTabId: "cal-java",
      sources: [src("Offset-only fallback", "assumption")],
    },
  },
  {
    id: "dt-yes-alt",
    type: "branch",
    position: { x: 520, y: 315 },
    data: {
      title: "ALT · 15%",
      summary: "Hybrid: zone + cached offset.",
      clusterId: "core",
      planSourceTabId: "cal-java",
      sources: [src("Hybrid memo", "file")],
    },
  },
  {
    id: "dt-yes-spike",
    type: "branch",
    position: { x: 650, y: 315 },
    data: {
      title: "SPIKE · 5%",
      summary: "Time-box spike first.",
      clusterId: "core",
      planSourceTabId: "cal-java",
      sources: [src("Spike plan", "prompt")],
    },
  },
  {
    id: "dt-alg",
    type: "decision",
    position: { x: 450, y: 470 },
    data: {
      title: "alg",
      summary: "Conflict resolution when overlapping events share attendees.",
      clusterId: "core",
      planSourceTabId: "cal-java",
      sources: [src("Prompt #14 — overlap policy", "prompt")],
      confirmed: true,
    },
  },
];

export const decisionTreeEdges: Edge[] = [
  { id: "e-r-n", source: "dt-root", target: "dt-no", type: "smoothstep", animated: false },
  { id: "e-r-y", source: "dt-root", target: "dt-yes", type: "smoothstep", animated: false },
  { id: "e-y-y", source: "dt-yes", target: "dt-yes-yes", type: "smoothstep", animated: false },
  { id: "e-y-n", source: "dt-yes", target: "dt-yes-no", type: "smoothstep", animated: false },
  { id: "e-y-a", source: "dt-yes", target: "dt-yes-alt", type: "smoothstep", animated: false },
  { id: "e-y-s", source: "dt-yes", target: "dt-yes-spike", type: "smoothstep", animated: false },
  { id: "e-yy-alg", source: "dt-yes-yes", target: "dt-alg", type: "smoothstep", animated: false },
  { id: "e-yn-alg", source: "dt-yes-no", target: "dt-alg", type: "smoothstep", animated: false },
  { id: "e-ya-alg", source: "dt-yes-alt", target: "dt-alg", type: "smoothstep", animated: false },
  { id: "e-ys-alg", source: "dt-yes-spike", target: "dt-alg", type: "smoothstep", animated: false },
];

/** Canonical root decision id per cluster mock — undo is never offered on these. */
export const PLAN_CLUSTER_TREE_ROOT_IDS = new Set<string>(["dt-root", "st-root", "it-root"]);

/** Security.py decision tree (same shape family as Core calendar tree). */
export const securityTreeNodes: Node<DecisionNodePayload>[] = [
  {
    id: "st-root",
    type: "decision",
    position: { x: 200, y: 20 },
    data: {
      title: "Security.py",
      summary: "Least-privilege OAuth scopes and token handling for calendar sync.",
      clusterId: "security",
      planSourceTabId: "sec-py",
      sources: [src("Prompt #4 — OAuth", "prompt")],
      options: [
        { id: "st-y", label: "Yes", confidence: 78, summary: "Narrow scopes; rotate refresh tokens." },
        { id: "st-n", label: "No", confidence: 22, summary: "Broad calendar access for speed." },
      ],
    },
  },
  {
    id: "st-narrow",
    type: "branch",
    position: { x: 28, y: 200 },
    data: {
      title: "NARROW · 78%",
      summary: "Per-resource grants; short-lived access tokens.",
      clusterId: "security",
      planSourceTabId: "sec-py",
      sources: [src("Policy — least privilege", "feature")],
    },
  },
  {
    id: "st-broad",
    type: "branch",
    position: { x: 400, y: 180 },
    data: {
      title: "BROAD · 22%",
      summary: "Org-wide calendar.read; fewer round-trips.",
      clusterId: "security",
      planSourceTabId: "sec-py",
      sources: [src("Tradeoff memo", "file")],
      optionsAsSeparateBranches: true,
      options: [
        { id: "stb1", label: "Risk", confidence: 45, summary: "Larger blast radius." },
        { id: "stb2", label: "OK", confidence: 55, summary: "Internal-only deployment." },
      ],
    },
  },
  {
    id: "st-broad-risk",
    type: "branch",
    position: { x: 268, y: 300 },
    data: {
      title: "RISK · 45%",
      summary: "Larger blast radius from wide calendar scope.",
      clusterId: "security",
      planSourceTabId: "sec-py",
      sources: [src("Threat model note", "assumption")],
    },
  },
  {
    id: "st-broad-ok",
    type: "branch",
    position: { x: 532, y: 300 },
    data: {
      title: "OK · 55%",
      summary: "Internal-only deployment constrains blast radius.",
      clusterId: "security",
      planSourceTabId: "sec-py",
      sources: [src("Internal deployment checklist", "file")],
    },
  },
  {
    id: "st-audit",
    type: "decision",
    position: { x: 400, y: 430 },
    data: {
      title: "audit",
      summary: "Log scope grants and token refresh for compliance review.",
      clusterId: "security",
      planSourceTabId: "sec-py",
      sources: [src("Prompt #4b — audit", "prompt")],
      confirmed: true,
    },
  },
];

export const securityTreeEdges: Edge[] = [
  { id: "st-e1", source: "st-root", target: "st-narrow", type: "smoothstep", animated: false },
  { id: "st-e2", source: "st-root", target: "st-broad", type: "smoothstep", animated: false },
  { id: "st-e3r", source: "st-broad", target: "st-broad-risk", type: "smoothstep", animated: false },
  { id: "st-e3k", source: "st-broad", target: "st-broad-ok", type: "smoothstep", animated: false },
  { id: "st-e4r", source: "st-broad-risk", target: "st-audit", type: "smoothstep", animated: false },
  { id: "st-e4k", source: "st-broad-ok", target: "st-audit", type: "smoothstep", animated: false },
];

/** application.yml / infra decision tree. */
export const infraTreeNodes: Node<DecisionNodePayload>[] = [
  {
    id: "it-root",
    type: "decision",
    position: { x: 200, y: 20 },
    data: {
      title: "application.yml",
      summary: "Sync cadence, retries, and rate limits for outbound calendar calls.",
      clusterId: "infra",
      planSourceTabId: "yaml",
      sources: [src("Prompt #6 — ops", "prompt"), src("deploy/calendar-sync.yml", "file")],
      options: [
        { id: "it-y", label: "Yes", confidence: 64, summary: "Exponential backoff + circuit breaker." },
        { id: "it-n", label: "No", confidence: 36, summary: "Fixed polling interval." },
      ],
    },
  },
  {
    id: "it-expo",
    type: "branch",
    position: { x: 32, y: 200 },
    data: {
      title: "EXPO · 64%",
      summary: "Decorrelated jitter; cap at 8s (see ApiClient).",
      clusterId: "infra",
      planSourceTabId: "yaml",
      sources: [src("ApiClient.kt", "file")],
    },
  },
    {
    id: "it-fixed",
    type: "branch",
    position: { x: 400, y: 200 },
    data: {
      title: "FIXED · 36%",
      summary: "30s poll; simpler ops, higher idle load.",
      clusterId: "infra",
      planSourceTabId: "yaml",
      sources: [src("deploy/calendar-sync.yml", "file")],
      optionsAsSeparateBranches: true,
      options: [
        { id: "itf-burst", label: "Burst cap", confidence: 55, summary: "Sharper per-minute ceiling for traffic spikes." },
        { id: "itf-sust", label: "Sustained", confidence: 45, summary: "Reserve headroom for steady average load." },
      ],
    },
  },
  {
    id: "it-fixed-burst",
    type: "branch",
    position: { x: 330, y: 305 },
    data: {
      title: "BURST · 55%",
      summary: "Sharper per-minute ceiling for traffic spikes.",
      clusterId: "infra",
      planSourceTabId: "yaml",
      sources: [src("Traffic envelope", "feature")],
    },
  },
  {
    id: "it-fixed-sustained",
    type: "branch",
    position: { x: 535, y: 305 },
    data: {
      title: "SUSTAINED · 45%",
      summary: "Reserve headroom for steady average load.",
      clusterId: "infra",
      planSourceTabId: "yaml",
      sources: [src("Capacity planning", "assumption")],
    },
  },
  {
    id: "it-obs",
    type: "decision",
    position: { x: 285, y: 470 },
    data: {
      title: "observability",
      summary: "Structured logs + metrics on retry budget exhaustion.",
      clusterId: "infra",
      planSourceTabId: "yaml",
      confirmed: false,
      sources: [src("Runbook — sync", "feature")],
    },
  },
];

export const infraTreeEdges: Edge[] = [
  { id: "it-e1", source: "it-root", target: "it-expo", type: "smoothstep", animated: false },
  { id: "it-e2", source: "it-root", target: "it-fixed", type: "smoothstep", animated: false },
  { id: "it-e3b", source: "it-fixed", target: "it-fixed-burst", type: "smoothstep", animated: false },
  { id: "it-e3s", source: "it-fixed", target: "it-fixed-sustained", type: "smoothstep", animated: false },
  { id: "it-e4e", source: "it-expo", target: "it-obs", type: "smoothstep", animated: false },
  { id: "it-e4b", source: "it-fixed-burst", target: "it-obs", type: "smoothstep", animated: false },
  { id: "it-e4s", source: "it-fixed-sustained", target: "it-obs", type: "smoothstep", animated: false },
];

export type PlanTreeKind = "core" | "security" | "infra";

const CLUSTER_FRAME_LABEL: Record<PlanTreeKind, string> = {
  core: "Core",
  security: "Security",
  infra: "Infra",
};

const CLUSTER_ID_MAP: Record<PlanTreeKind, ClusterId> = {
  core: "core",
  security: "security",
  infra: "infra",
};

/** Map explorer program-tab id → which mock tree to show in Plan → Tree. */
export function planTreeKindFromProgramTabId(tabId: string): PlanTreeKind {
  if (tabId === "sec-py") return "security";
  if (tabId === "yaml") return "infra";
  return "core";
}

/** Infer tree slice from mock node id prefix (dt- / st- / it-). */
export function kindFromNodeId(nodeId: string): PlanTreeKind | null {
  if (nodeId.startsWith("dt-")) return "core";
  if (nodeId.startsWith("st-")) return "security";
  if (nodeId.startsWith("it-")) return "infra";
  return null;
}

/** `cluster-overview-${kind}` frame id → plan tree kind. */
export function planKindFromClusterFrameId(frameId: string): PlanTreeKind | null {
  if (frameId === "cluster-overview-core") return "core";
  if (frameId === "cluster-overview-security") return "security";
  if (frameId === "cluster-overview-infra") return "infra";
  return null;
}

/**
 * React Flow’s fitView only includes measured nodes; frames may be unmeasured — use decision/branch ids.
 */
export function nodesArgForClusterFit(kind: PlanTreeKind, flowNodes: Node[]): { id: string }[] {
  const prefix = kind === "core" ? "dt-" : kind === "security" ? "st-" : "it-";
  const out: { id: string }[] = [];
  for (const n of flowNodes) {
    if ((n.type === "decision" || n.type === "branch") && n.id.startsWith(prefix)) {
      out.push({ id: n.id });
    }
  }
  return out;
}

function treeNodesAndEdges(kind: PlanTreeKind): { nodes: Node<DecisionNodePayload>[]; edges: Edge[] } {
  switch (kind) {
    case "core":
      return { nodes: decisionTreeNodes, edges: decisionTreeEdges };
    case "security":
      return { nodes: securityTreeNodes, edges: securityTreeEdges };
    case "infra":
      return { nodes: infraTreeNodes, edges: infraTreeEdges };
    default:
      return { nodes: decisionTreeNodes, edges: decisionTreeEdges };
  }
}

/** Plan tree nodes that surface option/confidence rows — same ordering as Program editor `decision:` markers. */
export function decisionHudSlotsForProgramTab(programTabId: string): Array<{
  nodeId: string;
  clusterId: ClusterId;
  title: string;
  options: DecisionOption[];
}> {
  const kind = planTreeKindFromProgramTabId(programTabId);
  const { nodes } = treeNodesAndEdges(kind);
  const out: Array<{
    nodeId: string;
    clusterId: ClusterId;
    title: string;
    options: DecisionOption[];
  }> = [];
  for (const n of nodes) {
    const d = n.data;
    const opts = d.options;
    if (Array.isArray(opts) && opts.length > 0) {
      out.push({ nodeId: n.id, clusterId: d.clusterId, title: d.title, options: opts });
    }
  }
  return out;
}

const TREE_CLUSTER_PAD = 64;
const CLUSTER_OVERVIEW_GAP = 80;

function estimateTreeNodeSize(type: string | undefined, hasOptions: boolean, miniOptions: boolean): { w: number; h: number } {
  if (type === "branch") {
    return miniOptions ? { w: 240, h: 220 } : { w: 220, h: 160 };
  }
  if (type === "decision") {
    if (hasOptions) return { w: 320, h: 300 };
    return { w: 320, h: 200 };
  }
  return { w: 300, h: 200 };
}

function coreTreeBoundingRect(content: Node<DecisionNodePayload>[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of content) {
    const d = n.data;
    const hasOptions = !!(d.options && d.options.length);
    const mini = hasOptions && d.options && d.options.length > 2;
    const { w, h } = estimateTreeNodeSize(n.type, hasOptions, mini);
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + w);
    maxY = Math.max(maxY, n.position.y + h);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Expand node spacing without changing the logical structure.
 * Keeps the root anchored and pushes siblings/descendants farther apart.
 */
function stretchTreeLayout(
  nodes: Node<DecisionNodePayload>[],
  scaleX: number,
  scaleY: number
): Node<DecisionNodePayload>[] {
  if (nodes.length === 0) return nodes;
  const root = nodes[0];
  const ox = root.position.x;
  const oy = root.position.y;
  return nodes.map(
    (n) =>
      ({
        ...n,
        position: {
          x: ox + (n.position.x - ox) * scaleX,
          y: oy + (n.position.y - oy) * scaleY,
        },
      }) as Node<DecisionNodePayload>
  );
}

/**
 * Plan → Tree: one cluster mat + the decision tree for the selected explorer file (`planExplorerTabId`).
 */
export function planTreePackForExplorerTab(programTabId: string): { nodes: Node[]; edges: Edge[] } {
  const kind = planTreeKindFromProgramTabId(programTabId);
  const { nodes: rawContent, edges } = treeNodesAndEdges(kind);
  const content = stretchTreeLayout(rawContent, 1.14, 1.18);
  const { minX, minY, maxX, maxY } = coreTreeBoundingRect(content);
  const p = TREE_CLUSTER_PAD;
  const frame: Node<ClusterFrameData> = {
    id: `plan-tree-frame-${kind}`,
    type: "clusterFrame",
    position: { x: minX - p, y: minY - p },
    style: { width: maxX - minX + p * 2, height: maxY - minY + p * 2 },
    data: { label: CLUSTER_FRAME_LABEL[kind], clusterId: CLUSTER_ID_MAP[kind] },
    draggable: false,
    selectable: false,
    zIndex: 0,
  };
  return {
    nodes: [frame, ...content.map((n) => ({ ...n, zIndex: 1 }))],
    edges,
  };
}

const OVERVIEW_ORDER: PlanTreeKind[] = ["security", "core", "infra"];

/**
 * Plan → Cluster: three decision trees (same mock content as Tree), Security | Core | Infra columns.
 */
export function clusterOverviewPack(): { nodes: Node[]; edges: Edge[] } {
  const allNodes: Node<ClusterFrameData | DecisionNodePayload>[] = [];
  const allEdges: Edge[] = [];
  let xCursor = 40;

  for (const kind of OVERVIEW_ORDER) {
    const { nodes: baseRaw, edges } = treeNodesAndEdges(kind);
    const raw = stretchTreeLayout(baseRaw, 1.18, 1.24);
    const r0 = coreTreeBoundingRect(raw);
    const dx = xCursor - r0.minX;
    const dy = -r0.minY;
    const shifted = raw.map(
      (n) =>
        ({
          ...n,
          position: { x: n.position.x + dx, y: n.position.y + dy },
          zIndex: 1,
          draggable: true,
        }) as Node<DecisionNodePayload>
    );
    const r1 = coreTreeBoundingRect(shifted);
    const pad = TREE_CLUSTER_PAD;
    const frame: Node<ClusterFrameData> = {
      id: `cluster-overview-${kind}`,
      type: "clusterFrame",
      position: { x: r1.minX - pad, y: r1.minY - pad },
      style: { width: r1.maxX - r1.minX + 2 * pad, height: r1.maxY - r1.minY + 2 * pad },
      data: {
        label: CLUSTER_FRAME_LABEL[kind],
        clusterId: CLUSTER_ID_MAP[kind],
        clusterMat: true,
      },
      draggable: true,
      selectable: false,
      zIndex: 0,
    };
    allNodes.push(frame, ...shifted);
    allEdges.push(...edges);
    xCursor = r1.maxX + pad + CLUSTER_OVERVIEW_GAP;
  }

  return { nodes: allNodes as Node[], edges: allEdges };
}

/**
 * Keeps each `cluster-overview-*` mat hugging its decision/branch nodes after drags.
 */
export function layoutClusterFramesForOverview(nodes: Node[]): Node[] {
  const contentByKind: Record<PlanTreeKind, Node<DecisionNodePayload>[]> = {
    core: [],
    security: [],
    infra: [],
  };
  for (const n of nodes) {
    if (n.type !== "decision" && n.type !== "branch") continue;
    const k = kindFromNodeId(n.id);
    if (k) contentByKind[k].push(n as Node<DecisionNodePayload>);
  }

  const pad = TREE_CLUSTER_PAD;
  const frameLayout = new Map<string, { x: number; y: number; width: number; height: number }>();

  for (const kind of OVERVIEW_ORDER) {
    const content = contentByKind[kind];
    if (content.length === 0) continue;
    const r = coreTreeBoundingRect(content);
    frameLayout.set(`cluster-overview-${kind}`, {
      x: r.minX - pad,
      y: r.minY - pad,
      width: r.maxX - r.minX + 2 * pad,
      height: r.maxY - r.minY + 2 * pad,
    });
  }

  return nodes.map((n) => {
    if (n.type !== "clusterFrame") return n;
    const layout = frameLayout.get(n.id);
    if (!layout) return n;
    const prevStyle = (n.style ?? {}) as Record<string, unknown>;
    return {
      ...n,
      position: { x: layout.x, y: layout.y },
      style: {
        ...prevStyle,
        width: layout.width,
        height: layout.height,
      },
    };
  });
}

/** Positions are seeds; Plan runs d3-force when opening Node graph */
export const fileGraphNodes: Node<FileGraphPayload>[] = [
  {
    id: "fg-main",
    type: "file",
    position: { x: 0, y: 0 },
    data: {
      path: "Main.java",
      clusterShare: { security: 0.25, core: 0.55, infra: 0.2 },
      graphEmphasis: "none",
    },
  },
  {
    id: "fg-cal",
    type: "file",
    position: { x: 0, y: 0 },
    data: {
      path: "Calendar.java",
      clusterShare: { security: 0.15, core: 0.75, infra: 0.1 },
      graphEmphasis: "none",
    },
  },
  {
    id: "fg-sec",
    type: "file",
    position: { x: 0, y: 0 },
    data: {
      path: "Security.py",
      clusterShare: { security: 0.78, core: 0.12, infra: 0.1 },
      graphEmphasis: "none",
    },
  },
  {
    id: "fg-api",
    type: "file",
    position: { x: 0, y: 0 },
    data: {
      path: "ApiClient.kt",
      clusterShare: { security: 0.35, core: 0.35, infra: 0.3 },
      graphEmphasis: "none",
    },
  },
  {
    id: "fg-config",
    type: "file",
    position: { x: 0, y: 0 },
    data: {
      path: "application.yml",
      clusterShare: { security: 0.2, core: 0.25, infra: 0.55 },
      graphEmphasis: "none",
    },
  },
  {
    id: "fg-auth",
    type: "file",
    position: { x: 0, y: 0 },
    data: {
      path: "AuthFilter.java",
      clusterShare: { security: 0.62, core: 0.28, infra: 0.1 },
      graphEmphasis: "none",
    },
  },
];

export const fileGraphEdges: Edge[] = [
  { id: "fe1", source: "fg-main", target: "fg-cal" },
  { id: "fe2", source: "fg-main", target: "fg-sec" },
  { id: "fe3", source: "fg-cal", target: "fg-api" },
  { id: "fe4", source: "fg-sec", target: "fg-api" },
  { id: "fe5", source: "fg-main", target: "fg-config" },
  { id: "fe6", source: "fg-api", target: "fg-auth" },
];
