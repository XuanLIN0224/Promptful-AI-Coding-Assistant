import type { Edge } from "@xyflow/react";

/** target -> source (first incoming edge wins for tree-shaped graphs) */
export function buildParentMap(edges: Edge[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of edges) {
    if (!m.has(e.target)) m.set(e.target, e.source);
  }
  return m;
}

/** Ordered nodes from root down to `leafId`. */
export function pathNodeIdsFromRoot(leafId: string, parentMap: Map<string, string>): string[] {
  const chain: string[] = [];
  let cur: string | undefined = leafId;
  while (cur) {
    chain.push(cur);
    cur = parentMap.get(cur);
  }
  return chain.reverse();
}

/** Edge ids along the path root → leaf. */
export function edgeIdsOnPath(leafId: string, edges: Edge[], parentMap: Map<string, string>): Set<string> {
  const nodes = pathNodeIdsFromRoot(leafId, parentMap);
  const ids = new Set<string>();
  for (let i = 0; i < nodes.length - 1; i++) {
    const s = nodes[i];
    const t = nodes[i + 1];
    const e = edges.find((ed) => ed.source === s && ed.target === t);
    if (e) ids.add(e.id);
  }
  return ids;
}

/** target -> all sources (supports DAG-style merge nodes) */
export function buildIncomingParentsMap(edges: Edge[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const e of edges) {
    const list = m.get(e.target);
    if (list) list.push(e.source);
    else m.set(e.target, [e.source]);
  }
  return m;
}

/** Resolve a parent for `nodeId`, honoring explicit per-node override when valid. */
export function resolvedParentForNode(
  nodeId: string,
  incoming: Map<string, string[]>,
  parentOverride?: Readonly<Record<string, string>>
): string | undefined {
  const parents = incoming.get(nodeId);
  if (!parents || parents.length === 0) return undefined;
  const forced = parentOverride?.[nodeId];
  if (forced && parents.includes(forced)) return forced;
  return parents[0];
}

/** Ordered nodes from root down to `leafId`, with multi-parent resolution. */
export function pathNodeIdsFromRootResolved(
  leafId: string,
  incoming: Map<string, string[]>,
  parentOverride?: Readonly<Record<string, string>>
): string[] {
  const chain: string[] = [];
  let cur: string | undefined = leafId;
  while (cur) {
    chain.push(cur);
    cur = resolvedParentForNode(cur, incoming, parentOverride);
  }
  return chain.reverse();
}

/** Edge ids along resolved path root → leaf. */
export function edgeIdsOnPathResolved(
  leafId: string,
  edges: Edge[],
  incoming: Map<string, string[]>,
  parentOverride?: Readonly<Record<string, string>>
): Set<string> {
  const nodes = pathNodeIdsFromRootResolved(leafId, incoming, parentOverride);
  const ids = new Set<string>();
  for (let i = 0; i < nodes.length - 1; i++) {
    const s = nodes[i];
    const t = nodes[i + 1];
    const e = edges.find((ed) => ed.source === s && ed.target === t);
    if (e) ids.add(e.id);
  }
  return ids;
}
