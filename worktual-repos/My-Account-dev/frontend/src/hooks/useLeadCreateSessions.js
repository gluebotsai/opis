import { useCallback, useState } from "react";

import { createId } from "../lib/id.js";

/**
 * Multi-session create-lead overlay state (open + minimized draft islands).
 * Shared by sales ProductsPage and partner/reseller shells.
 */
export function useLeadCreateSessions() {
  const [createSessions, setCreateSessions] = useState([]);

  const startCreateLead = useCallback(() => {
    setCreateSessions((current) => {
      const withOpenMinimized = current.map((session) =>
        session.presentation === "open"
          ? { ...session, presentation: "minimized" }
          : session,
      );
      return [...withOpenMinimized, { id: createId(), presentation: "open" }];
    });
  }, []);

  const updateCreateSession = useCallback((sessionId, presentation) => {
    setCreateSessions((current) =>
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

  const removeCreateSession = useCallback((sessionId) => {
    setCreateSessions((current) => current.filter((session) => session.id !== sessionId));
  }, []);

  const hasOpenSession = createSessions.some((session) => session.presentation === "open");
  const hasDraftSessions = createSessions.length > 0;

  return {
    createSessions,
    hasDraftSessions,
    hasOpenSession,
    removeCreateSession,
    startCreateLead,
    updateCreateSession,
  };
}
