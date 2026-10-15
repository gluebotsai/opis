import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CoworkerCreateShell } from "@/components/coworker/CoworkerCreateShell";
import {
  emptyProductDraft,
  ProductCreateDraftPanel,
} from "@/components/products/ProductCreateDraftPanel";
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
  assistProductDraft,
  type ProductDraftFields,
} from "@/services/coworker";

export function ProductCreateCoworkerPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const formOnly = searchParams.get("form") === "1";
  const sessionMemory = useDraftSessionMemory("product-create");
  const [draft, setDraft] = useState<ProductDraftFields>(() =>
    hydrateDraftFromMemory(
      emptyProductDraft(),
      sessionMemory.memoryRef.current,
      "productDraft",
    ),
  );
  const [baseline, setBaseline] = useState<ProductDraftFields>(emptyProductDraft);
  const { messages, setMessages, input, setInput } = useCoworkerThread();
  const [sending, setSending] = useState(false);
  const welcome = formOnly
    ? "Fill in the form on the right, or ask me in chat to fill fields for you."
    : "Happy to help create a product — I'll ask for details one at a time. Progress shows on the right.";

  useEffect(() => {
    setMessages((prev) => withModuleWelcome(prev, welcome));
  }, [setMessages, welcome]);

  const chatDirty = useCoworkerChatDirty();
  const dirty = isDraftDirty(draft, baseline) || chatDirty;

  const applyPatch = useCallback((patch: Partial<ProductDraftFields>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  const onRestart = () => {
    setMessages([
      {
        id: "welcome",
        role: "assistant",
        text: formOnly
          ? "Fresh start. Fill the form on the right."
          : "Fresh start. Describe the product — I'll update the setup panel as we go.",
      },
    ]);
    setInput("");
    const reset = emptyProductDraft();
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
      const result = await assistProductDraft({
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
    ready: true,
    sendText: (text, opts) => onSend(text, opts),
  });

  const draftPanel = (
    <ProductCreateDraftPanel
      draft={draft}
      onDraftChange={setDraft}
      mode={formOnly ? "form" : "guided"}
      onCreated={(productId) => {
        setBaseline(draft);
        navigate(`/product?highlight=${encodeURIComponent(productId)}`, {
          replace: true,
        });
      }}
    />
  );

  return (
    <CoworkerCreateShell
      title="New product"
      subtitle="Co-worker + guided setup"
      backHref="/product"
      formOnly={formOnly}
      hybridHref="/product/new"
      quickFormHref="/product/new?form=1"
      messages={messages}
      input={input}
      onInputChange={setInput}
      onSend={() => void onSend()}
      onRestart={onRestart}
      sending={sending}
      draftPanel={draftPanel}
      dirty={dirty}
      composerPlaceholder="e.g. Create Pro Plan, SKU PRO-1, price $99, recurring"
    />
  );
}
