import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CoworkerCreateShell } from "@/components/coworker/CoworkerCreateShell";
import {
  ActivityLogDraftPanel,
  emptyActivityDraft,
} from "@/components/activities/ActivityLogDraftPanel";
import {
  nextThreadWithUser,
  useCoworkerChatDirty,
  useCoworkerThread,
  withModuleWelcome,
} from "@/lib/coworker/coworker-thread";
import {
  isDraftDirty,
  newCoworkerMessageId,
} from "@/lib/coworker/draft-progress";
import { useCoworkerSeedPrompt } from "@/lib/coworker/useCoworkerSeedPrompt";
import { mergeActivityDraftPatchFromTurn } from "@/lib/coworker/activity-draft-patch";
import {
  readHandoffDealId,
  stripCreateSeedPrompt,
} from "@/lib/coworker/create-handoff";
import { followCreateShellTools } from "@/lib/coworker/follow-create-shell-tools";
import {
  hydrateDraftFromMemory,
  useDraftSessionMemory,
} from "@/lib/coworker/use-draft-session-memory";
import { COWORKER_LLM_ERROR_SPEECH } from "@/lib/coworker/sanitize-assistant-text";
import {
  assistActivityDraft,
  mergeSessionMemoryPatch,
  type ActivityDraftFields,
} from "@/services/coworker";

export function ActivityLogCoworkerPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const formOnly = searchParams.get("form") === "1";

  const sessionMemory = useDraftSessionMemory("activity-create");
  const [draft, setDraft] = useState<ActivityDraftFields>(() =>
    hydrateDraftFromMemory(
      emptyActivityDraft(),
      sessionMemory.memoryRef.current,
      "activityDraft",
    ),
  );
  const [baseline, setBaseline] = useState<ActivityDraftFields>(emptyActivityDraft);
  const { messages, setMessages, input, setInput } = useCoworkerThread();
  const [sending, setSending] = useState(false);
  const [ready, setReady] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const draftSubmitRef = useRef<(() => Promise<true | string>) | null>(null);

  const applyPatch = useCallback((patch: Partial<ActivityDraftFields>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  const handoffDealConsumed = useRef(false);
  useEffect(() => {
    if (handoffDealConsumed.current) return;
    const handoffDealId = readHandoffDealId(searchParams);
    if (!handoffDealId) return;
    handoffDealConsumed.current = true;
    const merged = mergeSessionMemoryPatch(sessionMemory.memoryRef.current, {
      lastEntities: { dealId: handoffDealId },
    });
    sessionMemory.apply({ lastEntities: merged.lastEntities });
    const next = stripCreateSeedPrompt(searchParams);
    navigate(
      { pathname: "/activities/log", search: next.toString() },
      { replace: true },
    );
  }, [navigate, searchParams, sessionMemory]);

  useEffect(() => {
    setMessages((prev) =>
      withModuleWelcome(
        prev,
        formOnly
          ? "Fill in the form on the right, or switch to co-worker for a guided chat."
          : "Happy to help log an activity — I'll ask for details one at a time. Progress shows on the right.",
      ),
    );
    setReady(true);
  }, [formOnly]);

  const chatDirty = useCoworkerChatDirty();
  const dirty = isDraftDirty(draft, baseline) || chatDirty;

  const onRestart = () => {
    setMessages([
      {
        id: "welcome",
        role: "assistant",
        text: "Fresh start. Describe the activity to log, or fill the draft on the right.",
      },
    ]);
    setInput("");
    const reset = emptyActivityDraft();
    setDraft(reset);
    setBaseline(reset);
    sessionMemory.clear();
    applyPatch(reset);
  };

  const onSend = async (
    overrideText?: string,
    opts?: { displayText?: string },
  ) => {
    const text = (overrideText ?? input).trim();
    if (!text || sending) return;
    if (!overrideText) setInput("");
    const visible = opts?.displayText?.trim() || text;
    const nextMessages = nextThreadWithUser(
      messages,
      visible,
      newCoworkerMessageId(),
    );
    setMessages(nextMessages);
    setSending(true);
    try {
      const result = await assistActivityDraft({
        messages: [
          ...messages.map((m) => ({ role: m.role, text: m.text })),
          { role: "user" as const, text },
        ],
        draft: draftRef.current,
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
      setMessages((p) => [
        ...p,
        {
          id: newCoworkerMessageId(),
          role: "assistant",
          text: result.assistantText || COWORKER_LLM_ERROR_SPEECH,
        },
      ]);
      const leftPage = followCreateShellTools({
        tools: result.toolProposals,
        navigate,
        seedFallback: text,
      });
      if (leftPage) return;
      const mergedPatch = mergeActivityDraftPatchFromTurn(result);
      if (mergedPatch) {
        flushSync(() => {
          applyPatch(mergedPatch);
        });
      }
      const shouldCreate = result.toolProposals?.some(
        (t) => t.name === "propose_create_activity",
      );
      if (shouldCreate) {
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        const submit = draftSubmitRef.current;
        if (!submit) {
          setMessages((p) => [
            ...p,
            {
              id: newCoworkerMessageId(),
              role: "assistant",
              text: "The activity form isn't ready yet — check the draft and tell me to save again.",
            },
          ]);
          return;
        }
        const created = await submit();
        if (created === true) {
          setMessages((p) => [
            ...p,
            {
              id: newCoworkerMessageId(),
              role: "assistant",
              text: "All set — activity logged.",
            },
          ]);
        } else if (
          typeof created === "string" &&
          created.trim() &&
          created !== "cancelled"
        ) {
          setMessages((p) => [
            ...p,
            {
              id: newCoworkerMessageId(),
              role: "assistant",
              text: created,
            },
          ]);
        }
      }
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

  useCoworkerSeedPrompt({
    ready,
    sendText: (prompt, opts) => onSend(prompt, opts),
  });

  const onDraftChange = useCallback((next: ActivityDraftFields) => {
    setDraft(next);
  }, []);

  const draftPanel = (
    <ActivityLogDraftPanel
      draft={draft}
      onDraftChange={onDraftChange}
      submitRef={draftSubmitRef}
      mode={formOnly ? "form" : "guided"}
      onCreated={(activityId) => {
        setBaseline(draft);
        navigate(`/activities?highlight=${encodeURIComponent(activityId)}`, {
          replace: true,
        });
      }}
    />
  );

  return (
    <CoworkerCreateShell
      title="Log activity"
      subtitle="Co-worker + guided setup"
      backHref="/activities"
      formOnly={formOnly}
      hybridHref="/activities/log"
      quickFormHref="/activities/log?form=1"
      welcomeLoading={!ready}
      messages={messages}
      input={input}
      onInputChange={setInput}
      onSend={() => void onSend()}
      onRestart={onRestart}
      sending={sending}
      draftPanel={draftPanel}
      dirty={dirty}
      composerPlaceholder="e.g. Log a call with Priya about pricing"
    />
  );
}
