import { useEffect, useState } from "react";
import type { MeetSidePanelClient } from "@googleworkspace/meet-addons/meet.addons";
import { MeetingAssistHostShell } from "@/components/meeting-assist/MeetingAssistHostShell";

const PROJECT_NUMBER =
  (import.meta.env.VITE_GOOGLE_CLOUD_PROJECT_NUMBER as string | undefined)?.trim() ||
  (import.meta.env.VITE_NEXT_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER as string | undefined)?.trim() ||
  "";

// The Meet Add-ons SDK throws "AddonSessionAlreadyCreated" if
// createAddonSession() is called twice in the same tab — React 18 StrictMode
// double-invokes effects in dev, and Vite HMR re-evaluates this module (and
// resets any module-level `let`) whenever this file is edited, so a plain
// module-scope cache doesn't survive either case. `window` does survive both,
// since it's the same JS realm for the lifetime of the real tab/iframe that
// the SDK session itself is scoped to.
declare global {
  interface Window {
    __worktualMeetSidePanelClientPromise?: Promise<MeetSidePanelClient>;
  }
}

/**
 * Google Meet add-on sidePanelUrl host.
 * Loads Meet Add-ons SDK when project number is set, reads the current
 * meeting code so the shell can jump straight to the right attendee with
 * no manual meeting picker, then renders the shared Assist shell.
 */
export function MeetAssistHostPage() {
  const [sdkStatus, setSdkStatus] = useState<string | null>(null);
  const [autoMeetCode, setAutoMeetCode] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Outside Google Meet's add-on iframe the SDK cannot start — expected on
    // localhost CRM testing. Skip the noisy banner and use Meet code entry.
    const inMeetAddonFrame =
      typeof window !== "undefined" && window.parent !== window;
    if (!PROJECT_NUMBER || !inMeetAddonFrame) {
      if (!cancelled && !inMeetAddonFrame) {
        setSdkStatus(
          "Local Assist test — enter Meet code below (or open panel URL). Meet Add-on SDK only runs inside Meet.",
        );
      } else if (!PROJECT_NUMBER) {
        setSdkStatus(
          "Preview mode: set VITE_GOOGLE_CLOUD_PROJECT_NUMBER to enable the full Meet Add-on SDK.",
        );
      }
      return;
    }
    (async () => {
      try {
        if (!window.__worktualMeetSidePanelClientPromise) {
          window.__worktualMeetSidePanelClientPromise = (async () => {
            const mod = await import("@googleworkspace/meet-addons/meet.addons");
            const session = await mod.meet.addon.createAddonSession({
              cloudProjectNumber: PROJECT_NUMBER,
            });
            return session.createSidePanelClient();
          })();
        }
        const client = await window.__worktualMeetSidePanelClientPromise;
        const info = await client.getMeetingInfo();
        if (!cancelled) {
          setSdkStatus(null);
          setAutoMeetCode(info.meetingCode || null);
        }
      } catch (err) {
        window.__worktualMeetSidePanelClientPromise = undefined;
        console.error("Meet add-on SDK init failed", err);
        if (!cancelled) {
          setSdkStatus(
            "Meet Add-on SDK unavailable — enter Meet code below; CRM features still work.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <MeetingAssistHostShell
      host="meet"
      sdkStatus={sdkStatus}
      autoMeetingCode={autoMeetCode}
    />
  );
}
