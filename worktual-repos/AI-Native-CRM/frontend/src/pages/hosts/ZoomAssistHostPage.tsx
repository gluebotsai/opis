import { useEffect, useState } from "react";
import { MeetingAssistHostShell } from "@/components/meeting-assist/MeetingAssistHostShell";

/**
 * Zoom App inMeeting sidebar — same panel URL / Assist shell + Zoom Apps SDK.
 * Account admin installs the Zoom App; OAuth is handled by Zoom + Connect CRM popup.
 */
export function ZoomAssistHostPage() {
  const [sdkStatus, setSdkStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const zoomSdk = (await import("@zoom/appssdk")).default;
        await zoomSdk.config({
          capabilities: ["getMeetingContext", "getRunningContext"],
        });
        const ctx = await zoomSdk.getRunningContext();
        if (!cancelled) {
          setSdkStatus(
            ctx ? `Zoom context: ${String(ctx)}` : "Zoom Apps SDK ready",
          );
        }
      } catch (err) {
        if (!cancelled) {
          setSdkStatus(
            err instanceof Error
              ? `Zoom SDK: ${err.message} (ok outside Zoom)`
              : "Zoom SDK unavailable (ok outside Zoom)",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return <MeetingAssistHostShell host="zoom" sdkStatus={sdkStatus} />;
}
