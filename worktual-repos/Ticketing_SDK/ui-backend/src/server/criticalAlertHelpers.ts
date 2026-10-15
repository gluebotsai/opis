import type { NotifyKind } from "./notifications";

export type CriticalAlertScenario =
  | "sla_breach"
  | "escalation_to_resolver"
  | "ticket_assigned"
  | "ticket_reopened";

export type CriticalAlertSeverity = "critical" | "warning" | "info";

export type CriticalAlertPrimaryAction = "open_ticket" | "dismiss_only";

type PrefColumn =
  | "notify_ticket_assignments"
  | "notify_ticket_updates"
  | "notify_sla_alerts";

type ScenarioConfig = {
  pref: PrefColumn;
  bellKind: NotifyKind;
  severity: CriticalAlertSeverity;
  primaryAction: CriticalAlertPrimaryAction;
  dedupeWindowMs: number;
};

export const CRITICAL_ALERT_SCENARIOS: Record<
  CriticalAlertScenario,
  ScenarioConfig
> = {
  sla_breach: {
    pref: "notify_sla_alerts",
    bellKind: "sla",
    severity: "critical",
    primaryAction: "open_ticket",
    dedupeWindowMs: 24 * 60 * 60 * 1000,
  },
  escalation_to_resolver: {
    pref: "notify_ticket_assignments",
    bellKind: "assignment",
    severity: "warning",
    primaryAction: "open_ticket",
    dedupeWindowMs: 60 * 60 * 1000,
  },
  ticket_assigned: {
    pref: "notify_ticket_assignments",
    bellKind: "assignment",
    severity: "warning",
    primaryAction: "open_ticket",
    dedupeWindowMs: 60 * 60 * 1000,
  },
  ticket_reopened: {
    pref: "notify_ticket_updates",
    bellKind: "update",
    severity: "warning",
    primaryAction: "open_ticket",
    dedupeWindowMs: 60 * 60 * 1000,
  },
};

export function isTicketReopen(
  prevStatus: string,
  nextStatus: string,
  wasTerminal: boolean
): boolean {
  return wasTerminal && String(nextStatus || "").trim() === "Reopened";
}

export function buildReopenAlertCopy(input: {
  ticketNumber: string;
  subject?: string | null;
  actorName?: string | null;
  prevStatus: string;
}): { title: string; message: string } {
  const num = String(input.ticketNumber || "").trim() || "ticket";
  const subject = String(input.subject || "").trim();
  const subjectBit = subject ? ` ("${subject}")` : "";
  const who = String(input.actorName || "Someone").trim() || "Someone";
  const from = String(input.prevStatus || "").trim() || "closed";
  return {
    title: "Ticket reopened",
    message: `Ticket ${num}${subjectBit} was reopened by ${who}. Status: ${from} → Reopened.`,
  };
}
