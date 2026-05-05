import type { ClusterId } from "./types";

export interface MimicResult {
  assistantLine: string;
  suggestion: string;
  newLocalLabel?: string;
}

export function mimicAi(prompt: string, cluster: ClusterId): MimicResult {
  const p = prompt.trim().toLowerCase();
  const base =
    cluster === "security"
      ? "Threat model checkpoint"
      : cluster === "infra"
        ? "Operational envelope"
        : "Product semantics";

  if (p.includes("edge") || p.includes("case")) {
    return {
      assistantLine: `${base}: are we accounting for edge cases before locking schema?`,
      suggestion: "Propose explicit invariants for empty-state, DST, and revoked tokens.",
      newLocalLabel: "Edge cases enumerated",
    };
  }
  if (p.includes("payment") || p.includes("pci")) {
    return {
      assistantLine: "Payments posture: tokenization vs. raw card flows?",
      suggestion: "Prefer provider-hosted fields; keep PAN out of application logs.",
      newLocalLabel: "PCI scope minimized",
    };
  }
  if (p.includes("performance") || p.includes("load")) {
    return {
      assistantLine: "Peak load assumptions: sustained vs. burst?",
      suggestion: "Set SLO on p99 latency; define back-pressure at the calendar fan-out.",
      newLocalLabel: "Load envelope drafted",
    };
  }

  return {
    assistantLine: `${base}: refine constraints for “${prompt.slice(0, 72)}${prompt.length > 72 ? "…" : ""}”?`,
    suggestion: "Capture assumptions as features; rank them in local context for this cluster.",
    newLocalLabel: "Clear definitions",
  };
}
