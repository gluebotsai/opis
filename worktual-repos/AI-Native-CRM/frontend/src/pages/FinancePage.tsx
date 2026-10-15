import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Receipt, Search } from "lucide-react";
import { emptyInvoiceDraft } from "@/components/finance/InvoiceCreateDraftPanel";
import { FinanceShell } from "@/components/finance/FinanceShell";
import { PendingDiscountApprovals } from "@/components/finance/PendingDiscountApprovals";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { DropdownSelect } from "@/components/ui/DropdownSelect";
import { InfiniteScrollSentinel } from "@/components/ui/InfiniteScrollSentinel";
import { useCreateHighlight } from "@/hooks/useCreateHighlight";
import {
  hydrateDraftFromMemory,
  readDraftSessionMemory,
} from "@/lib/coworker/use-draft-session-memory";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import {
  ESCALATION_SEVERITY_LABELS,
  escalationSeverityPillClass,
  formatInvoiceMoney,
  INVOICE_STATUS_LABELS,
  invoiceStatusPillClass,
} from "@/lib/invoice-labels";
import { canEditFinance, normalizeRole } from "@/lib/rbac";
import {
  fetchInvoiceBar,
  fetchInvoicesPage,
  approveInvoice,
  invoiceBlocksCustomerSend,
  invoiceIsApproved,
  markInvoicePaid,
  rejectInvoiceApproval,
  resendInvoice,
  resubmitInvoice,
  sendInvoiceEmail,
  voidInvoice,
  withdrawInvoiceApproval,
  type InvoiceBarItem,
  type InvoiceListItem,
  type InvoiceSummary,
} from "@/services/finance";
import { useAppSelector } from "@/store";
import { SkeletonText } from "@/components/skeleton/SkeletonText";
import { FinancePageSkeleton } from "./FinancePageSkeleton";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";
import { MODULE_WORKSPACE_DESCRIPTION } from "@/lib/module-workspace-copy";
import type {
  AgentToolProposal,
  InvoiceDraftFields,
} from "@/services/coworker";
import {
  CREATE_HIGHLIGHT_ROW_CLASS,
  SUCCESS_FLASH_CLASS,
} from "@/lib/ui-tones";

const SEARCH_DEBOUNCE_MS = 300;

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function FinancePage() {
  const navigate = useNavigate();
  const user = useAppSelector((s) => s.auth.user);
  const canEdit = canEditFinance(normalizeRole(user?.role));
  const [searchParams, setSearchParams] = useSearchParams();
  const workspaceMode =
    searchParams.get("view") === "create" ? "create" : "list";
  const initialSearch = searchParams.get("q") ?? "";
  const initialStatus = searchParams.get("status") ?? "all";

  const [createDraft, setCreateDraft] = useState<InvoiceDraftFields>(() =>
    hydrateDraftFromMemory(
      emptyInvoiceDraft(),
      readDraftSessionMemory("shell:finance"),
      "invoiceDraft",
    ),
  );

  const [bar, setBar] = useState<InvoiceBarItem[]>([]);
  const [items, setItems] = useState<InvoiceListItem[]>([]);
  const [summary, setSummary] = useState<InvoiceSummary>({
    outstanding: 0,
    openCount: 0,
    overdueCount: 0,
    collected: 0,
    currency: "USD",
  });
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [query, setQuery] = useState(initialSearch);
  const [appliedQuery, setAppliedQuery] = useState(initialSearch);
  const [status, setStatus] = useState(initialStatus);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [listModal, setListModal] = useState<
    | null
    | { kind: "reject"; invoice: InvoiceListItem }
    | { kind: "pay"; invoice: InvoiceListItem }
    | { kind: "void"; invoice: InvoiceListItem }
  >(null);
  const [modalReason, setModalReason] = useState("");
  const [payReference, setPayReference] = useState("");
  const [payMethod, setPayMethod] = useState<"offline" | "manual">("offline");
  const requestId = useRef(0);

  const { createdToast, isHighlighted } = useCreateHighlight();

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setAppliedQuery(query.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (appliedQuery) next.set("q", appliedQuery);
        else next.delete("q");
        if (status !== "all") next.set("status", status);
        else next.delete("status");
        return next;
      },
      { replace: true },
    );
  }, [appliedQuery, status, setSearchParams]);

  // Legacy ?view=create bookmarks → single invoice form.
  useEffect(() => {
    if (searchParams.get("view") === "create") {
      navigate("/finance/new", { replace: true });
    }
  }, [navigate, searchParams]);

  const onDraftPatch = useCallback(
    (patch: Partial<InvoiceDraftFields>) => {
      setCreateDraft((prev) => {
        const next = { ...prev, ...patch };
        if (
          workspaceMode === "list" &&
          typeof patch.dealId === "string" &&
          patch.dealId.trim()
        ) {
          const params = new URLSearchParams();
          if (next.dealId) params.set("dealId", next.dealId);
          if (next.currency) params.set("currency", next.currency);
          if (next.notes) params.set("notes", next.notes);
          if (next.paymentTerms) params.set("paymentTerms", next.paymentTerms);
          navigate(`/finance/new?${params.toString()}`);
        }
        return next;
      });
    },
    [navigate, workspaceMode],
  );

  const onWorkspaceCommand = useCallback(
    (tool: AgentToolProposal) => {
      if (tool.name !== "set_workspace") return false;
      const mode = String(tool.args.mode || "");
      if (mode !== "list" && mode !== "create") return false;
      if (mode === "create") {
        navigate("/finance/new");
        return true;
      }
      const next = new URLSearchParams(searchParams);
      next.delete("view");
      next.delete("form");
      const search = tool.args.search;
      if (typeof search === "string" && search.trim()) {
        setQuery(search.trim());
        setAppliedQuery(search.trim());
      }
      const entityId = tool.args.entityId;
      if (typeof entityId === "string" && entityId.trim()) {
        next.set("highlight", entityId.trim());
      }
      setSearchParams(next, { replace: true });
      return true;
    },
    [navigate, searchParams, setSearchParams],
  );

  const reload = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const [pageResult, barResult] = await Promise.all([
        fetchInvoicesPage({
          page: 1,
          search: appliedQuery,
          status,
        }),
        fetchInvoiceBar(),
      ]);
      if (id !== requestId.current) return;
      setItems(pageResult.items);
      setSummary(pageResult.summary);
      setPage(pageResult.pagination.page);
      setHasNext(pageResult.pagination.hasNext);
      setBar(barResult.items);
    } catch {
      if (id !== requestId.current) return;
      setError("Failed to load invoices.");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [appliedQuery, status]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const loadMore = useCallback(async () => {
    if (!hasNext || loading || loadingMore) return;
    const nextPage = page + 1;
    const id = ++requestId.current;
    setLoadingMore(true);
    try {
      const result = await fetchInvoicesPage({
        page: nextPage,
        search: appliedQuery,
        status,
      });
      if (id !== requestId.current) return;
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.id));
        return [...prev, ...result.items.filter((i) => !seen.has(i.id))];
      });
      setPage(result.pagination.page);
      setHasNext(result.pagination.hasNext);
      setSummary(result.summary);
    } catch {
      /* keep existing */
    } finally {
      setLoadingMore(false);
    }
  }, [hasNext, loading, loadingMore, page, appliedQuery, status]);

  const sentinelRef = useInfiniteScroll({
    hasMore: hasNext,
    loading: loading || loadingMore,
    onLoadMore: () => void loadMore(),
  });

  const runAction = async (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    successMessage?: string,
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
    if (successMessage) setMessage(successMessage);
    await reload();
  };

  const closeListModal = () => {
    setListModal(null);
    setModalReason("");
    setPayReference("");
    setPayMethod("offline");
  };

  const confirmListModal = async () => {
    if (!listModal) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    let result: { ok: boolean; error?: string };
    let successMessage = "";
    if (listModal.kind === "reject") {
      result = await rejectInvoiceApproval(listModal.invoice.id, modalReason);
      successMessage = `Invoice ${listModal.invoice.number} rejected.`;
    } else if (listModal.kind === "pay") {
      result = await markInvoicePaid(listModal.invoice.id, {
        paymentReference: payReference.trim() || undefined,
        paymentMethod: payMethod,
      });
      successMessage = `Invoice ${listModal.invoice.number} marked paid.`;
    } else {
      result = await voidInvoice(listModal.invoice.id, modalReason);
      successMessage = `Invoice ${listModal.invoice.number} voided.`;
    }
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Action failed.");
      return;
    }
    closeListModal();
    setMessage(successMessage);
    await reload();
  };

  const kpis = [
    {
      id: "outstanding",
      label: "Outstanding",
      value: formatInvoiceMoney(summary.outstanding, summary.currency),
      hint: "Unpaid invoices",
    },
    {
      id: "open",
      label: "Open",
      value: String(summary.openCount),
      hint: "Not paid or void",
    },
    {
      id: "overdue",
      label: "Overdue",
      value: String(summary.overdueCount),
      hint: "Past due date",
    },
    {
      id: "collected",
      label: "Collected",
      value: formatInvoiceMoney(summary.collected, summary.currency),
      hint: "Marked paid",
    },
  ];

  if (loading && items.length === 0 && workspaceMode === "list") {
    return (
      <AgentModuleShell
        moduleId="finance"
        title="Finance"
        welcome="I'm with you on finance — we can start an invoice together or check what's outstanding on the right."
        chips={[
          {
            id: "chip-new-invoice",
            label: "Create a new invoice",
            prompt: "Help me create a new invoice",
          },
          {
            id: "chip-show-list",
            label: "Show invoices",
            prompt: "Show list",
          },
        ]}
        surface="list"
        workspaceMode="list"
        workspace={<FinancePageSkeleton />}
      />
    );
  }

  const listWorkspace = (
    <FinanceShell
      invoices={bar}
      showNew={canEdit}
      createActive={false}
      onNewInvoice={
        canEdit ? () => navigate("/finance/new") : undefined
      }
    >
      <div className="crm-fade-in">
      {error ? (
        <p className="mb-4 text-sm text-text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="mb-4 text-sm text-text-secondary">{message}</p>
      ) : null}
      {createdToast ? (
        <p
          className={`mb-4 ${SUCCESS_FLASH_CLASS}`}
          role="status"
        >
          Invoice created — it's highlighted below.
        </p>
      ) : null}

      {canEdit ? <PendingDiscountApprovals /> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <div
            key={kpi.id}
            className="rounded-xl border border-border-default bg-surface p-4"
          >
            <p className="text-xs font-medium tracking-wide text-text-caption uppercase">
              {kpi.label}
            </p>
            <p className="mt-2 text-2xl font-semibold text-text-primary">
              {kpi.value}
            </p>
            <p className="mt-1 text-xs text-text-caption">{kpi.hint}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-3 rounded-xl border border-border-default bg-surface p-4 sm:grid-cols-[1fr_180px]">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search invoice # or company…"
          leftIcon={<Search className="size-4" strokeWidth={1.75} />}
          aria-label="Search invoices"
        />
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[
            { value: "all", label: "All statuses" },
            { value: "sent", label: "Sent" },
            { value: "overdue", label: "Overdue" },
            { value: "paid", label: "Paid" },
            { value: "draft", label: "Draft" },
            { value: "void", label: "Void" },
          ]}
          aria-label="Filter by status"
        />
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-border-default bg-surface">
        {items.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <span className="inline-flex size-12 items-center justify-center rounded-xl bg-subtle text-text-caption">
              <Receipt className="size-6" strokeWidth={1.5} />
            </span>
            <p className="mt-4 text-sm font-medium text-text-primary">
              No invoices found
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm text-text-caption">
              Create an invoice from a deal, or accept a quote in Sales. Clear
              filters if you expected results.
            </p>
            {canEdit ? (
              <Button
                type="button"
                variant="brand"
                className="mt-4"
                onClick={() => navigate("/finance/new")}
              >
                New invoice
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-border-default bg-subtle text-text-caption">
                <tr>
                  <th className="px-4 py-3 font-medium">Invoice</th>
                  <th className="px-4 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Deal</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Due</th>
                  <th className="px-4 py-3 font-medium">Total</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((inv) => (
                  <tr
                    key={inv.id}
                    data-highlight-id={inv.id}
                    className={`border-b border-border-default last:border-0 hover:bg-subtle/60 ${
                      isHighlighted(inv.id) ? CREATE_HIGHLIGHT_ROW_CLASS : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <Link
                        to={`/finance/${inv.id}`}
                        className="font-medium text-brand underline"
                      >
                        {inv.number}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {inv.companyId ? (
                        <Link
                          to={`/company/${inv.companyId}`}
                          className="text-brand underline"
                        >
                          {inv.companyName}
                        </Link>
                      ) : (
                        inv.companyName
                      )}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {inv.dealId ? (
                        <Link
                          to={`/sales/${inv.dealId}`}
                          className="text-brand underline"
                        >
                          {inv.dealTitle ?? "View deal"}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={invoiceStatusPillClass(inv.displayStatus)}
                        >
                          {INVOICE_STATUS_LABELS[inv.displayStatus] ??
                            inv.displayStatus}
                        </span>
                        {inv.escalationSeverity ? (
                          <span
                            className={escalationSeverityPillClass(
                              inv.escalationSeverity,
                            )}
                            title="Invoice Escalation Agent's collections-risk assessment"
                          >
                            {ESCALATION_SEVERITY_LABELS[
                              inv.escalationSeverity
                            ] ?? inv.escalationSeverity}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-text-caption">
                      {formatDate(inv.dueAt)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-text-primary">
                      {formatInvoiceMoney(inv.total, inv.currency)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {canEdit ? (
                          (() => {
                            const pendingApproval =
                              inv.approvalStatus === "pending_approval";
                            const financeRejected =
                              inv.approvalStatus === "finance_rejected";
                            const isApproved = invoiceIsApproved(inv);
                            const blocksSend = invoiceBlocksCustomerSend(inv);
                            const isDraft = inv.status === "draft";
                            const isSent =
                              inv.status === "sent" ||
                              (inv.status !== "paid" &&
                                inv.status !== "void" &&
                                inv.displayStatus === "overdue");
                            const isLocked =
                              inv.status === "paid" || inv.status === "void";

                            if (isLocked && inv.paidAt) {
                              return (
                                <span className="text-xs text-text-caption">
                                  Paid {formatDate(inv.paidAt)}
                                </span>
                              );
                            }
                            if (isLocked) {
                              return (
                                <span className="text-xs text-text-caption">
                                  Void
                                </span>
                              );
                            }

                            const actions: ReactNode[] = [];

                            if (isDraft && pendingApproval) {
                              actions.push(
                                <Button
                                  key="approve"
                                  type="button"
                                  variant="secondary"
                                  className="h-8 px-3 text-xs"
                                  disabled={busy}
                                  onClick={() =>
                                    void runAction(
                                      () => approveInvoice(inv.id),
                                      `Invoice ${inv.number} approved.`,
                                    )
                                  }
                                >
                                  Approve
                                </Button>,
                                <Button
                                  key="reject"
                                  type="button"
                                  variant="secondary"
                                  className="h-8 px-3 text-xs"
                                  disabled={busy}
                                  onClick={() => {
                                    setModalReason("");
                                    setListModal({ kind: "reject", invoice: inv });
                                  }}
                                >
                                  Reject
                                </Button>,
                              );
                            } else if (isDraft && financeRejected) {
                              actions.push(
                                <Button
                                  key="resubmit"
                                  type="button"
                                  variant="secondary"
                                  className="h-8 px-3 text-xs"
                                  disabled={busy}
                                  onClick={() =>
                                    void runAction(
                                      () => resubmitInvoice(inv.id),
                                      `Invoice ${inv.number} resubmitted for approval.`,
                                    )
                                  }
                                >
                                  Resubmit
                                </Button>,
                              );
                            } else if (isDraft && isApproved) {
                              if (!blocksSend) {
                                actions.push(
                                  <Button
                                    key="send"
                                    type="button"
                                    variant="secondary"
                                    className="h-8 px-3 text-xs"
                                    disabled={busy}
                                    onClick={() =>
                                      void runAction(
                                        () => sendInvoiceEmail(inv.id),
                                        `Invoice ${inv.number} emailed to the customer.`,
                                      )
                                    }
                                  >
                                    Send
                                  </Button>,
                                );
                              }
                              actions.push(
                                <Button
                                  key="withdraw"
                                  type="button"
                                  variant="secondary"
                                  className="h-8 px-3 text-xs"
                                  disabled={busy}
                                  onClick={() =>
                                    void runAction(
                                      () => withdrawInvoiceApproval(inv.id),
                                      `Approval withdrawn for ${inv.number}.`,
                                    )
                                  }
                                >
                                  Withdraw
                                </Button>,
                              );
                            } else if (isSent) {
                              actions.push(
                                <Button
                                  key="resend"
                                  type="button"
                                  variant="secondary"
                                  className="h-8 px-3 text-xs"
                                  disabled={busy}
                                  onClick={() =>
                                    void runAction(
                                      () => resendInvoice(inv.id),
                                      `Invoice ${inv.number} resent to the customer.`,
                                    )
                                  }
                                >
                                  Resend
                                </Button>,
                                <Button
                                  key="pay"
                                  type="button"
                                  variant="secondary"
                                  className="h-8 px-3 text-xs"
                                  disabled={busy}
                                  onClick={() => {
                                    setPayReference("");
                                    setPayMethod("offline");
                                    setListModal({ kind: "pay", invoice: inv });
                                  }}
                                >
                                  Mark paid
                                </Button>,
                                <Button
                                  key="void"
                                  type="button"
                                  variant="secondary"
                                  className="h-8 px-3 text-xs"
                                  disabled={busy}
                                  onClick={() => {
                                    setModalReason("");
                                    setListModal({ kind: "void", invoice: inv });
                                  }}
                                >
                                  Void
                                </Button>,
                              );
                            } else if (isDraft && !isApproved) {
                              actions.push(
                                <Button
                                  key="approve-fallback"
                                  type="button"
                                  variant="secondary"
                                  className="h-8 px-3 text-xs"
                                  disabled={busy}
                                  onClick={() =>
                                    void runAction(
                                      () => approveInvoice(inv.id),
                                      `Invoice ${inv.number} approved.`,
                                    )
                                  }
                                >
                                  Approve
                                </Button>,
                              );
                            }

                            if (actions.length === 0) {
                              return (
                                <span className="text-xs text-text-caption">
                                  —
                                </span>
                              );
                            }
                            return actions;
                          })()
                        ) : inv.paidAt ? (
                          <span className="text-xs text-text-caption">
                            Paid {formatDate(inv.paidAt)}
                          </span>
                        ) : (
                          <span className="text-xs text-text-caption">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {items.length > 0 ? (
        <>
          <InfiniteScrollSentinel ref={sentinelRef} />
          {loadingMore ? (
            <div className="mt-2 flex justify-center">
              <SkeletonText width={96} height={12} />
            </div>
          ) : null}
        </>
      ) : null}
      </div>

      {listModal?.kind === "reject" ? (
        <div className="mt-4 rounded-lg border border-border-default bg-subtle p-4">
          <p className="text-sm font-medium text-text-primary">
            Reject invoice {listModal.invoice.number}
          </p>
          <label className="mt-3 block text-sm text-text-secondary">
            Rejection reason
            <textarea
              className="mt-1.5 w-full rounded-md border border-border-default bg-surface px-3 py-2 text-sm"
              rows={3}
              value={modalReason}
              onChange={(e) => setModalReason(e.target.value)}
              placeholder="Why is this invoice being rejected?"
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="primary"
              className="h-9"
              disabled={busy || !modalReason.trim()}
              onClick={() => void confirmListModal()}
            >
              Confirm reject
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="h-9"
              disabled={busy}
              onClick={closeListModal}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {listModal?.kind === "pay" ? (
        <div className="mt-4 rounded-lg border border-border-default bg-subtle p-4">
          <p className="text-sm font-medium text-text-primary">
            Confirm offline payment — {listModal.invoice.number}
          </p>
          <label className="mt-3 block text-sm text-text-secondary">
            Payment reference (wire ref / UTR / cheque no.)
            <input
              className="mt-1.5 w-full rounded-md border border-border-default bg-surface px-3 py-2 text-sm"
              value={payReference}
              onChange={(e) => setPayReference(e.target.value)}
              placeholder="Optional but recommended"
            />
          </label>
          <label className="mt-3 block text-sm text-text-secondary">
            Method
            <DropdownSelect
              className="mt-1.5"
              value={payMethod}
              options={[
                { value: "offline", label: "Offline bank transfer" },
                { value: "manual", label: "Manual / other" },
              ]}
              fullWidth
              size="lg"
              onChange={(value) =>
                setPayMethod(value as "offline" | "manual")
              }
              aria-label="Payment method"
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="primary"
              className="h-9"
              disabled={busy}
              onClick={() => void confirmListModal()}
            >
              Confirm paid
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="h-9"
              disabled={busy}
              onClick={closeListModal}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {listModal?.kind === "void" ? (
        <div className="mt-4 rounded-lg border border-border-default bg-subtle p-4">
          <p className="text-sm font-medium text-text-primary">
            Void invoice {listModal.invoice.number}
          </p>
          <label className="mt-3 block text-sm text-text-secondary">
            Void reason
            <textarea
              className="mt-1.5 w-full rounded-md border border-border-default bg-surface px-3 py-2 text-sm"
              rows={3}
              value={modalReason}
              onChange={(e) => setModalReason(e.target.value)}
              placeholder="Why is this invoice being voided?"
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="primary"
              className="h-9"
              disabled={busy || !modalReason.trim()}
              onClick={() => void confirmListModal()}
            >
              Confirm void
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="h-9"
              disabled={busy}
              onClick={closeListModal}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </FinanceShell>
  );

  const shellWorkspace = listWorkspace;

  return (
    <AgentModuleShell
      moduleId="finance"
      title="Finance"
      welcome="I'm with you on finance — we can start an invoice together or check what's outstanding on the right."
      chips={[
        {
          id: "chip-new-invoice",
          label: "Create a new invoice",
          prompt: "Help me create a new invoice",
        },
        {
          id: "chip-show-list",
          label: "Show invoices",
          prompt: "Show list",
        },
      ]}
      surface="list"
      workspaceMode="list"
      draft={null}
      workspaceTitle="Finance"
      workspaceSubtitle={MODULE_WORKSPACE_DESCRIPTION.finance}
      workspace={shellWorkspace}
      onWorkspaceCommand={onWorkspaceCommand}
      onDraftPatch={(patch) =>
        onDraftPatch(patch as Partial<InvoiceDraftFields>)
      }
      onToolConfirm={async (tool) => {
        if (tool.name === "propose_create_invoice") {
          const params = new URLSearchParams();
          if (createDraft.dealId) params.set("dealId", createDraft.dealId);
          if (createDraft.currency) params.set("currency", createDraft.currency);
          if (createDraft.notes) params.set("notes", createDraft.notes);
          if (createDraft.paymentTerms) {
            params.set("paymentTerms", createDraft.paymentTerms);
          }
          const q = params.toString();
          navigate(q ? `/finance/new?${q}` : "/finance/new");
          return "Opened the invoice form — add products and save there.";
        }
        return false;
      }}
      onAfterTool={() => void reload()}
    />
  );
}
