import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CoworkerCreateShell } from "@/components/coworker/CoworkerCreateShell";
import {
  QuoteCreateDraftPanel,
  emptyQuoteDraft,
} from "@/components/sales/QuoteCreateDraftPanel";
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
import { buildCreateHandoffHref } from "@/lib/coworker/create-handoff";
import { followCreateShellTools } from "@/lib/coworker/follow-create-shell-tools";
import { looksLikeCreateProposalIntent } from "@/lib/coworker/proposal-intent";
import { useCoworkerSeedPrompt } from "@/lib/coworker/useCoworkerSeedPrompt";
import {
  hydrateDraftFromMemory,
  useDraftSessionMemory,
} from "@/lib/coworker/use-draft-session-memory";
import { COWORKER_LLM_ERROR_SPEECH } from "@/lib/coworker/sanitize-assistant-text";
import {
  assistAgentTurn,
  type AgentToolProposal,
  type QuoteDraftFields,
} from "@/services/coworker";
import { createProposal } from "@/services/sales";

const NAV_ALIASES: Record<string, string> = {
  "/quotes": "/sales/quotes",
  "/quote": "/sales/quotes",
  "/deals": "/sales",
  "/pipeline": "/sales",
};

function normalizeNavHref(href: string): string | null {
  const raw = (href || "").trim();
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  const pathOnly = raw.split("?")[0]?.split("#")[0] || "/";
  const query = raw.includes("?") ? raw.slice(raw.indexOf("?")) : "";
  const path = NAV_ALIASES[pathOnly] ?? pathOnly;
  return `${path}${query}`;
}

function toolHref(tool: AgentToolProposal, seedFallback?: string): string | null {
  const raw = String(tool.args.href || "");
  const normalized = normalizeNavHref(raw);
  if (!normalized) return null;
  const seed =
    (typeof tool.args.seedPrompt === "string" && tool.args.seedPrompt.trim()) ||
    seedFallback?.trim() ||
    "";
  if (!seed) return normalized;
  const path = normalized.split("?")[0] ?? normalized;
  if (path === "/sales/quotes/new") {
    return buildCreateHandoffHref(path, seed);
  }
  const params = new URLSearchParams(
    normalized.includes("?") ? normalized.slice(normalized.indexOf("?") + 1) : "",
  );
  params.set("prompt", seed.slice(0, 2000));
  return `${path}?${params.toString()}`;
}

export function QuoteCreateCoworkerPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const formOnly = searchParams.get("form") === "1";
  const dealIdParam = searchParams.get("dealId") ?? "";

  const sessionMemory = useDraftSessionMemory("quote-create");
  const [draft, setDraft] = useState<QuoteDraftFields>(() =>
    hydrateDraftFromMemory(
      emptyQuoteDraft(),
      sessionMemory.memoryRef.current,
      "quoteDraft",
    ),
  );
  const [baseline, setBaseline] = useState<QuoteDraftFields>(emptyQuoteDraft);
  const { messages, setMessages, input, setInput } = useCoworkerThread();
  const [sending, setSending] = useState(false);
  const [ready, setReady] = useState(false);
  const patchRef = useRef<
    ((patch: Partial<QuoteDraftFields>) => void) | null
  >(null);
  const submitRef = useRef<(() => Promise<true | string>) | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    setMessages((prev) =>
      withModuleWelcome(
        prev,
        formOnly
          ? "Fill in the form on the right, or switch to co-worker for a guided chat."
          : "Happy to help draft a quote — I'll ask for details one at a time. Progress shows on the right.",
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
        text: "Fresh start. Tell me the deal and product — or edit the draft on the right.",
      },
    ]);
    setInput("");
    sessionMemory.clear();
    const reset = emptyQuoteDraft();
    setDraft(reset);
    setBaseline(reset);
    patchRef.current?.(reset);
  };

  const runTool = useCallback(
    async (tool: AgentToolProposal, seedFallback?: string) => {
      if (tool.name === "navigate" || tool.name === "open_entity") {
        const href = toolHref(tool, seedFallback);
        if (!href) return;
        const nextPath = href.split("?")[0] ?? href;
        // Already on quote create — don't no-op-navigate and loop "Taking you there".
        if (
          nextPath === "/sales/quotes/new" &&
          window.location.pathname.startsWith("/sales/quotes/new")
        ) {
          return;
        }
        navigate(href);
        return;
      }
      if (tool.name === "set_workspace") {
        if (
          followCreateShellTools({
            tools: [tool],
            navigate,
            seedFallback: seedFallback,
          })
        ) {
          return;
        }
        const mode = String(tool.args.mode || "");
        if (mode === "list") {
          navigate("/sales/quotes");
          return;
        }
        // create on this page — stay; seed handled by chat.
        return;
      }
      if (tool.name === "propose_create_proposal") {
        const dealId = String(tool.args.dealId || "").trim();
        if (!dealId) {
          setMessages((p) => [
            ...p,
            {
              id: newCoworkerMessageId(),
              role: "assistant",
              text: "Which deal should this proposal attach to?",
            },
          ]);
          return;
        }
        const title =
          typeof tool.args.title === "string" && tool.args.title.trim()
            ? tool.args.title.trim()
            : undefined;
        const productHint =
          typeof tool.args.productHint === "string" &&
          tool.args.productHint.trim()
            ? tool.args.productHint.trim()
            : undefined;
        const productIds = Array.isArray(tool.args.productIds)
          ? tool.args.productIds.filter(
              (id): id is string => typeof id === "string" && Boolean(id.trim()),
            )
          : undefined;
        try {
          const result = await createProposal({
            dealId,
            fromTemplate: true,
            ...(title ? { title } : {}),
            ...(productHint ? { productHint } : {}),
            ...(productIds?.length ? { productIds } : {}),
          });
          if (!result.ok) {
            setMessages((p) => [
              ...p,
              {
                id: newCoworkerMessageId(),
                role: "assistant",
                text: result.error || "I couldn't create the proposal yet.",
              },
            ]);
            return;
          }
          const warn = result.warnings?.length
            ? `?warn=${encodeURIComponent(result.warnings.join(" "))}`
            : "";
          navigate(`/sales/proposals/${result.id}${warn}`);
        } catch {
          setMessages((p) => [
            ...p,
            {
              id: newCoworkerMessageId(),
              role: "assistant",
              text: "I couldn't create the proposal yet — try again in a moment.",
            },
          ]);
        }
        return;
      }
      if (tool.name === "propose_create_quote") {
        let submit = submitRef.current;
        if (!submit) {
          await new Promise<void>((r) => requestAnimationFrame(() => r()));
          submit = submitRef.current;
        }
        if (!submit) {
          setMessages((p) => [
            ...p,
            {
              id: newCoworkerMessageId(),
              role: "assistant",
              text: "The quote form isn't ready yet — finish deal and product, then tell me to save.",
            },
          ]);
          return;
        }
        const result = await submit();
        if (result === true) {
          setMessages((p) => [
            ...p,
            {
              id: newCoworkerMessageId(),
              role: "assistant",
              text: "All set — quote created.",
            },
          ]);
          return;
        }
        if (result && result !== "cancelled") {
          setMessages((p) => [
            ...p,
            {
              id: newCoworkerMessageId(),
              role: "assistant",
              text: result,
            },
          ]);
        }
      }
    },
    [navigate],
  );

  const onSend = async (
    overrideText?: string,
    opts?: { displayText?: string },
  ) => {
    const text = (overrideText ?? input).trim();
    if (!text || sending) return;
    if (!overrideText) setInput("");
    const visible = opts?.displayText?.trim() || text;

    if (looksLikeCreateProposalIntent(text)) {
      navigate(buildCreateHandoffHref("/sales", text));
      return;
    }

    const nextMessages = nextThreadWithUser(
      messages,
      visible,
      newCoworkerMessageId(),
    );
    setMessages(nextMessages);
    setSending(true);
    try {
      const result = await assistAgentTurn({
        messages: [
          ...messages.map((m) => ({ role: m.role, text: m.text })),
          { role: "user" as const, text },
        ],
        context: {
          module: "quotes",
          surface: "create",
          pathname: "/sales/quotes/new",
          draft: draftRef.current as unknown as Record<string, unknown>,
        },
        sessionMemory: sessionMemory.memoryRef.current,
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
      sessionMemory.apply(result.sessionMemoryPatch ?? null);
      const patch =
        (result as { patch?: Partial<QuoteDraftFields> }).patch ??
        undefined;
      if (patch) patchRef.current?.(patch);

      setMessages((p) => [
        ...p,
        {
          id: newCoworkerMessageId(),
          role: "assistant",
          text: result.assistantText || COWORKER_LLM_ERROR_SPEECH,
        },
      ]);

      const tools = result.toolProposals ?? [];
      const silent = tools.filter(
        (t) =>
          t.args?.auto === true ||
          t.args?.auto === "true" ||
          t.name === "navigate" ||
          t.name === "open_entity" ||
          t.name === "set_workspace" ||
          t.name === "propose_create_proposal" ||
          (t.name === "propose_create_quote" && t.args?.auto === true),
      );
      for (const tool of silent) {
        await runTool(tool, text);
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

  const onDraftChange = useCallback((next: QuoteDraftFields) => {
    setDraft(next);
  }, []);

  const draftPanel = (
    <QuoteCreateDraftPanel
      draft={draft}
      onDraftChange={onDraftChange}
      initialDealId={dealIdParam}
      patchRef={patchRef}
      submitRef={submitRef}
      mode={formOnly ? "form" : "guided"}
      onCreated={(quoteId) => {
        setBaseline(draft);
        navigate(`/sales/quotes/${encodeURIComponent(quoteId)}`, {
          replace: true,
        });
      }}
    />
  );

  return (
    <CoworkerCreateShell
      title="New quote"
      subtitle="Co-worker + guided setup"
      backHref="/sales/quotes"
      formOnly={formOnly}
      hybridHref="/sales/quotes/new"
      quickFormHref="/sales/quotes/new?form=1"
      welcomeLoading={!ready}
      messages={messages}
      input={input}
      onInputChange={setInput}
      onSend={() => void onSend()}
      onRestart={onRestart}
      sending={sending}
      draftPanel={draftPanel}
      dirty={dirty}
      composerPlaceholder="e.g. Quote CCaaS Starter with 5% discount"
    />
  );
}
