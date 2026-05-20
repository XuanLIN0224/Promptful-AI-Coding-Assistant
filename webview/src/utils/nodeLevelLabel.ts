/** Depth label for decision-tree rows (sidebar, source assignments, etc.). */
export function nodeLevelLabel(depth: number): string {
  if (depth <= 0) return "ROOT";
  return `LV.${depth}`;
}
