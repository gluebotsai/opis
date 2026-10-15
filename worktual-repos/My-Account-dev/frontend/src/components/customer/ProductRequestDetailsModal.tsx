// @ts-nocheck
import { Eye, X, XCircle } from "lucide-react";

import {
  buildProductRequestDetailLines,
  buildProductRequestNewBranchDetailRows,
  customerProductRequestStatusHint,
  customerProductRequestStatusLabel,
  groupProductRequestDetailRows,
  productRequestDisplayStatus,
  productRequestStatusLabel,
  productRequestTypeLabel,
} from "../../lib/customerProductRequests.js";

function formatRequestDate(value) {
  if (!value) {
    return "—";
  }

  return new Date(value).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function ProductRequestDetailsModal({
  request,
  onClose,
  onWithdraw,
  withdrawing = false,
  audience = "customer",
}) {
  if (!request) {
    return null;
  }

  const lines = buildProductRequestDetailLines(request);
  const newBranches = Array.isArray(request.newBranches) ? request.newBranches : [];
  const displayStatus = productRequestDisplayStatus(request);
  const canWithdraw = audience === "customer" && displayStatus === "open" && onWithdraw;
  const note = String(request.customerNote || "").trim();
  const noteLabel = audience === "sales" ? "Customer note" : "Your note";
  const statusLabel =
    audience === "sales"
      ? productRequestStatusLabel(displayStatus)
      : customerProductRequestStatusLabel(request);
  const statusHint = audience === "customer" ? customerProductRequestStatusHint(request) : "";

  return (
    <div
      aria-label="Product request details"
      aria-modal="true"
      className="confirm-modal-overlay"
      role="dialog"
    >
      <div
        className="confirm-modal-overlay__backdrop"
        onClick={withdrawing ? undefined : onClose}
      />
      <div className="confirm-modal product-request-details-modal">
        <header className="confirm-modal__header">
          <div className="confirm-modal__icon">
            <Eye size={22} />
          </div>
          <div>
            <p className="eyebrow">Product request</p>
            <h2>{request.requestNumber || "Request details"}</h2>
            <p className="confirm-modal__copy">
              {productRequestTypeLabel(request.requestType)} ·{" "}
              {statusLabel} · Submitted{" "}
              {formatRequestDate(request.createdAt)}
              {request.contactEmail ? ` · ${request.contactEmail}` : ""}
            </p>
            {statusHint ? <p className="confirm-modal__copy">{statusHint}</p> : null}
            {request.salespersonName ? (
              <p className="confirm-modal__copy">
                Salesperson · {request.salespersonName}
                {audience === "sales" && request.salespersonEmail
                  ? ` · ${request.salespersonEmail}`
                  : ""}
              </p>
            ) : null}
          </div>
          <button
            aria-label="Close"
            className="confirm-modal__close"
            disabled={withdrawing}
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </header>

        <div className="product-request-details-modal__body">
          {note ? (
            <div className="product-request-details-modal__note">
              <span className="product-request-details-modal__note-label">{noteLabel}</span>
              <p>{note}</p>
            </div>
          ) : null}

          {request.branchSummary ? (
            <div className="product-request-details-modal__note">
              <span className="product-request-details-modal__note-label">Branch summary</span>
              <p>
                {request.branchSummary.productCount ?? 0} products ·{" "}
                {request.branchSummary.branchCount ?? 0} branches ·{" "}
                {request.branchSummary.billingGroupCount ?? 0} billing groups
              </p>
            </div>
          ) : null}

          {newBranches.length > 0 ? (
            <div className="product-request-details-modal__new-locations">
              <h3 className="product-request-details-modal__section-title">New locations</h3>
              <div className="product-request-details-modal__lines">
                {newBranches.map((branch, index) => {
                  const title = String(branch.label || "").trim() || `New location ${index + 1}`;
                  const detailRows = buildProductRequestNewBranchDetailRows(branch);
                  return (
                    <article
                      className="product-request-details-modal__line"
                      key={branch.id || `${title}-${index}`}
                    >
                      <div className="product-request-details-modal__line-top">
                        <strong>{title}</strong>
                        <span className="lead-dashboard-badge">New location</span>
                      </div>
                      {detailRows.length > 0 ? (
                        <dl className="product-request-details-modal__dl">
                          {detailRows.map((row) => (
                            <div key={`${branch.id || index}-${row.label}`}>
                              <dt>{row.label}</dt>
                              <dd>{row.value}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </div>
          ) : null}

          {lines.length === 0 ? (
            <p className="sales-oversight-empty">
              {String(request.requestType || "").trim().toLowerCase() === "inquiry"
                ? "No product configuration was submitted. Sales will follow up about available products."
                : "No product details were saved with this request."}
            </p>
          ) : (
            <div className="product-request-details-modal__lines">
              {lines.map((line) => (
                <article className="product-request-details-modal__line" key={line.key}>
                  <div className="product-request-details-modal__line-top">
                    <strong>{line.name}</strong>
                    <span className="lead-dashboard-badge">{line.changeTypeLabel}</span>
                  </div>
                  {line.branchLabel ? (
                    <p className="product-request-details-modal__meta">
                      Branch: {line.branchLabel}
                      {line.billingLabel && line.billingLabel !== line.branchLabel
                        ? ` · Billing: ${line.billingLabel}`
                        : ""}
                    </p>
                  ) : null}
                  {line.details.length > 0 ? (
                    <div className="product-request-details-modal__breakdown">
                      {groupProductRequestDetailRows(line.details).map((group) => (
                        <div
                          className="product-request-details-modal__section"
                          key={`${line.key}-${group.section || "general"}`}
                        >
                          {group.section ? (
                            <h3 className="product-request-details-modal__section-title">
                              {group.section}
                            </h3>
                          ) : null}
                          <dl className="product-request-details-modal__dl">
                            {group.rows.map((row) => (
                              <div key={`${line.key}-${group.section}-${row.label}`}>
                                <dt>{row.label}</dt>
                                <dd>{row.value}</dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {audience !== "customer" && line.priceLabel ? (
                    <p className="product-request-details-modal__price">{line.priceLabel}</p>
                  ) : audience === "customer" ? (
                    <p className="product-request-details-modal__price product-request-details-modal__price--pending">
                      Pricing will be confirmed by sales after review.
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </div>

        <footer className="confirm-modal__footer">
          <button className="secondary-button" disabled={withdrawing} onClick={onClose} type="button">
            Close
          </button>
          {canWithdraw ? (
            <button
              className="secondary-button"
              disabled={withdrawing}
              onClick={() => onWithdraw?.(request.id)}
              type="button"
            >
              <XCircle size={16} />
              {withdrawing ? "Withdrawing..." : "Withdraw request"}
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
