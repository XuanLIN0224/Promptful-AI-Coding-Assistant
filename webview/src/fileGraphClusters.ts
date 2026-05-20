import type { Edge, Node } from "@xyflow/react";
import { CLUSTERS, type ClusterId, type FileGraphPayload } from "./types";

/** Cluster with the largest share on this file (pie chart dominant slice). */
export function dominantClusterForFile(share: FileGraphPayload["clusterShare"]): ClusterId | null {
  let best: ClusterId | null = null;
  let bestVal = -1;
  for (const cluster of CLUSTERS) {
    const value = share[cluster.id] ?? 0;
    if (value > bestVal) {
      bestVal = value;
      best = cluster.id;
    }
  }
  return bestVal > 0 ? best : null;
}

/** True when this file has any presence in the cluster (matches pie slice visibility). */
export function fileBelongsToCluster(share: FileGraphPayload["clusterShare"], clusterId: ClusterId): boolean {
  return (share[clusterId] ?? 0) > 0;
}

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}--${b}` : `${b}--${a}`;
}

/** Connect files that share any cluster slice (not only the dominant one). */
export function buildClusterFileGraphEdges(nodes: readonly Node<FileGraphPayload>[]): Edge[] {
  const edges: Edge[] = [];
  const seen = new Set<string>();

  for (const cluster of CLUSTERS) {
    const members = nodes.filter((node) => fileBelongsToCluster(node.data.clusterShare, cluster.id));
    if (members.length < 2) continue;

    const sorted = [...members].sort(
      (a, b) => (b.data.clusterShare[cluster.id] ?? 0) - (a.data.clusterShare[cluster.id] ?? 0)
    );
    const hub = sorted[0].id;
    for (let i = 1; i < sorted.length; i++) {
      const target = sorted[i].id;
      const key = edgeKey(hub, target);
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        id: `cluster-${cluster.id}-${hub}-${target}`,
        source: hub,
        target,
      });
    }
  }
  return edges;
}

export function groupFileNodesByDominantCluster(
  nodes: readonly Node<FileGraphPayload>[]
): Map<ClusterId, Node<FileGraphPayload>[]> {
  const byCluster = new Map<ClusterId, Node<FileGraphPayload>[]>();
  for (const node of nodes) {
    const cluster = dominantClusterForFile(node.data.clusterShare);
    if (!cluster) continue;
    const list = byCluster.get(cluster) ?? [];
    list.push(node);
    byCluster.set(cluster, list);
  }
  return byCluster;
}
