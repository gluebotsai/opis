// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Inbox,
  Search,
  X,
  XCircle,
} from "lucide-react";

import { AdminFieldSelect } from "../../components/AdminFieldSelect.tsx";
import { AdminPageToast } from "../../components/admin/AdminPageToast.tsx";
import {
  adminRequestKindLabel,
  adminTriggerLabel,
  approveAdminCancellationRequest,
  listAdminCancellationRequests,
  rejectAdminCancellationRequest,
} from "../../lib/adminCancellationRequests.js";
import { cancellationStatusLabel, effectiveTimingLabel } from "../../lib/branchCancellationRequests.js";
import { subscribeToAppEvents } from "../../lib/eventStream.js";
import "../../styles/admin-users-light.css";
import "../../styles/admin-cancellation-queue.css";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending review" },
  { value: "submitted", label: "Submitted" },
  { value: "auto_escalated", label: "Auto-escalated" },
  { value: "approved", label: "Approved" },
  { value: "approved_scheduled", label: "Scheduled" },
  { value: "rejected", label: "Rejected" },
];

const EXECUTION_TIMING_OPTIONS = [
  { value: "end_of_period", label: "End of billing period" },
  { value: "immediate", label: "Immediate" },
];

function formatDate(value) {
  if (!value) {
    return "—";
  }

  return new Date(value).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusPillClass(status) {
  if (status === "approved" || status === "approved_scheduled") {
    return "admin-cancel-status--approved";
  }
  if (status === "rejected") {
    return "admin-cancel-status--rejected";
  }
  if (status === "auto_escalated") {
    return "admin-cancel-status--escalated";
  }
  return "admin-cancel-status--pending";
}

function CancellationActionModal({
  action,
  approveTiming,
  busy,
  onCancel,
  onConfirm,
  request,
}) {
  if (!action || !request) {
    return null;
  }

  const isApprove = action === "approve";
  const title = isApprove ? "Approve this request?" : "Reject this request?";
  const copy = isApprove
    ? request.requestKind === "drop_branch" && approveTiming === "immediate"
      ? "Drop this branch inactive immediately? All products and branch portal access at this location will stop."
      : request.requestKind === "drop_branch" && approveTiming === "end_of_period"
        ? "Schedule branch drop at end of billing period? The branch stays active until the latest product renewal date."
        : "Approve and execute this cancellation request."
    : "Reject this cancellation request? The customer will see your rejection note.";

  return (
    <div
      aria-label={title}
      aria-modal="true"
      className="confirm-modal-overlay"
      role="dialog"
    >
      <div className="confirm-modal-overlay__backdrop" onClick={busy ? undefined : onCancel} />
      <div className="confirm-modal">
        <header className="confirm-modal__header">
          <div
            className={`confirm-modal__icon ${
              isApprove ? "confirm-modal__icon--approve" : "confirm-modal__icon--remove"
            }`}
          >
            {isApprove ? <CheckCircle2 size={22} /> : <XCircle size={22} />}
          </div>
          <div>
            <p className="eyebrow">Cancellation</p>
            <h2>{title}</h2>
            <p className="confirm-modal__copy">{copy}</p>
          </div>
          <button
            aria-label="Close"
            className="confirm-modal__close"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            <X size={18} />
          </button>
        </header>

        <footer className="confirm-modal__footer">
          <button className="secondary-button" disabled={busy} onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            className={isApprove ? "primary-button confirm-modal__approve" : "danger-button"}
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            {busy
              ? isApprove
                ? "Approving…"
                : "Rejecting…"
              : isApprove
                ? "Approve & execute"
                : "Reject request"}
          </button>
        </footer>
      </div>
    </div>
  );
}

export function AdminCancellationQueuePage() {
  const [requests, setRequests] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [noteError, setNoteError] = useState("");
  const [approveTiming, setApproveTiming] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [confirmAction, setConfirmAction] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const pendingStatuses = useMemo(() => new Set(["submitted", "auto_escalated"]), []);

  const selected = useMemo(
    () => requests.find((entry) => entry.id === selectedId) || null,
    [requests, selectedId],
  );

  useEffect(() => {
    if (!selected) {
      setApproveTiming("");
      return;
    }
    setApproveTiming(selected.effectiveTiming || "end_of_period");
  }, [selected?.id, selected?.effectiveTiming]);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key !== "Escape") {
        return;
      }
      if (confirmAction) {
        if (!actionLoading) {
          setConfirmAction(null);
        }
        return;
      }
      if (detailOpen && !actionLoading) {
        closeDetail();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [detailOpen, confirmAction, actionLoading]);

  const loadRequests = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
    }
    setActionError("");
    try {
      const rows = await listAdminCancellationRequests();
      setRequests(rows);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not load requests.");
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  useEffect(() => {
    return subscribeToAppEvents({
      channels: ["cancellations"],
      onEvent: (payload) => {
        if (!String(payload?.event || "").startsWith("cancellation.")) {
          return;
        }
        void loadRequests({ silent: true });
      },
    });
  }, [loadRequests]);

  const filteredRequests = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return requests.filter((entry) => {
      if (statusFilter === "pending" && !pendingStatuses.has(entry.status)) {
        return false;
      }
      if (
        statusFilter !== "all" &&
        statusFilter !== "pending" &&
        entry.status !== statusFilter
      ) {
        return false;
      }
      if (!query) {
        return true;
      }
      const haystack = [
        entry.requestNumber,
        entry.companyName,
        entry.branchId,
        entry.productId,
        entry.contactEmail,
        adminRequestKindLabel(entry.requestKind),
        cancellationStatusLabel(entry.status),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [requests, statusFilter, searchQuery, pendingStatuses]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, statusFilter, pageSize]);

  const pageCount = Math.max(1, Math.ceil(filteredRequests.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visibleRequests = filteredRequests.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );

  function openDetail(entry) {
    setSelectedId(entry.id);
    setDetailOpen(true);
    setAdminNote("");
    setNoteError("");
    setActionError("");
    setConfirmAction(null);
  }

  function closeDetail() {
    setDetailOpen(false);
    setSelectedId("");
    setAdminNote("");
    setNoteError("");
    setConfirmAction(null);
  }

  function openApproveConfirm() {
    if (!selected) {
      return;
    }
    setActionError("");
    setNoteError("");
    setConfirmAction("approve");
  }

  function openRejectConfirm() {
    if (!selected) {
      return;
    }
    if (!adminNote.trim()) {
      setNoteError("Enter a rejection note for the customer.");
      return;
    }
    setActionError("");
    setNoteError("");
    setConfirmAction("reject");
  }

  async function executeApprove() {
    if (!selected) {
      return;
    }
    setActionLoading(true);
    setActionError("");
    setActionMessage("");
    try {
      await approveAdminCancellationRequest(selected.id, adminNote.trim(), approveTiming);
      setActionMessage(
        approveTiming === "end_of_period"
          ? "Request approved — cancellation scheduled for end of billing period."
          : "Request approved and executed immediately.",
      );
      setAdminNote("");
      setNoteError("");
      setConfirmAction(null);
      closeDetail();
      await loadRequests();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not approve request.");
    } finally {
      setActionLoading(false);
    }
  }

  async function executeReject() {
    if (!selected) {
      return;
    }
    setActionLoading(true);
    setActionError("");
    setActionMessage("");
    try {
      await rejectAdminCancellationRequest(selected.id, adminNote.trim());
      setActionMessage("Request rejected.");
      setAdminNote("");
      setNoteError("");
      setConfirmAction(null);
      closeDetail();
      await loadRequests();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not reject request.");
    } finally {
      setActionLoading(false);
    }
  }

  const subtitle =
    "Review customer branch/product cancellation requests and auto-escalated unpaid alerts.";

  const emptyMessage =
    requests.length === 0
      ? "No cancellation requests yet."
      : "No requests match this search or filter.";

  return (
    <div className="admin-users-page admin-cancellation-queue-page">
      <header className="admin-users-page__header">
        <div>
          <h1>Cancellation requests</h1>
          <p className="admin-users-page__subtitle" title={subtitle}>
            {subtitle}
          </p>
        </div>
      </header>

      <AdminPageToast
        error={actionError}
        onDismiss={() => {
          setActionError("");
          setActionMessage("");
        }}
        success={actionMessage}
      />

      <section aria-busy={loading} className="admin-users-panel">
        <header className="admin-users-panel__section-header">
          <div>
            <h2>All requests</h2>
            <p>
              {filteredRequests.length} request{filteredRequests.length === 1 ? "" : "s"} in view
            </p>
          </div>

          <div className="admin-users-panel__toolbar">
            <label className="admin-users-panel__search">
              <Search size={18} />
              <input
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search company, request #, branch…"
                type="search"
                value={searchQuery}
              />
            </label>

            <div className="admin-users-panel__toolbar-actions">
              <div className="admin-cancellation-queue-page__filter">
                <AdminFieldSelect
                  aria-label="Filter by status"
                  className="admin-field-select--toolbar"
                  onChange={setStatusFilter}
                  options={STATUS_FILTER_OPTIONS}
                  value={statusFilter}
                />
              </div>
            </div>
          </div>
        </header>

        <div className="admin-users-panel__body">
          {loading ? (
            <p className="admin-users-panel__loading">Loading requests…</p>
          ) : filteredRequests.length === 0 ? (
            <div className="admin-cancellation-empty" role="status">
              <Inbox size={28} aria-hidden="true" />
              <p>{emptyMessage}</p>
            </div>
          ) : (
            <div className="admin-users-panel__table-wrap">
              <table className="admin-users-table admin-cancellation-table">
                <thead>
                  <tr>
                    <th>Request</th>
                    <th>Company</th>
                    <th>Type</th>
                    {/* Hidden for now — single-location UI.
                    <th>Branch</th>
                    */}
                    <th>Status</th>
                    <th>Submitted</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {visibleRequests.map((entry) => {
                    const requestNo = entry.requestNumber || entry.id;
                    const company = entry.companyName || "—";
                    const kind = adminRequestKindLabel(entry.requestKind);
                    // Hidden for now — single-location UI.
                    // const branch = entry.branchId || "—";
                    const status = cancellationStatusLabel(entry.status);
                    const submitted = formatDate(entry.createdAt);

                    return (
                      <tr key={entry.id}>
                        <td title={requestNo}>{requestNo}</td>
                        <td title={company}>{company}</td>
                        <td title={kind}>{kind}</td>
                        {/* Hidden for now — single-location UI.
                        <td title={branch}>{branch}</td>
                        */}
                        <td>
                          <span
                            className={`admin-users-status-pill admin-cancel-status ${statusPillClass(
                              entry.status,
                            )}`}
                          >
                            <span className="admin-users-status-pill__dot" />
                            {status}
                          </span>
                        </td>
                        <td title={submitted}>{submitted}</td>
                        <td>
                          <button
                            className="admin-users-panel__tool-button"
                            onClick={() => openDetail(entry)}
                            type="button"
                          >
                            Review
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {filteredRequests.length > 0 ? (
          <footer className="admin-users-panel__footer">
            <p>
              Showing {(safePage - 1) * pageSize + 1}–
              {Math.min(safePage * pageSize, filteredRequests.length)} of{" "}
              {filteredRequests.length}
            </p>
            <div className="admin-users-panel__footer-controls">
              <label className="admin-users-panel__page-size">
                <span>Rows</span>
                <span className="admin-users-panel__page-size-control">
                  <select
                    onChange={(event) => setPageSize(Number(event.target.value))}
                    value={pageSize}
                  >
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
              <nav aria-label="Cancellation requests pagination" className="admin-users-panel__pagination">
                <button
                  disabled={safePage <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  type="button"
                >
                  <ArrowLeft size={14} />
                </button>
                <button className="is-active" type="button">
                  {safePage}
                </button>
                <button
                  disabled={safePage >= pageCount}
                  onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                  type="button"
                >
                  <ArrowRight size={14} />
                </button>
              </nav>
            </div>
          </footer>
        ) : null}
      </section>

      {detailOpen && selected ? (
        <div
          aria-label={`Review ${selected.requestNumber || "cancellation request"}`}
          aria-modal="true"
          className="admin-side-overlay"
          role="dialog"
        >
          <button
            aria-label="Close review"
            className="admin-side-overlay__backdrop"
            disabled={actionLoading}
            onClick={closeDetail}
            type="button"
          />
          <section className="admin-side-overlay__panel admin-side-overlay__panel--wide">
            <header className="admin-side-overlay__header">
              <div>
                <h2 title={selected.requestNumber}>{selected.requestNumber || "Request"}</h2>
                <p>
                  {selected.companyName} · {adminRequestKindLabel(selected.requestKind)} ·{" "}
                  {adminTriggerLabel(selected.triggerSource)}
                </p>
              </div>
              <button
                aria-label="Close"
                className="admin-users-panel__icon-button"
                disabled={actionLoading}
                onClick={closeDetail}
                type="button"
              >
                <X size={18} />
              </button>
            </header>

            <div className="admin-side-overlay__body admin-cancellation-detail">
              <span
                className={`admin-users-status-pill admin-cancel-status ${statusPillClass(
                  selected.status,
                )}`}
              >
                <span className="admin-users-status-pill__dot" />
                {cancellationStatusLabel(selected.status)}
              </span>

              <dl className="admin-cancellation-detail__grid">
                {/* Hidden for now — single-location UI.
                <div>
                  <dt>Branch</dt>
                  <dd>{selected.branchId || "—"}</dd>
                </div>
                */}
                {selected.productId ? (
                  <div>
                    <dt>Product</dt>
                    <dd>{selected.productId}</dd>
                  </div>
                ) : null}
                {selected.subscriptionId ? (
                  <div>
                    <dt>Subscription</dt>
                    <dd>{selected.subscriptionId}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Submitted</dt>
                  <dd>{formatDate(selected.createdAt)}</dd>
                </div>
                {selected.graceDeadlineAt ? (
                  <div>
                    <dt>Grace deadline</dt>
                    <dd>{formatDate(selected.graceDeadlineAt)}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Requested timing</dt>
                  <dd>{effectiveTimingLabel(selected.effectiveTiming)}</dd>
                </div>
                {selected.effectiveAt ? (
                  <div>
                    <dt>Effective date</dt>
                    <dd>{formatDate(selected.effectiveAt)}</dd>
                  </div>
                ) : null}
                {selected.contactEmail ? (
                  <div>
                    <dt>Contact</dt>
                    <dd>{selected.contactEmail}</dd>
                  </div>
                ) : null}
              </dl>

              {selected.customerNote ? (
                <div className="admin-cancellation-detail__note">
                  <h3>Customer / system note</h3>
                  <p>{selected.customerNote}</p>
                </div>
              ) : null}

              {selected.requestKind === "drop_branch" ? (
                <div className="admin-cancellation-detail__info" role="status">
                  <AlertTriangle size={16} aria-hidden="true" />
                  <span>
                    {approveTiming === "end_of_period"
                      ? "Approving will schedule the branch to drop at the end of the current billing period."
                      : "Approving will drop the entire branch inactive and cancel all products at this location immediately."}
                  </span>
                </div>
              ) : null}

              {pendingStatuses.has(selected.status) ? (
                <>
                  <label className="admin-users-field">
                    <span>Execution timing</span>
                    <AdminFieldSelect
                      aria-label="Execution timing"
                      onChange={setApproveTiming}
                      options={EXECUTION_TIMING_OPTIONS}
                      value={approveTiming}
                    />
                  </label>

                  <label
                    className={`admin-users-field${noteError ? " is-invalid" : ""}`}
                  >
                    <span>Admin note</span>
                    <textarea
                      aria-invalid={noteError ? "true" : undefined}
                      onChange={(event) => {
                        setAdminNote(event.target.value);
                        if (noteError) {
                          setNoteError("");
                        }
                      }}
                      placeholder="Optional for approval. Required for rejection."
                      rows={4}
                      value={adminNote}
                    />
                    {noteError ? (
                      <span className="admin-users-field__error">{noteError}</span>
                    ) : null}
                  </label>
                </>
              ) : null}

              {selected.adminNote ? (
                <div className="admin-cancellation-detail__note">
                  <h3>Admin note</h3>
                  <p>{selected.adminNote}</p>
                </div>
              ) : null}
            </div>

            {pendingStatuses.has(selected.status) ? (
              <div className="admin-side-overlay__footer">
                <button
                  className="danger-button"
                  disabled={actionLoading}
                  onClick={openRejectConfirm}
                  type="button"
                >
                  <XCircle size={16} />
                  Reject
                </button>
                <button
                  className="primary-button"
                  disabled={actionLoading}
                  onClick={openApproveConfirm}
                  type="button"
                >
                  <CheckCircle2 size={16} />
                  Approve & execute
                </button>
              </div>
            ) : (
              <div className="admin-side-overlay__footer">
                <button className="secondary-button" onClick={closeDetail} type="button">
                  Close
                </button>
              </div>
            )}
          </section>
        </div>
      ) : null}

      <CancellationActionModal
        action={confirmAction}
        approveTiming={approveTiming}
        busy={actionLoading}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => {
          if (confirmAction === "approve") {
            void executeApprove();
          } else if (confirmAction === "reject") {
            void executeReject();
          }
        }}
        request={selected}
      />
    </div>
  );
}
