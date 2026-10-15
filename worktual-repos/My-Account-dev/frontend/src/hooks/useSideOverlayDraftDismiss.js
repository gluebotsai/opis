import { useCallback, useEffect } from "react";

/**
 * Minimize-to-island dismiss guard for right-side overlay forms.
 * Backdrop / Escape / Cancel call requestDismiss; clean forms close immediately.
 */
export function useSideOverlayDraftDismiss({
  enabled = true,
  isDirty,
  isBusy = false,
  minimized = false,
  onClose,
  onMinimize,
  onExpand,
}) {
  const shouldMinimize = useCallback(() => {
    if (!enabled) {
      return false;
    }
    return typeof isDirty === "function" ? isDirty() : Boolean(isDirty);
  }, [enabled, isDirty]);

  const requestDismiss = useCallback(() => {
    if (isBusy) {
      return;
    }
    if (shouldMinimize()) {
      onMinimize?.();
      return;
    }
    onClose?.();
  }, [isBusy, shouldMinimize, onMinimize, onClose]);

  const discardDraft = useCallback(() => {
    onClose?.();
  }, [onClose]);

  const expandDraft = useCallback(() => {
    onExpand?.();
  }, [onExpand]);

  useEffect(() => {
    if (!enabled || !minimized) {
      return;
    }
    if (!shouldMinimize()) {
      onClose?.();
    }
  }, [enabled, minimized, onClose, shouldMinimize]);

  useEffect(() => {
    if (!enabled || minimized || isBusy) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        requestDismiss();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [enabled, isBusy, minimized, requestDismiss]);

  return {
    discardDraft,
    expandDraft,
    requestDismiss,
    shouldMinimize,
  };
}
