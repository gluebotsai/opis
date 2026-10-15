// @ts-nocheck
import { createContext, useContext, useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useLeadCreateSessions } from "../../hooks/useLeadCreateSessions.js";
import { LeadCreateOverlay } from "./LeadCreateOverlay.tsx";

const PortalLeadCreateContext = createContext(null);

export function usePortalLeadCreate() {
  const value = useContext(PortalLeadCreateContext);
  if (!value) {
    throw new Error("usePortalLeadCreate must be used within PortalLeadCreateProvider");
  }
  return value;
}

export function usePortalLeadCreateOptional() {
  return useContext(PortalLeadCreateContext);
}

/**
 * Shell-level create-lead overlay + draft islands for partner / reseller portals.
 * Persists across in-portal navigation.
 */
export function PortalLeadCreateProvider({
  children,
  fallbackPath,
  mode = "partner",
  onCreated,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    createSessions,
    hasDraftSessions,
    hasOpenSession,
    removeCreateSession,
    startCreateLead,
    updateCreateSession,
  } = useLeadCreateSessions();

  useEffect(() => {
    if (!location.state?.openCreate) {
      return;
    }
    startCreateLead();
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [location.pathname, location.search, location.state?.openCreate, navigate, startCreateLead]);

  const value = useMemo(
    () => ({
      fallbackPath,
      hasDraftSessions,
      hasOpenSession,
      mode,
      startCreateLead,
    }),
    [fallbackPath, hasDraftSessions, hasOpenSession, mode, startCreateLead],
  );

  return (
    <PortalLeadCreateContext.Provider value={value}>
      {children}
      {createSessions.map((session, index) => {
        const minimizedStackIndex = createSessions
          .filter((entry) => entry.presentation === "minimized")
          .findIndex((entry) => entry.id === session.id);

        return (
          <LeadCreateOverlay
            key={session.id}
            minimized={session.presentation === "minimized"}
            mode={mode}
            onClose={() => removeCreateSession(session.id)}
            onCreated={(successMessage) => {
              removeCreateSession(session.id);
              onCreated?.(successMessage);
              window.dispatchEvent(new CustomEvent("worktual:lead-updated"));
            }}
            onExpand={() => updateCreateSession(session.id, "open")}
            onMinimize={() => updateCreateSession(session.id, "minimized")}
            stackIndex={minimizedStackIndex >= 0 ? minimizedStackIndex : index}
          />
        );
      })}
    </PortalLeadCreateContext.Provider>
  );
}

/** @deprecated Prefer usePortalLeadCreate */
export function usePartnerLeadCreate() {
  return usePortalLeadCreate();
}

/** @deprecated Prefer PortalLeadCreateProvider */
export const PartnerLeadCreateProvider = PortalLeadCreateProvider;
