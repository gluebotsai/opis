import { canUserModifyLead, canUserViewLead, getLeadOwnership } from "./leads.js";
import { getOrganizationById } from "./organizations.js";
import { getSubscriptionById } from "./subscriptions.js";

function deny(status, error) {
  return { ok: false, status, error };
}

export async function authorizeLeadView(authUser, leadId) {
  const ownership = await getLeadOwnership(leadId);
  if (!ownership) {
    return deny(404, "Lead not found.");
  }
  if (!canUserViewLead(authUser, ownership)) {
    return deny(403, "You do not have permission to view this lead.");
  }
  return { ok: true, ownership };
}

export async function authorizeLeadModify(authUser, leadId) {
  const ownership = await getLeadOwnership(leadId);
  if (!ownership) {
    return deny(404, "Lead not found.");
  }
  if (!canUserModifyLead(authUser, ownership)) {
    return deny(403, "You do not have permission to modify this lead.");
  }
  return { ok: true, ownership };
}

export async function authorizeOrganizationView(authUser, organizationId) {
  const organization = await getOrganizationById(organizationId);
  if (!organization) {
    return deny(404, "Organization not found.");
  }
  if (!organization.sourceLeadId) {
    return deny(403, "You do not have permission to view this organization.");
  }
  return authorizeLeadView(authUser, organization.sourceLeadId);
}

export async function authorizeSubscriptionView(authUser, subscriptionId) {
  const subscription = await getSubscriptionById(subscriptionId);
  if (!subscription) {
    return deny(404, "Subscription not found.");
  }
  if (!subscription.sourceLeadId) {
    return deny(403, "You do not have permission to view this subscription.");
  }
  return authorizeLeadView(authUser, subscription.sourceLeadId);
}

export async function authorizeSubscriptionModify(authUser, subscriptionId) {
  const subscription = await getSubscriptionById(subscriptionId);
  if (!subscription) {
    return deny(404, "Subscription not found.");
  }
  if (!subscription.sourceLeadId) {
    return deny(403, "You do not have permission to modify this subscription.");
  }
  return authorizeLeadModify(authUser, subscription.sourceLeadId);
}

export function rejectUnlessAuthorized(response, result) {
  if (result.ok) {
    return true;
  }
  response.status(result.status).json({ error: result.error });
  return false;
}
