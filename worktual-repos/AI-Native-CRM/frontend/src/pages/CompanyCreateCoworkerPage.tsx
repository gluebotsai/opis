import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  CompanyCreateDraftPanel,
  emptyCompanyDraft,
} from "@/components/companies/CompanyCreateDraftPanel";
import { CoworkerCreateShell } from "@/components/coworker/CoworkerCreateShell";
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
import { followCreateShellTools } from "@/lib/coworker/follow-create-shell-tools";
import {
  clearDraftSessionMemory,
  hydrateDraftFromMemory,
  useDraftSessionMemory,
} from "@/lib/coworker/use-draft-session-memory";
import {
  COWORKER_LLM_ERROR_SPEECH,
  draftReadyClientForModule,
  shouldPersistCompanyDraftClient,
} from "@/lib/coworker/sanitize-assistant-text";
import {
  assistCompanyDraft,
  type CompanyDraftFields,
} from "@/services/coworker";
import { fetchCompanyFormOptions } from "@/services/companies";

function withCompanyFields(
  base: CompanyDraftFields,
  ...layers: Array<Partial<CompanyDraftFields> | null | undefined>
): CompanyDraftFields {
  const next = { ...base };
  for (const layer of layers) {
    if (!layer) continue;
    (Object.keys(next) as (keyof CompanyDraftFields)[]).forEach((key) => {
      const val = layer[key];
      if (typeof val === "string" && val.trim()) {
        next[key] = val as never;
      }
    });
  }
  return next;
}

export function CompanyCreateCoworkerPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const formOnly = searchParams.get("form") === "1";

  const [loading, setLoading] = useState(true);
  const sessionMemory = useDraftSessionMemory("company-create");
  const [draft, setDraft] = useState<CompanyDraftFields>(() =>
    hydrateDraftFromMemory(
      emptyCompanyDraft(),
      sessionMemory.memoryRef.current,
      "companyDraft",
    ),
  );
  const [baseline, setBaseline] = useState<CompanyDraftFields>(emptyCompanyDraft);
  const { messages, setMessages, input, setInput } = useCoworkerThread();
  const [sending, setSending] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const draftSubmitRef = useRef<(() => Promise<true | string>) | null>(null);
  const pendingDuplicateIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchCompanyFormOptions()
      .then((opts) => {
        if (cancelled || !opts.ok) return;
        setMessages((prev) =>
          withModuleWelcome(
            prev,
            formOnly
              ? "Fill in the form on the right, or switch to co-worker for a guided chat."
              : "Happy to help create a company — I'll ask for details one at a time. Progress shows on the right.",
          ),
        );
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const chatDirty = useCoworkerChatDirty();
  const dirty = isDraftDirty(draft, baseline) || chatDirty;

  const applyPatch = useCallback((patch: Partial<CompanyDraftFields>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  const onRestart = () => {
    setMessages([
      {
        id: "welcome",
        role: "assistant",
        text: "Fresh start. Describe the company and its first location, or fill the draft on the right.",
      },
    ]);
    setInput("");
    const reset = emptyCompanyDraft();
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
      const remembered = hydrateDraftFromMemory(
        emptyCompanyDraft(),
        sessionMemory.memoryRef.current,
        "companyDraft",
      );
      const before = withCompanyFields(remembered, draftRef.current);
      const result = await assistCompanyDraft({
        messages: [
          ...messages.map((m) => ({ role: m.role, text: m.text })),
          { role: "user" as const, text },
        ],
        draft: before,
        sessionMemory: sessionMemory.memoryRef.current,
      });
      if (result.ok) {
        sessionMemory.apply(result.sessionMemoryPatch ?? null);
      }
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
      const merged = withCompanyFields(before, result.patch);
      const shouldCreate =
        draftReadyClientForModule("company", merged) &&
        (result.toolProposals?.some((t) => t.name === "propose_create_company") ||
          shouldPersistCompanyDraftClient(text, before, merged));
      if (shouldCreate) {
        flushSync(() => {
          draftRef.current = merged;
          setDraft(merged);
        });
      } else if (result.patch) {
        flushSync(() => {
          applyPatch(result.patch!);
        });
      }
      if (!shouldCreate) {
        const leftPage = followCreateShellTools({
          tools: result.toolProposals,
          navigate,
          seedFallback: text,
        });
        if (leftPage) return;
      }

      if (shouldCreate) {
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        const submit = draftSubmitRef.current;
        if (!submit) {
          setMessages((p) => [
            ...p,
            {
              id: newCoworkerMessageId(),
              role: "assistant",
              text: "Create form isn't ready yet — try again in a moment.",
            },
          ]);
          return;
        }
        const created = await submit();
        if (created !== true) {
          const existingId = pendingDuplicateIdRef.current;
          pendingDuplicateIdRef.current = null;
          if (existingId) {
            const name = draftRef.current.name.trim() || "That company";
            setMessages((p) => [
              ...p,
              {
                id: newCoworkerMessageId(),
                role: "assistant",
                text: `**${name}** already exists — I've opened that record instead of creating a duplicate.`,
              },
            ]);
            navigate(`/company/${existingId}`);
            return;
          }
          setMessages((p) => [
            ...p,
            {
              id: newCoworkerMessageId(),
              role: "assistant",
              text:
                typeof created === "string"
                  ? created
                  : "Couldn't save the company yet — check the draft and try again.",
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
    sendText: (prompt, opts) => onSend(prompt, opts),
  });

  const draftPanel = (
    <CompanyCreateDraftPanel
      draft={draft}
      onDraftChange={(next) => {
        draftRef.current = next;
        setDraft(next);
      }}
      submitRef={draftSubmitRef}
      onDuplicate={(existingId) => {
        pendingDuplicateIdRef.current = existingId;
      }}
      mode={formOnly ? "form" : "guided"}
      onCreated={(companyId) => {
        setBaseline(draft);
        sessionMemory.clear();
        clearDraftSessionMemory("shell:company");
        navigate(`/company?highlight=${encodeURIComponent(companyId)}`, {
          replace: true,
        });
      }}
    />
  );

  return (
    <CoworkerCreateShell
      title="New company"
      subtitle="Co-worker + guided setup"
      backHref="/company"
      formOnly={formOnly}
      hybridHref="/company/new"
      quickFormHref="/company/new?form=1"
      welcomeLoading={loading}
      messages={messages}
      input={input}
      onInputChange={setInput}
      onSend={() => void onSend()}
      onRestart={onRestart}
      sending={sending}
      draftPanel={draftPanel}
      dirty={dirty}
      composerPlaceholder="e.g. Create Acme Corp, HQ in Mumbai, software industry"
    />
  );
}
