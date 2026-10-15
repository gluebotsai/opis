import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CoworkerCreateShell } from "@/components/coworker/CoworkerCreateShell";
import {
  DealCreateDraftPanel,
  emptyDealDraft,
} from "@/components/sales/DealCreateDraftPanel";
import { Button } from "@/components/ui/Button";
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
import { readHandoffContact } from "@/lib/coworker/create-handoff";
import { humanLabel, looksLikeBareId } from "@/lib/coworker/human-name";
import { useCoworkerSeedPrompt } from "@/lib/coworker/useCoworkerSeedPrompt";
import { assistDealDraft, type DealDraftFields } from "@/services/coworker";
import { fetchContactDetail } from "@/services/contacts";
import { fetchCompanyLocations } from "@/services/companies";
import {
  fetchDealFormOptions,
  type DealFormOptions,
} from "@/services/sales";

function withoutBareCompany(draft: DealDraftFields): DealDraftFields {
  if (!looksLikeBareId(draft.companyName)) return draft;
  return { ...draft, companyName: "", companyId: "", locationId: "" };
}

export function DealCreateCoworkerPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const formOnly = searchParams.get("form") === "1";

  const [loading, setLoading] = useState(true);
  const [options, setOptions] = useState<DealFormOptions | null>(null);
  const sessionMemory = useDraftSessionMemory("deal-create");
  const [draft, setDraft] = useState<DealDraftFields>(() =>
    withoutBareCompany(
      hydrateDraftFromMemory(
        emptyDealDraft(),
        sessionMemory.memoryRef.current,
        "dealDraft",
      ),
    ),
  );
  const [baseline, setBaseline] = useState<DealDraftFields>(() =>
    emptyDealDraft(),
  );
  const { messages, setMessages, input, setInput } = useCoworkerThread();
  const [sending, setSending] = useState(false);
  const draftSubmitRef = useRef<(() => Promise<true | string>) | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchDealFormOptions()
      .then((opts) => {
        if (cancelled) return;
        setOptions(opts);
        setMessages((prev) =>
          withModuleWelcome(
            prev,
            formOnly
              ? "Fill in the form on the right, or switch to co-worker for a guided chat."
              : "Happy to help create a deal — I'll ask for details one at a time. Progress shows on the right.",
          ),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [formOnly]);

  const companies = options?.companies ?? [];
  const chatDirty = useCoworkerChatDirty();
  const dirty = isDraftDirty(draft, baseline) || chatDirty;

  const applyPatch = useCallback((patch: Partial<DealDraftFields>) => {
    setDraft((prev) => {
      const next = { ...prev, ...patch };
      if (looksLikeBareId(next.companyName)) {
        const kept = humanLabel(prev.companyName);
        next.companyName = kept || "";
        if (!kept) {
          next.companyId = "";
          next.locationId = "";
        }
      }
      return next;
    });
  }, []);

  const sourceContactRef = useRef<string | null>(null);
  const urlContact = searchParams.get("fromContact")?.trim() || "";
  if (urlContact) sourceContactRef.current = urlContact;
  else if (searchParams.get("prompt") && !sourceContactRef.current) {
    sourceContactRef.current = readHandoffContact();
  }
  const fromContact = sourceContactRef.current;

  useEffect(() => {
    if (!fromContact) return;
    let cancelled = false;
    void fetchContactDetail(fromContact)
      .then(async (result) => {
        if (cancelled || !result.ok) return;
        const company = result.contact.person.company;
        const name = humanLabel(company?.name);
        if (!name || !company?.id) return;
        let locationId = result.contact.person.locationId || "";
        if (!locationId) {
          const locs = await fetchCompanyLocations(company.id).catch(() => null);
          if (locs && locs.ok) {
            locationId =
              locs.locations.find((location) => location.type === "hq")?.id ||
              locs.locations[0]?.id ||
              "";
          }
        }
        if (cancelled) return;
        const next = {
          companyId: company.id,
          companyName: name,
          locationId,
          contactId: result.contact.id,
          contactName: humanLabel(result.contact.displayName) || "",
        };
        setDraft((prev) =>
          humanLabel(prev.companyName) ? prev : { ...prev, ...next },
        );
        setBaseline((prev) =>
          humanLabel(prev.companyName) ? prev : { ...prev, ...next },
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [fromContact]);

  const onRestart = () => {
    const reset = emptyDealDraft();
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
          : "Fresh start. Describe the deal — I'll update the setup panel as we go.",
      },
    ]);
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
      const result = await assistDealDraft({
        messages: [
          ...messages.map((m) => ({ role: m.role, text: m.text })),
          { role: "user" as const, text },
        ],
        draft,
        sessionMemory: sessionMemory.memoryRef.current,
        sourceContactId: fromContact,
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
      const shouldCreate = result.toolProposals?.some(
        (t) => t.name === "propose_create_deal",
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
              text: "The deal form isn't ready yet — check the draft and tell me to save again.",
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
                typeof created === "string" && created.trim() && created !== "cancelled"
                  ? created
                  : "I couldn't save the deal yet — check the draft and tell me to save again.",
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

  if (!loading && companies.length === 0) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-sm font-medium text-text-primary">
          Add a company before creating deals
        </p>
        <p className="mt-2 text-sm text-text-caption">
          Create a company and location first, then add deals.
        </p>
        <Button
          type="button"
          variant="primary"
          className="mt-4"
          onClick={() => navigate("/company?view=create")}
        >
          Add company
        </Button>
      </div>
    );
  }

  const draftPanel = (
    <DealCreateDraftPanel
      draft={draft}
      onDraftChange={setDraft}
      submitRef={draftSubmitRef}
      mode={formOnly ? "form" : "guided"}
      onCreated={(dealId) => {
        setBaseline(draft);
        navigate(`/sales?highlight=${encodeURIComponent(dealId)}`, {
          replace: true,
        });
      }}
    />
  );

  return (
    <CoworkerCreateShell
      title="New deal"
      subtitle="Co-worker + guided setup"
      backHref="/sales"
      formOnly={formOnly}
      hybridHref="/sales/new"
      quickFormHref="/sales/new?form=1"
      welcomeLoading={loading}
      messages={messages}
      input={input}
      onInputChange={setInput}
      onSend={() => void onSend()}
      onRestart={onRestart}
      sending={sending}
      draftPanel={draftPanel}
      dirty={dirty}
      composerPlaceholder="e.g. Qualify deal for Acme, $50k, close this month"
    />
  );
}
