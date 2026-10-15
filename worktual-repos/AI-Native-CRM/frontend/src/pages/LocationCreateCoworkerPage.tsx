import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  emptyLocationDraft,
  LocationCreateDraftPanel,
} from "@/components/companies/LocationCreateDraftPanel";
import { CoworkerCreateShell } from "@/components/coworker/CoworkerCreateShell";
import {
  nextThreadWithUser,
  useCoworkerChatDirty,
  useCoworkerThread,
  withModuleWelcome,
} from "@/lib/coworker/coworker-thread";
import { isDraftDirty, newCoworkerMessageId } from "@/lib/coworker/draft-progress";
import { COWORKER_LLM_ERROR_SPEECH } from "@/lib/coworker/sanitize-assistant-text";
import { followCreateShellTools } from "@/lib/coworker/follow-create-shell-tools";
import {
  hydrateDraftFromMemory,
  useDraftSessionMemory,
} from "@/lib/coworker/use-draft-session-memory";
import { useCoworkerSeedPrompt } from "@/lib/coworker/useCoworkerSeedPrompt";
import {
  assistLocationDraft,
  type LocationDraftFields,
} from "@/services/coworker";
import { fetchLocationFormOptions } from "@/services/companies";

export function LocationCreateCoworkerPage() {
  const { id: companyId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const formOnly = searchParams.get("form") === "1";

  const [loading, setLoading] = useState(true);
  const [companyName, setCompanyName] = useState("");
  const [hasHq, setHasHq] = useState(false);
  const sessionMemory = useDraftSessionMemory("location-create");
  const [draft, setDraft] = useState<LocationDraftFields>(() =>
    hydrateDraftFromMemory(
      emptyLocationDraft(false),
      sessionMemory.memoryRef.current,
      "locationDraft",
    ),
  );
  const [baseline, setBaseline] = useState<LocationDraftFields>(() =>
    emptyLocationDraft(false),
  );
  const { messages, setMessages, input, setInput } = useCoworkerThread();
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    void fetchLocationFormOptions(companyId)
      .then((opts) => {
        if (cancelled || !opts.ok) return;
        setCompanyName(opts.companyName);
        setHasHq(opts.hasHq);
        const initial = emptyLocationDraft(opts.hasHq);
        setDraft(initial);
        setBaseline(initial);
        setMessages((prev) =>
          withModuleWelcome(
            prev,
            formOnly
              ? `Fill in the form to add a location for **${opts.companyName}**.`
              : `Happy to help add a location for **${opts.companyName}** — I'll ask for details one at a time. Progress shows on the right.`,
          ),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, formOnly]);

  const chatDirty = useCoworkerChatDirty();
  const dirty = isDraftDirty(draft, baseline) || chatDirty;

  const applyPatch = useCallback((patch: Partial<LocationDraftFields>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  const onRestart = () => {
    const reset = emptyLocationDraft(hasHq);
    setDraft(reset);
    setBaseline(reset);
    sessionMemory.clear();
    setInput("");
    setMessages([
      {
        id: "welcome",
        role: "assistant",
        text: formOnly
          ? "Fresh start. Fill the form on the right."
          : "Fresh start. Describe the location — I'll update the setup panel as we go.",
      },
    ]);
  };

  const onSend = async (
    overrideText?: string,
    opts?: { displayText?: string },
  ) => {
    const text = (overrideText ?? input).trim();
    if (!text || sending || !companyId) return;
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
      const result = await assistLocationDraft({
        messages: [
          ...messages.map((m) => ({ role: m.role, text: m.text })),
          { role: "user" as const, text },
        ],
        draft,
        companyId,
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
      if (result.patch) applyPatch(result.patch);
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
    ready: !loading && Boolean(companyId),
    sendText: (text, opts) => onSend(text, opts),
  });

  if (!companyId) {
    return (
      <div className="p-8 text-center text-sm text-text-caption">
        Missing company.
      </div>
    );
  }

  const draftPanel = (
    <LocationCreateDraftPanel
      companyId={companyId}
      draft={draft}
      onDraftChange={setDraft}
      hasHq={hasHq}
      mode={formOnly ? "form" : "guided"}
      onCreated={(locationId) => {
        setBaseline(draft);
        navigate(`/company/${companyId}`, { replace: true });
        void locationId;
      }}
    />
  );

  return (
    <CoworkerCreateShell
      title={`New location · ${companyName || "Company"}`}
      subtitle="Co-worker + guided setup"
      backHref={`/company/${companyId}`}
      formOnly={formOnly}
      hybridHref={`/company/${companyId}/locations/new`}
      quickFormHref={`/company/${companyId}/locations/new?form=1`}
      welcomeLoading={loading}
      messages={messages}
      input={input}
      onInputChange={setInput}
      onSend={() => void onSend()}
      onRestart={onRestart}
      sending={sending}
      draftPanel={draftPanel}
      dirty={dirty}
      composerPlaceholder="e.g. Add a branch in Bengaluru at Whitefield"
    />
  );
}
