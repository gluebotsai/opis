// @ts-nocheck
import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/** Default auto-dismiss for success and error page toasts (ms). */
export const ADMIN_PAGE_TOAST_AUTO_DISMISS_MS = 2000;

/**
 * Fixed overlay toast — top-center, out of document flow (no KPI/table jump).
 * Defaults to auto-dismiss after 2s for both success and error (callers with
 * `onDismiss` clear state; fatal full-page errors without `onDismiss` stay).
 * `variant="pill"` → compact pill chrome for short action notices.
 */
export function AdminPageToast({
  autoDismissMs = ADMIN_PAGE_TOAST_AUTO_DISMISS_MS,
  error = "",
  onDismiss,
  success = "",
  variant = "card",
}) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const message = error || success;

  useEffect(() => {
    if (!autoDismissMs || !message || !onDismissRef.current) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      onDismissRef.current?.();
    }, autoDismissMs);
    return () => window.clearTimeout(timer);
  }, [autoDismissMs, message]);

  if (!message) {
    return null;
  }

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className={`admin-users-toast${variant === "pill" ? " admin-users-toast--pill" : ""} ${
        error ? "is-error" : "is-success"
      }`}
      role={error ? "alert" : "status"}
    >
      <p>{message}</p>
      {onDismiss ? (
        <button
          aria-label="Dismiss notice"
          className="admin-users-toast__close"
          onClick={onDismiss}
          type="button"
        >
          <X size={16} />
        </button>
      ) : null}
    </div>,
    document.body,
  );
}
