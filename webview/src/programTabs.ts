import type { ClusterId } from "./types";

/** Open-in-Program editor tabs + sample sources (mock only; no generated code is executed). */
export interface ProgramEditorTab {
  id: string;
  label: string;
  path: string;
  code: string;
}

export const PROGRAM_EDITOR_TABS: ProgramEditorTab[] = [
  {
    id: "split-ts",
    label: "SplitCalculator.ts",
    path: "src/domain/splitting/SplitCalculator.ts",
    code: `export type SplitMethod = "equal" | "percentage" | "custom";

export function calculateShares(totalCents: number, participantIds: string[], method: SplitMethod) {
  // decision: choose equal, percentage, or custom cost-splitting rules
  const baseShare = Math.floor(totalCents / Math.max(participantIds.length, 1));

  // decision: handle rounding so the submitted expense still reconciles
  return participantIds.map((participantId, index) => ({
    participantId,
    cents: index === 0 ? baseShare + totalCents % participantIds.length : baseShare,
    method,
  }));
}
`,
  },
  {
    id: "auth-ts",
    label: "AuthService.ts",
    path: "src/account/AuthService.ts",
    code: `export async function signIn(email: string, password: string) {
  // decision: account access owns sign-in and session identity
  const session = await mockSession(email, password);

  // decision: subscription tier gates premium budgeting and group limits
  return { session, entitlements: ["free-plan", "household-group"] };
}

async function mockSession(email: string, password: string) {
  return { userId: "demo-user", email, passwordAccepted: password.length > 0 };
}
`,
  },
  {
    id: "groups-ts",
    label: "GroupService.ts",
    path: "src/groups/GroupService.ts",
    code: `export function createGroup(ownerId: string, name: string) {
  // decision: groups can represent households, dining events, or trips
  return { id: "grp-demo", ownerId, name, members: [ownerId] };
}

export function inviteMember(groupId: string, email: string) {
  // decision: member invites connect group access to later expense splits
  return { groupId, email, status: "pending" };
}
`,
  },
  {
    id: "budgeting-ts",
    label: "BudgetingService.ts",
    path: "src/budgeting/BudgetingService.ts",
    code: `export function createMonthlyBudget(userId: string, month: string, limitCents: number) {
  // decision: monthly budgeting tracks planned spend by user and category
  return { userId, month, limitCents, categories: [] };
}

export function summariseBudget(month: string, expenseTotals: number[]) {
  // decision: budget summaries belong to budgeting, not access control
  return { month, spentCents: expenseTotals.reduce((sum, n) => sum + n, 0) };
}
`,
  },
  {
    id: "security-ts",
    label: "SecurityPolicy.ts",
    path: "src/security/SecurityPolicy.ts",
    code: `export function canViewFinancialRecord(actorId: string, recordOwnerId: string, groupMemberIds: string[]) {
  // decision: financial records require explicit owner or group membership access
  return actorId === recordOwnerId || groupMemberIds.includes(actorId);
}

export function auditFinancialChange(actorId: string, action: string, recordId: string) {
  // decision: security covers audit trails, access control, and data protection
  return { actorId, action, recordId, recordedAt: new Date().toISOString() };
}
`,
  },
];

export function canonicalProgramTabId(inputId: string): string {
  const raw = inputId.replace(/\\/g, "/").toLowerCase();
  if (raw === "auth-ts" || raw.endsWith("/authservice.ts") || raw.endsWith("authservice.ts")) return "auth-ts";
  if (raw === "groups-ts" || raw.endsWith("/groupservice.ts") || raw.endsWith("groupservice.ts")) return "groups-ts";
  if (raw === "budgeting-ts" || raw.endsWith("/budgetingservice.ts") || raw.endsWith("budgetingservice.ts")) return "budgeting-ts";
  if (raw === "security-ts" || raw.endsWith("/securitypolicy.ts") || raw.endsWith("securitypolicy.ts")) return "security-ts";
  if (raw === "split-ts" || raw.endsWith("/splitcalculator.ts") || raw.endsWith("splitcalculator.ts")) return "split-ts";
  return inputId;
}

/** Which context cluster sidebar + prompt chip track for each mock program file (sync with explorer Plan). */
export function clusterForProgramEditorTab(programTabId: string): ClusterId {
  const tabId = canonicalProgramTabId(programTabId);
  if (tabId === "auth-ts") return "account";
  if (tabId === "groups-ts") return "groups";
  if (tabId === "budgeting-ts") return "budgeting";
  if (tabId === "security-ts") return "security";
  return "core";
}
