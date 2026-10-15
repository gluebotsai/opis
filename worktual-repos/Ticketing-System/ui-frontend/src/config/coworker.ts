/**
 * Worktual co-worker model wiring (UI status display).
 * Live replies go through Express → Python LangGraph (`COWORKER_AGENTS_URL`).
 * Model URL comes from env — never hardcode a vendor IP in source.
 */
import { apiFetchInit } from './embedAuth';
export const COWORKER_MODEL_NAME =
  (import.meta.env.VITE_COWORKER_MODEL_NAME as string | undefined)?.trim() ||
  'worktual-gemma';
export const COWORKER_MODEL_URL =
  (import.meta.env.VITE_COWORKER_MODEL_URL as string | undefined)?.trim() || '';

export function isCoworkerModelConfigured() {
  return Boolean(COWORKER_MODEL_NAME.trim() && COWORKER_MODEL_URL.trim());
}

export type CoworkerHistoryItem = { role: 'user' | 'assistant'; text: string };

export type TicketDraftSnapshot = {
  awaiting?: string;
  customerId?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  issue?: string;
  subject?: string;
  priority?: string;
  stepId?: string;
  [key: string]: unknown;
};

export type FocusedEntity = {
  type: 'ticket' | 'article' | 'customer' | 'team' | 'macro' | 'priority' | 'status';
  id: string;
  name?: string;
};

export type CoworkerSessionMemory = {
  pendingIntent?: string;
  pendingAsk?: string;
  slots?: Record<string, unknown>;
  lastEntities?: unknown;
  lastEntity?: unknown;
  lastToolOutcome?: unknown;
  parkedDrafts?: unknown;
  harnessTaskId?: string | null;
  harnessFields?: Record<string, unknown> | null;
  idempotencyKey?: string | null;
};

/** Apply a sessionMemoryPatch; `null` values delete the key (stale pin drop). */
export function mergeCoworkerSessionMemory(
  current: CoworkerSessionMemory,
  patch: Record<string, unknown> | null | undefined
): CoworkerSessionMemory {
  if (!patch || typeof patch !== 'object') return current;
  const next: CoworkerSessionMemory = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete (next as Record<string, unknown>)[key];
    } else {
      (next as Record<string, unknown>)[key] = value;
    }
  }
  return next;
}

export type CoworkerChatContext = {
  module?: string;
  /** list | create | detail */
  surface?: string;
  draft?: TicketDraftSnapshot | null;
  focusedEntity?: FocusedEntity | null;
  sessionMemory?: CoworkerSessionMemory | null;
  entityId?: string | null;
};

export type AgentToolProposal = {
  name: string;
  args: Record<string, unknown>;
  risk: string;
  auto: boolean;
};

export type AgentTurnResult = {
  assistantText: string;
  toolProposals: AgentToolProposal[];
  patch: Record<string, unknown> | null;
  sessionMemoryPatch: CoworkerSessionMemory | null;
  uiRefresh: { lists?: string[]; href?: string; filename?: string } | null;
  reply: string;
  agent: string;
  sessionId?: string;
  actions: Record<string, unknown>[];
  data?: Record<string, unknown>;
  /** Structured AI/service failure when the turn did not produce a reply. */
  serviceError?: { code?: string; message?: string; retryable?: boolean } | boolean;
  source?: string;
};

const DRAFT_DATA_KEYS = [
  'team_draft',
  'kb_draft',
  'ticket_draft',
  'macro_draft',
  'customer_draft',
  'priority_draft',
  'status_draft',
] as const;

function patchFromTurnPayload(
  patch: unknown,
  data?: Record<string, unknown> | null
): Record<string, unknown> | null {
  const fromData: Record<string, unknown> = {};
  if (data && typeof data === 'object') {
    for (const key of DRAFT_DATA_KEYS) {
      const blob = data[key];
      if (blob && typeof blob === 'object' && !Array.isArray(blob)) {
        Object.assign(fromData, blob);
      }
    }
  }
  const fromPatch =
    patch && typeof patch === 'object' && !Array.isArray(patch)
      ? (patch as Record<string, unknown>)
      : {};
  const merged = { ...fromData, ...fromPatch };
  return Object.keys(merged).length ? merged : null;
}

/** Persist the open UI item into shared conversation_context (live DB fetch on agents). */
export function reportCoworkerFocus(
  sessionId: string | undefined,
  entity: FocusedEntity | null
) {
  if (!sessionId) return;
  void fetch('/api/coworker/focus', apiFetchInit({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      focused_entity: entity,
    }),
  })).catch(() => {
    /* next chat turn still sends focused_entity */
  });
}

/** Call the Express proxy to the LangGraph multi-agent service. */
export async function askCoworkerAgents(
  message: string,
  page?: string,
  opts?: {
    sessionId?: string;
    history?: CoworkerHistoryItem[];
    draft?: TicketDraftSnapshot | null;
    nextStep?: string | null;
    focusedEntity?: FocusedEntity | null;
  }
): Promise<{
  reply: string;
  agent: string;
  sessionId?: string;
  actions: Record<string, unknown>[];
  data?: Record<string, unknown>;
} | null> {
  const chatTimeoutMs = Math.max(
    15_000,
    Number(import.meta.env.VITE_COWORKER_CHAT_TIMEOUT_MS || 120_000) || 120_000
  );
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), chatTimeoutMs);
  try {
    const res = await fetch('/api/coworker/chat', apiFetchInit({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        message,
        page,
        session_id: opts?.sessionId,
        history: opts?.history,
        ticket_draft: opts?.draft || undefined,
        next_step: opts?.nextStep || undefined,
        focused_entity: opts?.focusedEntity || undefined,
      }),
    }));
    let data: {
      reply?: unknown;
      agent?: unknown;
      session_id?: unknown;
      ui_actions?: unknown;
      data?: unknown;
      error?: unknown;
      detail?: unknown;
    } = {};
    try {
      data = await res.json();
    } catch {
      data = {};
    }
    if (!res.ok) {
      console.warn(
        '[coworker/chat]',
        res.status,
        data.error || data.detail || res.statusText
      );
      return null;
    }
    const actions = Array.isArray(data.ui_actions)
      ? (data.ui_actions as Record<string, unknown>[])
      : [];
    const reply = data?.reply != null ? String(data.reply) : '';
    // HTTP 200 means agents reached. Empty text is a phrase miss, not an outage.
    return {
      reply,
      agent: String(data.agent || 'general'),
      sessionId: data.session_id ? String(data.session_id) : undefined,
      actions,
      data:
        data.data && typeof data.data === 'object'
          ? (data.data as Record<string, unknown>)
          : undefined,
    };
  } catch (err) {
    console.warn('[coworker/chat] network error', err);
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

/** CRM agent-turn: speech + workspace tools. Prefer SSE stream for ontology progress. */
export async function askCoworkerAgentTurn(
  message: string,
  page?: string,
  opts?: {
    sessionId?: string;
    history?: CoworkerHistoryItem[];
    draft?: TicketDraftSnapshot | null;
    nextStep?: string | null;
    focusedEntity?: FocusedEntity | null;
    module?: string;
    surface?: string;
    sessionMemory?: CoworkerSessionMemory | null;
    confirmTool?: AgentToolProposal | null;
    kind?: string;
    entityId?: string | null;
    onProgress?: (event: { label?: string; phase?: string; kind?: string }) => void;
    /** Hub remainder channel — coworker defaults to chat */
    channel?: 'chat' | 'email';
  }
): Promise<AgentTurnResult | null> {
  const chatTimeoutMs = Math.max(
    15_000,
    Number(import.meta.env.VITE_COWORKER_CHAT_TIMEOUT_MS || 180_000) || 180_000
  );
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), chatTimeoutMs);
  const body = {
    message,
    page,
    session_id: opts?.sessionId,
    history: opts?.history,
    ticket_draft: opts?.draft || undefined,
    draft: opts?.draft || undefined,
    next_step: opts?.nextStep || undefined,
    focused_entity: opts?.focusedEntity || undefined,
    module: opts?.module || undefined,
    page_surface: opts?.surface || undefined,
    session_memory: opts?.sessionMemory || undefined,
    confirm_tool: opts?.confirmTool
      ? { name: opts.confirmTool.name, args: opts.confirmTool.args }
      : undefined,
    kind: opts?.kind || undefined,
    entity_id: opts?.entityId || undefined,
    channel: opts?.channel === 'email' ? 'email' : 'chat',
  };

  const toResult = (data: Record<string, unknown>): AgentTurnResult => {
    const actions = Array.isArray(data.ui_actions)
      ? (data.ui_actions as Record<string, unknown>[])
      : [];
    const proposals = Array.isArray(data.toolProposals)
      ? (data.toolProposals as AgentToolProposal[]).map((p) => ({
          name: String(p?.name || ''),
          args: p?.args && typeof p.args === 'object' ? p.args : {},
          risk: String(p?.risk || 'low'),
          auto: Boolean(p?.auto),
        }))
      : [];
    const assistantText = String(data.assistantText || data.reply || '');
    const rawSe = data.serviceError;
    let serviceError: AgentTurnResult['serviceError'];
    if (rawSe && typeof rawSe === 'object') {
      const se = rawSe as Record<string, unknown>;
      serviceError = {
        code: se.code != null ? String(se.code) : undefined,
        message: se.message != null ? String(se.message) : undefined,
        retryable: typeof se.retryable === 'boolean' ? se.retryable : undefined,
      };
    } else if (rawSe) {
      serviceError = true;
    }
    return {
      assistantText,
      toolProposals: proposals.filter((p) => p.name),
      patch: patchFromTurnPayload(data.patch, data.data as Record<string, unknown> | undefined),
      sessionMemoryPatch:
        data.sessionMemoryPatch && typeof data.sessionMemoryPatch === 'object'
          ? (data.sessionMemoryPatch as CoworkerSessionMemory)
          : null,
      uiRefresh:
        data.uiRefresh && typeof data.uiRefresh === 'object'
          ? (data.uiRefresh as AgentTurnResult['uiRefresh'])
          : null,
      reply: assistantText,
      agent: String(data.agent || 'general'),
      sessionId: data.session_id ? String(data.session_id) : undefined,
      actions,
      data:
        data.data && typeof data.data === 'object'
          ? (data.data as Record<string, unknown>)
          : undefined,
      serviceError,
      source: data.source != null ? String(data.source) : undefined,
    };
  };

  const errorResult = (
    payload: Record<string, unknown>,
    fallbackDetail?: string
  ): AgentTurnResult => {
    const seRaw = payload.serviceError;
    let serviceError: AgentTurnResult['serviceError'] = true;
    let message = '';
    let code = '';
    if (seRaw && typeof seRaw === 'object') {
      const se = seRaw as Record<string, unknown>;
      code = String(se.code || se.error_code || '').trim();
      message = String(se.message || se.detail || '').trim();
      serviceError = {
        code: code || undefined,
        message: message || undefined,
        retryable: typeof se.retryable === 'boolean' ? se.retryable : undefined,
      };
    }
    if (!message) {
      message = String(
        payload.detail || payload.error || fallbackDetail || ''
      ).trim();
    }
    return {
      assistantText: '',
      toolProposals: [],
      patch: null,
      sessionMemoryPatch: null,
      uiRefresh: null,
      reply: '',
      agent: 'general',
      actions: [],
      serviceError,
      source: 'error',
      data: {
        serviceError,
        code: code || undefined,
        message: message || undefined,
      },
    };
  };

  try {
    // Prefer streaming path so ontology status/activity labels update the UI live.
    const res = await fetch(
      '/api/coworker/agent-turn/stream',
      apiFetchInit({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        signal: controller.signal,
        body: JSON.stringify(body),
      })
    );

    if (res.ok && res.body && (res.headers.get('content-type') || '').includes('text/event-stream')) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let eventName = 'message';
      let dataLines: string[] = [];
      let resultPayload: Record<string, unknown> | null = null;
      let streamError: string | null = null;

      const flush = () => {
        if (!dataLines.length) {
          eventName = 'message';
          return;
        }
        const raw = dataLines.join('\n').trim();
        dataLines = [];
        const name = eventName || 'message';
        eventName = 'message';
        let payload: Record<string, unknown> = {};
        try {
          payload = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        } catch {
          payload = { text: raw };
        }
        if (name === 'progress') {
          // Only ontology status labels belong in the thinking chip — never
          // activity/block/summary or answer fragments.
          const kind = String(payload.kind || '').trim().toLowerCase();
          if (kind && kind !== 'status') {
            /* ignore */
          } else {
            const label = String(payload.label || '').trim();
            if (label) {
              opts?.onProgress?.({
                label,
                phase: String(payload.phase || '').trim() || undefined,
                kind: kind || 'status',
              });
            }
          }
        } else if (name === 'result') {
          resultPayload = payload;
        } else if (name === 'error') {
          const errPayload =
            (payload.payload as Record<string, unknown> | undefined) || payload;
          const se =
            errPayload.serviceError && typeof errPayload.serviceError === 'object'
              ? (errPayload.serviceError as Record<string, unknown>)
              : null;
          streamError = String(
            errPayload.detail ||
              errPayload.message ||
              errPayload.error ||
              se?.message ||
              se?.code ||
              payload.detail ||
              'stream error'
          ).trim() || 'stream error';
          resultPayload = {
            ...errPayload,
            source: 'error',
            serviceError:
              errPayload.serviceError ||
              (errPayload.detail || errPayload.error || se
                ? {
                    code: String(se?.code || ''),
                    message: streamError,
                  }
                : true),
          };
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n');
        buffer = parts.pop() || '';
        for (const line of parts) {
          const s = line.replace(/\r$/, '');
          if (s.startsWith('event:')) eventName = s.slice(6).trim() || 'message';
          else if (s.startsWith('data:')) dataLines.push(s.slice(5).replace(/^\s/, ''));
          else if (s === '') flush();
        }
      }
      flush();

      if (resultPayload) {
        if (resultPayload.source === 'error' || resultPayload.serviceError) {
          return errorResult(resultPayload, streamError || undefined);
        }
        return toResult(resultPayload);
      }
      if (streamError) console.warn('[coworker/agent-turn/stream]', streamError);
    }

    // Fallback: non-streaming agent-turn
    const fallback = await fetch(
      '/api/coworker/agent-turn',
      apiFetchInit({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify(body),
      })
    );
    let data: Record<string, unknown> = {};
    try {
      data = await fallback.json();
    } catch {
      data = {};
    }
    if (!fallback.ok) {
      console.warn(
        '[coworker/agent-turn]',
        fallback.status,
        data.error || data.detail || fallback.statusText
      );
      if (data.serviceError || data.source === 'error') {
        return errorResult(data, fallback.statusText);
      }
      const legacy = await askCoworkerAgents(message, page, opts);
      if (!legacy) return errorResult(data, fallback.statusText);
      return {
        assistantText: legacy.reply,
        toolProposals: [],
        patch: patchFromTurnPayload(null, legacy.data),
        sessionMemoryPatch: null,
        uiRefresh: null,
        reply: legacy.reply,
        agent: legacy.agent,
        sessionId: legacy.sessionId,
        actions: legacy.actions,
        data: legacy.data,
      };
    }
    return toResult(data);
  } catch (err) {
    console.warn('[coworker/agent-turn] network error', err);
    const legacy = await askCoworkerAgents(message, page, opts);
    if (!legacy) return null;
    return {
      assistantText: legacy.reply,
      toolProposals: [],
      patch: patchFromTurnPayload(null, legacy.data),
      sessionMemoryPatch: null,
      uiRefresh: null,
      reply: legacy.reply,
      agent: legacy.agent,
      sessionId: legacy.sessionId,
      actions: legacy.actions,
      data: legacy.data,
    };
  } finally {
    window.clearTimeout(timer);
  }
}
