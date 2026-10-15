import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, Maximize2, Minimize2, RotateCcw, Paperclip } from 'lucide-react';
import CopilotMark from '../layout/CopilotMark';
import {
  askCoworkerAgentTurn,
  mergeCoworkerSessionMemory,
  type CoworkerChatContext,
  type CoworkerSessionMemory,
} from '../../config/coworker';
import { useCoworkerSessionOptional, type CoworkerMessage } from './CoworkerSessionContext';
import { llmGuidedReply } from './llmGuidedReply';
import { applyAgentTurn, optimisticCreateUiActions } from './coworkerActions';
import {
  clearSessionGreetingCache,
  compactStackedAssistantIntros,
  decideModuleGreeting,
  isTransientAssistantFailure,
  LLM_UNAVAILABLE_CHAT,
  sharedSessionGreeting,
  shouldRetryGreeting,
  UNIVERSAL_COWORKER_GREETING_INTENT,
} from './moduleGreetingPolicy';

export type { CoworkerMessage };

/** User-facing Confirm chip text — never show raw propose_* tool ids. */
export function confirmToolChipLabel(toolName: string): string {
  const key = String(toolName || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  const labels: Record<string, string> = {
    propose_create_team: 'Create team',
    create_queue: 'Create team',
    propose_create_ticket: 'Create ticket',
    create_ticket: 'Create ticket',
    propose_create_customer: 'Create customer',
    create_customer: 'Create customer',
    propose_create_kb: 'Create KB article',
    create_kb_article: 'Create KB article',
    propose_create_macro: 'Create macro',
    create_macro: 'Create macro',
    propose_create_priority: 'Create priority',
    create_priority: 'Create priority',
    propose_create_status: 'Create status',
    create_status: 'Create status',
    propose_delete_priority: 'Delete priority',
    delete_priority: 'Delete priority',
    propose_delete_status: 'Delete status',
    delete_status: 'Delete status',
    propose_delete_team: 'Delete team',
    delete_queue: 'Delete team',
    propose_delete_macro: 'Delete macro',
    delete_macro: 'Delete macro',
  };
  if (labels[key]) return labels[key];
  const stripped = key.replace(/^propose_/, '').replace(/_/g, ' ').trim();
  return stripped || 'action';
}

type CoworkerChatPanelProps = {
  pageLabel: string;
  expanded?: boolean;
  onToggleExpand?: () => void;
  className?: string;
  greetingOverride?: string;
  placeholder?: string;
  suggestionChips?: string[];
  /** Offline fallback when LangGraph agents are unreachable. */
  onUserMessage?: (text: string) => string | null | Promise<string | null>;
  /** Apply structured actions returned by LangGraph /chat (filters, create, etc.). */
  onChatActions?: (
    actions: Record<string, unknown>[],
    meta: { reply: string; agent: string; userText: string }
  ) => void | Promise<void>;
  /**
   * Offline / chrome only. Live field answers go to LangGraph.
   * When true, onUserMessage runs first — return null to fall through.
   */
  handlersFirst?: boolean;
  /** Attach the active LangGraph draft snapshot (awaiting + filled fields). */
  getChatContext?: () => CoworkerChatContext | null;
  onRestart?: () => void;
  /** Unused for live chat — UI routes only via onChatActions. Kept for callers. */
  onAgentRoute?: (agent: string, userText?: string) => void;
  module?: string;
  surface?: string;
  onDraftPatch?: (patch: Record<string, unknown>) => void;
  onToolConfirm?: (
    tool: { name: string; args: Record<string, unknown> }
  ) => boolean | Promise<boolean>;
};

function greetingIntent(override?: string) {
  return override?.trim() || UNIVERSAL_COWORKER_GREETING_INTENT;
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split('**');
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <strong key={`${keyPrefix}-b-${i}`} className="font-semibold text-neutral-900">
        {part}
      </strong>
    ) : (
      <React.Fragment key={`${keyPrefix}-t-${i}`}>{part}</React.Fragment>
    ),
  );
}

/** Turn model markdown (incl. inline "* a * b" lists) into readable blocks. */
function renderRichText(text: string) {
  let normalized = String(text ?? '')
    .replace(/\r\n/g, '\n')
    .trim();
  // Collapse inline bullet runs: "...: * item * item" → real newlines
  if (!normalized.includes('\n') && / \* /.test(normalized)) {
    normalized = normalized.replace(/ \* (?=\*\*|[\w#*])/g, '\n* ');
  }
  if (!normalized.includes('\n') && / - (?=[A-Z*\d])/.test(normalized)) {
    normalized = normalized.replace(/ - (?=[A-Z*\d])/g, '\n- ');
  }

  const lines = normalized.split('\n');
  const blocks: React.ReactNode[] = [];
  let listItems: string[] = [];
  let blockKey = 0;

  const flushList = () => {
    if (!listItems.length) return;
    const items = listItems;
    listItems = [];
    blocks.push(
      <ul key={`ul-${blockKey++}`} className="my-1.5 list-disc space-y-1 pl-5 marker:text-neutral-400">
        {items.map((item, i) => (
          <li key={`li-${i}`} className="pl-0.5">
            {renderInline(item, `li-${blockKey}-${i}`)}
          </li>
        ))}
      </ul>,
    );
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*([*\-]|\d+\.)\s+(.*)$/);
    if (bullet) {
      listItems.push(bullet[2]);
      continue;
    }
    flushList();
    if (!line.trim()) {
      blocks.push(<div key={`sp-${blockKey++}`} className="h-1.5" />);
      continue;
    }
    blocks.push(
      <p key={`p-${blockKey++}`} className="m-0">
        {renderInline(line.trim(), `p-${blockKey}`)}
      </p>,
    );
  }
  flushList();

  return <div className="space-y-0.5">{blocks}</div>;
}

export default function CoworkerChatPanel({
  pageLabel,
  expanded = false,
  onToggleExpand,
  className = '',
  greetingOverride,
  placeholder,
  suggestionChips = [],
  onUserMessage,
  onChatActions,
  handlersFirst = false,
  getChatContext,
  onRestart,
  module,
  surface,
  onDraftPatch,
  onToolConfirm,
}: CoworkerChatPanelProps) {
  const session = useCoworkerSessionOptional();

  // Fallback local state only when no session provider (should be rare)
  const [localMessages, setLocalMessages] = useState<CoworkerMessage[]>([]);
  const messages = session?.messages ?? localMessages;
  const setMessages = session?.setMessages ?? setLocalMessages;

  const [draft, setDraft] = useState('');
  const [localBusy, setLocalBusy] = useState(false);
  const [localThinkingLabel, setLocalThinkingLabel] = useState('Thinking…');
  const busy = session ? session.turnBusy : localBusy;
  const thinkingLabel = session ? session.thinkingLabel : localThinkingLabel;
  const setBusy = session ? session.setTurnBusy : setLocalBusy;
  const setThinkingLabel = session
    ? session.setThinkingLabel
    : setLocalThinkingLabel;
  const [greetingBusy, setGreetingBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const importFileRef = useRef<HTMLInputElement>(null);
  /** Local fallback when panel renders outside session provider. */
  const localGreetedPagesRef = useRef<string[]>([]);
  const busyRef = useRef(false);
  const isTurnBusy = () =>
    session ? session.isTurnBusy() : busyRef.current;
  const markBusy = (next: boolean) => {
    busyRef.current = next;
    setBusy(next);
  };
  const sessionMemoryRef = useRef<CoworkerSessionMemory>({});
  const queuedSendRef = useRef<string | null>(null);
  const sendTextRef = useRef<(text: string) => Promise<void>>(async () => {});
  /** Bumped on refresh so in-flight turns/greetings cannot paint into the new session. */
  const sessionEpochRef = useRef(0);

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(reader.error || new Error('read failed'));
      reader.readAsDataURL(file);
    });

  const maybeOpenCustomerImport = (actions: Record<string, unknown>[]) => {
    const wants = actions.some((a) => {
      const t = String(a?.type || '').toLowerCase();
      return t === 'open_customer_import';
    });
    if (!wants) return;
    window.setTimeout(() => importFileRef.current?.click(), 0);
  };

  const uploadCustomerImportFiles = async (files: FileList | File[]) => {
    const list = Array.from(files || []).filter(Boolean);
    if (!list.length) return;
    const results: Array<{
      fileName: string;
      created: number;
      errors: unknown[];
      error?: string;
    }> = [];
    for (const file of list) {
      try {
        const name = String(file.name || '').toLowerCase();
        const isExcel = name.endsWith('.xlsx') || name.endsWith('.xls');
        const body: Record<string, string> = { filename: file.name };
        if (isExcel) {
          body.contentBase64 = await fileToBase64(file);
        } else {
          body.csv = await file.text();
        }
        const res = await fetch('/api/customers/import', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          results.push({
            fileName: file.name,
            created: 0,
            errors: [],
            error: String(data.error || 'Import failed'),
          });
          continue;
        }
        results.push({
          fileName: file.name,
          created: Number(data.created || 0),
          errors: Array.isArray(data.errors) ? data.errors : [],
        });
      } catch {
        results.push({
          fileName: file.name,
          created: 0,
          errors: [],
          error: 'Import failed',
        });
      }
    }
    const createdTotal = results.reduce((n, r) => n + r.created, 0);
    const errorRows = results.reduce(
      (n, r) => n + (Array.isArray(r.errors) ? r.errors.length : 0),
      0
    );
    const fileErrors = results.filter((r) => r.error).map((r) => `${r.fileName}: ${r.error}`);
    // Structured follow-up for the LLM to phrase — no static assistant seed.
    const summaryPayload = {
      kind: 'customer_import_result',
      created: createdTotal,
      rowErrors: errorRows,
      files: results.map((r) => ({
        fileName: r.fileName,
        created: r.created,
        errors: r.errors,
        error: r.error || null,
      })),
      fileFailures: fileErrors,
    };
    await sendTextRef.current(
      `Customer/contact import finished. Structured result (summarize for me; do not invent rows): ${JSON.stringify(summaryPayload)}`
    );
    try {
      await onChatActions?.(
        [{ type: 'refresh_customers' }, { type: 'navigate', view: 'customers' }],
        {
          reply: '',
          agent: 'customers',
          userText: 'import customers',
        }
      );
    } catch {
      /* ignore */
    }
  };

  const greetedPages = session?.greetedPages ?? localGreetedPagesRef.current;
  const markGreetedPage = (page: string | null) => {
    if (session) {
      session.markGreetedPage(page);
      return;
    }
    const t = (page || '').trim();
    if (!t) {
      localGreetedPagesRef.current = [];
      return;
    }
    if (!localGreetedPagesRef.current.includes(t)) {
      localGreetedPagesRef.current = [...localGreetedPagesRef.current, t];
    }
  };

  const loadDynamicGreeting = async (sessionIdOverride?: string) => {
    const intent = greetingIntent(greetingOverride);
    const extras = getChatContext?.() || {};
    const turn = await askCoworkerAgentTurn('hello', pageLabel, {
      sessionId: sessionIdOverride || session?.sessionId,
      kind: 'greeting',
      module: extras.module || module,
      surface: extras.surface || surface,
      focusedEntity: extras.focusedEntity || session?.focusedEntity || undefined,
    });
    const fromTurn = String(turn?.assistantText || '').trim();
    if (fromTurn && !isTransientAssistantFailure(fromTurn)) {
      return fromTurn;
    }
    return llmGuidedReply(
      {
        module: 'greeting',
        kind: 'greeting',
        pageLabel,
        context: {
          pageLabel,
          intentHint: intent.slice(0, 160),
          scope: 'universal',
        },
      },
      intent
    );
  };

  const focusInput = () => {
    // Defer until after route/layout paint so focus isn't stolen by the new panel
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus({ preventScroll: true });
        const len = el.value.length;
        try {
          el.setSelectionRange(len, len);
        } catch {
          /* ignore unsupported selection */
        }
      }, 0);
    });
  };

  // One universal initial greeting for the session — same text covers all modules; no new intro on switch.
  useEffect(() => {
    session?.notePageChange(pageLabel);
    focusInput();

    // Optimistic create navigate remounts this panel mid-turn — do not start
    // a greeting fetch or clear the live thinking chip.
    if (session?.isTurnBusy()) {
      setGreetingBusy(false);
      return;
    }

    const sessionKey = String(session?.sessionId || 'local').trim() || 'local';
    const retryFailedHello = shouldRetryGreeting(messages);
    const decision = decideModuleGreeting({
      pageLabel,
      greetedPages,
      messageCount: retryFailedHello ? 0 : messages.length,
    });

    if (!retryFailedHello && (decision === 'skip' || decision === 'skip_and_mark')) {
      if (decision === 'skip_and_mark') markGreetedPage('__initial__');
      setMessages((prev) => {
        const next = compactStackedAssistantIntros(prev);
        return next.length === prev.length ? prev : next;
      });
      setGreetingBusy(false);
      return;
    }
    if (retryFailedHello && messages.length > 0) {
      clearSessionGreetingCache(sessionKey);
      setMessages([]);
    }

    let cancelled = false;
    const epoch = sessionEpochRef.current;
    setGreetingBusy(true);
    void (async () => {
      try {
        // One agent-turn per session even if Strict Mode / remount re-runs this effect.
        const dynamic = await sharedSessionGreeting(sessionKey, () =>
          loadDynamicGreeting(sessionKey === 'local' ? undefined : sessionKey)
        );
        if (cancelled || epoch !== sessionEpochRef.current) return;
        if (!dynamic) {
          setMessages((prev) => {
            if (prev.length > 0) return prev;
            return [
              {
                id: `greet-err-${Date.now()}`,
                role: 'assistant',
                text: LLM_UNAVAILABLE_CHAT,
              },
            ];
          });
          return;
        }
        markGreetedPage('__initial__');
        setMessages((prev) => {
          if (prev.length > 0) return prev;
          return [{ id: `greet-${Date.now()}`, role: 'assistant', text: dynamic }];
        });
      } finally {
        if (!cancelled && epoch === sessionEpochRef.current) setGreetingBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageLabel]);

  useEffect(() => {
    focusInput();
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy, greetingBusy]);

  useEffect(() => {
    if (!busy && !greetingBusy) focusInput();
  }, [busy, greetingBusy]);

  const restart = () => {
    sessionEpochRef.current += 1;
    const epoch = sessionEpochRef.current;
    markBusy(false);
    queuedSendRef.current = null;
    setGreetingBusy(false);
    setDraft('');
    sessionMemoryRef.current = {};
    const previousKey = String(session?.sessionId || 'local').trim() || 'local';
    clearSessionGreetingCache(previousKey);
    let sid: string | undefined;
    if (session) {
      sid = session.restartSession('', null);
    } else {
      localGreetedPagesRef.current = [];
      setLocalMessages([]);
    }
    onRestart?.();
    focusInput();
    const nextKey = String(sid || 'local').trim() || 'local';
    void (async () => {
      const greeting = await sharedSessionGreeting(nextKey, () => loadDynamicGreeting(sid));
      if (epoch !== sessionEpochRef.current) return;
      if (!greeting?.trim()) return;
      setMessages((prev) => {
        if (prev.length > 0) return prev;
        return [{ id: `greet-${Date.now()}`, role: 'assistant', text: greeting }];
      });
      markGreetedPage('__initial__');
    })();
  };

  const confirmPendingTool = async (
    messageId: string,
    chip: { name: string; args: Record<string, unknown>; risk?: string; auto?: boolean }
  ) => {
    if (isTurnBusy()) return;
    const epoch = sessionEpochRef.current;
    markBusy(true);
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, confirms: undefined } : m))
    );
    try {
      const owned = onToolConfirm
        ? await onToolConfirm({ name: chip.name, args: chip.args || {} })
        : false;
      if (epoch !== sessionEpochRef.current) return;
      if (owned) return;
      const extras = getChatContext?.() || {};
      const historyForApi = messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-80)
        .map((m) => ({ role: m.role, text: m.text }));
      const live = await askCoworkerAgentTurn('confirm', pageLabel, {
        sessionId: session?.sessionId,
        history: historyForApi,
        draft: extras.draft || undefined,
        focusedEntity: extras.focusedEntity || session?.focusedEntity || undefined,
        module: extras.module || module,
        surface: extras.surface || surface,
        sessionMemory: extras.sessionMemory || sessionMemoryRef.current,
        entityId: extras.entityId,
        confirmTool: {
          name: chip.name,
          args: chip.args || {},
          auto: false,
          risk: chip.risk || 'high',
        },
      });
      if (epoch !== sessionEpochRef.current) return;
      if (live?.sessionMemoryPatch) {
        sessionMemoryRef.current = mergeCoworkerSessionMemory(
          sessionMemoryRef.current,
          live.sessionMemoryPatch
        );
      }
      const applied = applyAgentTurn({
        actions: live?.actions,
        toolProposals: live?.toolProposals,
        patch: live?.patch,
        sessionMemoryPatch: live?.sessionMemoryPatch,
        uiRefresh: live?.uiRefresh,
      });
      if (applied.patch) {
        try {
          onDraftPatch?.(applied.patch);
        } catch {
          /* ignore */
        }
      }
      const paintedReply = String(live?.assistantText || live?.reply || '').trim();
      if (applied.uiActions.length) {
        try {
          await onChatActions?.(applied.uiActions, {
            reply: paintedReply,
            agent: live?.agent || '',
            userText: 'confirm',
          });
        } catch {
          /* ignore */
        }
        maybeOpenCustomerImport(applied.uiActions);
      }
      if (paintedReply) {
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            text: paintedReply,
            confirms: applied.confirms.length ? applied.confirms : undefined,
          },
        ]);
      }
    } finally {
      if (epoch === sessionEpochRef.current) {
        markBusy(false);
        focusInput();
      }
    }
  };

  const sendText = async (textRaw: string) => {
    const text = textRaw.trim();
    if (!text) return;
    if (isTurnBusy()) {
      queuedSendRef.current = text;
      return;
    }
    const epoch = sessionEpochRef.current;
    markBusy(true);
    setThinkingLabel('Thinking…');
    setGreetingBusy(false);
    const userMsg: CoworkerMessage = { id: `u-${Date.now()}`, role: 'user', text };
    setMessages((prev) => [...prev, userMsg]);
    setDraft('');

    // Open the create progress panel immediately — do not wait for agent-turn.
    // Skip when already collecting fields (draft.awaiting) so answers aren't treated as create-start.
    try {
      const ctxNow = getChatContext?.() || {};
      const awaiting = String(
        (ctxNow.draft as { awaiting?: string } | null | undefined)?.awaiting || ''
      ).trim();
      if (!awaiting) {
        const optimistic = optimisticCreateUiActions(
          text,
          module || ctxNow.module || undefined
        );
        if (optimistic?.length) {
          void onChatActions?.(optimistic, {
            reply: '',
            agent: 'optimistic',
            userText: text,
          });
        }
      }
    } catch {
      /* optimistic shell must not block chat */
    }

    // History before this user turn (for the model) + include the new user message
    const historyForApi = [...messages, userMsg]
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .filter((m) => !m.text.startsWith('Continuing this conversation'))
      .slice(-80)
      .map((m) => ({ role: m.role, text: m.text }));

    let reply: string | null = null;
    let agentsReached = false;
    try {
      // Guided wizards: local handler owns the turn when it returns a reply.
      // If it returns null, fall through to LangGraph (same as non-guided pages)
      // so confirm/save actions still refresh the right-hand list.
      if (handlersFirst) {
        try {
          reply = (await onUserMessage?.(text)) ?? null;
        } catch {
          reply = null;
        }
      }
      if (epoch !== sessionEpochRef.current) return;

      if (!reply) {
        // Primary path: CRM agent-turn (LangGraph internally).
        const extras = getChatContext?.() || {};
        const live = await askCoworkerAgentTurn(text, pageLabel, {
          sessionId: session?.sessionId,
          history: historyForApi,
          draft: extras.draft || undefined,
          focusedEntity: extras.focusedEntity || session?.focusedEntity || undefined,
          module: extras.module || module,
          surface: extras.surface || surface,
          sessionMemory: extras.sessionMemory || sessionMemoryRef.current,
          entityId: extras.entityId,
          onProgress: (ev) => {
            if (epoch !== sessionEpochRef.current) return;
            const kind = String(ev.kind || '').trim().toLowerCase();
            if (kind && kind !== 'status') return;
            const label = String(ev.label || '').trim();
            if (label) setThinkingLabel(label);
          },
        });
        if (epoch !== sessionEpochRef.current) return;
        if (live) {
          agentsReached = true;
          if (live.sessionMemoryPatch) {
            sessionMemoryRef.current = mergeCoworkerSessionMemory(
              sessionMemoryRef.current,
              live.sessionMemoryPatch
            );
          }
          const applied = applyAgentTurn({
            actions: live.actions,
            toolProposals: live.toolProposals,
            patch: live.patch,
            sessionMemoryPatch: live.sessionMemoryPatch,
            uiRefresh: live.uiRefresh,
          });
          if (applied.patch) {
            try {
              const slots =
                live.sessionMemoryPatch?.slots &&
                typeof live.sessionMemoryPatch.slots === 'object'
                  ? live.sessionMemoryPatch.slots
                  : {};
              onDraftPatch?.({ ...slots, ...applied.patch });
            } catch {
              /* draft apply must not hide the reply */
            }
          }
          // Apply workspace/create UI before painting the bubble so the progress
          // panel updates as soon as the turn returns (not after the reply paints).
          const paintedReply = String(live.assistantText || live.reply || '').trim();
          if (applied.uiActions.length) {
            try {
              await onChatActions?.(applied.uiActions, {
                reply: paintedReply,
                agent: live.agent,
                userText: text,
              });
            } catch {
              /* UI apply failures should not hide the model reply */
            }
            maybeOpenCustomerImport(applied.uiActions);
          }
          if (paintedReply || applied.confirms.length) {
            setMessages((prev) => [
              ...prev,
              {
                id: `a-${Date.now()}`,
                role: 'assistant',
                text: paintedReply || 'Confirm the proposed action to continue.',
                confirms: applied.confirms.length ? applied.confirms : undefined,
              },
            ]);
          } else if (
            live.source === 'error' ||
            live.serviceError
          ) {
            const se =
              live.serviceError && typeof live.serviceError === 'object'
                ? live.serviceError
                : null;
            const fromService = String(se?.message || '').trim();
            const fromData = String(
              (live.data as { message?: string } | undefined)?.message || ''
            ).trim();
            const rawErr = fromService || fromData;
            // Never paint internal tool-loop / budget diagnostics in the transcript.
            const errText =
              rawErr &&
              !/repeated tool-call cycle|tool loop exceeded|tool loop deadline/i.test(
                rawErr
              )
                ? rawErr
                : 'I could not finish that write just now — please try once more, or say what to change.';
            if (se?.code) {
              console.warn('[coworker/agent-turn]', se.code, rawErr || errText);
            }
            setMessages((prev) => [
              ...prev,
              {
                id: `a-${Date.now()}`,
                role: 'assistant',
                text: errText,
              },
            ]);
          } else {
            setMessages((prev) => [
              ...prev,
              {
                id: `a-${Date.now()}`,
                role: 'assistant',
                text: 'Service temporarily unavailable — please try again in a moment.',
              },
            ]);
          }
        }
      }

      if (epoch !== sessionEpochRef.current) return;

      // Offline / agents-down: structured service error only (no seed/LLM fallback bubble).
      if (!agentsReached && !reply) {
        try {
          reply = (await onUserMessage?.(text)) ?? null;
        } catch {
          reply = null;
        }
      }
      if (epoch !== sessionEpochRef.current) return;
      if (!agentsReached && reply) {
        const paintedReply = String(reply).trim();
        if (paintedReply) {
          setMessages((prev) => [
            ...prev,
            { id: `a-${Date.now()}`, role: 'assistant', text: paintedReply },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            {
              id: `a-${Date.now()}`,
              role: 'assistant',
              text: 'Service temporarily unavailable — please try again in a moment.',
            },
          ]);
        }
      } else if (!agentsReached) {
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            text: 'Service temporarily unavailable — please try again in a moment.',
          },
        ]);
      }
    } finally {
      if (epoch === sessionEpochRef.current) {
        markBusy(false);
        setGreetingBusy(false);
      }
    }
  };
  sendTextRef.current = sendText;

  useEffect(() => {
    const register = session?.registerSendUserText;
    if (!register) return;
    register((text) => sendTextRef.current(text));
    return () => register(null);
  }, [session?.registerSendUserText]);

  useEffect(() => {
    if (busy || greetingBusy) return;
    const queued = queuedSendRef.current;
    if (!queued) return;
    queuedSendRef.current = null;
    void sendTextRef.current(queued);
  }, [busy, greetingBusy]);

  const showChips =
    suggestionChips.length > 0 &&
    messages.length <= 2 &&
    !busy &&
    !greetingBusy;

  return (
    <div
      className={`rounded-2xl border border-neutral-200 bg-white shadow-sm flex h-full min-h-0 flex-col overflow-hidden ${className}`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-neutral-200 px-3 py-3 sm:px-4 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <CopilotMark className="h-7 w-7 shrink-0" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-neutral-900 truncate">Worktual</h2>
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            title="Restart conversation (new session)"
            onClick={restart}
            className="inline-flex items-center justify-center min-h-11 min-w-11 p-2 rounded-lg text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 transition-colors"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          {onToggleExpand && (
            <button
              type="button"
              title={expanded ? 'Minimize chat · widen board' : 'Maximize chat · shrink board'}
              onClick={onToggleExpand}
              className="hidden lg:inline-flex items-center justify-center min-h-11 min-w-11 p-2 rounded-lg text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 transition-colors"
            >
              {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>

      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-4 pr-5 py-4 space-y-3 select-text">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[92%] text-sm leading-relaxed px-3.5 py-2.5 shadow-md select-text cursor-text ${
                msg.role === 'user'
                  ? 'bg-white text-neutral-900 rounded-2xl rounded-tr-sm border border-neutral-200'
                  : 'bg-neutral-50 text-neutral-800 rounded-2xl rounded-tl-sm'
              }`}
            >
              {renderRichText(msg.text)}
              {msg.role === 'assistant' && msg.confirms && msg.confirms.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {msg.confirms.map((chip) => (
                    <button
                      key={`${msg.id}-${chip.name}`}
                      type="button"
                      disabled={busy}
                      onClick={() => void confirmPendingTool(msg.id, chip)}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-neutral-300 bg-white text-neutral-800 hover:border-neutral-500 hover:bg-neutral-100 disabled:opacity-50 transition-colors"
                    >
                      {chip.risk === 'high' ? 'Confirm' : 'Continue'}:{' '}
                      {confirmToolChipLabel(chip.name)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {(busy || greetingBusy) && (
          <div className="flex justify-start" aria-live="polite" aria-label={thinkingLabel}>
            <div className="inline-flex items-center gap-2.5 max-w-[92%] rounded-2xl rounded-tl-sm bg-neutral-50 px-3.5 py-2.5 shadow-md">
              <span className="flex items-center gap-1" aria-hidden>
                <span className="h-1.5 w-1.5 rounded-full bg-neutral-400 animate-[coworkerThink_1.05s_ease-in-out_infinite]" />
                <span className="h-1.5 w-1.5 rounded-full bg-neutral-400 animate-[coworkerThink_1.05s_ease-in-out_0.15s_infinite]" />
                <span className="h-1.5 w-1.5 rounded-full bg-neutral-400 animate-[coworkerThink_1.05s_ease-in-out_0.3s_infinite]" />
              </span>
              <span className="text-xs font-medium text-neutral-500 tracking-wide">
                {busy ? thinkingLabel : 'Thinking…'}
              </span>
            </div>
          </div>
        )}

        {showChips && (
          <div className="flex flex-wrap gap-2 pt-1">
            {suggestionChips.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => sendText(chip)}
                className="text-xs font-medium px-3 py-1.5 rounded-full border border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400 hover:bg-neutral-50 transition-colors"
              >
                {chip}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 p-3 pt-1">
        <input
          ref={importFileRef}
          type="file"
          multiple
          accept=".csv,.tsv,.xls,.xlsx,text/csv,text/tab-separated-values"
          className="hidden"
          onChange={(e) => {
            const files = e.target.files;
            if (files?.length) void uploadCustomerImportFiles(files);
            e.target.value = '';
          }}
        />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendText(draft);
          }}
          className="rounded-2xl border border-neutral-200 bg-neutral-50/80 p-1.5 flex items-end gap-1.5 focus-within:border-neutral-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-neutral-200/70"
        >
          <button
            type="button"
            title="Import customers or contacts (CSV, TSV, Excel)"
            disabled={busy || greetingBusy}
            onClick={() => importFileRef.current?.click()}
            className="h-9 w-9 shrink-0 rounded-full text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 flex items-center justify-center disabled:opacity-50 transition-colors"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void sendText(draft);
              }
            }}
            placeholder={placeholder || 'Ask your Worktual co-worker...'}
            className="flex-1 min-h-[40px] max-h-28 resize-none bg-transparent px-3 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none border-0 shadow-none focus:!shadow-none focus:!border-transparent select-text"
          />
          <button
            type="submit"
            disabled={!draft.trim() || busy}
            title="Send"
            className="h-9 w-9 shrink-0 rounded-full bg-neutral-300 text-white flex items-center justify-center disabled:opacity-50 enabled:bg-black enabled:hover:bg-neutral-800 transition-colors"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
