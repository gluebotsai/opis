import { useCallback, useState } from "react";

import { createId } from "../lib/id.js";

/**
 * Multi-session edit-lead overlay state (open + minimized draft islands).
 * Mounted at sales workspace shell so edit works from Products and Customers.
 */
export function useLeadEditSessions() {
  const [editSessions, setEditSessions] = useState([]);

  const startEditLead = useCallback((leadId) => {
    const normalizedLeadId = String(leadId || "").trim();
    if (!normalizedLeadId) {
      return;
    }

    setEditSessions((current) => {
      const withoutDuplicate = current.filter((session) => session.leadId !== normalizedLeadId);
      const withOpenMinimized = withoutDuplicate.map((session) =>
        session.presentation === "open"
          ? { ...session, presentation: "minimized" }
          : session,
      );
      return [
        ...withOpenMinimized,
        { id: createId(), leadId: normalizedLeadId, presentation: "open" },
      ];
    });
  }, []);

  const updateEditSession = useCallback((sessionId, presentation) => {
    setEditSessions((current) =>
      current.map((session) => {
        if (session.id === sessionId) {
          return { ...session, presentation };
        }
        if (presentation === "open" && session.presentation === "open") {
          return { ...session, presentation: "minimized" };
        }
        return session;
      }),
    );
  }, []);

  const removeEditSession = useCallback((sessionId) => {
    setEditSessions((current) => current.filter((session) => session.id !== sessionId));
  }, []);

  const hasOpenEditSession = editSessions.some((session) => session.presentation === "open");
  const hasEditDraftSessions = editSessions.length > 0;

  return {
    editSessions,
    hasEditDraftSessions,
    hasOpenEditSession,
    removeEditSession,
    startEditLead,
    updateEditSession,
  };
}
