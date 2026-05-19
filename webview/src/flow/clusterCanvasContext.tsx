import { createContext, useContext, type MouseEvent } from "react";
import type { ClusterId } from "../types";

export type ClusterCanvasActions = {
  openClusterMenu: (clusterId: ClusterId, event: MouseEvent<HTMLButtonElement>) => void;
};

export const ClusterCanvasActionsContext = createContext<ClusterCanvasActions | null>(null);

export function useClusterCanvasActions(): ClusterCanvasActions | null {
  return useContext(ClusterCanvasActionsContext);
}
