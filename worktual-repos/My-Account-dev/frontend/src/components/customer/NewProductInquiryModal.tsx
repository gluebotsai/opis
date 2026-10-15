// @ts-nocheck
import { PlusCircle, X } from "lucide-react";

export function NewProductInquiryModal({
  note = "",
  busy = false,
  error = "",
  onNoteChange,
  onCancel,
  onConfirm,
}) {
  return (
    <div
      aria-label="Request a new product"
      aria-modal="true"
      className="confirm-modal-overlay"
      role="dialog"
    >
      <div
        className="confirm-modal-overlay__backdrop"
        onClick={busy ? undefined : onCancel}
      />
      <div className="confirm-modal">
        <header className="confirm-modal__header">
          <div className="confirm-modal__icon">
            <PlusCircle size={22} />
          </div>
          <div>
            <p className="eyebrow">Products</p>
            <h2>Request a new product?</h2>
            <p className="confirm-modal__copy">
              We will notify your sales team. They will follow up with options — you do not need
              to configure products here.
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
            <label className="field field--full" htmlFor="new-product-inquiry-note">
              <span>Note for sales</span>
              <textarea
                id="new-product-inquiry-note"
                disabled={busy}
                onChange={(event) => onNoteChange?.(event.target.value)}
                placeholder="Anything sales should know before they follow up"
                required
                rows={3}
                value={note}
              />
            </label>
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
          <button
            className="primary-button"
            disabled={busy || !String(note || "").trim()}
            onClick={onConfirm}
            type="button"
          >
            {busy ? "Sending…" : "Notify sales"}
          </button>
        </footer>
      </div>
    </div>
  );
}
