// @ts-nocheck
import { createContext, useContext, useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useLeadEditSessions } from "../../hooks/useLeadEditSessions.js";
import { LeadCreateOverlay } from "./LeadCreateOverlay.tsx";

const LeadEditContext = createContext(null);

export function useLeadEdit() {
  const value = useContext(LeadEditContext);
  if (!value) {
    throw new Error("useLeadEdit must be used within LeadEditProvider");
  }
  return value;
}

export function useLeadEditOptional() {
  return useContext(LeadEditContext);
}

/**
 * Shell-level edit-lead overlay + draft islands for sales workspace
 * and partner/reseller portals.
 * Persists across Products / Customers / detail / portal routes.
 */
export function LeadEditProvider({ children, mode = "sales", onUpdated }) {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    editSessions,
    hasEditDraftSessions,
    hasOpenEditSession,
    removeEditSession,
    startEditLead,
    updateEditSession,
  } = useLeadEditSessions();

  useEffect(() => {
    const openEditLeadId = location.state?.openEditLeadId;
    if (!openEditLeadId) {
      return;
    }
    startEditLead(openEditLeadId);
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [
    location.pathname,
    location.search,
    location.state?.openEditLeadId,
    navigate,
    startEditLead,
  ]);

  const value = useMemo(
    () => ({
      hasEditDraftSessions,
      hasOpenEditSession,
      startEditLead,
    }),
    [hasEditDraftSessions, hasOpenEditSession, startEditLead],
  );

  return (
    <LeadEditContext.Provider value={value}>
      {children}
      {editSessions.map((session, index) => {
        const minimizedStackIndex = editSessions
          .filter((entry) => entry.presentation === "minimized")
          .findIndex((entry) => entry.id === session.id);

        return (
          <LeadCreateOverlay
            key={session.id}
            draftKind="edit"
            leadId={session.leadId}
            minimized={session.presentation === "minimized"}
            mode={mode}
            onClose={() => removeEditSession(session.id)}
            onExpand={() => updateEditSession(session.id, "open")}
            onMinimize={() => updateEditSession(session.id, "minimized")}
            onUpdated={(successMessage) => {
              removeEditSession(session.id);
              onUpdated?.(successMessage);
              window.dispatchEvent(new CustomEvent("worktual:lead-updated"));
            }}
            stackIndex={minimizedStackIndex >= 0 ? minimizedStackIndex : index}
          />
        );
      })}
    </LeadEditContext.Provider>
  );
}
