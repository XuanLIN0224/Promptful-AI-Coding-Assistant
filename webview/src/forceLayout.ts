import type { SimulationNodeDatum } from "d3-force";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from "d3-force";
import type { Edge, Node } from "@xyflow/react";
import type { FileGraphPayload } from "./types";

type SimVertex = SimulationNodeDatum & { id: string };

export function computeFileGraphLayout(
  nodes: Node<FileGraphPayload>[],
  edges: Edge[],
  width = 980,
  height = 740
): Map<string, { x: number; y: number }> {
  const count = nodes.length;
  const simNodes: SimVertex[] = nodes.map((node, i) => {
    const t = (i / Math.max(count, 1)) * Math.PI * 2;
    const spread = 28 * Math.sin(i * 2.17 + 0.31);
    return {
      id: node.id,
      x: width / 2 + Math.cos(t) * 220 + spread * Math.cos(t * 1.5),
      y: height / 2 + Math.sin(t) * 220 + spread * Math.sin(t * 1.5),
    };
  });

  const linkEntries = edges.map((e) => ({ source: e.source, target: e.target }));

  const link = forceLink<SimVertex, { source: string; target: string }>(linkEntries)
    .id((d) => d.id)
    .distance(168)
    .strength(0.42);

  const sim = forceSimulation(simNodes)
    .force("link", link)
    .force("charge", forceManyBody().strength(-620))
    .force("center", forceCenter(width / 2, height / 2))
    .force("collide", forceCollide<SimVertex>().radius(72).strength(0.95));

  sim.stop();
  const iterations = Math.min(420, Math.max(96, 48 + count * 14));
  sim.alpha(1);
  for (let i = 0; i < iterations; i++) sim.tick();

  const out = new Map<string, { x: number; y: number }>();
  for (const sn of simNodes) {
    out.set(sn.id, { x: sn.x ?? width / 2, y: sn.y ?? height / 2 });
  }
  return out;
}
