import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { skippedReason } from "@/lib/nurture-skip-reason";
import {
  TONE_DANGER,
  TONE_INFO,
  TONE_MUTED,
  TONE_SUCCESS,
  TONE_WARNING,
} from "@/lib/ui-tones";

type Props = {
  status?: string | null;
  decision?: string | null;
  lastSentAt?: string | null;
  lastError?: string | null;
  rationale?: string | null;
  nextRetryAt?: string | null;
  skipReason?: string | null;
  resultSummary?: unknown;
};

/**
 * Read-only chip for the last autonomous nurture decision on a lead.
 */
export function LeadNurtureStatusBadge({
  status = null,
  decision = null,
  lastSentAt = null,
  lastError = null,
  rationale = null,
  nextRetryAt = null,
  skipReason = null,
  resultSummary = null,
}: Props) {
  const summary =
    resultSummary &&
    typeof resultSummary === "object" &&
    !Array.isArray(resultSummary)
      ? (resultSummary as Record<string, unknown>)
      : null;
  const transport =
    typeof summary?.transport === "string" ? summary.transport : null;
  const voiceFallback =
    typeof summary?.voiceFallback === "string"
      ? summary.voiceFallback.trim()
      : null;
  const voiceCallWaiting =
    status === "waited" &&
    (typeof summary?.callTouchEligibleAt === "string" ||
      (rationale ?? "").toLowerCase().includes("voice call scheduled"));
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!voiceCallWaiting || !nextRetryAt) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [nextRetryAt, voiceCallWaiting]);

  if (!status || status === "pending" || status === "analyzing") {
    if (status === "analyzing") {
      return (
        <div
          className={`mb-4 rounded-md border border-[#b6d0f5] px-3 py-2 text-sm ${TONE_INFO}`}
          role="status"
        >
          Nurture agent analyzing engagement…
        </div>
      );
    }
    return null;
  }

  let label: string | null = null;
  let tone = `${TONE_MUTED} border-border-default`;

  if (status === "analyzing") {
    label = "Nurture agent re-queued — contact details updated";
    tone = `${TONE_INFO} border-[#b6d0f5]`;
  } else if (status === "sent") {
    const when = lastSentAt
      ? ` · ${new Date(lastSentAt).toLocaleDateString()}`
      : "";
    if (transport === "voice_auto_bot") {
      label = `Nurture voice call started${when}`;
    } else if (voiceFallback) {
      label = `Nurture email sent${when} — voice call unavailable: ${friendlyNurtureError(voiceFallback)}`;
    } else if (
      transport === "campaign" ||
      transport === "campaign_automation" ||
      transport === "fallback"
    ) {
      label = `Nurture email sent${when}`;
    } else {
      label = `Nurture touch sent${when}`;
    }
    tone = `${TONE_SUCCESS} border-[#b7e4c7]`;
  } else if (status === "waited") {
    label = waitedLabel(rationale, nextRetryAt, nowMs);
    tone = `${TONE_WARNING} border-[#f0d78c]`;
  } else if (status === "skipped") {
    label = `Nurture skipped — ${skippedReason({
      decision,
      skipReason,
      lastError,
      rationale,
    })}`;
    tone = `${TONE_MUTED} border-border-default`;
  } else if (status === "failed") {
    label = lastError
      ? `Nurture send failed — ${friendlyNurtureError(lastError)}`
      : "Nurture send failed — will retry";
    tone = `${TONE_DANGER} border-[#f5c2c0]`;
  }

  if (!label) return null;

  const reauth = isCrmBotReauthError(lastError);
  return (
    <div className={`mb-4 rounded-md border px-3 py-2 text-sm ${tone}`} role="status">
      {label}
      {reauth ? (
        <>
          {" "}
          <Link
            to="/configuration/email"
            className="font-medium text-text-link underline-offset-2 hover:underline"
          >
            Reconnect in Email settings
          </Link>
        </>
      ) : null}
    </div>
  );
}

function waitedLabel(
  rationale: string | null | undefined,
  nextRetryAt: string | null | undefined,
  nowMs: number,
): string {
  const retryAt = nextRetryAt ? new Date(nextRetryAt) : null;
  const validRetryAt =
    retryAt && !Number.isNaN(retryAt.getTime()) ? retryAt : null;
  const when = validRetryAt
    ? ` We'll check again on ${validRetryAt.toLocaleDateString()}.`
    : " We'll check again soon.";
  const key = (rationale ?? "").trim().toLowerCase();
  if (key.includes("voice call scheduled")) {
    if (!validRetryAt) {
      return "Nurture voice call scheduled — waiting for the call worker.";
    }
    const remainingMs = validRetryAt.getTime() - nowMs;
    if (remainingMs <= 0) {
      return "Nurture voice call is due — waiting for the call worker.";
    }
    return `Nurture voice call scheduled — calling in ${formatCountdown(remainingMs)}.`;
  }
  if (key.includes("recent activity")) {
    return `Nurture email not sent — this contact had activity in the last day, so we paused outreach to avoid bothering them.${when}`;
  }
  if (rationale && rationale.trim().length <= 120 && !/[`"{}]/.test(rationale)) {
    return `Nurture email not sent — ${rationale.trim().replace(/\.$/, "")}.${when}`;
  }
  return `Nurture email not sent yet — waiting before the next follow-up.${when}`;
}

function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
}

function isCrmBotReauthError(code: string | null | undefined): boolean {
  const key = (code ?? "").trim().toLowerCase();
  if (!key) return false;
  return (
    key === "needs_connect" ||
    key === "crm_bot_gmail_reauth" ||
    key.includes("mailbox needs re-authentication") ||
    key.includes("reconnect the crm bot")
  );
}

function isTokenDecryptError(code: string | null | undefined): boolean {
  const key = (code ?? "").trim().toLowerCase();
  if (!key) return false;
  return (
    key === "crm_bot_token_decrypt_failed" ||
    key.includes("unable to authenticate data") ||
    key.includes("unsupported state") ||
    key.includes("failed to decrypt accounts")
  );
}

function friendlyNurtureError(code: string): string {
  const key = code.trim().toLowerCase();
  if (key === "job_budget_exceeded") {
    return "agent timed out (budget); will retry";
  }
  if (key === "no_owner_mailbox" || key === "no_owner") {
    return "no owner mailbox connected";
  }
  if (key === "no_email") return "contact has no email";
  if (isTokenDecryptError(code)) {
    return "CRM API cannot decrypt bot mailbox tokens — set MS_TOKEN_ENCRYPTION_KEY to match Accounts, then restart API.";
  }
  if (isCrmBotReauthError(code)) {
    return "CRM bot mailbox needs re-authentication in Accounts.";
  }
  if (
    /google token refresh failed/i.test(key) &&
    /unauthorized_client|invalid_client|invalid_grant/i.test(key)
  ) {
    return "CRM bot mailbox needs re-authentication in Accounts.";
  }
  if (key === "contact_not_found") return "contact missing";
  if (key.length <= 80 && !/[`"{}]/.test(key) && !key.includes("\n")) {
    return code.trim();
  }
  return "will retry";
}
