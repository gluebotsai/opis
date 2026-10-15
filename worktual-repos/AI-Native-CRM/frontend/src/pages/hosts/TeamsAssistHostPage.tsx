import { useEffect, useState } from "react";
import { MeetingAssistHostShell } from "@/components/meeting-assist/MeetingAssistHostShell";

/**
 * Teams meetingSidePanel host — same Assist shell.
 * Tenant admin installs the Teams app; panel is opened from meeting Apps.
 */
export function TeamsAssistHostPage() {
  const [sdkStatus, setSdkStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { app } = await import("@microsoft/teams-js");
        await app.initialize();
        const context = await app.getContext();
        if (!cancelled) {
          const meetingId =
            context.meeting?.id || context.chat?.id || "meeting";
          setSdkStatus(`Teams meeting context: ${meetingId}`);
        }
      } catch (err) {
        if (!cancelled) {
          setSdkStatus(
            err instanceof Error
              ? `Teams SDK: ${err.message} (ok outside Teams)`
              : "Teams SDK unavailable (ok outside Teams)",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return <MeetingAssistHostShell host="teams" sdkStatus={sdkStatus} />;
}
