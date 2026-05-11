import type { ClusterId } from "./types";

export interface MimicResult {
  assistantLine: string;
  suggestion: string;
  newLocalLabel?: string;
}

const clusterName: Record<ClusterId, string> = {
  core: "Core",
  account: "User Account & Access",
  groups: "Groups",
  budgeting: "Budgeting",
  security: "Security",
};

export function mimicAi(prompt: string, cluster: ClusterId): MimicResult {
  const p = prompt.trim().toLowerCase();
  const base = `Terminus ${clusterName[cluster]}`;

  if (p.includes("predict") || p.includes("prediction") || p.includes("before") || p.includes("cluster")) {
    return {
      assistantLine: "Before opening the cluster overview, capture your expected mapping for Core, Account, Groups, and Budgeting.",
      suggestion: "Use the prediction as a checkpoint, then compare it against the cluster allocations.",
      newLocalLabel: "Expected cluster mapping",
    };
  }

  if (p.includes("brainstorm") || p.includes("terminus") || p.includes("feature") || p.includes("structure")) {
    return {
      assistantLine: "Terminus structure: split expenses, manage users, form groups, budget monthly, and trace financial decisions into code.",
      suggestion: "Keep project-wide assumptions global, then assign each product feature to the cluster it changes most directly.",
      newLocalLabel: "Cost-splitting workflow",
    };
  }

  if (p.includes("security") || p.includes("financial") || p.includes("privacy")) {
    return {
      assistantLine: "Security should centre on permissions, audit trails, sensitive financial data, and trust boundaries.",
      suggestion: "Check whether any confident suggestions are actually product reporting or group UI rather than security work.",
      newLocalLabel: "Audit financial changes",
    };
  }

  if (p.includes("budget") || p.includes("monthly")) {
    return {
      assistantLine: "Budgeting covers monthly limits, category tracking, alerts, and spending summaries.",
      suggestion: "If account access appears here, treat that as context drift and move it back to User Account & Access.",
      newLocalLabel: "Monthly category limits",
    };
  }

  if (p.includes("group") || p.includes("invite")) {
    return {
      assistantLine: "Groups covers membership, invites, households, dining events, trips, and shared balances.",
      suggestion: "Use group membership as the bridge between expense splitting and access checks.",
      newLocalLabel: "Group member balances",
    };
  }

  return {
    assistantLine: `${base}: scripted refinement for "${prompt.slice(0, 72)}${prompt.length > 72 ? "..." : ""}".`,
    suggestion: "Capture the feature as local context for the focused cluster; keep project-wide constraints global.",
    newLocalLabel: `${clusterName[cluster]} refinement`,
  };
}
