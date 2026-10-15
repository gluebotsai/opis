// @ts-nocheck
import { Building2 } from "lucide-react";

import { SideOverlayDraftIsland } from "../SideOverlayDraftIsland.tsx";

/**
 * Lead create/edit draft island — thin wrapper over SideOverlayDraftIsland.
 */
export function LeadCreateDraftIsland({
  draftKind = "create",
  label,
  step = 1,
  stackIndex = 0,
  onOpen,
  onDiscard,
}) {
  return (
    <SideOverlayDraftIsland
      badge={step}
      draftKind={draftKind}
      icon={Building2}
      label={label}
      onDiscard={onDiscard}
      onOpen={onOpen}
      stackIndex={stackIndex}
    />
  );
}

export { isLeadCreateDraftEmpty, isLeadFormDirty, shouldLeadOverlayMinimizeOnDismiss } from "../../lib/leadFormDraft.js";
