import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useCreateHighlight } from "@/hooks/useCreateHighlight";
import {
  hydrateDraftFromMemory,
  readDraftSessionMemory,
} from "@/lib/coworker/use-draft-session-memory";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";
import { MODULE_WORKSPACE_DESCRIPTION } from "@/lib/module-workspace-copy";
import {
  QuoteCreateDraftPanel,
  emptyQuoteDraft,
} from "@/components/sales/QuoteCreateDraftPanel";
import {
  type AgentToolProposal,
  type QuoteDraftFields,
} from "@/services/coworker";
import {
  CREATE_HIGHLIGHT_ROW_CLASS,
  SUCCESS_FLASH_CLASS,
} from "@/lib/ui-tones";
import {
  acceptQuote,
  fetchQuotesPage,
  rejectQuote,
  sendQuote,
  type QuoteListItem,
} from "@/services/quotes";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  rejected: "Rejected",
  void: "Void",
};

export function QuotesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const workspaceMode =
    searchParams.get("view") === "create" ? "create" : "list";

  const [items, setItems] = useState<QuoteListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [createDraft, setCreateDraft] = useState<QuoteDraftFields>(() =>
    hydrateDraftFromMemory(
      emptyQuoteDraft(),
      readDraftSessionMemory("shell:quotes"),
      "quoteDraft",
    ),
  );
  const draftPatchRef = useRef<
    ((patch: Partial<QuoteDraftFields>) => void) | null
  >(null);
  const draftSubmitRef = useRef<(() => Promise<true | string>) | null>(null);

  const { createdToast, isHighlighted } = useCreateHighlight();

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const quotes = await fetchQuotesPage({ page: 1 });
      setItems(quotes.items);
    } catch {
      setError("Failed to load quotes.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setWorkspace = useCallback(
    (mode: "list" | "create", opts?: { form?: boolean }) => {
      const next = new URLSearchParams(searchParams);
      if (mode === "create") {
        next.set("view", "create");
        if (opts?.form) next.set("form", "1");
        else next.delete("form");
      } else {
        next.delete("view");
        next.delete("form");
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const createPanelMode =
    searchParams.get("form") === "1" ? "form" : "guided";

  const onDraftPatch = useCallback(
    (patch: Partial<QuoteDraftFields>) => {
      if (draftPatchRef.current) {
        draftPatchRef.current(patch);
      } else {
        setCreateDraft((prev) => ({ ...prev, ...patch }));
      }
      if (
        workspaceMode === "list" &&
        typeof patch.dealId === "string" &&
        patch.dealId.trim()
      ) {
        setWorkspace("create");
      }
    },
    [workspaceMode, setWorkspace],
  );

  const onWorkspaceCommand = useCallback(
    (tool: AgentToolProposal) => {
      if (tool.name !== "set_workspace") return false;
      const mode = String(tool.args.mode || "");
      if (mode !== "list" && mode !== "create") return false;
      const next = new URLSearchParams(searchParams);
      if (mode === "create") {
        if (workspaceMode !== "create") {
          setCreateDraft(emptyQuoteDraft());
        }
        next.set("view", "create");
        next.delete("form");
      } else {
        next.delete("view");
        next.delete("form");
        const search = tool.args.search;
        if (typeof search === "string" && search.trim()) {
          next.set("q", search.trim());
        }
        const entityId = tool.args.entityId;
        if (typeof entityId === "string" && entityId.trim()) {
          next.set("highlight", entityId.trim());
        }
      }
      setSearchParams(next, { replace: true });
      return true;
    },
    [searchParams, setSearchParams, workspaceMode],
  );

  const run = async (
    fn: () => Promise<{ ok: boolean; error?: string; warning?: string }>,
  ) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await fn();
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Action failed.");
      return;
    }
    if (result.warning) setMessage(result.warning);
    await reload();
  };

  const listWorkspace = (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      {error ? <p className="text-sm text-text-danger">{error}</p> : null}
      {message ? <p className="mt-3 text-sm text-text-secondary">{message}</p> : null}
      {createdToast ? (
        <p
          className={`mt-3 ${SUCCESS_FLASH_CLASS}`}
          role="status"
        >
          Quote created — it's highlighted below.
        </p>
      ) : null}

      <div className="mt-5 overflow-hidden rounded-xl border border-border-default bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border-default bg-subtle text-text-caption">
            <tr>
              <th className="px-4 py-3 font-medium">Number</th>
              <th className="px-4 py-3 font-medium">Deal</th>
              <th className="px-4 py-3 font-medium">Total</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="px-4 py-8 text-text-caption" colSpan={5}>
                  Loading…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td className="px-4 py-8 text-text-caption" colSpan={5}>
                  No quotes yet.
                </td>
              </tr>
            ) : (
              items.map((q) => (
                <tr
                  key={q.id}
                  data-highlight-id={q.id}
                  className={`border-t border-border-default ${
                    isHighlighted(q.id) ? CREATE_HIGHLIGHT_ROW_CLASS : ""
                  }`}
                >
                  <td className="px-4 py-3 font-medium text-text-primary">
                    <Link
                      to={`/sales/quotes/${q.id}`}
                      className="text-brand underline"
                    >
                      {q.number}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/sales/${q.dealId}`}
                      className="text-brand underline"
                    >
                      {q.dealTitle}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {q.currency} {q.total}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {STATUS_LABEL[q.status] ?? q.status}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {q.status === "draft" ? (
                        <button
                          type="button"
                          className="text-xs underline"
                          disabled={
                            busy ||
                            q.approvalStatus === "pending_finance_approval" ||
                            q.approvalStatus === "finance_rejected"
                          }
                          title={
                            q.approvalStatus === "pending_finance_approval"
                              ? "Waiting for Finance discount approval"
                              : q.approvalStatus === "finance_rejected"
                                ? "Finance rejected — revise before send"
                                : undefined
                          }
                          onClick={() => void run(() => sendQuote(q.id))}
                        >
                          Send
                        </button>
                      ) : null}
                      {q.status === "sent" ? (
                        <>
                          <button
                            type="button"
                            className="text-xs underline"
                            disabled={busy}
                            onClick={() => void run(() => acceptQuote(q.id))}
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            className="text-xs underline"
                            disabled={busy}
                            onClick={() => void run(() => rejectQuote(q.id))}
                          >
                            Reject
                          </button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const workspace =
    workspaceMode === "create" ? (
      <QuoteCreateDraftPanel
        draft={createDraft}
        onDraftChange={setCreateDraft}
        patchRef={draftPatchRef}
        submitRef={draftSubmitRef}
        mode={createPanelMode}
        onCancel={() => setWorkspace("list")}
        onCreated={(quoteId) => {
          setCreateDraft(emptyQuoteDraft());
          navigate(`/sales/quotes/${quoteId}`, { replace: true });
        }}
      />
    ) : (
      listWorkspace
    );

  return (
    <AgentModuleShell
      moduleId="quotes"
      title="Quotes"
      welcome="Happy to help with quotes — we can draft one together or review what's pending on the right."
      chips={[
        {
          id: "chip-new-quote",
          label: "Draft a new quote",
          prompt: "Help me draft a new quote",
        },
        {
          id: "chip-show-list",
          label: "Show quotes",
          prompt: "Show list",
        },
      ]}
      surface={workspaceMode}
      workspaceMode={workspaceMode}
      draft={workspaceMode === "create" ? createDraft : null}
      workspaceTitle="Quotes"
      workspaceSubtitle={
        workspaceMode === "list"
          ? MODULE_WORKSPACE_DESCRIPTION.quotes
          : undefined
      }
      workspaceHeaderActions={
        workspaceMode === "list" ? (
          <Button
            type="button"
            onClick={() => {
              setCreateDraft(emptyQuoteDraft());
              setWorkspace("create", { form: true });
            }}
          >
            <Plus className="size-4" strokeWidth={1.75} />
            New quote
          </Button>
        ) : undefined
      }
      workspace={workspace}
      onWorkspaceCommand={onWorkspaceCommand}
      onDraftPatch={(patch) => onDraftPatch(patch as Partial<QuoteDraftFields>)}
      onToolConfirm={async (tool) => {
        if (tool.name === "propose_create_proposal") {
          // AgentModuleShell handles this (requirement PDF from chat attach).
          return false;
        }
        if (tool.name === "propose_create_quote") {
          let submit = draftSubmitRef.current;
          if (!submit) {
            await new Promise<void>((r) => requestAnimationFrame(() => r()));
            submit = draftSubmitRef.current;
          }
          if (!submit) {
            return "Create form isn't ready yet — try again in a moment, or tap Create quote on the right.";
          }
          const result = await submit();
          if (result === true) return true;
          return result;
        }
        return false;
      }}
      onAfterTool={() => void reload()}
    />
  );
}
