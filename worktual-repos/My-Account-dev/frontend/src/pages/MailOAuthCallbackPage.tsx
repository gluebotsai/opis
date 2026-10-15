// @ts-nocheck
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  clearMailOAuthPopupPending,
  finishMailOAuthPopup,
} from "../lib/email.js";
import { humanizeMailError } from "../lib/mailErrors.js";

export function MailOAuthCallbackPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [message, setMessage] = useState("Completing Microsoft sign-in…");

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const oauthResult = params.get("oauth");
    const oauthMessage = params.get("message");
    const oauthEmail = params.get("email");
    const redirect = params.get("redirect") || "/mail";

    if (!oauthResult) {
      navigate(redirect, { replace: true });
      return;
    }

    if (oauthResult === "success") {
      finishMailOAuthPopup({
        status: "success",
        email: oauthEmail ? decodeURIComponent(oauthEmail) : "",
      });
      clearMailOAuthPopupPending();
      setMessage("Outlook connected. Closing this tab…");
      const timer = window.setTimeout(() => {
        setMessage("Outlook connected. You can close this tab and return to mail.");
      }, 1200);
      return () => window.clearTimeout(timer);
    }

    if (oauthResult === "admin_consent_success") {
      finishMailOAuthPopup({ status: "admin_consent_success" });
      clearMailOAuthPopupPending();
      setMessage("Admin consent granted. Closing this tab…");
      const timer = window.setTimeout(() => {
        setMessage("Admin consent granted. You can close this tab and sign in again.");
      }, 1200);
      return () => window.clearTimeout(timer);
    }

    if (oauthResult === "error") {
      let resolvedMessage = humanizeMailError(oauthMessage || "Could not connect Outlook.");
      try {
        resolvedMessage = decodeURIComponent(resolvedMessage);
      } catch {
        // Keep raw message.
      }
      finishMailOAuthPopup({ status: "error", message: resolvedMessage });
      clearMailOAuthPopupPending();
      setMessage(resolvedMessage);
    }
  }, [location.search, navigate]);

  return (
    <div className="mail-oauth-callback">
      <p>{message}</p>
    </div>
  );
}
