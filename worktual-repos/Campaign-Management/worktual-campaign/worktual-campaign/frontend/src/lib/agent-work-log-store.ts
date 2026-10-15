/**
 * Local log of agent work — CRM-style performance cards on Events tracking.
 */

import { packStorageKey, subscribeActivePack } from "@/lib/industry-packs";

export type AgentWorkAgentId =
  | "recommendations"
  | "create_campaign"
  | "forms"
  | "reports"
  | "monitoring"
  | "contacts"
  | "system";

export type AgentWorkAction =
  | "recommendation_edited"
  | "campaign_planned"
  | "templates_created"
  | "campaign_launched"
  | "form_designed"
  | "event_launched"
  | "event_answered"
  | "monitoring_answered"
  | "contacts_helped"
  | "other";

export type AgentWorkWindow = "1h" | "1d" | "7d";

export type AgentWorkEntry = {
  id: string;
  agentId: AgentWorkAgentId;
  agentLabel: string;
  action: AgentWorkAction;
  summary: string;
  eventId?: string | null;
  eventTitle?: string | null;
  href?: string | null;
  createdAt: string;
  sourceKey?: string;
};

export type AgentWorkGroup = {
  agentId: AgentWorkAgentId;
  agentLabel: string;
  entries: AgentWorkEntry[];
};

export type AgentOutcomeTone = "success" | "muted" | "warn" | "danger" | "info";

export type AgentOutcomeStat = {
  key: string;
  label: string;
  count: number;
  tone: AgentOutcomeTone;
};

export type AgentPerformanceCard = {
  agentId: AgentWorkAgentId;
  label: string;
  description: string;
  href: string;
  runs: number;
  outcomes: AgentOutcomeStat[];
  pending: number;
  running: number;
  recent: AgentWorkEntry[];
};

const STORAGE_KEY_BASE = "worktual.agentWorkLog.v1";

function storageKey() {
  return packStorageKey(STORAGE_KEY_BASE);
}
const MAX_ITEMS = 120;
const RETAIN_MS = 7 * 24 * 60 * 60 * 1000;
const EMPTY: AgentWorkEntry[] = [];

export const AGENT_LABELS: Record<AgentWorkAgentId, string> = {
  recommendations: "Recommendations",
  create_campaign: "Create campaign",
  forms: "Forms design",
  reports: "Events co-worker",
  monitoring: "Campaign monitoring",
  contacts: "Audience / Contacts",
  system: "System",
};

export const AGENT_DESCRIPTIONS: Record<AgentWorkAgentId, string> = {
  recommendations:
    "Proposes and refines campaign ideas from goals, audience, and timing.",
  create_campaign:
    "Plans audience, builds channel templates, and schedules launches.",
  forms:
    "Designs form events with the forms agent and launches them live.",
  reports:
    "Answers questions about launched events, submissions, and performance.",
  monitoring:
    "Explains live campaign metrics, channel health, and send outcomes.",
  contacts: "Helps inspect and refine audience / contact segments.",
  system: "System-level agent maintenance and housekeeping.",
};

export const AGENT_HREFS: Record<AgentWorkAgentId, string> = {
  recommendations: "/campaigns/create/recommendations",
  create_campaign: "/campaigns/create",
  forms: "/events?tab=draft",
  reports: "/events",
  monitoring: "/campaigns",
  contacts: "/campaigns/create",
  system: "/events",
};

/** Cards always shown (CRM-style), even at 0 runs. */
export const PRIMARY_AGENT_IDS: AgentWorkAgentId[] = [
  "recommendations",
  "create_campaign",
  "forms",
  "reports",
  "monitoring",
];

/** Display order on Events tracking (contacts CRUD excluded from this surface). */
const DISPLAY_ORDER: AgentWorkAgentId[] = [
  "recommendations",
  "create_campaign",
  "forms",
  "reports",
  "monitoring",
  "system",
];

/** Outcome keys + tones per action (aggregated into chips). */
const ACTION_OUTCOME: Record<
  AgentWorkAction,
  { key: string; label: string; tone: AgentOutcomeTone }
> = {
  recommendation_edited: {
    key: "edited",
    label: "Edited",
    tone: "success",
  },
  campaign_planned: { key: "planned", label: "Planned", tone: "info" },
  templates_created: {
    key: "templates",
    label: "Templates",
    tone: "success",
  },
  campaign_launched: {
    key: "launched",
    label: "Launched",
    tone: "success",
  },
  form_designed: { key: "designed", label: "Designed", tone: "success" },
  event_launched: { key: "launched", label: "Launched", tone: "success" },
  event_answered: { key: "answered", label: "Answered", tone: "success" },
  monitoring_answered: {
    key: "answered",
    label: "Answered",
    tone: "success",
  },
  contacts_helped: { key: "helped", label: "Helped", tone: "info" },
  other: { key: "other", label: "Other", tone: "muted" },
};

/** Stable empty outcome chips per agent (CRM shows zeros). */
const DEFAULT_OUTCOMES: Record<AgentWorkAgentId, AgentOutcomeStat[]> = {
  recommendations: [
    { key: "edited", label: "Edited", count: 0, tone: "success" },
  ],
  create_campaign: [
    { key: "templates", label: "Templates", count: 0, tone: "success" },
    { key: "launched", label: "Launched", count: 0, tone: "success" },
    { key: "planned", label: "Planned", count: 0, tone: "info" },
  ],
  forms: [
    { key: "designed", label: "Designed", count: 0, tone: "success" },
    { key: "launched", label: "Launched", count: 0, tone: "success" },
  ],
  reports: [
    { key: "answered", label: "Answered", count: 0, tone: "success" },
  ],
  monitoring: [
    { key: "answered", label: "Answered", count: 0, tone: "success" },
  ],
  contacts: [{ key: "helped", label: "Helped", count: 0, tone: "info" }],
  system: [{ key: "other", label: "Other", count: 0, tone: "muted" }],
};

type Listener = () => void;
const listeners = new Set<Listener>();

let cachedList: AgentWorkEntry[] = EMPTY;
let cacheHydrated = false;

function canUseStorage() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function notify() {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

export function subscribeAgentWorkLog(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function parseStored(): AgentWorkEntry[] {
  if (!canUseStorage()) return EMPTY;
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as AgentWorkEntry[];
    if (!Array.isArray(parsed)) return EMPTY;
    return parsed.filter(
      (r) => r && typeof r === "object" && typeof r.id === "string",
    );
  } catch {
    return EMPTY;
  }
}

function writeAll(rows: AgentWorkEntry[]) {
  if (!canUseStorage()) return;
  try {
    localStorage.setItem(storageKey(), JSON.stringify(rows));
  } catch {
    /* quota */
  }
  cachedList = rows;
  cacheHydrated = true;
  notify();
}

function ensureCache(): AgentWorkEntry[] {
  if (!cacheHydrated) {
    cachedList = parseStored();
    cacheHydrated = true;
  }
  return cachedList;
}

function prune(rows: AgentWorkEntry[]): AgentWorkEntry[] {
  const cutoff = Date.now() - RETAIN_MS;
  return rows
    .filter((r) => {
      const t = Date.parse(r.createdAt);
      return Number.isFinite(t) ? t >= cutoff : true;
    })
    .slice(0, MAX_ITEMS);
}

function startOfLocalDay(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isSameLocalDay(iso: string, day: Date): boolean {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  const x = new Date(t);
  return (
    x.getFullYear() === day.getFullYear() &&
    x.getMonth() === day.getMonth() &&
    x.getDate() === day.getDate()
  );
}

export function windowCutoffMs(
  window: AgentWorkWindow,
  now = new Date(),
): number {
  const t = now.getTime();
  if (window === "1h") return t - 60 * 60 * 1000;
  if (window === "7d") return t - 7 * 24 * 60 * 60 * 1000;
  return t - 24 * 60 * 60 * 1000;
}

export function formatWindowRange(
  window: AgentWorkWindow,
  now = new Date(),
): string {
  const end = now;
  const start = new Date(windowCutoffMs(window, now));
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  };
  return `${start.toLocaleString(undefined, opts)} – ${end.toLocaleString(undefined, opts)}`;
}

export function getAgentWorkSnapshot(): AgentWorkEntry[] {
  return ensureCache();
}

export function appendAgentWork(
  input: Omit<AgentWorkEntry, "id" | "createdAt" | "agentLabel"> & {
    agentLabel?: string;
    createdAt?: string;
    id?: string;
  },
): AgentWorkEntry | null {
  const summary = String(input.summary || "").trim();
  if (!summary) return null;
  const rows = [...ensureCache()];
  if (input.sourceKey) {
    const dup = rows.find((r) => r.sourceKey === input.sourceKey);
    if (dup) return dup;
  }
  const entry: AgentWorkEntry = {
    id: input.id || crypto.randomUUID(),
    agentId: input.agentId,
    agentLabel: input.agentLabel || AGENT_LABELS[input.agentId],
    action: input.action,
    summary: summary.slice(0, 280),
    eventId: input.eventId ?? null,
    eventTitle: input.eventTitle ?? null,
    href: input.href ?? null,
    createdAt: input.createdAt || new Date().toISOString(),
    sourceKey: input.sourceKey,
  };
  writeAll(prune([entry, ...rows]));
  return entry;
}

export function listAgentWorkInWindow(
  window: AgentWorkWindow,
  now = new Date(),
): AgentWorkEntry[] {
  const cutoff = windowCutoffMs(window, now);
  return ensureCache()
    .filter((r) => {
      const t = Date.parse(r.createdAt);
      return Number.isFinite(t) && t >= cutoff;
    })
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function listAgentWorkToday(now = new Date()): AgentWorkEntry[] {
  const day = startOfLocalDay(now);
  return ensureCache()
    .filter((r) => isSameLocalDay(r.createdAt, day))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function listAgentWorkGroupedByAgentToday(
  now = new Date(),
): AgentWorkGroup[] {
  const today = listAgentWorkToday(now);
  const map = new Map<AgentWorkAgentId, AgentWorkEntry[]>();
  for (const row of today) {
    const list = map.get(row.agentId) || [];
    list.push(row);
    map.set(row.agentId, list);
  }
  const groups: AgentWorkGroup[] = [];
  for (const id of DISPLAY_ORDER) {
    const entries = map.get(id);
    if (entries?.length) {
      groups.push({
        agentId: id,
        agentLabel: entries[0]?.agentLabel || AGENT_LABELS[id],
        entries,
      });
    }
  }
  return groups;
}

function buildOutcomes(
  agentId: AgentWorkAgentId,
  entries: AgentWorkEntry[],
): AgentOutcomeStat[] {
  const base = DEFAULT_OUTCOMES[agentId].map((o) => ({ ...o }));
  const byKey = new Map(base.map((o) => [o.key, o]));
  for (const e of entries) {
    const meta = ACTION_OUTCOME[e.action] || ACTION_OUTCOME.other;
    const existing = byKey.get(meta.key);
    if (existing) {
      existing.count += 1;
    } else {
      const next: AgentOutcomeStat = {
        key: meta.key,
        label: meta.label,
        count: 1,
        tone: meta.tone,
      };
      byKey.set(meta.key, next);
      base.push(next);
    }
  }
  return base;
}

export function listAgentPerformanceCards(
  window: AgentWorkWindow,
  now = new Date(),
): AgentPerformanceCard[] {
  const rows = listAgentWorkInWindow(window, now);
  const byAgent = new Map<AgentWorkAgentId, AgentWorkEntry[]>();
  for (const row of rows) {
    const list = byAgent.get(row.agentId) || [];
    list.push(row);
    byAgent.set(row.agentId, list);
  }

  const ids = new Set<AgentWorkAgentId>(PRIMARY_AGENT_IDS);
  for (const id of byAgent.keys()) ids.add(id);

  const cards: AgentPerformanceCard[] = [];
  for (const id of DISPLAY_ORDER) {
    if (!ids.has(id)) continue;
    const entries = byAgent.get(id) || [];
    cards.push({
      agentId: id,
      label: AGENT_LABELS[id],
      description: AGENT_DESCRIPTIONS[id],
      href: AGENT_HREFS[id],
      runs: entries.length,
      outcomes: buildOutcomes(id, entries),
      pending: 0,
      running: 0,
      recent: entries.slice(0, 4),
    });
  }
  return cards;
}

if (typeof window !== "undefined") {
  subscribeActivePack(() => {
    cacheHydrated = false;
    ensureCache();
    notify();
  });
}

export function formatAgentWorkTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}
