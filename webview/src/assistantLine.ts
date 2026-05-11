import { canonicalProgramTabId, PROGRAM_EDITOR_TABS } from "./programTabs";

/** Footer assistant line: file-specific and scripted for the Promptful mock. */
export function assistantLineForProgramTab(tabId: string): string {
  const canonicalId = canonicalProgramTabId(tabId);
  const t = PROGRAM_EDITOR_TABS.find((x) => x.id === canonicalId);
  const name = t?.label ?? "Workspace";
  const hints: Record<string, string> = {
    "split-ts": "which cost-splitting rule should be the default for Terminus?",
    "auth-ts": "account access should stay separate from budgeting decisions.",
    "groups-ts": "group membership drives who can share and settle expenses.",
    "budgeting-ts": "check whether every local feature here really belongs to budgeting.",
    "security-ts": "security should focus on access, audit, privacy, and data protection.",
  };
  return `${name} - ${hints[canonicalId] ?? "what should we refine next?"}`;
}
