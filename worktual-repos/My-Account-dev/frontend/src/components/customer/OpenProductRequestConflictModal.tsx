// @ts-nocheck
import { BellRing, PencilLine, X } from "lucide-react";

import {
  canEditCustomerProductRequest,
  canNotifyCustomerProductRequestAgain,
  customerProductRequestStatusLabel,
} from "../../lib/customerProductRequests.js";

export function OpenProductRequestConflictModal({
  request,
  productName = "This product",
  busy = false,
  error = "",
  onEdit,
  onNotifyAgain,
  onCancel,
}) {
  if (!request) {
    return null;
  }

  const canEdit = canEditCustomerProductRequest(request);
  const canNotify = canNotifyCustomerProductRequestAgain(request);
  const statusLabel = customerProductRequestStatusLabel(request);

  return (
    <div
      aria-label="Existing product request"
      aria-modal="true"
      className="confirm-modal-overlay"
      role="dialog"
    >
      <div className="confirm-modal-overlay__backdrop" onClick={busy ? undefined : onCancel} />
      <div className="confirm-modal">
        <header className="confirm-modal__header">
          <div className="confirm-modal__icon">
            <BellRing size={22} />
          </div>
          <div>
            <p className="eyebrow">Already requested</p>
            <h2>{productName} already has a request</h2>
            <p className="confirm-modal__copy">
              {canEdit
                ? "Edit the existing request, or notify your sales team again. A second request will not be created."
                : "A quotation is already in progress for this request. You can notify sales again, or close and wait for their update."}
            </p>
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

        <div className="confirm-modal__body">
          <div className="confirm-modal__note">
            <span>Existing request</span>
            <p>
              {request.requestNumber || "Request"} · {statusLabel}
              {request.productSummary?.length
                ? ` · ${request.productSummary.map((entry) => entry.name).filter(Boolean).join(", ")}`
                : ""}
            </p>
          </div>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <footer className="confirm-modal__footer">
          <button className="secondary-button" disabled={busy} onClick={onCancel} type="button">
            Cancel
          </button>
          {canNotify ? (
            <button
              className="secondary-button"
              disabled={busy}
              onClick={onNotifyAgain}
              type="button"
            >
              <BellRing size={16} />
              {busy ? "Sending…" : "Notify again"}
            </button>
          ) : null}
          {canEdit ? (
            <button className="primary-button" disabled={busy} onClick={onEdit} type="button">
              <PencilLine size={16} />
              Edit request
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
