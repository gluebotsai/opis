// @ts-nocheck
import { X, XCircle } from "lucide-react";

export function BranchDropTimingModal({
  branchLabel,
  note,
  onNoteChange,
  onCancel,
  onConfirm,
  busy = false,
  eyebrow = "Branch drop",
  title,
  copy = "Choose when this branch should stop. Worktual admin must approve before the drop takes effect.",
  ariaLabel = "Request branch drop",
}) {
  const heading = title || `Drop ${branchLabel}?`;

  return (
    <div
      aria-label={ariaLabel}
      aria-modal="true"
      className="confirm-modal-overlay"
      role="dialog"
    >
      <div className="confirm-modal-overlay__backdrop" onClick={busy ? undefined : onCancel} />
      <div className="confirm-modal">
        <header className="confirm-modal__header">
          <div className="confirm-modal__icon confirm-modal__icon--remove">
            <XCircle size={22} />
          </div>
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2>{heading}</h2>
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

        <div className="confirm-modal__note">
          <label className="field field--full">
            <span>Optional note for Worktual admin</span>
            <textarea
              disabled={busy}
              onChange={(event) => onNoteChange(event.target.value)}
              placeholder="Reason or extra context..."
              rows={3}
              value={note}
            />
          </label>
        </div>

        <footer className="confirm-modal__footer">
          <button className="secondary-button" disabled={busy} onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => onConfirm("immediate")}
            type="button"
          >
            Immediate
          </button>
          <button
            className="primary-button confirm-modal__approve"
            disabled={busy}
            onClick={() => onConfirm("end_of_period")}
            type="button"
          >
            {busy ? "Submitting..." : "End of period"}
          </button>
        </footer>
      </div>
    </div>
  );
}
