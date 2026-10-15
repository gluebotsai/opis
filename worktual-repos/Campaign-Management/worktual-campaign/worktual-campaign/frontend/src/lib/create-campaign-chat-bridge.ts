/**
 * Persistent create-campaign chat bridge.
 * Socket listeners stay registered while the user opens template View
 * (chat unmounts) so typing + assistant replies are not dropped.
 */
import {
  getCampaignDraft,
  persistTemplateEditToDraftAndSession,
  upsertCampaignDraft,
} from "@/lib/campaign-drafts";
import { upsertCreateCampaignAssistantReply } from "@/lib/create-campaign-transcript";
import { runTemplatesReadySync } from "@/lib/append-session-channel-templates";
import {
  isChannelTemplatesReadyEvent,
  shouldShowTemplateLoadProgress,
} from "@/lib/campaign-template-timeline";
import { isAgentsUnableToConnectError } from "@/lib/agents-join";
import { getAgentsSocket } from "@/services/agents.socket";

export type CreateCampaignBridgeSnapshot = {
  typing: boolean;
  sending: boolean;
  thinkingLabel: string | null;
  serverAgentBusy: boolean;
  awaitingAgentReply: boolean;
};

type Listener = (snap: CreateCampaignBridgeSnapshot) => void;

type Entry = {
  typing: boolean;
  sending: boolean;
  thinkingLabel: string | null;
  serverAgentBusy: boolean;
  awaitingAgentReply: boolean;
  listeners: Set<Listener>;
  awaitTimeout: number | null;
};

const entries = new Map<string, Entry>();
let socketBound = false;

/** Clear stuck "Agent is preparing a response" if agents die mid-turn. */
const AWAITING_TIMEOUT_MS = 90_000;

function snap(entry: Entry): CreateCampaignBridgeSnapshot {
  return {
    typing: entry.typing,
    sending: entry.sending,
    thinkingLabel: entry.thinkingLabel,
    serverAgentBusy: entry.serverAgentBusy,
    awaitingAgentReply: entry.awaitingAgentReply,
  };
}

function finishAgentTurn(entry: Entry, sessionId: string) {
  entry.typing = false;
  entry.sending = false;
  entry.thinkingLabel = null;
  entry.serverAgentBusy = false;
  entry.awaitingAgentReply = false;
  clearAwaitTimeout(entry);
  notify(sessionId);
}

function notify(sessionId: string) {
  const entry = entries.get(sessionId);
  if (!entry) return;
  const s = snap(entry);
  for (const fn of entry.listeners) {
    try {
      fn(s);
    } catch {
      /* ignore subscriber errors */
    }
  }
}

function clearAwaitTimeout(entry: Entry) {
  if (entry.awaitTimeout != null) {
    window.clearTimeout(entry.awaitTimeout);
    entry.awaitTimeout = null;
  }
}

function armAwaitTimeout(sessionId: string, entry: Entry) {
  clearAwaitTimeout(entry);
  entry.awaitTimeout = window.setTimeout(() => {
    entry.awaitTimeout = null;
    if (!entry.typing && !entry.sending) return;
    entry.typing = false;
    entry.sending = false;
    entry.thinkingLabel = null;
    notify(sessionId);
  }, AWAITING_TIMEOUT_MS);
}

function ensureEntry(sessionId: string): Entry {
  let entry = entries.get(sessionId);
  if (!entry) {
    entry = {
      typing: false,
      sending: false,
      thinkingLabel: null,
      serverAgentBusy: false,
      awaitingAgentReply: false,
      listeners: new Set(),
      awaitTimeout: null,
    };
    entries.set(sessionId, entry);
  }
  return entry;
}

/** Auto-register sessions when server events arrive before local markAwaiting. */
function entryForEvent(sessionId: string | undefined): Entry | null {
  if (!sessionId) return null;
  return ensureEntry(sessionId);
}

function isCreateChatContext(chatContext?: string): boolean {
  return !chatContext || chatContext === "create";
}

function appendAssistantToDraft(sessionId: string, text: string) {
  const draft = getCampaignDraft(sessionId);
  if (!draft) return;
  const messages = upsertCreateCampaignAssistantReply(
    sessionId,
    draft.messages || [],
    text,
  );
  upsertCampaignDraft({
    ...draft,
    status: draft.status === "empty" ? "drafting" : draft.status,
    dirty: draft.status === "draft_saved" ? false : true,
    updatedAt: new Date().toISOString(),
    messages,
  });
}

function pickThinkingLabel(payload: {
  payload?: { steps?: Array<{ label?: string }> };
}): string | null {
  const steps = payload.payload?.steps;
  if (!Array.isArray(steps) || !steps.length) return null;
  const label = String(steps[steps.length - 1]?.label || "").trim();
  return label || null;
}

function bindSocketOnce() {
  if (socketBound) return;
  socketBound = true;
  const socket = getAgentsSocket();

  const clearAllAwaiting = () => {
    for (const [id, entry] of entries) {
      if (!entry.typing && !entry.sending && !entry.serverAgentBusy && !entry.awaitingAgentReply) {
        continue;
      }
      finishAgentTurn(entry, id);
    }
  };

  socket.on(
    "agent_typing",
    (payload: {
      session_id?: string;
      typing?: boolean;
      chat_context?: string;
      agent_busy?: boolean;
    }) => {
      if (!isCreateChatContext(payload.chat_context)) return;
      const entry = entryForEvent(payload.session_id);
      if (!entry || !payload.session_id) return;
      if (!payload.typing) {
        // Idle typing signals are ignored — turn_complete ends the UI turn.
        if (typeof payload.agent_busy === "boolean") {
          entry.serverAgentBusy = payload.agent_busy;
        }
        notify(payload.session_id);
        return;
      }
      entry.typing = true;
      entry.awaitingAgentReply = true;
      if (typeof payload.agent_busy === "boolean") {
        entry.serverAgentBusy = payload.agent_busy;
      } else {
        entry.serverAgentBusy = true;
      }
      armAwaitTimeout(payload.session_id, entry);
      notify(payload.session_id);
    },
  );

  socket.on(
    "thinking_progress",
    (payload: {
      session_id?: string;
      chat_context?: string;
      payload?: { status?: string; steps?: Array<{ label?: string }> };
    }) => {
      if (!isCreateChatContext(payload.chat_context)) return;
      const entry = entryForEvent(payload.session_id);
      if (!entry || !payload.session_id) return;
      const progressStatus = String(payload.payload?.status || "")
        .trim()
        .toLowerCase();
      if (progressStatus === "done" || progressStatus === "completed") {
        return;
      }
      // Never reopen typing chrome after a turn finished — progress is in-turn only.
      if (!entry.typing && !entry.sending && !entry.serverAgentBusy && !entry.awaitingAgentReply) {
        return;
      }
      const label = pickThinkingLabel(payload);
      if (label) entry.thinkingLabel = label;
      armAwaitTimeout(payload.session_id, entry);
      notify(payload.session_id);
    },
  );

  socket.on(
    "agent_message",
    (payload: {
      session_id?: string;
      text?: string;
      role?: string;
      chat_context?: string;
    }) => {
      if (!isCreateChatContext(payload.chat_context)) return;
      const entry = entryForEvent(payload.session_id);
      if (!entry || !payload.session_id) return;
      const text = String(payload.text || "").trim();
      if (text) {
        appendAssistantToDraft(payload.session_id, text);
      }
      // Keep typing chrome until turn_complete — mid-turn messages must not
      // clear the indicator while tools/launch are still running.
      entry.thinkingLabel = entry.thinkingLabel || "Agent is preparing a response";
      armAwaitTimeout(payload.session_id, entry);
      notify(payload.session_id);
    },
  );

  socket.on(
    "ui_event",
    (payload: {
      session_id?: string;
      type?: string;
      chat_context?: string;
      payload?: unknown;
    }) => {
      if (!isCreateChatContext(payload.chat_context)) return;
      const sid = payload.session_id;
      if (!sid || !entries.has(sid)) return;
      if (!isChannelTemplatesReadyEvent(payload.type)) return;
      const draft = getCampaignDraft(sid);
      if (!draft) return;
      const eventBody =
        payload.payload && typeof payload.payload === "object" && !Array.isArray(payload.payload)
          ? (payload.payload as Record<string, unknown>)
          : null;
      if (!shouldShowTemplateLoadProgress(draft, eventBody)) {
        void runTemplatesReadySync(sid, eventBody);
        return;
      }
      void runTemplatesReadySync(sid, eventBody).then((result) => {
        if (result.added.length) notify(sid);
      });
    },
  );

  socket.on(
    "template_updated",
    (payload: {
      session_id?: string;
      template_id?: string;
      template?: { template_id?: string; fields?: Record<string, unknown> };
    }) => {
      const sid = payload.session_id;
      if (!sid || !entries.has(sid)) return;
      const tid = String(
        payload.template_id || payload.template?.template_id || "",
      ).trim();
      const fields = payload.template?.fields;
      if (!tid || !fields || typeof fields !== "object") return;
      const draft = getCampaignDraft(sid);
      if (!draft) return;
      void persistTemplateEditToDraftAndSession(sid, tid, fields).then(() => {
        notify(sid);
      });
    },
  );

  socket.on("generation_stopped", (payload: { session_id?: string }) => {
    const sid = payload.session_id;
    if (!sid || !entries.has(sid)) return;
    finishAgentTurn(entries.get(sid)!, sid);
  });

  socket.on(
    "turn_complete",
    (payload: { session_id?: string; chat_context?: string }) => {
      if (!isCreateChatContext(payload.chat_context)) return;
      const sid = payload.session_id;
      if (!sid) return;
      finishAgentTurn(ensureEntry(sid), sid);
    },
  );

  socket.on(
    "error",
    (payload: { session_id?: string; message?: string; code?: string }) => {
      if (payload?.code === "agent_busy") {
        const sid = payload.session_id;
        if (sid && entries.has(sid)) {
          const entry = entries.get(sid)!;
          entry.serverAgentBusy = true;
          notify(sid);
        }
        return;
      }
      const sid = payload?.session_id;
      if (sid && entries.has(sid)) {
        finishAgentTurn(entries.get(sid)!, sid);
        return;
      }
      clearAllAwaiting();
    },
  );

  socket.on("disconnect", (reason: string) => {
    if (reason === "io client disconnect") return;
    clearAllAwaiting();
  });

  socket.on("connect_error", (err: Error) => {
    if (isAgentsUnableToConnectError(err)) {
      clearAllAwaiting();
    }
  });
}

/** Keep socket handlers alive for this session (survives chat unmount / View). */
export function ensureCreateCampaignBridge(sessionId: string): void {
  if (!sessionId) return;
  bindSocketOnce();
  ensureEntry(sessionId);
}

/** Drop bridge when leaving create-campaign entirely. */
export function releaseCreateCampaignBridge(sessionId: string): void {
  const entry = entries.get(sessionId);
  if (entry) clearAwaitTimeout(entry);
  entries.delete(sessionId);
}

export function markCreateCampaignServerBusy(
  sessionId: string,
  busy: boolean,
): void {
  ensureCreateCampaignBridge(sessionId);
  const entry = entries.get(sessionId)!;
  entry.serverAgentBusy = busy;
  notify(sessionId);
}

export function markCreateCampaignAwaiting(sessionId: string): void {
  ensureCreateCampaignBridge(sessionId);
  const entry = entries.get(sessionId)!;
  entry.typing = true;
  entry.sending = true;
  entry.serverAgentBusy = true;
  entry.awaitingAgentReply = true;
  if (!entry.thinkingLabel) {
    entry.thinkingLabel = "Sending…";
  }
  armAwaitTimeout(sessionId, entry);
  notify(sessionId);
}

export function clearCreateCampaignAwaiting(sessionId: string): void {
  const entry = entries.get(sessionId);
  if (!entry) return;
  finishAgentTurn(entry, sessionId);
}

export function getCreateCampaignBridgeSnapshot(
  sessionId: string,
): CreateCampaignBridgeSnapshot {
  const entry = entries.get(sessionId);
  return entry
    ? snap(entry)
    : {
        typing: false,
        sending: false,
        thinkingLabel: null,
        serverAgentBusy: false,
        awaitingAgentReply: false,
      };
}

export function subscribeCreateCampaignBridge(
  sessionId: string,
  listener: Listener,
): () => void {
  ensureCreateCampaignBridge(sessionId);
  const entry = entries.get(sessionId)!;
  entry.listeners.add(listener);
  listener(snap(entry));
  return () => {
    entry.listeners.delete(listener);
  };
}
