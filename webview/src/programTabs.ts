import type { ClusterId } from "./types";

/** Open-in-Program editor tabs + sample sources (mock). */
export interface ProgramEditorTab {
  id: string;
  label: string;
  path: string;
  code: string;
}

export const PROGRAM_EDITOR_TABS: ProgramEditorTab[] = [
  {
    id: "cal-java",
    label: "Calendar.java",
    path: "src/main/java/com/acme/calendar/Calendar.java",
    code: `public final class Calendar {
  private final Id id;

  public Calendar(Id id, ZoneRules rules) {
    this.id = id;
    // decision: immutable id vs regenerated key each deploy
    this.rules = rules;
  }

  public ZonedDateTime interpret(Instant utc) {
    return utc.atZone(rules.effectiveZone());
  }
}`,
  },
  {
    id: "svc-java",
    label: "CalendarService.java",
    path: "src/main/java/com/acme/calendar/CalendarService.java",
    code: `public final class CalendarService {
  private final Clock clock;
  private final ZoneResolver zones;

  public EventSeries normalizeSeries(RawSeries raw) {
    // decision: storage normalization — UTC vs wall time
    Instant anchor = raw.startsAt().atZone(zones.user()).toInstant();
    return new EventSeries(anchor, raw.rule());
  }

  public ConflictReport detectOverlap(List<Event> events) {
    // decision: overlap policy — hard reject vs soft warn
    return sweepLine(events, OverlapPolicy.strict());
  }
}`,
  },
  {
    id: "api-kt",
    label: "ApiClient.kt",
    path: "src/main/kotlin/com/acme/client/ApiClient.kt",
    code: `class ApiClient(
  private val http: OkHttpClient,
  private val tokenVault: Vault,
) {
  suspend fun syncCalendar(cursor: Cursor): Batch {
    // decision: backoff — exponential vs decorrelated jitter
    return withRetry(policy = Backoff.decorrelated(maxMs = 8000)) {
      http.calendarDiff(cursor).requireOk()
    }
  }
}`,
  },
  {
    id: "sec-py",
    label: "Security.py",
    path: "python/security/Security.py",
    code: `def refresh_token(flow: OAuthFlow) -> Credentials:
    # decision: rotating refresh tokens vs long-lived offline
    if flow.requires_rotation():
        return rotate_refresh(flow.credentials)
    return flow.credentials.extend(ttl=VAULT_BOUND)

def authorize_scope(actor: Principal, scopes: list[str]) -> bool:
    # decision: coarse calendar.read vs granular per-resource
    return policy.least_common(scopes).issubset(actor.allowed_scopes())
`,
  },
  {
    id: "yaml",
    label: "application.yml",
    path: "src/main/resources/application.yml",
    code: `calendar:
  provider: hybrid
  # decision: webhook secret — env vs KMS envelope
  webhook:
    secretRef: KMS_CAL_WEBHOOK
  limits:
    # decision: burst vs sustained rate cap
    maxFanOutPerMinute: 500
`,
  },
];

export function canonicalProgramTabId(inputId: string): string {
  const raw = inputId.replace(/\\/g, "/").toLowerCase();
  if (raw.endsWith("/security.py") || raw.endsWith("security.py")) return "sec-py";
  if (raw.endsWith("/application.yml") || raw.endsWith("application.yml")) return "yaml";
  if (raw.endsWith("/calendarservice.java") || raw.endsWith("calendarservice.java")) return "svc-java";
  if (raw.endsWith("/calendar.java") || raw.endsWith("calendar.java")) return "cal-java";
  if (raw.endsWith("/apiclient.kt") || raw.endsWith("apiclient.kt")) return "api-kt";
  return inputId;
}

/** Which CONTEXT cluster sidebar + prompt chip track for each mock program file (sync with explorer Plan). */
export function clusterForProgramEditorTab(programTabId: string): ClusterId {
  const tabId = canonicalProgramTabId(programTabId);
  if (tabId === "sec-py") return "security";
  if (tabId === "yaml") return "infra";
  return "core";
}
