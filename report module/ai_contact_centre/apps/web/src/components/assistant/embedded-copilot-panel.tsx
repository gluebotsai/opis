import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";

import { CopilotMessageList } from "@/components/assistant/copilot-message-list";
import { ContactOperationPreview } from "@/components/contacts/contact-operation-preview";
import {
  CopilotChatInput,
  CopilotChatShell,
} from "@/components/assistant/copilot-workspace";
import { CopilotMark } from "@/components/brand/CopilotMark";
import {
  ASSISTANT_CANCEL_CONTACT_PREVIEW,
  ASSISTANT_CONFIRM_CONTACT,
  ASSISTANT_CONTACT_DRAFT,
  ASSISTANT_CONTACT_PREVIEW,
  ASSISTANT_COWORKER_REQUEST,
  dispatchCopilotSuggestion,
  listWorkspaceCopilotTurns,
  type ContactConfirmation,
  type ContactGuidedDraft,
} from "@/features/assistant/assistant-api";
import {
  WORKSPACE_ASSIST_TURN_RECORDED,
  mergeInboxAssistTurns,
} from "@/features/assistant/coworker-assist-memory";
import {
  copilotPlaceholder,
  copilotWelcome,
} from "@/features/assistant/copilot-context";
import { useCopilotPage } from "@/features/assistant/copilot-page-context";
import type { ChatMessage } from "@/features/assistant/copilot-engine";
import { useCopilotRunner } from "@/features/assistant/use-copilot-runner";
import { useAuth } from "@/hooks/use-auth";
import { useChatAutoScroll } from "@/hooks/use-chat-auto-scroll";
import { useAppDispatch, useAppSelector } from "@/hooks/redux";
import { store } from "@/store";
import {
  clearCopilotChatSession,
  initializeCopilotChatSession,
  selectCopilotChatSession,
  applyCopilotChatMessages,
  setCopilotChatInput,
  setCopilotRunnerState,
} from "@/store/slices/copilot-chat-session-slice";

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      'input, textarea, select, button, a, [contenteditable=""], [contenteditable="true"], [role="button"], [role="textbox"], [role="combobox"]',
    ),
  );
}

function buildWelcomeMessage(
  snapshot: ReturnType<typeof useCopilotPage>["snapshot"],
  role: "admin" | "agent",
): ChatMessage {
  return {
    id: "welcome",
    kind: "text",
    role: "assistant",
    content: copilotWelcome(snapshot, role),
    createdAt: new Date().toISOString(),
  };
}

export function EmbeddedCopilotPanel({
  onOpenQueue,
  embedded = false,
}: {
  onOpenQueue?: (queueId: string) => void;
  embedded?: boolean;
}) {
  const { user } = useAuth();
  const { snapshot, setContactDraft } = useCopilotPage();
  const dispatch = useAppDispatch();
  const copilotSession = useAppSelector(selectCopilotChatSession);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const role: "admin" | "agent" = user?.role === "agent" ? "agent" : "admin";
  const [contactPreview, setContactPreview] = useState<ContactConfirmation | null>(null);

  const { loading, statusLabel, resetGuidedCreate, submit } = useCopilotRunner(
    snapshot,
    role,
    { persistToRedux: true },
  );

  const messages = Array.isArray(copilotSession.messages) ? copilotSession.messages : [];
  const input = copilotSession.input;

  const setInput = useCallback(
    (value: string) => {
      dispatch(setCopilotChatInput(value));
    },
    [dispatch],
  );

  const appendInput = useCallback(
    (key: string) => {
      setInput(input + key);
    },
    [input, setInput],
  );

  useChatAutoScroll(listRef, messages, loading);

  useEffect(() => {
    if (snapshot.surface !== "inbox") return;

    function showDraft(event: Event) {
      const detail = (event as CustomEvent<ContactGuidedDraft | null>).detail;
      if (!detail?.mode) {
        setContactDraft(null);
        return;
      }
      setContactDraft({
        mode: detail.mode,
        contactId: detail.contactId ?? snapshot.contactId ?? null,
        fields: detail.fields ?? {},
        nextField: detail.nextField ?? null,
        nextQuestion: detail.nextQuestion,
        skippedFields: detail.skippedFields,
        ready: detail.ready,
      });
    }

    function clearDraft() {
      setContactDraft(null);
    }

    window.addEventListener(ASSISTANT_CONTACT_DRAFT, showDraft);
    window.addEventListener(ASSISTANT_CANCEL_CONTACT_PREVIEW, clearDraft);
    return () => {
      window.removeEventListener(ASSISTANT_CONTACT_DRAFT, showDraft);
      window.removeEventListener(ASSISTANT_CANCEL_CONTACT_PREVIEW, clearDraft);
    };
  }, [setContactDraft, snapshot.contactId, snapshot.surface]);

  useEffect(() => {
    if (snapshot.surface !== "inbox") {
      setContactPreview(null);
      return;
    }

    function showPreview(event: Event) {
      const detail = (event as CustomEvent<ContactConfirmation | null>).detail;
      if (!detail?.id) return;
      setContactPreview(detail);
    }

    function clearPreview() {
      setContactPreview(null);
    }

    window.addEventListener(ASSISTANT_CONTACT_PREVIEW, showPreview);
    window.addEventListener(ASSISTANT_CANCEL_CONTACT_PREVIEW, clearPreview);
    return () => {
      window.removeEventListener(ASSISTANT_CONTACT_PREVIEW, showPreview);
      window.removeEventListener(ASSISTANT_CANCEL_CONTACT_PREVIEW, clearPreview);
    };
  }, [snapshot.surface]);

  useEffect(() => {
    function confirmContact(event: Event) {
      const confirmationId = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (!confirmationId || loading) return;
      void submit(
        "Confirm the pending contact change exactly as previewed.",
        copilotSession.messages,
        () => undefined,
        { confirmedActions: [confirmationId], suppressUserMessage: true },
      );
    }

    window.addEventListener(ASSISTANT_CONFIRM_CONTACT, confirmContact);
    return () => window.removeEventListener(ASSISTANT_CONFIRM_CONTACT, confirmContact);
  }, [copilotSession.messages, loading, submit]);

  useEffect(() => {
    function submitCoworkerRequest(event: Event) {
      const message = (
        event as CustomEvent<{ message?: string }>
      ).detail?.message?.trim();
      if (!message || loading) return;
      void submit(message, copilotSession.messages, () => undefined);
    }

    window.addEventListener(ASSISTANT_COWORKER_REQUEST, submitCoworkerRequest);
    return () =>
      window.removeEventListener(ASSISTANT_COWORKER_REQUEST, submitCoworkerRequest);
  }, [copilotSession.messages, loading, submit]);

  useEffect(() => {
    if (!user) return;

    if (copilotSession.userId && copilotSession.userId !== user.id) {
      dispatch(clearCopilotChatSession());
    }

    // One coworker transcript across surfaces; initialize only seeds an empty session.
    dispatch(
      initializeCopilotChatSession({
        userId: user.id,
        welcomeMessage: buildWelcomeMessage(snapshot, role),
      }),
    );
  }, [copilotSession.userId, dispatch, role, snapshot, user]);

  useEffect(() => {
    const conversationId = snapshot.conversationId;
    if (!user || snapshot.surface !== "inbox" || !conversationId) {
      dispatch(
        applyCopilotChatMessages(
          mergeInboxAssistTurns(store.getState().copilotChatSession.messages, []),
        ),
      );
      return;
    }

    const selectedConversationId = conversationId;
    let cancelled = false;
    async function hydrate() {
      try {
        const turns = await listWorkspaceCopilotTurns({
          conversationId: selectedConversationId,
        });
        if (cancelled) return;
        dispatch(
          applyCopilotChatMessages(
            mergeInboxAssistTurns(store.getState().copilotChatSession.messages, turns),
          ),
        );
      } catch {
        // Keep the live panel usable if assist history cannot load.
      }
    }

    void hydrate();
    function handleRecorded(event: Event) {
      const recordedId = (event as CustomEvent<{ conversationId?: string }>).detail
        ?.conversationId;
      if (recordedId !== conversationId) return;
      void hydrate();
    }
    window.addEventListener(WORKSPACE_ASSIST_TURN_RECORDED, handleRecorded);
    return () => {
      cancelled = true;
      window.removeEventListener(WORKSPACE_ASSIST_TURN_RECORDED, handleRecorded);
    };
  }, [dispatch, snapshot.conversationId, snapshot.surface, user]);

  useEffect(() => {
    if (loading) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.length !== 1) return;

      const chatInput = inputRef.current;
      if (!chatInput) return;
      if (event.target === chatInput) return;
      if (isEditableTarget(event.target)) return;

      event.preventDefault();
      chatInput.focus({ preventScroll: true });
      appendInput(event.key);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [appendInput, loading]);

  function restart() {
    resetGuidedCreate();
    if (!user) return;

    dispatch(clearCopilotChatSession());
    dispatch(
      initializeCopilotChatSession({
        userId: user.id,
        welcomeMessage: buildWelcomeMessage(snapshot, role),
      }),
    );
    dispatch(
      setCopilotRunnerState({
        loading: false,
        streaming: false,
        statusLabel: "Ready when you are",
      }),
    );
    dispatch(setCopilotChatInput(""));
  }

  function handleSubmit() {
    void submit(input, copilotSession.messages, () => undefined);
    dispatch(setCopilotChatInput(""));
  }

  if (snapshot.surface === "inbox" && contactPreview) {
    return (
      <div className="h-full min-h-0">
        <ContactOperationPreview
          confirmation={contactPreview}
          onClose={() => setContactPreview(null)}
        />
      </div>
    );
  }

  return (
    <div className="h-full min-h-0">
      <CopilotChatShell
        scrollRef={listRef}
        onRestart={restart}
        embedded={embedded}
        footer={
          <CopilotChatInput
            ref={inputRef}
            value={input}
            onChange={setInput}
            disabled={loading}
            placeholder={copilotPlaceholder(snapshot)}
            onSubmit={handleSubmit}
          />
        }
      >
        <CopilotMessageList
          messages={messages}
          createQueueActionLabel="Add shifts & agents"
          onOpenQueue={onOpenQueue}
          onUseSuggestion={
            !embedded &&
            snapshot.surface === "inbox" &&
            snapshot.conversationId
              ? (text, copilotTurnId) =>
                  dispatchCopilotSuggestion(
                    snapshot.conversationId!,
                    text,
                    copilotTurnId,
                  )
              : undefined
          }
        />
        {loading && statusLabel ? (
          <div className="self-start w-fit inline-flex items-center gap-2 rounded-2xl bg-neutral-100 px-3.5 py-2 text-xs font-medium text-neutral-600 shadow-xs">
            <CopilotMark />
            <LoaderCircle className="size-3.5 animate-spin text-neutral-900" />
            {statusLabel}
          </div>
        ) : null}
      </CopilotChatShell>
    </div>
  );
}
