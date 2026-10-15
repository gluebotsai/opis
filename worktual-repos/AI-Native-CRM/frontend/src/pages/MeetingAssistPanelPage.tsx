import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { AssistSidePanel } from "@/components/meeting-assist/AssistSidePanel";
import {
  hydrateMeetingAssistPanelTokenFromUrl,
  setMeetingAssistPanelToken,
} from "@/lib/meeting-assist-panel-auth";
import {
  parseTopicFromMeetingBody,
} from "@/lib/meeting-body";
import {
  fetchMeetingAssistSession,
  issueMeetingAssistPanelToken,
  type MeetingAssistSessionView,
} from "@/services/meetingAssist";
import { MeetingAssistPanelPageSkeleton } from "./MeetingAssistPanelPageSkeleton";

/**
 * Shared Assist side panel route for Meet / Zoom / Teams hosts and CRM deep links.
 * Auth: cookie session and/or ?token= panel JWT.
 */
export function MeetingAssistPanelPage() {
  const { sessionId: routeId } = useParams<{ sessionId: string }>();
  const [searchParams] = useSearchParams();
  const [session, setSession] = useState<MeetingAssistSessionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    hydrateMeetingAssistPanelTokenFromUrl(searchParams);
  }, [searchParams]);

  useEffect(() => {
    if (!routeId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        // Prefer issuing a panel token when cookie session is available
        // (deep link from CRM) so the URL is iframe-safe if copied later.
        try {
          const issued = await issueMeetingAssistPanelToken(routeId);
          if (issued.ok) setMeetingAssistPanelToken(issued.token);
        } catch {
          /* cookie may be absent inside host iframe — token query is enough */
        }

        const data = await fetchMeetingAssistSession(routeId);
        if (!cancelled) {
          if (!data?.id) {
            setError(
              "Session not found or unauthorized. Connect CRM from the host panel, or open from CRM.",
            );
            setSession(null);
          } else {
            setSession(data);
          }
        }
      } catch {
        if (!cancelled) {
          setError(
            "Session not found or unauthorized. Connect CRM from the host panel, or open from CRM.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [routeId]);

  if (loading) {
    return <MeetingAssistPanelPageSkeleton />;
  }

  if (error || !session) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-canvas p-6 text-center">
        <p className="text-sm text-text-secondary">
          {error ?? "Session not found."}
        </p>
      </div>
    );
  }

  const topic =
    parseTopicFromMeetingBody(session.activity?.body ?? null) ||
    session.activity?.subject.replace(/^Meeting:\s*/i, "").trim() ||
    null;

  return (
    <div className="crm-fade-in h-screen overflow-hidden bg-canvas">
      <AssistSidePanel
        sessionId={session.id}
        contactId={session.contactId}
        contactName={session.contactName || "Contact"}
        topic={topic}
        hostLabel="AI sales Assist"
      />
    </div>
  );
}
