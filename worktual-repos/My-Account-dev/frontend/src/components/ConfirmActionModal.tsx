// @ts-nocheck
import { AlertTriangle, X } from "lucide-react";

/**
 * Simple in-app confirm dialog using the shared confirm-modal styles.
 * Prefer this over browser `confirm()` / `alert()`.
 */
export function ConfirmActionModal({
  title,
  copy,
  eyebrow = "Confirm",
  confirmLabel = "Continue",
  cancelLabel = "Cancel",
  busy = false,
  busyLabel = "Working…",
  onCancel,
  onConfirm,
  tone = "default",
}) {
  const iconClass =
    tone === "danger" ? "confirm-modal__icon confirm-modal__icon--remove" : "confirm-modal__icon";

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
          <div className={iconClass}>
            <AlertTriangle size={22} />
          </div>
          <div>
            <p className="eyebrow">{eyebrow}</p>
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
            {cancelLabel}
          </button>
          <button
            className={
              tone === "danger" ? "danger-button" : "primary-button confirm-modal__approve"
            }
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}
