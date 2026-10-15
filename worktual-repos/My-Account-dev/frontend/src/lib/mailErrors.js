const MAIL_ERROR_PATTERNS = [
  {
    pattern: /not configured|MS_CLIENT_ID|oauth is not configured/i,
    message:
      "Mailbox is not set up yet. Ask your administrator to configure Microsoft mail in the server environment.",
  },
  {
    pattern: /admin consent|mail\.read|consent/i,
    message:
      "Your organization has not granted mailbox access yet. An IT admin may need to approve the app in Microsoft Azure.",
  },
  {
    pattern: /unsupported state|unable to authenticate data|authentication tag|bad decrypt/i,
    message: "Your Microsoft sign-in could not be restored. Sign in with Microsoft again.",
  },
  {
    pattern: /invalidauthenticationtoken|expired|token.*invalid|reconnect/i,
    message: "Your Microsoft sign-in has expired. Disconnect and sign in with Microsoft again.",
  },
  {
    pattern: /denied|access denied|forbidden|403/i,
    message: "Microsoft denied mailbox access for this account. Try a different mailbox or contact IT support.",
  },
  {
    pattern: /imap|smtp|credentials/i,
    message:
      "Mail credentials are missing or incorrect. Check IMAP/SMTP settings with your administrator.",
  },
  {
    pattern: /network|fetch|timeout|ECONNREFUSED/i,
    message: "Could not reach the mail service. Check your connection and try again in a moment.",
  },
];

export function humanizeMailError(rawMessage = "") {
  const message = String(rawMessage || "").trim();
  if (!message) {
    return "Something went wrong while loading mail. Try refreshing the page.";
  }

  for (const entry of MAIL_ERROR_PATTERNS) {
    if (entry.pattern.test(message)) {
      return entry.message;
    }
  }

  if (message.length > 180) {
    return "Something went wrong while loading mail. Try reconnecting your Microsoft account.";
  }

  return message;
}

export function isMailErrorRecoverable(rawMessage = "") {
  const message = String(rawMessage || "");
  return /consent|reconnect|expired|not configured|denied|oauth|sign in|unable to authenticate data|unsupported state/i.test(
    message,
  );
}

/**
 * Transient crypto / session noise (often on reload) — do not show in the mail list status area.
 */
export function shouldSuppressMailListStatusError(rawMessage = "") {
  const message = String(rawMessage || "");
  return /unsupported state|unable to authenticate data|operationerror|authentication tag|bad decrypt|wrong final block length/i.test(
    message,
  );
}

