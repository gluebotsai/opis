import { pool, withTransaction } from "../../db/pool.js";
import { rowToCamel } from "../../db/util.js";
import { resyncOrganizationCustomerGrants } from "../customer-portal/customer-auth.js";
import {
  cancelScheduledSubscriptionInvoices,
  cancelSubscriptionRow,
  clearScheduledBranchDrop,
  clearScheduledSubscriptionCancellation,
  deactivateBranchCustomerUsers,
  deleteActiveProductRow,
  deleteGrantsForSubscription,
  scheduleBranchDrop,
  scheduleSubscriptionCancellation,
  selectActiveSubscriptionsAtLocation,
  selectLocationsDueForDrop,
  selectOrganizationLocation,
  selectSubscriptionsDueForCancellation,
  updateOrganizationLocationInactive,
} from "../../repositories/raw/branchCancellationRequests.repo.js";
import { cancelRenewalEventsForSubscription } from "../../repositories/raw/renewals.repo.js";
import { selectSubscriptionById } from "../../repositories/raw/subscriptions.repo.js";

function mapSubscription(row: any) {
  if (!row) {
    return null;
  }
  return rowToCamel(row);
}

function addMonths(date: any, months: any) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function addYears(date: any, years: any) {
  const next = new Date(date);
  next.setFullYear(next.getFullYear() + years);
  return next;
}

function computeSubscriptionEffectiveAt(subRow: any) {
  if (subRow.renews_at) {
    return new Date(subRow.renews_at).toISOString();
  }

  const approvedAt = subRow.approved_at ? new Date(subRow.approved_at) : new Date();
  const config = subRow.entitlement_config || {};
  const billingCycle = config.billingCycle === "yearly" ? "yearly" : "monthly";
  const renewsAt = billingCycle === "yearly" ? addYears(approvedAt, 1) : addMonths(approvedAt, 1);
  return renewsAt.toISOString();
}

async function computeBranchDropEffectiveAt(client: any, organizationId: any, branchId: any) {
  const activeSubs = await selectActiveSubscriptionsAtLocation(client, organizationId, branchId);
  if (!activeSubs.length) {
    return new Date().toISOString();
  }

  let latest = null;
  for (const subRow of activeSubs) {
    const effectiveAt = new Date(computeSubscriptionEffectiveAt(subRow));
    if (!latest || effectiveAt > latest) {
      latest = effectiveAt;
    }
  }

  return latest!.toISOString();
}

export async function isBranchInactive(client: any, organizationId: any, branchId: any) {
  const row = await selectOrganizationLocation(client || pool, organizationId, branchId);
  if (!row) {
    return false;
  }
  return (row.status || "active") === "inactive";
}

export async function cancelProductAtBranch(
  client: any,
  { subscriptionId, adminUser, reason = "Cancelled by Worktual admin" }: any,
) {
  const subscriptionRow = await selectSubscriptionById(client, subscriptionId);
  if (!subscriptionRow) {
    throw new Error("Subscription not found.");
  }

  const subscription = mapSubscription(subscriptionRow);
  if (subscription!.status === "cancelled") {
    return { subscription, alreadyCancelled: true };
  }

  if (await isBranchInactive(client, subscription!.organizationId, subscription!.branchId)) {
    throw new Error("This branch is already inactive.");
  }

  const cancelledAt = new Date().toISOString();
  const updated = await cancelSubscriptionRow(client, subscriptionId, {
    cancelledAt,
    cancelledBy: adminUser,
    reason,
  });

  if (!updated) {
    throw new Error("Could not cancel subscription.");
  }

  await cancelRenewalEventsForSubscription(client, subscriptionId);
  await cancelScheduledSubscriptionInvoices(client, subscriptionId);
  await deleteGrantsForSubscription(client, subscriptionId);
  await deleteActiveProductRow(
    client,
    subscription!.sourceLeadId,
    subscription!.productId,
    subscription!.branchId,
  );

  await resyncOrganizationCustomerGrants(client, subscription!.organizationId);

  return {
    subscription: mapSubscription(updated),
    alreadyCancelled: false,
  };
}

export async function scheduleCancelProductAtBranch(
  client: any,
  { subscriptionId, requestId, adminUser, reason = "Scheduled cancellation at period end" }: any,
) {
  const subscriptionRow = await selectSubscriptionById(client, subscriptionId);
  if (!subscriptionRow) {
    throw new Error("Subscription not found.");
  }

  const subscription = mapSubscription(subscriptionRow);
  if (subscription!.status === "cancelled") {
    throw new Error("This product subscription is already cancelled.");
  }

  if (subscriptionRow.cancel_at_period_end) {
    throw new Error("This subscription is already scheduled to cancel.");
  }

  if (await isBranchInactive(client, subscription!.organizationId, subscription!.branchId)) {
    throw new Error("This branch is already inactive.");
  }

  const effectiveAt = computeSubscriptionEffectiveAt(subscriptionRow);
  const updated = await scheduleSubscriptionCancellation(client, subscriptionId, {
    effectiveAt,
    requestId,
    adminUser,
    reason,
  });

  if (!updated) {
    throw new Error("Could not schedule subscription cancellation.");
  }

  await cancelRenewalEventsForSubscription(client, subscriptionId);
  await cancelScheduledSubscriptionInvoices(client, subscriptionId);

  return {
    subscription: mapSubscription(updated),
    effectiveAt,
    scheduled: true,
  };
}

export async function clearScheduledProductCancellation(client: any, subscriptionId: any) {
  const cleared = await clearScheduledSubscriptionCancellation(client, subscriptionId);
  return cleared ? mapSubscription(cleared) : null;
}

export async function dropBranch(
  client: any,
  { organizationId, branchId, adminUser, reason = "Branch dropped by Worktual admin" }: any,
) {
  const locationRow = await selectOrganizationLocation(client, organizationId, branchId);
  if (!locationRow) {
    throw new Error("Branch location not found.");
  }

  if ((locationRow.status || "active") === "inactive") {
    return { location: rowToCamel(locationRow), alreadyInactive: true, cancelledSubscriptions: [] };
  }

  const activeSubs = await selectActiveSubscriptionsAtLocation(client, organizationId, branchId);
  const cancelledSubscriptions = [];

  for (const subRow of activeSubs) {
    const result = await cancelProductAtBranch(client, {
      subscriptionId: subRow.id,
      adminUser,
      reason,
    });
    cancelledSubscriptions.push(result.subscription);
  }

  const inactivatedAt = new Date().toISOString();
  const updatedLocation = await updateOrganizationLocationInactive(client, organizationId, branchId, {
    inactivatedAt,
    inactivatedBy: adminUser,
    reason,
  });

  await deactivateBranchCustomerUsers(client, organizationId, branchId);
  await resyncOrganizationCustomerGrants(client, organizationId);

  return {
    location: rowToCamel(updatedLocation),
    alreadyInactive: false,
    cancelledSubscriptions,
  };
}

export async function scheduleDropBranch(
  client: any,
  {
    organizationId,
    branchId,
    requestId,
    adminUser,
    reason = "Branch drop scheduled at period end",
  }: any,
) {
  const locationRow = await selectOrganizationLocation(client, organizationId, branchId);
  if (!locationRow) {
    throw new Error("Branch location not found.");
  }

  if ((locationRow.status || "active") === "inactive") {
    throw new Error("This branch is already inactive.");
  }

  if (locationRow.scheduled_drop_at) {
    throw new Error("This branch is already scheduled to drop.");
  }

  const effectiveAt = await computeBranchDropEffectiveAt(client, organizationId, branchId);
  const activeSubs = await selectActiveSubscriptionsAtLocation(client, organizationId, branchId);
  const scheduledSubscriptions = [];

  for (const subRow of activeSubs) {
    if (subRow.cancel_at_period_end) {
      continue;
    }

    const result = await scheduleSubscriptionCancellation(client, subRow.id, {
      effectiveAt,
      requestId,
      adminUser,
      reason,
    });

    if (result) {
      await cancelRenewalEventsForSubscription(client, subRow.id);
      await cancelScheduledSubscriptionInvoices(client, subRow.id);
      scheduledSubscriptions.push(mapSubscription(result));
    }
  }

  const updatedLocation = await scheduleBranchDrop(client, organizationId, branchId, {
    effectiveAt,
    requestId,
    adminUser,
    reason,
  });

  if (!updatedLocation) {
    throw new Error("Could not schedule branch drop.");
  }

  return {
    location: rowToCamel(updatedLocation),
    effectiveAt,
    scheduledSubscriptions,
    scheduled: true,
  };
}

export async function clearScheduledBranchDropAtLocation(client: any, organizationId: any, branchId: any) {
  const activeSubs = await selectActiveSubscriptionsAtLocation(client, organizationId, branchId);
  for (const subRow of activeSubs) {
    if (subRow.cancel_at_period_end) {
      await clearScheduledSubscriptionCancellation(client, subRow.id);
    }
  }

  const cleared = await clearScheduledBranchDrop(client, organizationId, branchId);
  return cleared ? rowToCamel(cleared) : null;
}

export async function processScheduledCancellations(client: any) {
  const branchDrops = await selectLocationsDueForDrop(client);
  const droppedBranches = [];

  for (const locationRow of branchDrops) {
    try {
      const result = await dropBranch(client, {
        organizationId: locationRow.organization_id,
        branchId: locationRow.id,
        adminUser: locationRow.scheduled_drop_by || "system",
        reason: locationRow.scheduled_drop_reason || "Scheduled branch drop",
      });
      droppedBranches.push(result);
    } catch (error) {
      console.warn(
        `[branchLifecycle] scheduled branch drop failed for ${locationRow.organization_id}/${locationRow.id}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  const dueSubs = await selectSubscriptionsDueForCancellation(client);
  const cancelledSubscriptions = [];
  const processedIds = new Set();

  for (const subRow of dueSubs) {
    if (processedIds.has(subRow.id)) {
      continue;
    }

    const locationRow = await selectOrganizationLocation(
      client,
      subRow.organization_id,
      subRow.branch_id,
    );
    if (locationRow?.scheduled_drop_at && new Date(locationRow.scheduled_drop_at) <= new Date()) {
      continue;
    }

    try {
      const result = await cancelProductAtBranch(client, {
        subscriptionId: subRow.id,
        adminUser: subRow.cancelled_by || "system",
        reason: subRow.cancellation_reason || "Scheduled cancellation at period end",
      });
      cancelledSubscriptions.push(result.subscription);
      processedIds.add(subRow.id);
    } catch (error) {
      console.warn(
        `[branchLifecycle] scheduled product cancel failed for ${subRow.id}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return {
    droppedBranches: droppedBranches.length,
    cancelledSubscriptions: cancelledSubscriptions.length,
  };
}

export async function cancelProductAtBranchTx(options: any) {
  return withTransaction((client: any) => cancelProductAtBranch(client, options));
}

export async function dropBranchTx(options: any) {
  return withTransaction((client: any) => dropBranch(client, options));
}

export async function scheduleCancelProductAtBranchTx(options: any) {
  return withTransaction((client: any) => scheduleCancelProductAtBranch(client, options));
}

export async function scheduleDropBranchTx(options: any) {
  return withTransaction((client: any) => scheduleDropBranch(client, options));
}
