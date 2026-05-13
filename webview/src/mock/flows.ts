import type { Edge, Node } from "@xyflow/react";
import type { ClusterFrameData, ClusterId, DecisionNodePayload, DecisionOption, FileGraphPayload } from "../types";
import { CLUSTERS } from "../types";

const src = (label: string, kind: DecisionNodePayload["sources"][0]["kind"]): DecisionNodePayload["sources"][0] => ({
  id: `s-${label}`,
  label,
  kind,
});

export type PlanTreeKind = ClusterId;

export const decisionTreeNodes: Node<DecisionNodePayload>[] = [
  {
    id: "co-root",
    type: "decision",
    position: { x: 200, y: 24 },
    data: {
      title: "Core splitting",
      summary: "Define how submitted costs become participant balances.",
      clusterId: "core",
      planSourceTabId: "split-ts",
      sources: [src("Initial Terminus brief", "prompt"), src("Client comparison: Beem and Splitwise", "assumption")],
      options: [
        { id: "co-equal", label: "Equal", confidence: 72, summary: "Default to equal split with later adjustment." },
        { id: "co-custom", label: "Custom", confidence: 28, summary: "Ask for exact shares during entry." },
      ],
    },
  },
  {
    id: "co-equal",
    type: "branch",
    position: { x: 40, y: 210 },
    data: {
      title: "EQUAL - 72%",
      summary: "Split by participant count first, then allow manual edits.",
      clusterId: "core",
      planSourceTabId: "split-ts",
      sources: [src("Feature: cost splitting", "feature")],
    },
  },
  {
    id: "co-custom",
    type: "branch",
    position: { x: 412, y: 200 },
    data: {
      title: "CUSTOM - 28%",
      summary: "Support exact shares, percentage, and paid-by tracking.",
      clusterId: "core",
      planSourceTabId: "split-ts",
      sources: [src("Feature: submit and split costs", "feature")],
      optionsAsSeparateBranches: true,
      options: [
        { id: "co-cents", label: "Exact cents", confidence: 45, summary: "Most precise but more input." },
        { id: "co-percent", label: "Percent", confidence: 35, summary: "Flexible for subscriptions." },
        { id: "co-shares", label: "Shares", confidence: 20, summary: "Simple for dining." },
      ],
    },
  },
  {
    id: "co-cents",
    type: "branch",
    position: { x: 262, y: 320 },
    data: {
      title: "CENTS - 45%",
      summary: "Store exact owed cents per participant.",
      clusterId: "core",
      planSourceTabId: "split-ts",
      sources: [src("SplitCalculator.ts", "file")],
    },
  },
  {
    id: "co-percent",
    type: "branch",
    position: { x: 426, y: 320 },
    data: {
      title: "PERCENT - 35%",
      summary: "Allow percentage allocations on recurring subscriptions.",
      clusterId: "core",
      planSourceTabId: "split-ts",
      sources: [src("Subscription allocation note", "feature")],
    },
  },
  {
    id: "co-settle",
    type: "decision",
    position: { x: 402, y: 490 },
    data: {
      title: "Settlement state",
      summary: "Track whether each participant owes, paid, or is settled.",
      clusterId: "core",
      planSourceTabId: "split-ts",
      sources: [src("Feature: settlement tracking", "feature")],
      confirmed: true,
    },
  },
];

export const decisionTreeEdges: Edge[] = [
  { id: "co-e1", source: "co-root", target: "co-equal", type: "smoothstep", animated: false },
  { id: "co-e2", source: "co-root", target: "co-custom", type: "smoothstep", animated: false },
  { id: "co-e3", source: "co-custom", target: "co-cents", type: "smoothstep", animated: false },
  { id: "co-e4", source: "co-custom", target: "co-percent", type: "smoothstep", animated: false },
  { id: "co-e5", source: "co-equal", target: "co-settle", type: "smoothstep", animated: false },
  { id: "co-e6", source: "co-cents", target: "co-settle", type: "smoothstep", animated: false },
  { id: "co-e7", source: "co-percent", target: "co-settle", type: "smoothstep", animated: false },
];

export const accountTreeNodes: Node<DecisionNodePayload>[] = [
  {
    id: "ua-root",
    type: "decision",
    position: { x: 200, y: 24 },
    data: {
      title: "Account access",
      summary: "Own identity, sessions, profile data, and subscription entitlement checks.",
      clusterId: "account",
      planSourceTabId: "auth-ts",
      sources: [src("Local context refinement", "prompt")],
      options: [
        { id: "ua-basic", label: "Basic auth", confidence: 66, summary: "Email/password with mock sessions." },
        { id: "ua-social", label: "Social login", confidence: 34, summary: "Out of scope for this mock." },
      ],
    },
  },
  {
    id: "ua-signin",
    type: "branch",
    position: { x: 42, y: 210 },
    data: {
      title: "SIGN-IN - 66%",
      summary: "Email/password sign-in and session state belong here.",
      clusterId: "account",
      planSourceTabId: "auth-ts",
      sources: [src("AuthService.ts", "file")],
    },
  },
  {
    id: "ua-subscription",
    type: "branch",
    position: { x: 412, y: 200 },
    data: {
      title: "TIERS - 58%",
      summary: "Subscription type controls limits for budgets, groups, and exports.",
      clusterId: "account",
      planSourceTabId: "auth-ts",
      sources: [src("Feature: multiple subscription types", "feature")],
      optionsAsSeparateBranches: true,
      options: [
        { id: "ua-free", label: "Free", confidence: 45, summary: "Small group and budget limits." },
        { id: "ua-plus", label: "Plus", confidence: 42, summary: "Larger groups and recurring costs." },
        { id: "ua-family", label: "Family", confidence: 13, summary: "Household-oriented billing." },
      ],
    },
  },
  {
    id: "ua-free",
    type: "branch",
    position: { x: 250, y: 320 },
    data: {
      title: "FREE - 45%",
      summary: "Useful for onboarding and baseline usage.",
      clusterId: "account",
      planSourceTabId: "auth-ts",
      sources: [src("Pricing assumption", "assumption")],
    },
  },
  {
    id: "ua-plus",
    type: "branch",
    position: { x: 416, y: 320 },
    data: {
      title: "PLUS - 42%",
      summary: "Unlock recurring costs and more categories.",
      clusterId: "account",
      planSourceTabId: "auth-ts",
      sources: [src("Subscription tier note", "feature")],
    },
  },
  {
    id: "ua-family",
    type: "branch",
    position: { x: 582, y: 320 },
    data: {
      title: "FAMILY - 13%",
      summary: "Household-oriented billing and shared account limits.",
      clusterId: "account",
      planSourceTabId: "auth-ts",
      sources: [src("Family tier assumption", "assumption")],
    },
  },
];

export const accountTreeEdges: Edge[] = [
  { id: "ua-e1", source: "ua-root", target: "ua-signin", type: "smoothstep", animated: false },
  { id: "ua-e2", source: "ua-root", target: "ua-subscription", type: "smoothstep", animated: false },
  { id: "ua-e3", source: "ua-subscription", target: "ua-free", type: "smoothstep", animated: false },
  { id: "ua-e4", source: "ua-subscription", target: "ua-plus", type: "smoothstep", animated: false },
  { id: "ua-e5", source: "ua-subscription", target: "ua-family", type: "smoothstep", animated: false },
];

export const groupsTreeNodes: Node<DecisionNodePayload>[] = [
  {
    id: "gr-root",
    type: "decision",
    position: { x: 200, y: 24 },
    data: {
      title: "Groups",
      summary: "Define households, dining groups, trips, membership, and balances.",
      clusterId: "groups",
      planSourceTabId: "groups-ts",
      sources: [src("Feature: multiple users and groups", "feature")],
      options: [
        { id: "gr-household", label: "Household", confidence: 52, summary: "Long-lived recurring group." },
        { id: "gr-event", label: "Event", confidence: 48, summary: "Short-lived dining or trip group." },
      ],
    },
  },
  {
    id: "gr-household",
    type: "branch",
    position: { x: 34, y: 210 },
    data: {
      title: "HOUSEHOLD - 52%",
      summary: "Recurring rent, utilities, subscriptions, and shared bills.",
      clusterId: "groups",
      planSourceTabId: "groups-ts",
      sources: [src("Household bill example", "feature")],
    },
  },
  {
    id: "gr-event",
    type: "branch",
    position: { x: 405, y: 200 },
    data: {
      title: "EVENT - 48%",
      summary: "Dining, trips, and one-off shared costs.",
      clusterId: "groups",
      planSourceTabId: "groups-ts",
      sources: [src("Dining example", "feature")],
      optionsAsSeparateBranches: true,
      options: [
        { id: "gr-invite", label: "Invite", confidence: 70, summary: "Email or link invitation." },
        { id: "gr-roles", label: "Roles", confidence: 30, summary: "Owner/member permissions." },
      ],
    },
  },
  {
    id: "gr-invite",
    type: "branch",
    position: { x: 330, y: 318 },
    data: {
      title: "INVITE - 70%",
      summary: "Invite members before expenses are split.",
      clusterId: "groups",
      planSourceTabId: "groups-ts",
      sources: [src("GroupService.ts", "file")],
    },
  },
  {
    id: "gr-balances",
    type: "decision",
    position: { x: 285, y: 488 },
    data: {
      title: "Member balances",
      summary: "Show who owes whom across submitted group expenses.",
      clusterId: "groups",
      planSourceTabId: "groups-ts",
      sources: [src("Feature: group balances", "feature")],
      confirmed: true,
    },
  },
];

export const groupsTreeEdges: Edge[] = [
  { id: "gr-e1", source: "gr-root", target: "gr-household", type: "smoothstep", animated: false },
  { id: "gr-e2", source: "gr-root", target: "gr-event", type: "smoothstep", animated: false },
  { id: "gr-e3", source: "gr-event", target: "gr-invite", type: "smoothstep", animated: false },
  { id: "gr-e4", source: "gr-household", target: "gr-balances", type: "smoothstep", animated: false },
  { id: "gr-e5", source: "gr-invite", target: "gr-balances", type: "smoothstep", animated: false },
];

export const budgetingTreeNodes: Node<DecisionNodePayload>[] = [
  {
    id: "bu-root",
    type: "decision",
    position: { x: 200, y: 24 },
    data: {
      title: "Budgeting",
      summary: "Monthly budgets, category limits, alerts, and spending summaries.",
      clusterId: "budgeting",
      planSourceTabId: "budgeting-ts",
      sources: [src("Feature: monthly budgeting", "feature")],
      options: [
        { id: "bu-category", label: "Category", confidence: 64, summary: "Budget by category." },
        { id: "bu-user", label: "User", confidence: 36, summary: "Budget by person." },
      ],
    },
  },
  {
    id: "bu-categories",
    type: "branch",
    position: { x: 32, y: 210 },
    data: {
      title: "CATEGORIES - 64%",
      summary: "Food, rent, utilities, subscriptions, and shared one-offs.",
      clusterId: "budgeting",
      planSourceTabId: "budgeting-ts",
      sources: [src("BudgetingService.ts", "file")],
    },
  },
  {
    id: "bu-auth-drift",
    type: "branch",
    position: { x: 412, y: 200 },
    data: {
      title: "SIGN-IN - 41%",
      summary: "Email/password access appears here because it touches personal budget settings.",
      clusterId: "budgeting",
      planSourceTabId: "budgeting-ts",
      sources: [src("Assistant allocation", "assumption")],
      optionsAsSeparateBranches: true,
      options: [
        { id: "bu-auth", label: "Keep", confidence: 41, summary: "Budget settings need identity." },
        { id: "bu-move", label: "Move", confidence: 59, summary: "Better handled by Account & Access." },
      ],
    },
  },
  {
    id: "bu-alerts",
    type: "branch",
    position: { x: 270, y: 318 },
    data: {
      title: "ALERTS - 55%",
      summary: "Notify when monthly spend approaches a limit.",
      clusterId: "budgeting",
      planSourceTabId: "budgeting-ts",
      sources: [src("Feature: budget alerts", "feature")],
    },
  },
  {
    id: "bu-summary",
    type: "branch",
    position: { x: 520, y: 318 },
    data: {
      title: "SUMMARY - 45%",
      summary: "Monthly summary of spend by category and group.",
      clusterId: "budgeting",
      planSourceTabId: "budgeting-ts",
      sources: [src("Feature: monthly report", "feature")],
    },
  },
];

export const budgetingTreeEdges: Edge[] = [
  { id: "bu-e1", source: "bu-root", target: "bu-categories", type: "smoothstep", animated: false },
  { id: "bu-e2", source: "bu-root", target: "bu-auth-drift", type: "smoothstep", animated: false },
  { id: "bu-e3", source: "bu-categories", target: "bu-alerts", type: "smoothstep", animated: false },
  { id: "bu-e4", source: "bu-auth-drift", target: "bu-summary", type: "smoothstep", animated: false },
];

export const securityTreeNodes: Node<DecisionNodePayload>[] = [
  {
    id: "se-root",
    type: "decision",
    position: { x: 200, y: 24 },
    data: {
      title: "Security",
      summary: "Financial information needs access control, auditability, and data-protection boundaries.",
      clusterId: "security",
      planSourceTabId: "security-ts",
      sources: [src("Client priority: financial safety", "prompt")],
      options: [
        { id: "se-access", label: "Access", confidence: 80, summary: "Role and membership-based access." },
        { id: "se-audit", label: "Audit", confidence: 20, summary: "Track sensitive changes." },
      ],
    },
  },
  {
    id: "se-access",
    type: "branch",
    position: { x: 35, y: 210 },
    data: {
      title: "ACCESS - 80%",
      summary: "Only owners or group members can view financial records.",
      clusterId: "security",
      planSourceTabId: "security-ts",
      sources: [src("SecurityPolicy.ts", "file")],
    },
  },
  {
    id: "se-audit",
    type: "branch",
    position: { x: 405, y: 200 },
    data: {
      title: "AUDIT - 20%",
      summary: "Record changes to expenses, budgets, and settlements.",
      clusterId: "security",
      planSourceTabId: "security-ts",
      sources: [src("Financial audit note", "feature")],
      optionsAsSeparateBranches: true,
      options: [
        { id: "se-budget-summary", label: "Budget summary", confidence: 46, summary: "Monthly budget summary suggested here." },
        { id: "se-invite-ui", label: "Invite UI", confidence: 31, summary: "Group invite UI suggested here." },
        { id: "se-encrypt", label: "Encrypt", confidence: 23, summary: "Protect financial records at rest." },
      ],
    },
  },
  {
    id: "se-budget-summary",
    type: "branch",
    position: { x: 246, y: 318 },
    data: {
      title: "BUDGET SUMMARY - 46%",
      summary: "A product reporting feature appears in Security.",
      clusterId: "security",
      planSourceTabId: "security-ts",
      sources: [src("Assistant suggestion", "assumption")],
    },
  },
  {
    id: "se-invite-ui",
    type: "branch",
    position: { x: 438, y: 318 },
    data: {
      title: "INVITE UI - 31%",
      summary: "A group interface feature appears in Security.",
      clusterId: "security",
      planSourceTabId: "security-ts",
      sources: [src("Assistant suggestion", "assumption")],
    },
  },
  {
    id: "se-encrypt",
    type: "branch",
    position: { x: 610, y: 318 },
    data: {
      title: "ENCRYPT - 23%",
      summary: "Encrypt financial records and sensitive identifiers.",
      clusterId: "security",
      planSourceTabId: "security-ts",
      sources: [src("Security requirement", "feature")],
    },
  },
];

export const securityTreeEdges: Edge[] = [
  { id: "se-e1", source: "se-root", target: "se-access", type: "smoothstep", animated: false },
  { id: "se-e2", source: "se-root", target: "se-audit", type: "smoothstep", animated: false },
  { id: "se-e3", source: "se-audit", target: "se-budget-summary", type: "smoothstep", animated: false },
  { id: "se-e4", source: "se-audit", target: "se-invite-ui", type: "smoothstep", animated: false },
  { id: "se-e5", source: "se-audit", target: "se-encrypt", type: "smoothstep", animated: false },
];

export const complianceTreeNodes: Node<DecisionNodePayload>[] = [
  {
    id: "cm-root",
    type: "decision",
    position: { x: 200, y: 24 },
    data: {
      title: "Compliance",
      summary: "Mock AI-generated cluster for retention, consent, and export-readiness decisions.",
      clusterId: "compliance",
      planSourceTabId: "security-ts",
      sources: [src("Generated cluster prompt", "prompt")],
      options: [
        { id: "cm-retention", label: "Retention", confidence: 61, summary: "Define how long financial records are kept." },
        { id: "cm-export", label: "Export", confidence: 39, summary: "Prepare user-visible exports and deletion traces." },
      ],
    },
  },
  {
    id: "cm-retention",
    type: "branch",
    position: { x: 40, y: 210 },
    data: {
      title: "RETENTION - 61%",
      summary: "Keep audit records long enough for disputes without over-retaining private data.",
      clusterId: "compliance",
      planSourceTabId: "security-ts",
      sources: [src("AI-generated compliance feature", "feature")],
    },
  },
  {
    id: "cm-export",
    type: "branch",
    position: { x: 412, y: 200 },
    data: {
      title: "EXPORT - 39%",
      summary: "Let users inspect, export, and understand stored financial information.",
      clusterId: "compliance",
      planSourceTabId: "security-ts",
      sources: [src("Data portability assumption", "assumption")],
    },
  },
  {
    id: "cm-consent",
    type: "decision",
    position: { x: 250, y: 372 },
    data: {
      title: "Consent checks",
      summary: "Confirm consent before exposing shared financial records outside a group.",
      clusterId: "compliance",
      planSourceTabId: "security-ts",
      sources: [src("Generated review checkpoint", "feature")],
      confirmed: true,
    },
  },
];

export const complianceTreeEdges: Edge[] = [
  { id: "cm-e1", source: "cm-root", target: "cm-retention", type: "smoothstep", animated: false },
  { id: "cm-e2", source: "cm-root", target: "cm-export", type: "smoothstep", animated: false },
  { id: "cm-e3", source: "cm-retention", target: "cm-consent", type: "smoothstep", animated: false },
  { id: "cm-e4", source: "cm-export", target: "cm-consent", type: "smoothstep", animated: false },
];

export const PLAN_CLUSTER_TREE_ROOT_IDS = new Set<string>([
  "co-root",
  "ua-root",
  "gr-root",
  "bu-root",
  "se-root",
  "cm-root",
  "compliance2-root",
  "compliance3-root",
  "compliance4-root",
  "compliance5-root",
  "compliance6-root",
  "compliance7-root",
  "compliance8-root",
  "compliance9-root",
  "compliance10-root",
  "compliance11-root",
  "compliance12-root",
]);

function prefixForKind(kind: PlanTreeKind): string {
  if (kind === "core") return "co-";
  if (kind === "account") return "ua-";
  if (kind === "groups") return "gr-";
  if (kind === "budgeting") return "bu-";
  if (kind === "security") return "se-";
  if (kind === "compliance") return "cm-";
  return `${kind}-`;
}

function labelForKind(kind: PlanTreeKind): string {
  return CLUSTERS.find((cluster) => cluster.id === kind)?.label ?? "Generated cluster";
}

export function planTreeKindFromProgramTabId(tabId: string): PlanTreeKind {
  const raw = tabId.replace(/\\/g, "/").toLowerCase();
  if (raw === "auth-ts" || raw.endsWith("/authservice.ts") || raw.endsWith("authservice.ts")) return "account";
  if (raw === "groups-ts" || raw.endsWith("/groupservice.ts") || raw.endsWith("groupservice.ts")) return "groups";
  if (raw === "budgeting-ts" || raw.endsWith("/budgetingservice.ts") || raw.endsWith("budgetingservice.ts")) return "budgeting";
  if (raw === "security-ts" || raw.endsWith("/securitypolicy.ts") || raw.endsWith("securitypolicy.ts")) return "security";
  return "core";
}

export function kindFromNodeId(nodeId: string): PlanTreeKind | null {
  if (nodeId.startsWith("co-")) return "core";
  if (nodeId.startsWith("ua-")) return "account";
  if (nodeId.startsWith("gr-")) return "groups";
  if (nodeId.startsWith("bu-")) return "budgeting";
  if (nodeId.startsWith("se-")) return "security";
  if (nodeId.startsWith("cm-")) return "compliance";
  const generated = nodeId.match(/^(compliance(?:[2-9]|1[0-2]))-/);
  if (generated) return generated[1] as PlanTreeKind;
  return null;
}

export function planKindFromClusterFrameId(frameId: string): PlanTreeKind | null {
  if (frameId === "cluster-overview-core") return "core";
  if (frameId === "cluster-overview-account") return "account";
  if (frameId === "cluster-overview-groups") return "groups";
  if (frameId === "cluster-overview-budgeting") return "budgeting";
  if (frameId === "cluster-overview-security") return "security";
  if (frameId === "cluster-overview-compliance") return "compliance";
  const generated = frameId.match(/^cluster-overview-(compliance(?:[2-9]|1[0-2]))$/);
  if (generated) return generated[1] as PlanTreeKind;
  return null;
}

export function nodesArgForClusterFit(kind: PlanTreeKind, flowNodes: Node[]): { id: string }[] {
  const prefix = prefixForKind(kind);
  const out: { id: string }[] = [];
  for (const n of flowNodes) {
    if ((n.type === "decision" || n.type === "branch") && n.id.startsWith(prefix)) {
      out.push({ id: n.id });
    }
  }
  return out;
}

function generatedComplianceTree(kind: PlanTreeKind): { nodes: Node<DecisionNodePayload>[]; edges: Edge[] } {
  const prefix = prefixForKind(kind);
  const label = labelForKind(kind);
  return {
    nodes: [
      {
        id: `${prefix}root`,
        type: "decision",
        position: { x: 200, y: 24 },
        data: {
          title: label,
          summary: "Mock AI-generated cluster for reviewing retention, consent, and export-readiness decisions.",
          clusterId: kind,
          planSourceTabId: "security-ts",
          sources: [src("Generated cluster prompt", "prompt")],
          options: [
            { id: `${prefix}retention`, label: "Retention", confidence: 61, summary: "Define how long financial records are kept." },
            { id: `${prefix}export`, label: "Export", confidence: 39, summary: "Prepare user-visible exports and deletion traces." },
          ],
        },
      },
      {
        id: `${prefix}retention`,
        type: "branch",
        position: { x: 40, y: 210 },
        data: {
          title: "RETENTION - 61%",
          summary: "Keep audit records long enough for disputes without over-retaining private data.",
          clusterId: kind,
          planSourceTabId: "security-ts",
          sources: [src("AI-generated compliance feature", "feature")],
        },
      },
      {
        id: `${prefix}export`,
        type: "branch",
        position: { x: 412, y: 200 },
        data: {
          title: "EXPORT - 39%",
          summary: "Let users inspect, export, and understand stored financial information.",
          clusterId: kind,
          planSourceTabId: "security-ts",
          sources: [src("Data portability assumption", "assumption")],
        },
      },
      {
        id: `${prefix}consent`,
        type: "decision",
        position: { x: 250, y: 372 },
        data: {
          title: "Consent checks",
          summary: "Confirm consent before exposing shared financial records outside a group.",
          clusterId: kind,
          planSourceTabId: "security-ts",
          sources: [src("Generated review checkpoint", "feature")],
          confirmed: true,
        },
      },
    ],
    edges: [
      { id: `${prefix}e1`, source: `${prefix}root`, target: `${prefix}retention`, type: "smoothstep", animated: false },
      { id: `${prefix}e2`, source: `${prefix}root`, target: `${prefix}export`, type: "smoothstep", animated: false },
      { id: `${prefix}e3`, source: `${prefix}retention`, target: `${prefix}consent`, type: "smoothstep", animated: false },
      { id: `${prefix}e4`, source: `${prefix}export`, target: `${prefix}consent`, type: "smoothstep", animated: false },
    ],
  };
}

function treeNodesAndEdges(kind: PlanTreeKind): { nodes: Node<DecisionNodePayload>[]; edges: Edge[] } {
  switch (kind) {
    case "core":
      return { nodes: decisionTreeNodes, edges: decisionTreeEdges };
    case "account":
      return { nodes: accountTreeNodes, edges: accountTreeEdges };
    case "groups":
      return { nodes: groupsTreeNodes, edges: groupsTreeEdges };
    case "budgeting":
      return { nodes: budgetingTreeNodes, edges: budgetingTreeEdges };
    case "security":
      return { nodes: securityTreeNodes, edges: securityTreeEdges };
    case "compliance":
      return { nodes: complianceTreeNodes, edges: complianceTreeEdges };
    default:
      return generatedComplianceTree(kind);
  }
}

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
    const mini = !!(hasOptions && d.options && d.options.length > 2);
    const { w, h } = estimateTreeNodeSize(n.type, hasOptions, mini);
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + w);
    maxY = Math.max(maxY, n.position.y + h);
  }
  return { minX, minY, maxX, maxY };
}

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
    data: { label: labelForKind(kind), clusterId: kind },
    draggable: false,
    selectable: false,
    zIndex: 0,
  };
  return {
    nodes: [frame, ...content.map((n) => ({ ...n, zIndex: 1 }))],
    edges,
  };
}

const OVERVIEW_ORDER: PlanTreeKind[] = CLUSTERS.map((cluster) => cluster.id);

export function clusterOverviewPack(enabledKinds: readonly PlanTreeKind[] = CLUSTERS.map((cluster) => cluster.id)): { nodes: Node[]; edges: Edge[] } {
  const allNodes: Node<ClusterFrameData | DecisionNodePayload>[] = [];
  const allEdges: Edge[] = [];
  let xCursor = 40;

  for (const kind of OVERVIEW_ORDER.filter((candidate) => enabledKinds.includes(candidate))) {
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
        label: labelForKind(kind),
        clusterId: kind,
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

export function layoutClusterFramesForOverview(nodes: Node[]): Node[] {
  const contentByKind: Record<PlanTreeKind, Node<DecisionNodePayload>[]> = {
    ...Object.fromEntries(CLUSTERS.map((cluster) => [cluster.id, []])),
  } as Record<PlanTreeKind, Node<DecisionNodePayload>[]>;
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

export const fileGraphNodes: Node<FileGraphPayload>[] = [
  {
    id: "fg-shell",
    type: "file",
    position: { x: 0, y: 0 },
    data: {
      path: "TerminusApp.tsx",
      clusterShare: { core: 0.3, account: 0.18, groups: 0.18, budgeting: 0.18, security: 0.16 },
      graphEmphasis: "none",
    },
  },
  {
    id: "fg-split",
    type: "file",
    position: { x: 0, y: 0 },
    data: {
      path: "SplitCalculator.ts",
      clusterShare: { core: 0.82, account: 0.03, groups: 0.08, budgeting: 0.05, security: 0.02 },
      graphEmphasis: "none",
    },
  },
  {
    id: "fg-auth",
    type: "file",
    position: { x: 0, y: 0 },
    data: {
      path: "AuthService.ts",
      clusterShare: { core: 0.05, account: 0.68, groups: 0.02, budgeting: 0.05, security: 0.2 },
      graphEmphasis: "none",
    },
  },
  {
    id: "fg-groups",
    type: "file",
    position: { x: 0, y: 0 },
    data: {
      path: "GroupService.ts",
      clusterShare: { core: 0.1, account: 0.1, groups: 0.72, budgeting: 0.03, security: 0.05 },
      graphEmphasis: "none",
    },
  },
  {
    id: "fg-budget",
    type: "file",
    position: { x: 0, y: 0 },
    data: {
      path: "BudgetingService.ts",
      clusterShare: { core: 0, account: 0, groups: 0, budgeting: 0, security: 1 },
      graphEmphasis: "none",
    },
  },
  {
    id: "fg-security",
    type: "file",
    position: { x: 0, y: 0 },
    data: {
      path: "SecurityPolicy.ts",
      clusterShare: { core: 0.05, account: 0.12, groups: 0.03, budgeting: 0, security: 0.8 },
      graphEmphasis: "none",
    },
  },
  {
    id: "fg-subscriptions",
    type: "file",
    position: { x: 0, y: 0 },
    data: {
      path: "SubscriptionPlans.ts",
      clusterShare: { core: 0.24, account: 0.38, groups: 0.06, budgeting: 0.22, security: 0.1 },
      graphEmphasis: "none",
    },
  },
];

export const fileGraphEdges: Edge[] = [
  { id: "fe1", source: "fg-shell", target: "fg-split" },
  { id: "fe2", source: "fg-shell", target: "fg-auth" },
  { id: "fe3", source: "fg-shell", target: "fg-groups" },
  { id: "fe4", source: "fg-shell", target: "fg-budget" },
  { id: "fe5", source: "fg-shell", target: "fg-security" },
  { id: "fe6", source: "fg-auth", target: "fg-security" },
  { id: "fe7", source: "fg-groups", target: "fg-split" },
  { id: "fe8", source: "fg-budget", target: "fg-subscriptions" },
  { id: "fe9", source: "fg-auth", target: "fg-subscriptions" },
];
