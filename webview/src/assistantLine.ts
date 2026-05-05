import { PROGRAM_EDITOR_TABS } from "./programTabs";

/** Footer assistant line: file-specific, not a single hardcoded file name. */
export function assistantLineForProgramTab(tabId: string): string {
  const t = PROGRAM_EDITOR_TABS.find((x) => x.id === tabId);
  const name = t?.label ?? "Workspace";
  const hints: Record<string, string> = {
    "cal-java": "would you like to define variables for normalization?",
    "svc-java": "should overlap detection be strict, or warn-only for soft conflicts?",
    "api-kt": "how should backoff behave on calendar sync failures?",
    "sec-py": "should OAuth scopes stay narrow and refresh tokens rotate?",
    "yaml": "prefer env-based secrets or a KMS envelope for webhooks?",
  };
  return `${name} — ${hints[tabId] ?? "what should we refine next?"}`;
}
