// @ts-nocheck
import { Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Type-to-confirm hard delete for a customer company.
 */
export function DeleteCustomerModal({
  companyName,
  onCancel,
  onConfirm,
  busy = false,
  error = "",
  requirePassword = false,
  title = "Delete customer",
  copy = "This permanently deletes the company, portal users, quotations, and related records. This cannot be undone.",
}) {
  const [confirmName, setConfirmName] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    setConfirmName("");
    setPassword("");
  }, [companyName]);

  const expected = String(companyName || "").trim();
  const nameMatches =
    expected && confirmName.trim().toLowerCase() === expected.toLowerCase();
  const canSubmit = nameMatches && (!requirePassword || Boolean(password.trim())) && !busy;

  function handleSubmit(event) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    onConfirm({
      confirmName: confirmName.trim(),
      password: password.trim(),
    });
  }

  return (
    <div
      className="confirm-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="confirm-modal-overlay__backdrop" onClick={busy ? undefined : onCancel} />

      <form className="confirm-modal" onSubmit={handleSubmit}>
        <header className="confirm-modal__header">
          <div className="confirm-modal__icon confirm-modal__icon--remove">
            <Trash2 size={22} />
          </div>
          <div>
            <h2>{title}</h2>
            <p className="confirm-modal__copy">{copy}</p>
          </div>
          <button
            className="confirm-modal__close"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            <X size={18} />
          </button>
        </header>

        <div className="confirm-modal__note">
          <span>Company name</span>
          <p>
            Type <strong>{expected || "—"}</strong> to confirm.
          </p>
          <input
            autoFocus
            disabled={busy}
            onChange={(event) => setConfirmName(event.target.value)}
            placeholder={expected}
            type="text"
            value={confirmName}
          />
        </div>

        {requirePassword ? (
          <div className="confirm-modal__note">
            <span>Current password</span>
            <input
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Portal password"
              type="password"
              value={password}
            />
          </div>
        ) : null}

        {error ? <p className="form-error">{error}</p> : null}

        <footer className="confirm-modal__footer">
          <button className="secondary-button" disabled={busy} onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="danger-button" disabled={!canSubmit} type="submit">
            {busy ? "Deleting…" : "Delete permanently"}
          </button>
        </footer>
      </form>
    </div>
  );
}
