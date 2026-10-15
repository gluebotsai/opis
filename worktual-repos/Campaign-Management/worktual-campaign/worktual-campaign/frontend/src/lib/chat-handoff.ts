/**
 * Cross-module chat handoff + agent-driven navigation.
 *
 * When an agent decides the user's request belongs to another workspace it
 * emits a `ui_event` of `{ type: "navigate", payload: { module, path, query } }`.
 * This module centralises what the frontend does with that event so every chat
 * behaves identically:
 *   1. Stash the current thread + a one-line `query` in sessionStorage so the
 *      destination chat can *display* the prior conversation and hand the agent
 *      a short context line (see `carry_query` on join).
 *   2. For `create_campaign`, land the user *inside* a real draft chat (seeded
 *      with the carried history) instead of the hub picker page.
 *   3. Otherwise navigate to the module's home path.
 */

import {
  getOpportunityEvent,
} from "@/lib/opportunity-events-store";
import { resolveChatMessageImages } from "@/lib/chat-message-images";
import {
  chatPathForDraft,
  CREATE_CAMPAIGN_DRAFTS_HREF,
  startCreateCampaignChat,
} from "@/lib/start-create-campaign-chat";
import { startCampaignFromFormEvent } from "@/lib/start-campaign-from-form";

const HANDOFF_KEY = "worktual.chatHandoff.v1";
/** Envelopes older than this are ignored so stale handoffs never leak in. */
const HANDOFF_TTL_MS = 2 * 60 * 1000;

export type HandoffMessage = {
  id?: string;
  role: "user" | "assistant";
  text: string;
  createdAt?: string;
  image_url?: string;
  imageUrl?: string;
  image_filename?: string;
  imageFilename?: string;
  image_urls?: { url: string; filename?: string }[];
  imageUrls?: { url: string; filename?: string }[];
};

export type ChatHandoff = {
  fromModule: string;
  toModule: string;
  messages: HandoffMessage[];
  query: string;
  createdAt: number;
};

/** Agent module ids (mirror agents/app/agents/routing.py). */
const MODULE_ALIASES: Record<string, string> = {
  contact: "contacts",
  audience: "contacts",
  customer: "contacts",
  customers: "contacts",
  campaign: "create_campaign",
  campaigns: "create_campaign",
  monitor: "monitoring",
  report: "reports",
  dashboard: "reports",
  events_report: "events_report",
  events_tracking: "events_report",
  recommendation: "recommendations",
  recommendation_run: "recommendation_run",
  library_run: "library_run",
  form: "forms",
  event: "forms",
  events: "forms",
};

export function normalizeModule(name: string | null | undefined): string {
  const raw = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, "_");
  if (!raw) return "";
  return MODULE_ALIASES[raw] || raw;
}

function cleanMessages(rows: HandoffMessage[]): HandoffMessage[] {
  return (rows || [])
    .filter((m) => {
      if (!m || (m.role !== "user" && m.role !== "assistant")) return false;
      const text = typeof m.text === "string" ? m.text.trim() : "";
      const images = resolveChatMessageImages(m);
      return Boolean(text || images.length);
    })
    .map((m) => {
      const images = resolveChatMessageImages(m);
      const imageUrl =
        String(m.image_url || m.imageUrl || "").trim() ||
        images[0]?.url ||
        "";
      const imageFilename = String(
        m.image_filename || m.imageFilename || "",
      ).trim();
      return {
        id: m.id,
        role: m.role,
        text: typeof m.text === "string" ? m.text : "",
        createdAt: m.createdAt,
        ...(images.length ? { image_urls: images } : {}),
        ...(imageUrl ? { image_url: imageUrl } : {}),
        ...(imageFilename || images[0]?.filename
          ? {
              image_filename:
                imageFilename || images[0]?.filename || "",
            }
          : {}),
      };
    });
}

export function writeChatHandoff(input: {
  fromModule: string;
  toModule: string;
  messages: HandoffMessage[];
  query: string;
}): void {
  try {
    const envelope: ChatHandoff = {
      fromModule: normalizeModule(input.fromModule) || input.fromModule || "",
      toModule: normalizeModule(input.toModule) || input.toModule || "",
      messages: cleanMessages(input.messages).slice(-40),
      query: (input.query || "").trim(),
      createdAt: Date.now(),
    };
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(envelope));
  } catch {
    /* sessionStorage unavailable — carry is best-effort */
  }
}

/**
 * Read + consume a handoff for one of `accepted` modules. Returns null when
 * there is nothing fresh addressed to this workspace. Always clears the
 * envelope so it is used exactly once.
 */
export function readChatHandoff(
  accepted: string | string[],
): ChatHandoff | null {
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChatHandoff;
    // Consume regardless of match/staleness so it can't leak into a later view.
    sessionStorage.removeItem(HANDOFF_KEY);
    if (!parsed || typeof parsed !== "object") return null;
    if (Date.now() - Number(parsed.createdAt || 0) > HANDOFF_TTL_MS) return null;
    const wanted = (Array.isArray(accepted) ? accepted : [accepted]).map(
      normalizeModule,
    );
    if (!wanted.includes(normalizeModule(parsed.toModule))) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Human-readable source label for the carried-context divider. */
export function handoffSourceLabel(module: string): string {
  const map: Record<string, string> = {
    contacts: "Audience",
    create_campaign: "Create campaign",
    monitoring: "Campaign monitoring",
    reports: "Dashboard",
    events_report: "Events tracking",
    recommendations: "Recommendations",
    recommendation_run: "Recommendation run",
    library_run: "Library run",
    forms: "Events",
  };
  return map[normalizeModule(module)] || "the previous workspace";
}

export function handoffJoinPayload(handoff: ChatHandoff | null): {
  carry_query?: string;
  carry_from_module?: string;
  carry_messages?: HandoffMessage[];
  explicit_handoff?: boolean;
} {
  if (!handoff) return {};
  const messages = cleanMessages(handoff.messages);
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  return {
    explicit_handoff: true,
    ...(handoff.query ? { carry_query: handoff.query } : {}),
    ...(handoff.fromModule ? { carry_from_module: handoff.fromModule } : {}),
    // Never send the prior campaign's full user thread — last user only.
    ...(lastUser ? { carry_messages: [lastUser] } : {}),
  };
}

export type AgentNavigateEvent = {
  session_id?: string;
  type?: string;
  payload?: {
    path?: string;
    module?: string;
    query?: string;
    create?: boolean;
    [key: string]: unknown;
  };
};

export type ApplyNavigateContext = {
  /** Current chat session id (to ignore events for other sessions). */
  sessionId: string;
  /** Current FE module id (so we don't carry a chat into itself). */
  module: string;
  navigate: (path: string, opts?: { state?: unknown }) => void;
  /** Snapshot of the current visible thread, newest last. */
  getMessages?: () => HandoffMessage[];
};

/**
 * Apply an agent `ui_event`. Returns true when it was a navigate we handled.
 * Safe to call for every `ui_event`; non-navigate events are ignored.
 */
export function applyAgentNavigate(
  evt: AgentNavigateEvent,
  ctx: ApplyNavigateContext,
): boolean {
  if (!evt || evt.type !== "navigate" || !evt.payload) return false;
  if (evt.session_id && evt.session_id !== ctx.sessionId) return false;

  const p = evt.payload;
  const targetModule = normalizeModule(p.module);
  const path = String(p.path || "").trim();
  const query = String(p.query || "").trim();
  const messages = cleanMessages(ctx.getMessages ? ctx.getMessages() : []);

  // Create campaign → open a real draft chat (not the hub picker) and seed it
  // with the carried conversation so the create agent continues from context.
  if (targetModule === "create_campaign") {
    const formEventId = formEventIdFromEditorPath();
    const linkedForm =
      formEventId && normalizeModule(ctx.module) === "forms"
        ? getOpportunityEvent(formEventId)
        : null;
    if (linkedForm?.kind === "form") {
      const { path } = startCampaignFromFormEvent(linkedForm, {
        seedUserOnJoin: query.trim() || undefined,
      });
      if (targetModule !== normalizeModule(ctx.module) && (messages.length || query)) {
        writeChatHandoff({
          fromModule: ctx.module,
          toModule: targetModule,
          messages,
          query,
        });
      }
      ctx.navigate(path, {
        state: { listHref: `/events/create/${linkedForm.id}` },
      });
      return true;
    }

    const seedMessages = messages.map((m) => ({
      id: m.id || crypto.randomUUID(),
      role: m.role,
      text: m.text,
      createdAt: m.createdAt || new Date().toISOString(),
    }));
    const lastUser = [...seedMessages].reverse().find((m) => m.role === "user");
    const seedUserOnJoin =
      query.trim() || (lastUser?.text || "").trim() || undefined;

    if (targetModule !== normalizeModule(ctx.module) && (messages.length || query)) {
      writeChatHandoff({
        fromModule: ctx.module,
        toModule: targetModule,
        messages,
        query,
      });
    }

    const draft = startCreateCampaignChat({
      useLibrarySelection: false,
      seed:
        seedMessages.length || seedUserOnJoin
          ? {
              messages: seedMessages,
              status: "drafting",
              dirty: true,
              ...(seedUserOnJoin ? { seedUserOnJoin } : {}),
            }
          : undefined,
    });
    ctx.navigate(chatPathForDraft(draft.id), {
      state: { listHref: CREATE_CAMPAIGN_DRAFTS_HREF },
    });
    return true;
  }

  // Any other module: stash the thread so the destination chat can show it and
  // give its agent a one-line context via `carry_query` on join.
  if (targetModule && targetModule !== normalizeModule(ctx.module)) {
    if (messages.length || query) {
      writeChatHandoff({
        fromModule: ctx.module,
        toModule: targetModule,
        messages,
        query,
      });
    }
  }

  if (path) {
    ctx.navigate(path);
    return true;
  }
  return false;
}

function formEventIdFromEditorPath(): string | null {
  if (typeof window === "undefined") return null;
  const m = window.location.pathname.match(/^\/events\/create\/([^/]+)/);
  return m?.[1]?.trim() || null;
}
