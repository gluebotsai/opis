// @ts-nocheck
import { MapPin, X } from "lucide-react";

export function BranchAddRequestModal({
  onCancel,
  onConfirm,
  busy = false,
  error = "",
}) {
  return (
    <div
      aria-label="Request new branch"
      aria-modal="true"
      className="confirm-modal-overlay"
      role="dialog"
    >
      <div className="confirm-modal-overlay__backdrop" onClick={busy ? undefined : onCancel} />
      <div className="confirm-modal">
        <header className="confirm-modal__header">
          <div className="confirm-modal__icon">
            <MapPin size={22} />
          </div>
          <div>
            <p className="eyebrow">New location</p>
            <h2>Request a new branch?</h2>
            <p className="confirm-modal__copy">
              Send a request to your sales team. They will follow up to collect location details and
              add the branch.
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

        {error ? <p className="form-error confirm-modal__body">{error}</p> : null}

        <footer className="confirm-modal__footer">
          <button className="secondary-button" disabled={busy} onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            className="primary-button confirm-modal__approve"
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            {busy ? "Sending..." : "Send request to sales"}
          </button>
        </footer>
      </div>
    </div>
  );
}
