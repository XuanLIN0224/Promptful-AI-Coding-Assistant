import { BaseEdge, getStraightPath, useReactFlow, type EdgeProps } from "@xyflow/react";

/**
 * Straight edge between node centers. Default straight edges use handle positions derived from
 * DOM rects and viewport zoom; in the VS Code webview those can drift from the node's rendered
 * position. With `origin: [0.5, 0.5]`, each node's `position` is the layout center — match that.
 */
export function FileGraphCenterEdge(props: EdgeProps) {
  const { id, source, target, sourceX, sourceY, targetX, targetY, ...rest } = props;
  const { getNode } = useReactFlow();
  const s = getNode(source);
  const t = getNode(target);

  const sx = s?.position.x ?? sourceX;
  const sy = s?.position.y ?? sourceY;
  const tx = t?.position.x ?? targetX;
  const ty = t?.position.y ?? targetY;

  const [path, labelX, labelY] = getStraightPath({
    sourceX: sx,
    sourceY: sy,
    targetX: tx,
    targetY: ty,
  });

  return <BaseEdge {...rest} id={id} path={path} labelX={labelX} labelY={labelY} />;
}
