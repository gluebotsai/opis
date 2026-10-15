/**
 * Framework-agnostic Google / Microsoft OAuth BFF (Wave 13).
 * Callbacks hit the API host; returnTo sends the browser back to the SPA.
 */

import { getServerUserId } from "@/service/account/session-cookie";
import { runWithRequestUserId } from "@/service/account/request-context";
import {
  deleteOtherMailProvider,
  upsertCalendarConnection,
} from "@/dao/calendar/token-repository";
import { setPreferredEmailProvider } from "@/service/email/preferred-provider";
import type { ConnectedEmailProvider } from "@/service/email/preferred-provider";
import { requeueFailedCrmBotNurtureJobs } from "@/dao/ai/lead-nurture-store";
import {
  resolveCrmBotMailbox,
  saveCrmBotGoogleTokens,
} from "@/dao/account/crm-bot-mailbox";
import { canEditOrgSettings } from "@/service/auth/rbac";
import {
  ForbiddenError,
  getCurrentOrganizationId,
  requireRole,
} from "@/service/auth/require-role";
import {
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  fetchGoogleAccountEmail,
  googleBotOAuthClient,
  isGoogleBotConfigured,
  isGoogleConfigured,
  publicAppOrigin,
} from "@/service/google/calendar";
import { signOAuthState, verifyOAuthState } from "@/service/google/oauth-state";
import {
  buildMicrosoftAuthUrl,
  exchangeMicrosoftCode,
  fetchMicrosoftAccountEmail,
  isMicrosoftGuestMailbox,
  isMicrosoftOAuthConfigured,
  microsoftHasMailSendScope,
} from "@/service/microsoft/oauth";
import { googleHasGmailSendScope } from "@/service/google/access-token";

export type OAuthCallbackResult = {
  redirectUrl: string;
  preferredSendProvider?: ConnectedEmailProvider | null;
};

/** Where the SPA lives (post-OAuth redirect target base for relative returnTo). */
export function frontendAppOrigin(): string {
  const raw =
    process.env.FRONTEND_ORIGIN?.trim() ||
    process.env.VITE_PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "http://localhost:3000";
  try {
    const u = new URL(raw.includes("://") ? raw : `http://${raw}`);
    if (u.hostname === "0.0.0.0" || u.hostname === "::") {
      return "http://localhost:3000";
    }
    return `${u.protocol}//${u.host}`;
  } catch {
    return "http://localhost:3000";
  }
}

/** Origin registered with Google/Microsoft for /api/{provider}/oauth/callback. */
export function oauthCallbackOrigin(): string {
  const fromRedirect = process.env.GOOGLE_REDIRECT_URI?.trim()?.replace(
    /\/api\/google\/oauth\/callback\/?$/,
    "",
  );
  const raw =
    process.env.OAUTH_CALLBACK_ORIGIN?.trim() ||
    process.env.API_PUBLIC_URL?.trim() ||
    fromRedirect ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "http://localhost:4000";
  try {
    const u = new URL(raw.includes("://") ? raw : `http://${raw}`);
    if (u.hostname === "0.0.0.0" || u.hostname === "::") {
      return "http://localhost:4000";
    }
    return `${u.protocol}//${u.host}`;
  } catch {
    return "http://localhost:4000";
  }
}

export function resolveOAuthReturnUrl(
  returnTo: string,
  fallbackOrigin?: string,
): URL {
  const trimmed = returnTo.trim() || "/configuration/email";
  if (/^https?:\/\//i.test(trimmed)) {
    return new URL(trimmed);
  }
  const base =
    fallbackOrigin || frontendAppOrigin() || publicAppOrigin();
  return new URL(trimmed, base);
}

function withFlag(dest: URL, param: "calendar" | "email", flag: string): URL {
  dest.searchParams.set(param, flag);
  return dest;
}

export async function startGoogleOAuthCommand(input: {
  returnTo: string;
  requestOrigin?: string;
  intent?: string | null;
}): Promise<{ redirectUrl: string }> {
  const dest = resolveOAuthReturnUrl(input.returnTo, input.requestOrigin);
  const intent = input.intent?.trim() || undefined;
  const googleReady =
    intent === "crm_bot" ? isGoogleBotConfigured() : isGoogleConfigured();

  if (!googleReady) {
    return {
      redirectUrl: withFlag(dest, "calendar", "not_configured").toString(),
    };
  }

  const userId = await getServerUserId();
  if (!userId) {
    const login = new URL("/login", frontendAppOrigin());
    login.searchParams.set("next", input.returnTo || "/configuration/email");
    return { redirectUrl: login.toString() };
  }

  if (intent === "crm_bot") {
    try {
      await requireRole(
        canEditOrgSettings,
        "Only admins and sales managers can reconnect the CRM bot mailbox.",
      );
    } catch (err) {
      if (err instanceof ForbiddenError) {
        return {
          redirectUrl: withFlag(dest, "calendar", "crm_bot_forbidden").toString(),
        };
      }
      throw err;
    }
  }

  const state = signOAuthState(
    userId,
    input.returnTo || dest.pathname,
    intent,
  );
  let loginHint: string | null = null;
  let clientId: string | null = null;
  if (intent === "crm_bot") {
    const mailbox = await resolveCrmBotMailbox(await getCurrentOrganizationId());
    loginHint = mailbox?.accountEmail || mailbox?.senderEmail || null;
    clientId = googleBotOAuthClient()?.clientId ?? null;
  }
  return { redirectUrl: buildGoogleAuthUrl(state, { loginHint, clientId }) };
}

export async function handleGoogleOAuthCallbackCommand(input: {
  code: string | null;
  state: string | null;
  oauthError: string | null;
}): Promise<OAuthCallbackResult> {
  const verified = input.state ? verifyOAuthState(input.state) : null;
  const returnPath = verified?.returnTo || "/configuration/email";
  const destBase = resolveOAuthReturnUrl(returnPath);

  const redirectWith = (flag: string): OAuthCallbackResult => ({
    redirectUrl: withFlag(new URL(destBase.toString()), "calendar", flag).toString(),
  });

  if (verified?.intent === "crm_bot") {
    if (!isGoogleBotConfigured()) return redirectWith("not_configured");
  } else if (!isGoogleConfigured()) {
    return redirectWith("not_configured");
  }
  if (input.oauthError) return redirectWith("denied");
  if (!input.code || !input.state || !verified) {
    return redirectWith(verified ? "invalid" : "invalid_state");
  }

  try {
    const tokens = await exchangeGoogleCode(
      input.code,
      verified.intent === "crm_bot" ? googleBotOAuthClient() : null,
    );
    const email = await fetchGoogleAccountEmail(tokens.access_token);

    if (verified.intent === "crm_bot") {
      return await runWithRequestUserId(verified.userId, async () => {
        await requireRole(
          canEditOrgSettings,
          "Only admins and sales managers can reconnect the CRM bot mailbox.",
        );
        if (!tokens.refresh_token) {
          return redirectWith("crm_bot_no_refresh");
        }
        const saved = await saveCrmBotGoogleTokens({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: tokens.expires_in
            ? new Date(Date.now() + tokens.expires_in * 1000)
            : null,
          accountEmail: email,
          scope: tokens.scope ?? null,
        });
        if (!saved.ok) {
          if (saved.error.startsWith("wrong_account:")) {
            return redirectWith("crm_bot_wrong_account");
          }
          console.error("CRM bot Google reconnect failed", saved.error);
          return redirectWith("crm_bot_error");
        }
        await requeueFailedCrmBotNurtureJobs(
          await getCurrentOrganizationId(),
        ).catch((err) =>
          console.error("requeue nurture after CRM bot reconnect failed", err),
        );
        void import("@/service/ai/lead-nurture-job").then(({ processDueLeadNurtureJobs }) =>
          processDueLeadNurtureJobs().catch((err) =>
            console.error("nurture retry after CRM bot reconnect failed", err),
          ),
        );
        void import("@/service/inbox/gmail-push").then(({ registerGmailPushWatchForCrmBot }) =>
          getCurrentOrganizationId().then((orgId) => {
            if (!orgId) return;
            return registerGmailPushWatchForCrmBot(orgId).catch((err) =>
              console.error("gmail push watch after CRM bot reconnect failed", err),
            );
          }),
        );
        return redirectWith("crm_bot_connected");
      });
    }

    await upsertCalendarConnection({
      userId: verified.userId,
      provider: "google",
      accountEmail: email,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      tokenExpiresAt: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : null,
      scope: tokens.scope ?? null,
    });
    // One mail account at a time — drop Microsoft if present.
    await deleteOtherMailProvider(verified.userId, "google");
    void import("@/service/inbox/gmail-push").then(({ registerGmailPushWatchForUser }) =>
      registerGmailPushWatchForUser(verified.userId).catch((err) =>
        console.error("gmail push watch after Google connect failed", err),
      ),
    );
    void import("@/service/calendar/google-calendar-push").then(
      ({ registerGoogleCalendarWatchForUser }) =>
        registerGoogleCalendarWatchForUser(verified.userId).catch((err) =>
          console.error("calendar push watch after Google connect failed", err),
        ),
    );
    let preferredSendProvider: ConnectedEmailProvider | null = null;
    if (googleHasGmailSendScope(tokens.scope ?? null)) {
      await setPreferredEmailProvider("google");
      preferredSendProvider = "google";
    }
    return { ...redirectWith("connected"), preferredSendProvider };
  } catch (err) {
    console.error(err);
    if (err instanceof ForbiddenError) {
      return redirectWith("crm_bot_forbidden");
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (/invalid_client|client secret is invalid/i.test(msg)) {
      return redirectWith("invalid_secret");
    }
    if (/redirect_uri_mismatch/i.test(msg)) {
      return redirectWith("redirect_mismatch");
    }
    return redirectWith("error");
  }
}

export async function startMicrosoftOAuthCommand(input: {
  returnTo: string;
  requestOrigin?: string;
}): Promise<{ redirectUrl: string }> {
  const dest = resolveOAuthReturnUrl(input.returnTo, input.requestOrigin);

  if (!isMicrosoftOAuthConfigured()) {
    return {
      redirectUrl: withFlag(dest, "email", "microsoft_not_configured").toString(),
    };
  }

  const userId = await getServerUserId();
  if (!userId) {
    const login = new URL("/login", frontendAppOrigin());
    login.searchParams.set("next", input.returnTo || "/configuration/email");
    return { redirectUrl: login.toString() };
  }

  const state = signOAuthState(userId, input.returnTo || dest.pathname);
  return { redirectUrl: buildMicrosoftAuthUrl(state) };
}

export async function handleMicrosoftOAuthCallbackCommand(input: {
  code: string | null;
  state: string | null;
  oauthError: string | null;
}): Promise<OAuthCallbackResult> {
  const verified = input.state ? verifyOAuthState(input.state) : null;
  const returnPath = verified?.returnTo || "/configuration/email";
  const destBase = resolveOAuthReturnUrl(returnPath);

  const redirectWith = (flag: string): OAuthCallbackResult => ({
    redirectUrl: withFlag(new URL(destBase.toString()), "email", flag).toString(),
  });

  if (!isMicrosoftOAuthConfigured()) {
    return redirectWith("microsoft_not_configured");
  }
  if (input.oauthError) return redirectWith("microsoft_denied");
  if (!input.code || !input.state || !verified) {
    return redirectWith(
      verified ? "microsoft_invalid" : "microsoft_invalid_state",
    );
  }

  try {
    const tokens = await exchangeMicrosoftCode(input.code);
    const email = await fetchMicrosoftAccountEmail(tokens.access_token);
    await upsertCalendarConnection({
      userId: verified.userId,
      provider: "microsoft",
      accountEmail: email,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      tokenExpiresAt: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : null,
      scope: tokens.scope ?? null,
    });
    // One mail account at a time — drop Google if present.
    await deleteOtherMailProvider(verified.userId, "microsoft");
    let preferredSendProvider: ConnectedEmailProvider | null = null;
    if (
      !isMicrosoftGuestMailbox(email) &&
      microsoftHasMailSendScope(tokens.scope)
    ) {
      await setPreferredEmailProvider("microsoft");
      preferredSendProvider = "microsoft";
    }
    return {
      ...redirectWith(
        isMicrosoftGuestMailbox(email)
          ? "microsoft_guest"
          : "microsoft_connected",
      ),
      preferredSendProvider,
    };
  } catch (err) {
    console.error(err);
    return redirectWith("microsoft_error");
  }
}
