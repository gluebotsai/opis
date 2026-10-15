import { useEffect, useId, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";

export type ConfirmDeleteResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Contact-module style delete control: compact trash or labeled button + modal confirm.
 */
export function ConfirmDeleteButton({
  name,
  entityLabel,
  consequence,
  confirmLabel,
  buttonLabel,
  compact = false,
  menuItem = false,
  disabled = false,
  onConfirm,
  onSuccess,
}: {
  name: string;
  /** e.g. "contact", "deal", "product" */
  entityLabel: string;
  /** Extra sentence after the name, e.g. "This permanently removes…" */
  consequence?: string;
  confirmLabel?: string;
  /** Visible trigger label when not compact. Defaults to "Delete". */
  buttonLabel?: string;
  compact?: boolean;
  /** Full-width row for a More menu. The confirm dialog is portaled. */
  menuItem?: boolean;
  disabled?: boolean;
  onConfirm: () => Promise<ConfirmDeleteResult>;
  onSuccess?: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) {
        setOpen(false);
        setError(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, pending]);

  const close = () => {
    if (pending) return;
    setOpen(false);
    setError(null);
  };

  const onDelete = () => {
    setError(null);
    startTransition(async () => {
      const result = await onConfirm();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      onSuccess?.();
    });
  };

  const title = `Delete ${entityLabel}`;
  const actionLabel = confirmLabel ?? `Delete ${entityLabel}`;
  const consequenceText =
    consequence ?? "This action cannot be undone.";

  return (
    <>
      {menuItem ? (
        <button
          type="button"
          role="menuitem"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className="flex w-full items-center px-3 py-2 text-left text-sm text-text-danger hover:bg-subtle disabled:cursor-not-allowed disabled:text-text-caption"
        >
          {buttonLabel ?? "Delete"}
        </button>
      ) : compact ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className="inline-flex size-7 items-center justify-center rounded-full text-text-caption hover:bg-subtle hover:text-text-danger disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={`Delete ${name}`}
          title={`Delete ${name}`}
        >
          <Trash2 className="size-3.5" strokeWidth={1.75} />
        </button>
      ) : (
        <Button
          type="button"
          variant="secondary"
          disabled={disabled}
          className="border-text-danger text-text-danger hover:border-text-danger"
          onClick={() => setOpen(true)}
        >
          {buttonLabel ?? "Delete"}
        </Button>
      )}

      {open
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
              role="presentation"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) close();
              }}
            >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            className="w-full max-w-md overflow-hidden rounded-2xl border border-border-default bg-surface shadow-lg"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="px-5 pt-5 sm:px-6 sm:pt-6">
              <div className="flex gap-4">
                <div
                  className="flex size-11 shrink-0 items-center justify-center rounded-full bg-text-danger/10 text-text-danger"
                  aria-hidden
                >
                  <AlertTriangle className="size-5" strokeWidth={1.75} />
                </div>
                <div className="min-w-0">
                  <h2
                    id={titleId}
                    className="text-base font-semibold text-text-primary"
                  >
                    {title}
                  </h2>
                  <p
                    id={descriptionId}
                    className="mt-1.5 text-sm leading-relaxed text-text-caption"
                  >
                    Are you sure you want to delete{" "}
                    <span className="font-medium text-text-primary">{name}</span>
                    ? {consequenceText}
                  </p>
                </div>
              </div>

              {error ? (
                <p className="mt-4 rounded-lg border border-text-danger/20 bg-text-danger/5 px-3 py-2 text-sm text-text-danger">
                  {error}
                </p>
              ) : null}
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-border-default bg-subtle/40 px-5 py-4 sm:px-6">
              <Button
                ref={cancelRef}
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={close}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                className="bg-text-danger hover:bg-text-danger/90 disabled:bg-neutral-200"
                disabled={pending}
                onClick={onDelete}
              >
                {pending ? "Deleting…" : actionLabel}
              </Button>
            </div>
          </div>
        </div>,
            document.body,
          )
        : null}
    </>
  );
}
