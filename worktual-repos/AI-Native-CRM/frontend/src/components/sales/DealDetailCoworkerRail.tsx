import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { CoworkerChatShell } from "@/components/coworker/CoworkerChatShell";
import type { CoworkerMessage } from "@/components/coworker/types";
import { Button } from "@/components/ui/Button";
import { DEAL_STAGE_LABELS, DEAL_STAGE_OPTIONS } from "@/lib/deal-stages";
import { newCoworkerMessageId } from "@/lib/coworker/draft-progress";
import { COWORKER_LLM_ERROR_SPEECH } from "@/lib/coworker/sanitize-assistant-text";
import { useDraftSessionMemory } from "@/lib/coworker/use-draft-session-memory";
import { assistDealDraft } from "@/services/coworker";
import { updateDealStage } from "@/services/sales";

const VALID_STAGES = new Set<string>(DEAL_STAGE_OPTIONS.map((o) => o.value));

/**
 * Collapsible co-worker rail for the deal detail page. Chat only — never
 * writes on its own. Stage changes surface a confirm banner and go through
 * updateDealStage; quote drafting hands off to the quote builder.
 */
export function DealDetailCoworkerRail({
  dealId,
  title,
  stage,
  onStageUpdated,
}: {
  dealId: string;
  title: string;
  stage: string;
  onStageUpdated?: () => void;
}) {
  const [open, setOpen] = useState(true);
  const sessionMemory = useDraftSessionMemory(`deal-detail:${dealId}`);
  const [messages, setMessages] = useState<CoworkerMessage[]>(() => [
    {
      id: "welcome",
      role: "assistant",
      text: `I'm your **Worktual co-worker** for **${title}**. Ask me about next steps, moving the stage, or drafting a quote — I'll never save changes without your confirmation.`,
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingStage, setPendingStage] = useState<string | null>(null);
  const [applyingStage, setApplyingStage] = useState(false);

  const onSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setError(null);
    const userMsg: CoworkerMessage = {
      id: newCoworkerMessageId(),
      role: "user",
      text,
    };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setSending(true);
    try {
      const result = await assistDealDraft({
        messages: nextMessages.map((m) => ({ role: m.role, text: m.text })),
        draft: {
          title,
          stage,
          notes: `Deal: ${title}`,
        },
        sessionMemory: sessionMemory.memoryRef.current,
      });
      if (result.ok) sessionMemory.apply(result.sessionMemoryPatch ?? null);
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
      const suggestedStage = result.patch?.stage;
      if (
        suggestedStage &&
        suggestedStage !== stage &&
        VALID_STAGES.has(suggestedStage)
      ) {
        setPendingStage(suggestedStage);
      }
      setMessages((p) => [
        ...p,
        {
          id: newCoworkerMessageId(),
          role: "assistant",
          text: result.assistantText || COWORKER_LLM_ERROR_SPEECH,
        },
      ]);
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
        text: `Fresh start. Ask about "${title}" — stage, quotes, or next steps.`,
      },
    ]);
    setInput("");
    setPendingStage(null);
    setError(null);
    sessionMemory.clear();
  };

  const confirmStage = async () => {
    if (!pendingStage) return;
    setApplyingStage(true);
    setError(null);
    const result = await updateDealStage(dealId, pendingStage);
    setApplyingStage(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPendingStage(null);
    onStageUpdated?.();
  };

  return (
    <div className="rounded-xl border border-border-default bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          <Sparkles className="size-4 text-brand" strokeWidth={1.75} />
          CRM co-worker
        </span>
        {open ? (
          <ChevronUp className="size-4 text-text-caption" strokeWidth={1.75} />
        ) : (
          <ChevronDown className="size-4 text-text-caption" strokeWidth={1.75} />
        )}
      </button>

      {open ? (
        <div className="border-t border-border-default p-3">
          {pendingStage ? (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
              <p>
                Move this deal to{" "}
                <strong>{DEAL_STAGE_LABELS[pendingStage] ?? pendingStage}</strong>?
              </p>
              <div className="mt-2 flex gap-2">
                <Button
                  type="button"
                  variant="primary"
                  className="h-8 px-3 text-xs"
                  disabled={applyingStage}
                  onClick={() => void confirmStage()}
                >
                  {applyingStage ? "Updating…" : "Confirm"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-8 px-3 text-xs"
                  disabled={applyingStage}
                  onClick={() => setPendingStage(null)}
                >
                  Dismiss
                </Button>
              </div>
            </div>
          ) : null}

          {error ? (
            <p className="mb-2 text-xs text-text-danger" role="alert">
              {error}
            </p>
          ) : null}

          <div className="h-[26rem]">
            <CoworkerChatShell
              title="co-worker"
              messages={messages}
              input={input}
              onInputChange={setInput}
              onSend={() => void onSend()}
              onRestart={onRestart}
              sending={sending}
              placeholder="e.g. Should we move this to Propose?"
              footerHint="Stage changes need your confirmation above."
            />
          </div>

          <div className="mt-3 text-right">
            <Link
              to={`/sales/quotes/new?dealId=${encodeURIComponent(dealId)}`}
              className="text-xs font-medium text-text-link hover:underline"
            >
              Open quote builder →
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
