import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { MessageSquare, X } from "lucide-react";
import { CoworkerChatShell } from "@/components/coworker/CoworkerChatShell";
import type { CoworkerMessage } from "@/components/coworker/types";
import { Button } from "@/components/ui/Button";
import { newCoworkerMessageId } from "@/lib/coworker/draft-progress";
import { COWORKER_LLM_ERROR_SPEECH } from "@/lib/coworker/sanitize-assistant-text";
import { getModuleRailConfig, isModuleRailEnabled } from "@/lib/coworker/module-rail-registry";
import { resolvePageCoworkerContext } from "@/lib/coworker/page-context";
import {
  assistPageContext,
  type PageAssistAction,
} from "@/services/coworker";
import {
  hydrateCoworkerRailOpen,
  setCoworkerRailOpen,
  useAppDispatch,
  useAppSelector,
} from "@/store";
import "@/lib/coworker/register-module-rails";

const OPEN_KEY = "crm-coworker-rail-open";

function readOpen(): boolean {
  try {
    return sessionStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeOpen(open: boolean) {
  try {
    sessionStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/**
 * Global page-scoped co-worker drawer. Hidden on Inbox and create-hybrid routes,
 * and when the current module is not registered yet.
 */
export function PageCoworkerRail() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const businessType = useAppSelector((s) => s.auth.user?.businessType);
  const ctx = useMemo(() => resolvePageCoworkerContext(pathname), [pathname]);
  const config = getModuleRailConfig(ctx.moduleKey);
  const financeBlocked = ctx.moduleKey === "finance" && businessType === "b2c";
  const visible =
    !ctx.excluded &&
    !financeBlocked &&
    isModuleRailEnabled(ctx.moduleKey) &&
    Boolean(config);

  const dispatch = useAppDispatch();
  const open = useAppSelector((s) => s.shell.coworkerRailOpen);
  const [messages, setMessages] = useState<CoworkerMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [actions, setActions] = useState<PageAssistAction[]>([]);

  useEffect(() => {
    dispatch(hydrateCoworkerRailOpen(readOpen()));
  }, [dispatch]);

  useEffect(() => {
    if (!visible || !config) return;
    setMessages([
      {
        id: "welcome",
        role: "assistant",
        text: config.welcome(ctx),
      },
    ]);
    setInput("");
    setActions(config.quickLinks?.(ctx) ?? []);
  }, [visible, ctx.pathname, ctx.moduleKey, ctx.surface, ctx.entityId, config?.key]);

  const toggle = (next: boolean) => {
    dispatch(setCoworkerRailOpen(next));
    writeOpen(next);
  };

  if (!visible || !config) return null;

  const onSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    const userMsg: CoworkerMessage = {
      id: newCoworkerMessageId(),
      role: "user",
      text,
    };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setSending(true);
    try {
      const result = await assistPageContext({
        messages: nextMessages.map((m) => ({ role: m.role, text: m.text })),
        context: {
          module: ctx.moduleKey,
          surface: ctx.surface,
          entityId: ctx.entityId,
          pathname: ctx.pathname,
        },
      });
      if (!result.ok) {
        setMessages((p) => [
          ...p,
          {
            id: newCoworkerMessageId(),
            role: "assistant",
            text: COWORKER_LLM_ERROR_SPEECH,
          },
        ]);
        return;
      }
      setMessages((p) => [
        ...p,
        {
          id: newCoworkerMessageId(),
          role: "assistant",
          text: result.assistantText || COWORKER_LLM_ERROR_SPEECH,
        },
      ]);
      if (result.actions?.length) setActions(result.actions);
    } catch {
      setMessages((p) => [
        ...p,
        {
          id: newCoworkerMessageId(),
          role: "assistant",
          text: COWORKER_LLM_ERROR_SPEECH,
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const onRestart = () => {
    setMessages([
      {
        id: "welcome",
        role: "assistant",
        text: config.welcome(ctx),
      },
    ]);
    setActions(config.quickLinks?.(ctx) ?? []);
    setInput("");
  };

  return (
    <>
      {!open ? (
        <button
          type="button"
          onClick={() => toggle(true)}
          className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2.5 text-sm font-medium text-text-on-dark shadow-lg hover:opacity-90"
          aria-label="Open co-worker"
        >
          <MessageSquare className="size-4" strokeWidth={1.75} />
          Co-worker
        </button>
      ) : null}

      {/* Mobile overlay */}
      {open ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          aria-label="Close co-worker backdrop"
          onClick={() => toggle(false)}
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border-default bg-subtle shadow-xl transition-transform duration-200 lg:static lg:z-0 lg:max-w-[380px] lg:shrink-0 lg:shadow-none ${
          open
            ? "translate-x-0"
            : "pointer-events-none translate-x-full lg:hidden"
        }`}
        aria-hidden={!open}
      >
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border-default/80 px-3">
          <p className="text-sm font-semibold text-text-primary">
            {config.label} co-worker
          </p>
          <button
            type="button"
            onClick={() => toggle(false)}
            className="inline-flex size-8 items-center justify-center rounded-lg hover:bg-state-hover"
            aria-label="Close co-worker"
          >
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col p-3">
          <div className="min-h-0 flex-1">
            <CoworkerChatShell
              title="co-worker"
              messages={messages}
              input={input}
              onInputChange={setInput}
              onSend={() => void onSend()}
              onRestart={onRestart}
              sending={sending}
              placeholder="Ask about this page…"
              footerHint="I won’t save changes for you — I’ll link or suggest next steps."
            />
          </div>
          {actions.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {actions.map((a) => (
                <Button
                  key={`${a.href}-${a.label}`}
                  type="button"
                  variant="secondary"
                  className="h-8 text-xs"
                  onClick={() => {
                    toggle(false);
                    navigate(a.href);
                  }}
                >
                  {a.label}
                </Button>
              ))}
            </div>
          ) : null}
          {ctx.entityId ? (
            <p className="mt-2 text-[11px] text-text-caption">
              Context id: {ctx.entityId.slice(0, 8)}…
              {ctx.surface === "detail" ? (
                <>
                  {" "}
                  ·{" "}
                  <Link
                    to={ctx.pathname}
                    className="text-text-link hover:underline"
                  >
                    stay on record
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
      </aside>
    </>
  );
}
