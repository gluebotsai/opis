/**
 * In-app notifications — server list is source of truth; localStorage is a cache.
 * Recommendations may still seed locally then POST to /api/notifications.
 */

import { appendAgentWork } from "@/lib/agent-work-log-store";
import {
  packStorageKey,
  subscribeActivePack,
} from "@/lib/industry-packs";
import {
  ensureRecommendationCardSeeds,
  listExpiryCandidates,
  listRecommendations,
} from "@/lib/campaign-recommendations-store";
import {
  createAppNotificationApi,
  fetchAppNotifications,
  markAllAppNotificationsReadApi,
  markAppNotificationReadApi,
} from "@/services/notifications.api";

export type NotificationKind =
  | "recommendation_ready"
  | "recommendation_expiry"
  | "recommendation_edit"
  | "whatsapp_approved"
  | "send_time_insight"
  | "send_time_mismatch"
  | "template_rejected"
  | "template_expiring"
  | "template_paused"
  | "campaign_launched"
  | "campaign_scheduled"
  | "campaign_send_progress"
  | "campaign_failures"
  | "campaign_completed"
  | "campaign_stopped"
  | "campaign_channel_paused"
  | "campaign_channel_resumed"
  | "system";

export type AppNotification = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  /** Optional — only actionable items navigate and close the dropdown */
  href?: string | null;
  createdAt: string;
  readAt: string | null;
  /** Dedup key for sync (stable across reloads) */
  sourceKey?: string;
};

const STORAGE_KEY_BASE = "worktual.appNotifications.v2";

function storageKey() {
  return packStorageKey(STORAGE_KEY_BASE);
}
const MAX_ITEMS = 40;
const EMPTY: AppNotification[] = [];

type Listener = () => void;
const listeners = new Set<Listener>();

/** Cached snapshot — stable reference until write (required by useSyncExternalStore). */
let cachedList: AppNotification[] = EMPTY;
let cacheHydrated = false;

function canUseStorage() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function minutesAgo(n: number): string {
  return new Date(Date.now() - n * 60_000).toISOString();
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

export function subscribeNotifications(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True only for items that should navigate + close the bell dropdown. */
export function notificationCanRoute(n: AppNotification): boolean {
  const href = (n.href || "").trim();
  if (!href) return false;
  if (n.kind === "system") return false;
  return (
    n.kind === "recommendation_ready" ||
    n.kind === "recommendation_expiry" ||
    n.kind === "recommendation_edit" ||
    n.kind === "whatsapp_approved" ||
    n.kind === "send_time_insight" ||
    n.kind === "send_time_mismatch" ||
    n.kind === "template_rejected" ||
    n.kind === "template_expiring" ||
    n.kind === "template_paused" ||
    n.kind === "campaign_launched" ||
    n.kind === "campaign_scheduled" ||
    n.kind === "campaign_send_progress" ||
    n.kind === "campaign_failures" ||
    n.kind === "campaign_completed" ||
    n.kind === "campaign_stopped" ||
    n.kind === "campaign_channel_paused" ||
    n.kind === "campaign_channel_resumed"
  );
}

function parseStored(): AppNotification[] {
  if (!canUseStorage()) return EMPTY;
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as AppNotification[];
    if (!Array.isArray(parsed) || parsed.length === 0) return EMPTY;
    return parsed.map((n) => ({
      ...n,
      readAt: n.readAt ?? null,
      href: n.kind === "system" ? null : n.href,
    }));
  } catch {
    return EMPTY;
  }
}

function hydrateCache() {
  if (cacheHydrated) return;
  cachedList = parseStored();
  cacheHydrated = true;
}

function writeAll(rows: AppNotification[]) {
  if (!canUseStorage()) return;
  const trimmed = rows
    .slice()
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    .slice(0, MAX_ITEMS);
  localStorage.setItem(storageKey(), JSON.stringify(trimmed));
  cachedList = trimmed.length === 0 ? EMPTY : trimmed;
  cacheHydrated = true;
  notify();
}

/** Stable snapshot for useSyncExternalStore — same ref until data changes. */
export function listNotifications(): AppNotification[] {
  hydrateCache();
  return cachedList;
}

export function getNotificationsServerSnapshot(): AppNotification[] {
  return EMPTY;
}

export function unreadNotificationCount(): number {
  return listNotifications().filter((n) => !n.readAt).length;
}

export function pushNotification(
  input: Omit<AppNotification, "id" | "createdAt" | "readAt"> & {
    id?: string;
    createdAt?: string;
    readAt?: string | null;
  },
): AppNotification {
  const all = [...listNotifications()];
  if (input.sourceKey) {
    const existing = all.find((n) => n.sourceKey === input.sourceKey);
    if (existing) return existing;
  }
  const kind = input.kind;
  const row: AppNotification = {
    id: input.id || crypto.randomUUID(),
    kind,
    title: input.title,
    body: input.body,
    href: kind === "system" ? null : input.href,
    createdAt: input.createdAt || new Date().toISOString(),
    readAt: input.readAt ?? null,
    sourceKey: input.sourceKey,
  };
  writeAll([row, ...all]);
  return row;
}

/**
 * Merge server feed into local cache (server wins on same sourceKey / id).
 */
function maybeLogProactiveWork(n: AppNotification): void {
  if (
    n.kind !== "send_time_insight" &&
    n.kind !== "send_time_mismatch" &&
    n.kind !== "template_rejected" &&
    n.kind !== "template_expiring" &&
    n.kind !== "template_paused"
  ) {
    return;
  }
  appendAgentWork({
    agentId: "system",
    action: "other",
    summary: n.body || n.title,
    href: n.href,
    sourceKey: n.sourceKey || `notif:${n.id}`,
  });
}

export function applyServerNotifications(serverItems: AppNotification[]): void {
  const local = listNotifications();
  const prevKeys = new Set(
    local.map((n) => n.sourceKey || `id:${n.id}`),
  );
  const byKey = new Map<string, AppNotification>();
  for (const n of local) {
    const key = n.sourceKey || `id:${n.id}`;
    byKey.set(key, n);
  }
  for (const n of serverItems) {
    const key = n.sourceKey || `id:${n.id}`;
    if (!prevKeys.has(key)) maybeLogProactiveWork(n);
    byKey.set(key, n);
  }
  writeAll([...byKey.values()]);
}

/** Pull from /api/notifications and refresh the bell cache. */
export async function syncNotificationsFromServer(): Promise<void> {
    const { items } = await fetchAppNotifications({ limit: 40 });
  applyServerNotifications(items);
}

export function markNotificationRead(id: string): void {
  const all = listNotifications();
  let changed = false;
  const next = all.map((n) => {
    if (n.id === id && !n.readAt) {
      changed = true;
      return { ...n, readAt: new Date().toISOString() };
    }
    return n;
  });
  if (changed) writeAll(next);
  void markAppNotificationReadApi(id).catch(() => {
    /* offline / not yet on server */
  });
}

export function markAllNotificationsRead(): void {
  const now = new Date().toISOString();
  const all = listNotifications();
  if (!all.some((n) => !n.readAt)) return;
  writeAll(all.map((n) => (n.readAt ? n : { ...n, readAt: now })));
  void markAllAppNotificationsReadApi().catch(() => {
    /* ignore */
  });
}

export function clearNotifications(): void {
  writeAll([]);
}

/** Simple info tips — no href, clicking must not close the dropdown. */
function buildInfoSeeds(): AppNotification[] {
  
  return [
    {
      id: "seed-info-manager",
      kind: "system",
      title: "Manager tip",
      body: "Ask the recommendation manager what agents have done, or request new ideas anytime.",
      href: null,
      createdAt: minutesAgo(8),
      readAt: null,
      sourceKey: "system:tip-manager",
    },
    {
      id: "seed-info-config",
      kind: "system",
      title: "Config reminder",
      body: "Verify your sending domain before launching email campaigns.",
      href: null,
      createdAt: minutesAgo(25),
      readAt: null,
      sourceKey: "system:tip-config",
    },
    {
      id: "seed-info-monitor",
      kind: "system",
      title: "Monitoring note",
      body: "Paused channels stay paused until you resume them in Campaign monitoring.",
      href: null,
      createdAt: minutesAgo(55),
      readAt: null,
      sourceKey: "system:tip-monitor",
    },
    {
      id: "seed-info-welcome",
      kind: "system",
      title: "Notifications ready",
      body: "After a campaign launches, send progress, failures, pauses, and completion show here. Contact adds are not notified.",
      href: null,
      createdAt: minutesAgo(120),
      readAt: null,
      sourceKey: "system:welcome",
    },
  ];
}

/**
 * Upsert notifications from recommendations board (ready cards + expiry)
 * and ensure sample info messages exist. Also POSTs client kinds to the server.
 */
export function syncNotificationsFromRecommendations(): void {
  ensureRecommendationCardSeeds();
  const active = listRecommendations().filter((r) => r.status === "active");
  const expiry = listExpiryCandidates();
  const existing = listNotifications();
  const bySource = new Map(
    existing.filter((n) => n.sourceKey).map((n) => [n.sourceKey!, n]),
  );

  const merged = existing.map((n) =>
    n.kind === "system" ? { ...n, href: null } : n,
  );
  let changed = merged.some((n, i) => n.href !== existing[i]?.href);

  for (const tip of buildInfoSeeds()) {
    const existingTip = bySource.get(tip.sourceKey!);
    if (existingTip) {
            continue;
    }
    bySource.set(tip.sourceKey!, tip);
    merged.push(tip);
    changed = true;
    void createAppNotificationApi({
      kind: tip.kind,
      title: tip.title,
      body: tip.body,
      href: tip.href,
      sourceKey: tip.sourceKey!,
    });
  }

  
  for (const r of active) {
    const key = `rec-ready:${r.id}`;
    if (bySource.has(key)) continue;
    const row: AppNotification = {
      id: crypto.randomUUID(),
      kind: "recommendation_ready",
      title: "New recommendation",
      body: r.title,
      href: "/campaigns/create/recommendations",
      createdAt: r.createdAt || new Date().toISOString(),
      readAt: null,
      sourceKey: key,
    };
    bySource.set(key, row);
    merged.unshift(row);
    changed = true;
    void createAppNotificationApi({
      kind: row.kind,
      title: row.title,
      body: row.body,
      href: row.href,
      sourceKey: key,
    });
  }

  for (const r of expiry) {
    const key = `rec-expiry:${r.id}`;
    if (bySource.has(key)) continue;
    const row: AppNotification = {
      id: crypto.randomUUID(),
      kind: "recommendation_expiry",
      title: "Recommendation needs review",
      body: `“${r.title}” is older than ~2 months — consent to delete or keep.`,
      href: "/campaigns/create/recommendations",
      createdAt: new Date().toISOString(),
      readAt: null,
      sourceKey: key,
    };
    bySource.set(key, row);
    merged.unshift(row);
    changed = true;
    void createAppNotificationApi({
      kind: row.kind,
      title: row.title,
      body: row.body,
      href: row.href,
      sourceKey: key,
    });
  }

  if (changed) writeAll(merged);
}

export type WhatsAppApprovalFeedItem = {
  id: string;
  campaign_id: string;
  campaign_name: string;
  template_name?: string;
  approved_at: string;
  href?: string | null;
};

/**
 * @deprecated Server emits whatsapp_approved into /api/notifications.
 * Kept for transitional callers.
 */
export function syncWhatsAppApprovalNotifications(
  items: WhatsAppApprovalFeedItem[],
): void {
  if (!items?.length) return;
  const existing = listNotifications();
  const bySource = new Map(
    existing.filter((n) => n.sourceKey).map((n) => [n.sourceKey!, n]),
  );
  const merged = [...existing];
  let changed = false;

  for (const item of items) {
    const key = item.id.startsWith("wa-approved:")
      ? item.id.replace(/^wa-approved:/, "whatsapp:approved:")
      : `whatsapp:approved:${item.campaign_id}`;
    if (bySource.has(key) || bySource.has(item.id)) continue;
    const name = (item.campaign_name || "Campaign").trim() || "Campaign";
    const row: AppNotification = {
      id: crypto.randomUUID(),
      kind: "whatsapp_approved",
      title: "WhatsApp channel approved",
      body: `Campaign “${name}” — WhatsApp channel is approved.`,
      href: item.href || `/campaigns/${item.campaign_id}`,
      createdAt: item.approved_at || new Date().toISOString(),
      readAt: null,
      sourceKey: key,
    };
    bySource.set(key, row);
    merged.unshift(row);
    changed = true;
  }

  if (changed) writeAll(merged);
}

if (typeof window !== "undefined") {
  subscribeActivePack(() => {
    cacheHydrated = false;
    hydrateCache();
    notify();
  });
}

export function formatNotificationTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
