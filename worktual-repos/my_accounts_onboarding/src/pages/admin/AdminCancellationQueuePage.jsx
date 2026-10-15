import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

import {
  adminRequestKindLabel,
  adminTriggerLabel,
  approveAdminCancellationRequest,
  listAdminCancellationRequests,
  rejectAdminCancellationRequest,
} from "../../lib/adminCancellationRequests.js";
import { cancellationStatusLabel, effectiveTimingLabel } from "../../lib/branchCancellationRequests.js";

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

export function AdminCancellationQueuePage() {
  const [requests, setRequests] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [approveTiming, setApproveTiming] = useState("");
  const [statusFilter, setStatusFilter] = useState("pending");

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

  async function loadRequests() {
    setLoading(true);
    setActionError("");
    try {
      const rows = await listAdminCancellationRequests();
      setRequests(rows);
      if (!selectedId && rows.length) {
        setSelectedId(rows[0].id);
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not load requests.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRequests();
  }, []);

  const visibleRequests = useMemo(() => {
    if (statusFilter === "all") {
      return requests;
    }
    if (statusFilter === "pending") {
      return requests.filter((entry) => pendingStatuses.has(entry.status));
    }
    return requests.filter((entry) => entry.status === statusFilter);
  }, [requests, statusFilter, pendingStatuses]);

  async function handleApprove() {
    if (!selected) {
      return;
    }

    if (
      selected.requestKind === "drop_branch" &&
      approveTiming === "immediate" &&
      !window.confirm(
        "Drop this branch inactive immediately? All products and branch portal access at this location will stop.",
      )
    ) {
      return;
    }

    if (
      selected.requestKind === "drop_branch" &&
      approveTiming === "end_of_period" &&
      !window.confirm(
        "Schedule branch drop at end of billing period? The branch stays active until the latest product renewal date.",
      )
    ) {
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
      await loadRequests();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not approve request.");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleReject() {
    if (!selected) {
      return;
    }

    if (!adminNote.trim()) {
      setActionError("Enter a rejection note for the customer.");
      return;
    }

    setActionLoading(true);
    setActionError("");
    setActionMessage("");

    try {
      await rejectAdminCancellationRequest(selected.id, adminNote.trim());
      setActionMessage("Request rejected.");
      setAdminNote("");
      await loadRequests();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not reject request.");
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <section className="finance-queue-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Platform admin</p>
          <h1>Cancellation requests</h1>
          <p className="page-header__copy">
            Review customer branch/product cancellation requests and auto-escalated unpaid alerts.
            Only platform admin can approve or drop branches inactive.
          </p>
        </div>
      </header>

      {actionMessage ? <div className="form-success-banner">{actionMessage}</div> : null}
      {actionError ? <div className="form-error-banner">{actionError}</div> : null}

      <div className="finance-queue-layout">
        <aside className="finance-queue-list onboarding-card">
          <div className="finance-queue-list__toolbar">
            <label className="field">
              <span>Filter</span>
              <select onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}>
                <option value="pending">Pending review</option>
                <option value="submitted">Submitted</option>
                <option value="auto_escalated">Auto-escalated</option>
                <option value="approved">Approved</option>
                <option value="approved_scheduled">Scheduled</option>
                <option value="rejected">Rejected</option>
                <option value="all">All</option>
              </select>
            </label>
          </div>

          {loading ? (
            <p role="status">Loading requests...</p>
          ) : visibleRequests.length === 0 ? (
            <p>No cancellation requests in this filter.</p>
          ) : (
            <ul>
              {visibleRequests.map((entry) => (
                <li key={entry.id}>
                  <button
                    className={`finance-queue-item${selectedId === entry.id ? " is-active" : ""}`}
                    onClick={() => {
                      setSelectedId(entry.id);
                      setAdminNote("");
                      setActionError("");
                      setActionMessage("");
                    }}
                    type="button"
                  >
                    <strong>{entry.companyName || "Customer"}</strong>
                    <span>
                      {adminRequestKindLabel(entry.requestKind)} · {entry.locationId}
                    </span>
                    <small>{cancellationStatusLabel(entry.status)}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="finance-queue-detail onboarding-card">
          {!selected ? (
            <p>Select a request to review.</p>
          ) : (
            <>
              <header className="finance-queue-detail__header">
                <div>
                  <h2>{selected.requestNumber}</h2>
                  <p>
                    {selected.companyName} · {adminRequestKindLabel(selected.requestKind)} ·{" "}
                    {adminTriggerLabel(selected.triggerSource)}
                  </p>
                </div>
                <span className="status-pill">{cancellationStatusLabel(selected.status)}</span>
              </header>

              <dl className="lead-dashboard-details">
                <div>
                  <dt>Branch</dt>
                  <dd>{selected.locationId}</dd>
                </div>
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
                <div className="finance-review-note">
                  <h3>Customer / system note</h3>
                  <p>{selected.customerNote}</p>
                </div>
              ) : null}

              {selected.requestKind === "drop_branch" ? (
                <div className="form-error-banner">
                  <AlertTriangle size={16} />
                  {approveTiming === "end_of_period"
                    ? "Approving will schedule the branch to drop at the end of the current billing period."
                    : "Approving will drop the entire branch inactive and cancel all products at this location immediately."}
                </div>
              ) : null}

              {pendingStatuses.has(selected.status) ? (
                <>
                  <label className="field">
                    <span>Execution timing</span>
                    <select
                      onChange={(event) => setApproveTiming(event.target.value)}
                      value={approveTiming}
                    >
                      <option value="end_of_period">End of billing period</option>
                      <option value="immediate">Immediate</option>
                    </select>
                  </label>

                  <label className="field">
                    <span>Admin note</span>
                    <textarea
                      onChange={(event) => setAdminNote(event.target.value)}
                      placeholder="Optional for approval. Required for rejection."
                      rows={4}
                      value={adminNote}
                    />
                  </label>

                  <div className="finance-review-actions">
                    <button
                      className="finance-review-actions__approve"
                      disabled={actionLoading}
                      onClick={handleApprove}
                      type="button"
                    >
                      <CheckCircle2 size={16} />
                      Approve & execute
                    </button>
                    <button
                      className="danger-button"
                      disabled={actionLoading}
                      onClick={handleReject}
                      type="button"
                    >
                      <XCircle size={16} />
                      Reject
                    </button>
                  </div>
                </>
              ) : selected.adminNote ? (
                <div className="finance-review-note">
                  <h3>Admin resolution note</h3>
                  <p>{selected.adminNote}</p>
                  <small>
                    Resolved {formatDate(selected.resolvedAt)} by {selected.resolvedBy || "admin"}
                  </small>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
