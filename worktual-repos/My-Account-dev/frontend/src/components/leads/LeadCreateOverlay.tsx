// @ts-nocheck
import "../../styles/admin-users-light.css";
import { OnboardingPage } from "../../pages/OnboardingPage.tsx";

/**
 * Create / edit lead — right side overlay (admin-side-overlay pattern).
 * Backdrop / Escape / Cancel minimize to a draft island when the form is dirty;
 * empty create forms discard immediately. Multiple sessions can stay minimized.
 */
export function LeadCreateOverlay({
  draftKind = "create",
  leadId = null,
  minimized = false,
  mode = "sales",
  stackIndex = 0,
  leadKind = "standard",
  onClose,
  onCreated,
  onUpdated,
  onExpand,
  onMinimize,
}) {
  return (
    <OnboardingPage
      draftKind={draftKind}
      leadId={leadId}
      leadKind={leadKind}
      minimized={minimized}
      mode={mode}
      onClose={onClose}
      onCreated={onCreated}
      onUpdated={onUpdated}
      onExpand={onExpand}
      onMinimize={onMinimize}
      stackIndex={stackIndex}
      variant="overlay"
    />
  );
}
