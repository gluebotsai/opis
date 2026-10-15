// @ts-nocheck
import { useCallback, useState } from "react";
import { UserCircle, X } from "lucide-react";

import { AccountSettingsForm } from "./AccountSettingsForm.tsx";
import { SideOverlayDraftIsland } from "./SideOverlayDraftIsland.tsx";
import { useSideOverlayDraftDismiss } from "../hooks/useSideOverlayDraftDismiss.js";
import "../styles/admin-users-light.css";

/**
 * My account / My Profile — right side overlay (sidebar tenant card).
 */
export function AccountSettingsOverlay({
  onClose,
  subtitle = "Update your profile and password.",
  title = "My account",
}) {
  const [status, setStatus] = useState({
    isDirty: false,
    loading: true,
    saving: false,
    managedProfile: false,
  });
  const [minimized, setMinimized] = useState(false);

  const handleStatusChange = useCallback((next) => {
    setStatus(next);
  }, []);

  const isOverlayDirty = useCallback(() => status.isDirty, [status.isDirty]);

  const { discardDraft, expandDraft, requestDismiss } = useSideOverlayDraftDismiss({
    isBusy: status.saving || status.loading,
    isDirty: isOverlayDirty,
    minimized,
    onClose,
    onExpand: () => setMinimized(false),
    onMinimize: () => setMinimized(true),
  });

  if (minimized) {
    if (!status.isDirty) {
      return null;
    }

    return (
      <SideOverlayDraftIsland
        draftKind="edit"
        icon={UserCircle}
        label={title}
        onDiscard={discardDraft}
        onOpen={expandDraft}
      />
    );
  }

  return (
    <div
      aria-label={title}
      aria-modal="true"
      className="admin-side-overlay account-settings-overlay"
      role="dialog"
    >
      <button
        aria-label={`Minimize ${title.toLowerCase()} to draft`}
        className="admin-side-overlay__backdrop"
        disabled={status.saving}
        onClick={requestDismiss}
        type="button"
      />
      <section className="admin-side-overlay__panel">
        <header className="admin-side-overlay__header">
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button
            aria-label="Close"
            className="admin-users-panel__icon-button"
            disabled={status.saving}
            onClick={requestDismiss}
            type="button"
          >
            <X size={18} />
          </button>
        </header>

        <div className="admin-side-overlay__body account-settings-overlay__body">
          <AccountSettingsForm
            onStatusChange={handleStatusChange}
            showSubmitButton={false}
            variant="overlay"
          />
        </div>

        <div className="admin-side-overlay__footer">
          {status.managedProfile ? (
            <>
              <button
                className="secondary-button"
                disabled={status.saving}
                onClick={requestDismiss}
                type="button"
              >
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={status.saving || status.loading}
                form="account-settings-form"
                type="submit"
              >
                {status.saving ? "Saving…" : "Save changes"}
              </button>
            </>
          ) : (
            <button
              className="secondary-button"
              disabled={status.saving}
              onClick={requestDismiss}
              type="button"
            >
              Close
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
