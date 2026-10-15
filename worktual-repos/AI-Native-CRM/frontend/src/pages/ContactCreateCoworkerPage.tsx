import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CoworkerCreateShell } from "@/components/coworker/CoworkerCreateShell";
import {
  ContactCreateDraftPanel,
  emptyContactDraft,
  NEW_COMPANY,
} from "@/components/contacts/ContactCreateDraftPanel";
import {
  nextThreadWithUser,
  useCoworkerChatDirty,
  useCoworkerThread,
  withModuleWelcome,
} from "@/lib/coworker/coworker-thread";
import { isDraftDirty, newCoworkerMessageId } from "@/lib/coworker/draft-progress";
import {
  COWORKER_LLM_ERROR_SPEECH,
  draftReadyClientForModule,
  looksLikeCreateConfirmClient,
} from "@/lib/coworker/sanitize-assistant-text";
import { useCoworkerSeedPrompt } from "@/lib/coworker/useCoworkerSeedPrompt";
import { followCreateShellTools } from "@/lib/coworker/follow-create-shell-tools";
import {
  hydrateDraftFromMemory,
  useDraftSessionMemory,
} from "@/lib/coworker/use-draft-session-memory";
import {
  assistContactDraft,
  type ContactDraftFields,
} from "@/services/coworker";
import { fetchContactFormOptions } from "@/services/contacts";

export function ContactCreateCoworkerPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const formOnly = searchParams.get("form") === "1";

  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState<
    Array<{
      id: string;
      name: string;
      locations: Array<{ id: string; name: string; type: string }>;
    }>
  >([]);
  const sessionMemory = useDraftSessionMemory("contact-create");
  const [draft, setDraft] = useState<ContactDraftFields>(() =>
    hydrateDraftFromMemory(
      emptyContactDraft(),
      sessionMemory.memoryRef.current,
      "contactDraft",
    ),
  );
  const [baseline, setBaseline] = useState<ContactDraftFields>(emptyContactDraft);
  const { messages, setMessages, input, setInput } = useCoworkerThread();
  const [sending, setSending] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const draftSubmitRef = useRef<(() => Promise<true | string>) | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchContactFormOptions()
      .then((opts) => {
        if (cancelled || !opts.ok) return;
        setCompanies(opts.companies);
        setMessages((prev) =>
          withModuleWelcome(
            prev,
            formOnly
              ? "Fill in the form on the right, or switch to co-worker for a guided chat."
              : "Happy to help create a contact — I'll ask for details one at a time. Progress shows on the right.",
          ),
        );
        setBaseline(emptyContactDraft());
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [formOnly]);

  const chatDirty = useCoworkerChatDirty();
  const dirty = isDraftDirty(draft, baseline) || chatDirty;

  const applyPatch = useCallback(
    (patch: Partial<ContactDraftFields>) => {
      setDraft((prev) => {
        const next = { ...prev, ...patch };
        if (
          patch.companyName?.trim() &&
          (patch.companyId === undefined || patch.companyId === "")
        ) {
          next.companyId = NEW_COMPANY;
          next.locationId = "";
        }
        if (
          patch.companyId &&
          patch.companyId !== NEW_COMPANY &&
          patch.companyId !== prev.companyId &&
          !patch.locationId
        ) {
          const c = companies.find((x) => x.id === patch.companyId);
          next.locationId = c?.locations[0]?.id ?? "";
          next.companyName = "";
        }
        draftRef.current = next;
        return next;
      });
    },
    [companies],
  );

  const onRestart = () => {
    setMessages([
      {
        id: "welcome",
        role: "assistant",
        text: formOnly
          ? "Fresh start. Fill the form on the right."
          : "Fresh start. Describe the contact — I'll update the setup panel as we go.",
      },
    ]);
    setInput("");
    const reset = emptyContactDraft();
    setDraft(reset);
    setBaseline(reset);
    sessionMemory.clear();
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
      const result = await assistContactDraft({
        messages: [
          ...messages.map((m) => ({ role: m.role, text: m.text })),
          { role: "user" as const, text },
        ],
        draft,
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

      if (result.patch) {
        flushSync(() => {
          applyPatch(result.patch!);
        });
      }

      const shouldCreate =
        result.toolProposals?.some(
          (t) =>
            t.name === "propose_create_contact" && t.args?.auto === true,
        ) ||
        (looksLikeCreateConfirmClient(text) &&
          draftReadyClientForModule("contact", draftRef.current));
      if (shouldCreate) {
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        const submit = draftSubmitRef.current;
        if (!submit) {
          setMessages((p) => [
            ...p,
            {
              id: newCoworkerMessageId(),
              role: "assistant",
              text: "Create form isn't ready yet — tap Create contact or try again.",
            },
          ]);
          return;
        }
        const created = await submit();
        if (created !== true) {
          setMessages((p) => [
            ...p,
            {
              id: newCoworkerMessageId(),
              role: "assistant",
              text:
                typeof created === "string" && created !== "cancelled"
                  ? created
                  : "Couldn't save the contact yet — check the draft and try again.",
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
    ready: !loading,
    sendText: (text, opts) => onSend(text, opts),
  });

  const draftPanel = (
    <ContactCreateDraftPanel
      draft={draft}
      onDraftChange={(next) => {
        draftRef.current = next;
        setDraft(next);
      }}
      submitRef={draftSubmitRef}
      mode={formOnly ? "form" : "guided"}
      onCreated={(contactId) => {
        setBaseline(draftRef.current);
        navigate(
          `/contact?view=detail&id=${encodeURIComponent(contactId)}&highlight=${encodeURIComponent(contactId)}`,
          { replace: true },
        );
      }}
    />
  );

  return (
    <CoworkerCreateShell
      title="New contact"
      subtitle="Co-worker + guided setup"
      backHref="/contact"
      formOnly={formOnly}
      hybridHref="/contact/new"
      quickFormHref="/contact/new?form=1"
      welcomeLoading={loading}
      messages={messages}
      input={input}
      onInputChange={setInput}
      onSend={() => void onSend()}
      onRestart={onRestart}
      sending={sending}
      draftPanel={draftPanel}
      dirty={dirty}
      composerPlaceholder="e.g. Add Priya Sharma, priya@acme.com, MQL"
    />
  );
}
