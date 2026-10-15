import { useEffect, useState, useTransition } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { issueMeetingAssistHostToken } from "@/services/meetingAssist";
import {
  setMeetingAssistPanelToken,
} from "@/lib/meeting-assist-panel-auth";
import { useAppSelector } from "@/store";

/**
 * Top-level Connect CRM flow for Meet / Zoom / Teams hosts.
 * Popup: issues JWT and postMessages opener.
 * Same-tab (popup blocked / localhost): issues JWT and redirects back.
 */
export function MeetingAssistLinkPage() {
  const { user, bootstrapped } = useAppSelector((s) => s.auth);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isPopup = searchParams.get("popup") === "1";
  const host = searchParams.get("host") || "meet";
  const returnToRaw = searchParams.get("returnTo")?.trim() || "";
  const returnTo =
    returnToRaw.startsWith("/meeting-assist/") ? returnToRaw : "";
  const [message, setMessage] = useState("Connecting…");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!bootstrapped) return;
    if (!user) {
      const nextPath = returnTo
        ? `/meeting-assist/link?host=${encodeURIComponent(host)}&returnTo=${encodeURIComponent(returnTo)}`
        : `/meeting-assist/link?popup=1&host=${encodeURIComponent(host)}`;
      navigate(`/login?next=${encodeURIComponent(nextPath)}`, { replace: true });
      return;
    }

    startTransition(async () => {
      const result = await issueMeetingAssistHostToken();
      if (!result.ok) {
        setMessage(result.error || "Could not issue token.");
        return;
      }
      setMeetingAssistPanelToken(result.token);
      if (isPopup && window.opener) {
        window.opener.postMessage(
          {
            type: "worktual-meeting-assist-linked",
            token: result.token,
            host,
          },
          window.location.origin,
        );
        setMessage("Connected. You can close this window.");
        window.setTimeout(() => window.close(), 800);
        return;
      }

      const dest =
        returnTo ||
        `/meeting-assist/hosts/${encodeURIComponent(host)}?token=${encodeURIComponent(result.token)}`;
      setMessage("CRM linked. Returning to Assist…");
      navigate(dest, { replace: true });
    });
  }, [bootstrapped, user, isPopup, host, returnTo, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm rounded-xl border border-border-default bg-surface p-6 text-center shadow-sm">
        <p className="text-xs uppercase tracking-wide text-brand">
          Worktual Assist
        </p>
        <h1 className="mt-2 text-lg font-semibold text-text-primary">
          Link CRM account
        </h1>
        <p className="mt-3 text-sm text-text-secondary">
          {pending ? "Issuing secure panel token…" : message}
        </p>
      </div>
    </div>
  );
}
