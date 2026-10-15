/**
 * Framework-agnostic configuration commands for Fastify Wave 7.
 */

import { getServerUserId } from "@/service/account/session-cookie";
import {
  deleteCalendarConnection,
  deleteOtherMailProvider,
  ensureExclusiveMailProvider,
  getCalendarConnection,
} from "@/dao/calendar/token-repository";
import {
  clearPreferredEmailProvider,
  getPreferredEmailProvider,
  setPreferredEmailProvider,
} from "@/service/email/preferred-provider";
import {
  googleHasCalendarScope,
  googleHasGmailReadScope,
  googleHasGmailSendScope,
  isGoogleConfigured,
} from "@/service/google/access-token";
import { googleRedirectUri, isGoogleBotConfigured } from "@/service/google/calendar";
import {
  displayMicrosoftAccountEmail,
  isMicrosoftGuestMailbox,
  isMicrosoftOAuthConfigured,
  microsoftHasMailReadScope,
  microsoftHasMailSendScope,
} from "@/service/microsoft/oauth";
import { isZoomConfigured } from "@/service/zoom/zoom-api";
import { isTeamsConfigured } from "@/service/microsoft/teams-api";
import type { ConnectedEmailProvider } from "@/service/email/send-connected-email";
import {
  canEditFinance,
  canEditOrgSettings,
  canManageSalesAssignment,
  canViewSalesAssignment,
  normalizeRole,
  type AppRole,
} from "@/service/auth/rbac";
import { getCurrentUserRole, requireRole } from "@/service/auth/require-role";
import { getCurrentOrganizationId } from "@/service/auth/require-role";
import { accountQuery } from "@/dao/db/account-pool";
import { resolveCrmBotMailbox } from "@/dao/account/crm-bot-mailbox";
import {
  getOrCreateOrgAssignmentSettings,
  listRepAssignmentProfiles,
  updateOrgAssignmentSettings,
  upsertRepAssignmentProfile,
  type OrgAssignmentSettingsView,
  type RepAssignmentProfile,
  type SeniorityTier,
} from "@/dao/sales/assignment-settings";

export type EmailIntegrationsStatus = {
  googleConfigured: boolean;
  googleRedirectUri: string | null;
  googleConnected: boolean;
  googleEmail: string | null;
  googleCanSendMail: boolean;
  googleCanReadMail: boolean;
  googleCanScheduleMeetings: boolean;
  microsoftConfigured: boolean;
  microsoftConnected: boolean;
  microsoftEmail: string | null;
  microsoftDisplayEmail: string | null;
  microsoftIsGuest: boolean;
  microsoftCanSendMail: boolean;
  microsoftCanReadMail: boolean;
  preferredSendProvider: ConnectedEmailProvider | null;
  canSendMail: boolean;
  zoomConfigured: boolean;
  teamsConfigured: boolean;
  crmBotChannelName: string | null;
  crmBotEmail: string | null;
  crmBotProvider: "google" | "microsoft" | null;
  crmBotConnected: boolean;
  crmBotNeedsReauth: boolean;
  canReconnectCrmBot: boolean;
};

/** When dual mail tokens were collapsed; route should persist cookie. */
export type EmailIntegrationsResult = {
  status: EmailIntegrationsStatus;
  preferredCookieToSet?: ConnectedEmailProvider | null;
  clearPreferredCookie?: boolean;
};

const emptyCrmBotFields = {
  crmBotChannelName: null as string | null,
  crmBotEmail: null as string | null,
  crmBotProvider: null as "google" | "microsoft" | null,
  crmBotConnected: false,
  crmBotNeedsReauth: false,
  canReconnectCrmBot: false,
};

export type CommandResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };

export async function getEmailIntegrationsCommand(): Promise<EmailIntegrationsResult> {
  const userId = await getServerUserId();
  const googleConfigured = isGoogleConfigured();
  const microsoftConfigured = isMicrosoftOAuthConfigured();
  const zoomConfigured = isZoomConfigured();
  const teamsConfigured = isTeamsConfigured();

  if (!userId) {
    return {
      status: {
        googleConfigured,
        googleRedirectUri: googleConfigured ? googleRedirectUri() : null,
        googleConnected: false,
        googleEmail: null,
        googleCanSendMail: false,
        googleCanReadMail: false,
        googleCanScheduleMeetings: false,
        microsoftConfigured,
        microsoftConnected: false,
        microsoftEmail: null,
        microsoftDisplayEmail: null,
        microsoftIsGuest: false,
        microsoftCanSendMail: false,
        microsoftCanReadMail: false,
        preferredSendProvider: null,
        canSendMail: false,
        zoomConfigured,
        teamsConfigured,
        ...emptyCrmBotFields,
      },
    };
  }

  let preferredSendProvider = await getPreferredEmailProvider();
  const reconciled = await ensureExclusiveMailProvider(
    userId,
    preferredSendProvider,
  );
  let preferredCookieToSet: ConnectedEmailProvider | undefined;
  if (reconciled) {
    await setPreferredEmailProvider(reconciled);
    preferredSendProvider = reconciled;
    preferredCookieToSet = reconciled;
  }

  const google = await getCalendarConnection(userId, "google");
  const microsoft = await getCalendarConnection(userId, "microsoft");
  const gScope = google?.scope ?? null;
  const mScope = microsoft?.scope ?? null;

  const googleCanSendMail =
    Boolean(google) && googleHasGmailSendScope(gScope);
  const microsoftIsGuest = isMicrosoftGuestMailbox(microsoft?.accountEmail);
  const microsoftCanSendMail =
    Boolean(microsoft) &&
    microsoftHasMailSendScope(mScope) &&
    !microsoftIsGuest;

  let crmBot = { ...emptyCrmBotFields };
  try {
    const mailbox = await resolveCrmBotMailbox(await getCurrentOrganizationId());
    if (mailbox) {
      const role = await getCurrentUserRole();
      crmBot = {
        crmBotChannelName: mailbox.channelName,
        crmBotEmail: mailbox.senderEmail || mailbox.accountEmail,
        crmBotProvider: mailbox.oauthProvider,
        crmBotConnected: Boolean(mailbox.oauthConnectionId),
        crmBotNeedsReauth: mailbox.needsReauth,
        canReconnectCrmBot:
          canEditOrgSettings(role) &&
          isGoogleBotConfigured() &&
          mailbox.oauthProvider === "google",
      };
    }
  } catch (err) {
    console.error(
      "CRM bot mailbox status failed",
      err instanceof Error ? err.message : err,
    );
  }

  return {
    status: {
      googleConfigured,
      googleRedirectUri: googleConfigured ? googleRedirectUri() : null,
      googleConnected: Boolean(google),
      googleEmail: google?.accountEmail ?? null,
      googleCanSendMail,
      googleCanReadMail: Boolean(google) && googleHasGmailReadScope(gScope),
      googleCanScheduleMeetings:
        googleCanSendMail && googleHasCalendarScope(gScope),
      microsoftConfigured,
      microsoftConnected: Boolean(microsoft),
      microsoftEmail: microsoft?.accountEmail ?? null,
      microsoftDisplayEmail: displayMicrosoftAccountEmail(
        microsoft?.accountEmail,
      ),
      microsoftIsGuest,
      microsoftCanSendMail,
      microsoftCanReadMail:
        Boolean(microsoft) && microsoftHasMailReadScope(mScope),
      preferredSendProvider,
      canSendMail: googleCanSendMail || microsoftCanSendMail,
      zoomConfigured,
      teamsConfigured,
      ...crmBot,
    },
    ...(preferredCookieToSet
      ? { preferredCookieToSet }
      : {}),
  };
}

export async function disconnectGoogleEmailCommand(): Promise<
  CommandResult & { clearPreferredCookie?: boolean }
> {
  const userId = await getServerUserId();
  if (!userId) return { ok: false, error: "Sign in again to disconnect Google." };
  const preferred = await getPreferredEmailProvider();
  await deleteCalendarConnection(userId, "google");
  if (preferred === "google") {
    await clearPreferredEmailProvider();
    return { ok: true, clearPreferredCookie: true };
  }
  return { ok: true };
}

export async function disconnectMicrosoftEmailCommand(): Promise<
  CommandResult & { clearPreferredCookie?: boolean }
> {
  const userId = await getServerUserId();
  if (!userId) {
    return { ok: false, error: "Sign in again to disconnect Microsoft." };
  }
  const preferred = await getPreferredEmailProvider();
  await deleteCalendarConnection(userId, "microsoft");
  if (preferred === "microsoft") {
    await clearPreferredEmailProvider();
    return { ok: true, clearPreferredCookie: true };
  }
  return { ok: true };
}

export async function setPreferredSendProviderCommand(
  provider: ConnectedEmailProvider,
): Promise<CommandResult & { provider?: ConnectedEmailProvider }> {
  const userId = await getServerUserId();
  if (!userId) {
    return { ok: false, error: "Sign in again to choose a send account." };
  }
  const conn = await getCalendarConnection(userId, provider);
  if (!conn) {
    return { ok: false, error: `Connect ${provider} first.` };
  }
  await deleteOtherMailProvider(userId, provider);
  await setPreferredEmailProvider(provider);
  return { ok: true, provider };
}

export type AssignmentRepView = {
  userId: string;
  displayName: string;
  email: string;
  role: AppRole;
  acceptingLeads: boolean;
  maxOpenDeals: number | null;
  seniorityTier: SeniorityTier | null;
  onPtoUntil: string | null;
  country: string | null;
  hasProfile: boolean;
};

async function loadSalesUsersForAssignment(
  organizationId: string,
): Promise<
  Array<{
    id: string;
    role: string | null;
    display_name: string | null;
    email: string;
  }>
> {
  const res = await accountQuery<{
    id: string;
    role: string | null;
    display_name: string | null;
    email: string;
  }>(
    `SELECT u.id::text AS id,
            lower(r.name) AS role,
            trim(both FROM coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')) AS display_name,
            lower(u.work_email) AS email
     FROM accounts.setup_users u
     LEFT JOIN accounts.setup_user_product_access a
       ON a.user_id = u.id AND a.product_id = 'crm'
     LEFT JOIN accounts.setup_roles r ON r.id = a.role_id
     WHERE u.status = 'active'
       AND u.organization_id = $1::bigint
       AND lower(coalesce(r.name, '')) IN ('admin', 'manager', 'sales rep', 'sales_manager', 'sales_rep')
     ORDER BY display_name ASC, email ASC`,
    [organizationId],
  );
  return res.rows;
}

export async function getAssignmentSettingsCommand(): Promise<
  | { ok: true; settings: OrgAssignmentSettingsView; canManage: boolean }
  | { ok: false; error: string }
> {
  try {
    const role = await requireRole(
      canViewSalesAssignment,
      "You do not have permission to view sales assignment settings.",
    );
    const orgId = await getCurrentOrganizationId();
    const settings = await getOrCreateOrgAssignmentSettings(orgId);
    return {
      ok: true,
      settings,
      canManage: canManageSalesAssignment(role),
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to load assignment settings.",
    };
  }
}

export async function patchAssignmentSettingsCommand(input: {
  seniorAmountThreshold?: number;
  leadIcp?: {
    targetIndustries?: string[];
    adjacentIndustries?: string[];
    sizeTiers?: string[];
    serviceableGeos?: string[];
  } | null;
  followupPolicy?: {
    hot?: {
      remindMinutes?: number;
      managerMinutes?: number;
      adminMinutes?: number;
    };
    warm?: {
      remindMinutes?: number;
      managerMinutes?: number;
      adminMinutes?: number;
    };
  } | null;
}): Promise<
  | { ok: true; settings: OrgAssignmentSettingsView }
  | { ok: false; error: string }
> {
  try {
    await requireRole(
      canManageSalesAssignment,
      "Only admins and sales managers can update sales assignment settings.",
    );
    if (
      input.seniorAmountThreshold == null &&
      input.leadIcp === undefined &&
      input.followupPolicy === undefined
    ) {
      return {
        ok: false,
        error: "Provide seniorAmountThreshold, leadIcp, and/or followupPolicy.",
      };
    }
    if (
      input.seniorAmountThreshold != null &&
      !Number.isFinite(input.seniorAmountThreshold)
    ) {
      return { ok: false, error: "seniorAmountThreshold must be a number." };
    }
    const orgId = await getCurrentOrganizationId();
    const userId = await getServerUserId();
    const settings = await updateOrgAssignmentSettings({
      organizationId: orgId,
      seniorAmountThreshold: input.seniorAmountThreshold,
      leadIcp: input.leadIcp,
      followupPolicy: input.followupPolicy
        ? {
            hot: {
              remindMinutes: input.followupPolicy.hot?.remindMinutes ?? 5,
              managerMinutes: input.followupPolicy.hot?.managerMinutes ?? 15,
              adminMinutes: input.followupPolicy.hot?.adminMinutes ?? 30,
            },
            warm: {
              remindMinutes: input.followupPolicy.warm?.remindMinutes ?? 30,
              managerMinutes: input.followupPolicy.warm?.managerMinutes ?? 120,
              adminMinutes: input.followupPolicy.warm?.adminMinutes ?? 240,
            },
            cold: {
              remind: "end_of_working_day",
              manager: "next_working_day",
              admin: "two_working_days",
            },
          }
        : undefined,
      updatedByUserId: userId,
    });
    return { ok: true, settings };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to update assignment settings.",
    };
  }
}

export async function listAssignmentRepsCommand(): Promise<
  | { ok: true; reps: AssignmentRepView[]; canManage: boolean }
  | { ok: false; error: string }
> {
  try {
    const role = await requireRole(
      canViewSalesAssignment,
      "You do not have permission to view sales assignment reps.",
    );
    const orgId = await getCurrentOrganizationId();
    const [users, profiles] = await Promise.all([
      loadSalesUsersForAssignment(orgId),
      listRepAssignmentProfiles(orgId),
    ]);
    const reps: AssignmentRepView[] = users.map((u) => {
      const profile = profiles.get(u.id);
      const display =
        u.display_name?.trim() ||
        u.email.split("@")[0]?.replace(/[._-]+/g, " ") ||
        u.email;
      return {
        userId: u.id,
        displayName: display,
        email: u.email,
        role: normalizeRole(u.role),
        acceptingLeads: profile?.acceptingLeads ?? true,
        maxOpenDeals: profile?.maxOpenDeals ?? null,
        seniorityTier: profile?.seniorityTier ?? null,
        onPtoUntil: profile?.onPtoUntil ?? null,
        country: profile?.country ?? null,
        hasProfile: Boolean(profile),
      };
    });
    return {
      ok: true,
      reps,
      canManage: canManageSalesAssignment(role),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load assignment reps.",
    };
  }
}

export async function upsertAssignmentRepCommand(
  userId: string,
  body: {
    acceptingLeads?: boolean;
    maxOpenDeals?: number | null;
    seniorityTier?: SeniorityTier | null;
    onPtoUntil?: string | null;
    country?: string | null;
  },
): Promise<
  | { ok: true; profile: RepAssignmentProfile }
  | { ok: false; error: string }
> {
  try {
    await requireRole(
      canManageSalesAssignment,
      "Only admins and sales managers can update rep assignment profiles.",
    );
    const targetId = userId?.trim();
    if (!targetId) return { ok: false, error: "userId is required." };

    const orgId = await getCurrentOrganizationId();
    const users = await loadSalesUsersForAssignment(orgId);
    if (!users.some((u) => u.id === targetId)) {
      return {
        ok: false,
        error: "User is not an active sales user in this organization.",
      };
    }

    const profile = await upsertRepAssignmentProfile({
      organizationId: orgId,
      userId: targetId,
      acceptingLeads: body.acceptingLeads,
      maxOpenDeals: body.maxOpenDeals,
      seniorityTier: body.seniorityTier,
      onPtoUntil: body.onPtoUntil,
      country: body.country,
    });
    return { ok: true, profile };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to update rep assignment profile.",
    };
  }
}

function apiPublicBaseUrl(): string {
  return (
    process.env.API_PUBLIC_URL?.replace(/\/$/, "") ||
    process.env.PUBLIC_API_URL?.replace(/\/$/, "") ||
    `http://localhost:${process.env.API_PORT || 4000}`
  );
}

export async function getFinanceBillingSettingsCommand(): Promise<
  | {
      ok: true;
      settings: Awaited<
        ReturnType<
          typeof import("@/dao/finance/org-finance-settings").getOrgFinanceSettingsPublic
        >
      >;
      webhookUrls: { stripe: string; razorpay: string };
    }
  | { ok: false; error: string }
> {
  try {
    await requireRole(
      canEditFinance,
      "Only Finance (or Admin) can view billing settings.",
    );
    const orgId = await getCurrentOrganizationId();
    const { getOrgFinanceSettingsPublic } = await import(
      "@/dao/finance/org-finance-settings"
    );
    const settings = await getOrgFinanceSettingsPublic(orgId);
    const base = apiPublicBaseUrl();
    return {
      ok: true,
      settings,
      webhookUrls: {
        stripe: `${base}/api/webhooks/stripe/${orgId}`,
        razorpay: `${base}/api/webhooks/razorpay/${orgId}`,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Failed to load billing settings.",
    };
  }
}

export async function patchFinanceBillingSettingsCommand(
  body: import("@/dao/finance/org-finance-settings").PatchOrgFinanceSettingsInput,
): Promise<
  | {
      ok: true;
      settings: Awaited<
        ReturnType<
          typeof import("@/dao/finance/org-finance-settings").updateOrgFinanceSettings
        >
      >;
      webhookUrls: { stripe: string; razorpay: string };
    }
  | { ok: false; error: string }
> {
  try {
    await requireRole(
      canEditFinance,
      "Only Finance (or Admin) can update billing settings.",
    );
    const orgId = await getCurrentOrganizationId();
    const userId = await getServerUserId();
    const { updateOrgFinanceSettings } = await import(
      "@/dao/finance/org-finance-settings"
    );
    const settings = await updateOrgFinanceSettings(orgId, body, userId);
    const base = apiPublicBaseUrl();
    return {
      ok: true,
      settings,
      webhookUrls: {
        stripe: `${base}/api/webhooks/stripe/${orgId}`,
        razorpay: `${base}/api/webhooks/razorpay/${orgId}`,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Failed to update billing settings.",
    };
  }
}

export async function getResearchProvidersCommand(): Promise<
  | {
      ok: true;
      providers: import("@/dao/ai/research-provider-config").OrgResearchProviderView[];
      leadIcp: import("@/dao/sales/assignment-settings").LeadIcpConfig | null;
      competitorStacks: string[];
      canManage: boolean;
    }
  | { ok: false; error: string }
> {
  try {
    const role = await requireRole(
      canEditOrgSettings,
      "Only admins and sales managers can view research provider settings.",
    );
    const orgId = await getCurrentOrganizationId();
    const {
      listOrgResearchProviderConfigs,
      getOrgCompetitorStacks,
    } = await import("@/dao/ai/research-provider-config");
    const settings = await getOrCreateOrgAssignmentSettings(orgId);
    const providers = await listOrgResearchProviderConfigs(orgId);
    const competitorStacks = await getOrgCompetitorStacks(orgId);
    return {
      ok: true,
      providers,
      leadIcp: settings.leadIcp,
      competitorStacks,
      canManage: canEditOrgSettings(role),
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to load research providers.",
    };
  }
}

export async function patchResearchProviderCommand(input: {
  provider: string;
  enabled?: boolean;
  apiKey?: string | null;
  clearApiKey?: boolean;
  settings?: Record<string, unknown> | null;
}): Promise<
  | {
      ok: true;
      provider: import("@/dao/ai/research-provider-config").OrgResearchProviderView;
    }
  | { ok: false; error: string }
> {
  try {
    await requireRole(
      canEditOrgSettings,
      "Only admins and sales managers can update research providers.",
    );
    const {
      RESEARCH_PROVIDERS,
      upsertOrgResearchProviderConfig,
    } = await import("@/dao/ai/research-provider-config");
    const provider = String(input.provider || "")
      .trim()
      .toLowerCase();
    if (!(RESEARCH_PROVIDERS as readonly string[]).includes(provider)) {
      return {
        ok: false,
        error: `provider must be one of: ${RESEARCH_PROVIDERS.join(", ")}`,
      };
    }
    if (input.apiKey != null && String(input.apiKey).trim()) {
      return {
        ok: false,
        error:
          "Research API keys are managed in MyAccounts. Connect Apollo, ZoomInfo, Lusha, or BuiltWith there — CRM only reads them.",
      };
    }
    if (input.clearApiKey) {
      return {
        ok: false,
        error:
          "Research API keys are managed in MyAccounts. Disconnect or rotate the key there.",
      };
    }
    const orgId = await getCurrentOrganizationId();
    const userId = await getServerUserId();
    const row = await upsertOrgResearchProviderConfig({
      organizationId: orgId,
      provider: provider as import("@/dao/ai/research-provider-config").ResearchProviderId,
      enabled: input.enabled,
      settings: input.settings,
      updatedByUserId: userId,
    });
    return { ok: true, provider: row };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to update research provider.",
    };
  }
}

export async function patchResearchIcpCommand(input: {
  leadIcp?: {
    targetIndustries?: string[];
    adjacentIndustries?: string[];
    sizeTiers?: string[];
    serviceableGeos?: string[];
  } | null;
  competitorStacks?: string[];
}): Promise<
  | {
      ok: true;
      leadIcp: import("@/dao/sales/assignment-settings").LeadIcpConfig | null;
      competitorStacks: string[];
    }
  | { ok: false; error: string }
> {
  try {
    await requireRole(
      canEditOrgSettings,
      "Only admins and sales managers can update ICP / research settings.",
    );
    const orgId = await getCurrentOrganizationId();
    const userId = await getServerUserId();
    let leadIcp =
      (
        await getOrCreateOrgAssignmentSettings(orgId)
      ).leadIcp;
    if (input.leadIcp !== undefined) {
      const settings = await updateOrgAssignmentSettings({
        organizationId: orgId,
        leadIcp: input.leadIcp,
        updatedByUserId: userId,
      });
      leadIcp = settings.leadIcp;
    }
    let competitorStacks: string[] = [];
    const { getOrgCompetitorStacks, setOrgCompetitorStacks } = await import(
      "@/dao/ai/research-provider-config"
    );
    if (input.competitorStacks !== undefined) {
      competitorStacks = await setOrgCompetitorStacks({
        organizationId: orgId,
        competitorStacks: input.competitorStacks,
        updatedByUserId: userId,
      });
    } else {
      competitorStacks = await getOrgCompetitorStacks(orgId);
    }
    return { ok: true, leadIcp, competitorStacks };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to update research ICP settings.",
    };
  }
}

export async function getInternalDomainsSettingsCommand(): Promise<
  | {
      ok: true;
      state: import("@/dao/org/organization-profile-store").InternalDomainsState;
      canManage: boolean;
    }
  | { ok: false; error: string }
> {
  try {
    const role = await requireRole(
      canEditOrgSettings,
      "Only admins and sales managers can view internal-domain settings.",
    );
    const orgId = await getCurrentOrganizationId();
    const { resolveInternalDomains } = await import(
      "@/service/account/internal-domains"
    );
    const state = await resolveInternalDomains(orgId);
    return { ok: true, state, canManage: canEditOrgSettings(role) };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to load internal-domain settings.",
    };
  }
}

export async function patchInternalDomainsSettingsCommand(input: {
  domains?: string[];
  overrideEmails?: string[];
}): Promise<
  | {
      ok: true;
      state: import("@/dao/org/organization-profile-store").InternalDomainsState;
    }
  | { ok: false; error: string }
> {
  try {
    await requireRole(
      canEditOrgSettings,
      "Only admins and sales managers can update internal-domain settings.",
    );
    if (input.domains === undefined && input.overrideEmails === undefined) {
      return {
        ok: false,
        error: "Provide domains and/or overrideEmails.",
      };
    }
    const orgId = await getCurrentOrganizationId();
    const {
      setManualInternalDomains,
      setInternalDomainOverrides,
    } = await import("@/service/account/internal-domains");
    let state: import("@/dao/org/organization-profile-store").InternalDomainsState | null =
      null;
    if (input.domains !== undefined) {
      state = await setManualInternalDomains(orgId, input.domains);
    }
    if (input.overrideEmails !== undefined) {
      state = await setInternalDomainOverrides(orgId, input.overrideEmails);
    }
    return { ok: true, state: state! };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to update internal-domain settings.",
    };
  }
}

export async function getLeadNurtureSettingsCommand(): Promise<
  | {
      ok: true;
      settings: import("@/dao/ai/org-nurture-settings").OrgNurtureSettingsView;
    }
  | { ok: false; error: string }
> {
  try {
    await requireRole(
      canEditOrgSettings,
      "Only Admin or Sales Manager can view lead nurture settings.",
    );
    const orgId = await getCurrentOrganizationId();
    const { getOrCreateOrgNurtureSettings } = await import(
      "@/dao/ai/org-nurture-settings"
    );
    const settings = await getOrCreateOrgNurtureSettings(orgId);
    return { ok: true, settings };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Failed to load nurture settings.",
    };
  }
}

export async function patchLeadNurtureSettingsCommand(body: {
  nurtureCallEnabled?: boolean;
  nurtureCallDelayMinutes?: number;
}): Promise<
  | {
      ok: true;
      settings: import("@/dao/ai/org-nurture-settings").OrgNurtureSettingsView;
    }
  | { ok: false; error: string }
> {
  try {
    await requireRole(
      canEditOrgSettings,
      "Only Admin or Sales Manager can update lead nurture settings.",
    );
    const orgId = await getCurrentOrganizationId();
    const userId = await getServerUserId();
    const { updateOrgNurtureSettings } = await import(
      "@/dao/ai/org-nurture-settings"
    );
    const settings = await updateOrgNurtureSettings(orgId, body, userId);
    return { ok: true, settings };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Failed to update nurture settings.",
    };
  }
}
