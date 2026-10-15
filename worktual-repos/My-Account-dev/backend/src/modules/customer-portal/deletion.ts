import { withTransaction } from "../../db/pool.js";
import { canUserModifyLead, getLeadById, getLeadOwnership } from "../leads/lead-store.js";

async function deleteQuotationCascade(client: any, quotationId: any) {
  if (!quotationId) {
    return;
  }

  await client.query(
    `DELETE FROM subscription_invoices
     WHERE subscription_id IN (SELECT id FROM subscriptions WHERE quotation_id = $1)`,
    [quotationId],
  );
  await client.query(
    `DELETE FROM usage_metrics
     WHERE subscription_id IN (SELECT id FROM subscriptions WHERE quotation_id = $1)`,
    [quotationId],
  );
  await client.query(
    `DELETE FROM subscription_items
     WHERE purchase_order_id IN (SELECT id FROM purchase_orders WHERE quotation_id = $1)`,
    [quotationId],
  );
  await client.query(
    `DELETE FROM subscription_entitlements
     WHERE subscription_id IN (SELECT id FROM subscriptions WHERE quotation_id = $1)`,
    [quotationId],
  );
  await client.query(
    `DELETE FROM renewal_events
     WHERE subscription_id IN (SELECT id FROM subscriptions WHERE quotation_id = $1)`,
    [quotationId],
  );
  await client.query(`DELETE FROM subscriptions WHERE quotation_id = $1`, [quotationId]);
  await client.query(`DELETE FROM purchase_orders WHERE quotation_id = $1`, [quotationId]);
  await client.query(`DELETE FROM payment_webhook_events WHERE quotation_id = $1`, [quotationId]);
  await client.query(`DELETE FROM quotation_branch_payments WHERE quotation_id = $1`, [quotationId]);
  await client.query(`DELETE FROM quotation_invoices WHERE quotation_id = $1`, [quotationId]);
  await client.query(`DELETE FROM product_assignments WHERE quotation_id = $1`, [quotationId]);
  await client.query(`DELETE FROM product_summary_items WHERE quotation_id = $1`, [quotationId]);
  await client.query(`DELETE FROM partner_commission_entries WHERE quotation_id = $1`, [
    quotationId,
  ]);
  await client.query(`DELETE FROM payments WHERE quotation_id = $1`, [quotationId]);
  await client.query(`DELETE FROM quotations WHERE id = $1`, [quotationId]);
}

/**
 * Irreversibly delete a customer lead, organization, portal users, and related commercial data.
 */
export async function hardDeleteCustomerByLeadId(leadId: any, { actor = null }: any = {}) {
  const resolvedLeadId = String(leadId || "").trim();
  if (!resolvedLeadId) {
    throw new Error("Lead id is required.");
  }

  const lead = await getLeadById(resolvedLeadId);
  if (!lead) {
    const error = new Error("Lead not found.");
    (error as any).status = 404;
    throw error;
  }

  const result = await withTransaction(async (client: any) => {
    const { rows: quotationRows } = await client.query(
      `SELECT id FROM quotations WHERE lead_id = $1`,
      [resolvedLeadId],
    );
    for (const row of quotationRows) {
      await deleteQuotationCascade(client, row.id);
    }

    await client.query(
      `DELETE FROM subscription_invoices
       WHERE subscription_id IN (SELECT id FROM subscriptions WHERE source_lead_id = $1)`,
      [resolvedLeadId],
    );
    await client.query(
      `DELETE FROM usage_metrics
       WHERE subscription_id IN (SELECT id FROM subscriptions WHERE source_lead_id = $1)`,
      [resolvedLeadId],
    );
    await client.query(
      `DELETE FROM subscription_items
       WHERE purchase_order_id IN (SELECT id FROM purchase_orders WHERE lead_id = $1)`,
      [resolvedLeadId],
    );
    await client.query(
      `DELETE FROM subscription_entitlements
       WHERE subscription_id IN (SELECT id FROM subscriptions WHERE source_lead_id = $1)`,
      [resolvedLeadId],
    );
    await client.query(
      `DELETE FROM renewal_events
       WHERE subscription_id IN (SELECT id FROM subscriptions WHERE source_lead_id = $1)`,
      [resolvedLeadId],
    );
    await client.query(`DELETE FROM subscriptions WHERE source_lead_id = $1`, [resolvedLeadId]);
    await client.query(`DELETE FROM purchase_orders WHERE lead_id = $1`, [resolvedLeadId]);
    await client.query(`DELETE FROM active_products WHERE lead_id = $1`, [resolvedLeadId]);
    await client.query(`DELETE FROM partner_commission_entries WHERE lead_id = $1`, [
      resolvedLeadId,
    ]);
    await client.query(`DELETE FROM lead_assignments WHERE lead_id = $1`, [resolvedLeadId]);
    await client.query(`DELETE FROM quote_sessions WHERE lead_id = $1`, [resolvedLeadId]);
    await client.query(`DELETE FROM customer_product_requests WHERE source_lead_id = $1`, [
      resolvedLeadId,
    ]);
    await client.query(`DELETE FROM branch_cancellation_requests WHERE source_lead_id = $1`, [
      resolvedLeadId,
    ]);

    const { rows: orgRows } = await client.query(
      `SELECT DISTINCT org_id AS id
       FROM (
         SELECT id AS org_id FROM organizations WHERE source_lead_id = $1
         UNION
         SELECT organization_id AS org_id FROM leads WHERE id = $1 AND organization_id IS NOT NULL
         UNION
         SELECT converted_organization_id AS org_id
         FROM leads
         WHERE id = $1 AND converted_organization_id IS NOT NULL
         UNION
         SELECT id AS org_id
         FROM organizations
         WHERE tenant_id = (SELECT tenant_id FROM leads WHERE id = $1 LIMIT 1)
         UNION
         SELECT id AS org_id
         FROM organizations
         WHERE source_lead_id IS NULL
           AND tenant_id = (SELECT tenant_id FROM leads WHERE id = $1 LIMIT 1)
       ) orgs`,
      [resolvedLeadId],
    );
    const organizationIds = orgRows.map((row: any) => row.id).filter(Boolean);

    if (organizationIds.length) {
      await client.query(
        `DELETE FROM password_reset_otps
         WHERE email IN (
           SELECT LOWER(email) FROM customer_users WHERE organization_id = ANY($1::uuid[])
           UNION
           SELECT LOWER(TRIM(work_email)) FROM organizations WHERE id = ANY($1::uuid[]) AND work_email <> ''
           UNION
           SELECT LOWER(TRIM(admin_email)) FROM organizations WHERE id = ANY($1::uuid[]) AND admin_email <> ''
         )`,
        [organizationIds],
      );

      // leads.organization_id is ON DELETE RESTRICT — clear before wiping orgs.
      await client.query(
        `UPDATE leads
         SET organization_id = NULL
         WHERE organization_id = ANY($1::uuid[])`,
        [organizationIds],
      );
      await client.query(
        `UPDATE leads
         SET converted_organization_id = NULL
         WHERE converted_organization_id = ANY($1::uuid[])`,
        [organizationIds],
      );

      await client.query(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [organizationIds]);
    } else {
      await client.query(
        `UPDATE leads
         SET organization_id = NULL, converted_organization_id = NULL
         WHERE id = $1`,
        [resolvedLeadId],
      );
    }

    await client.query(`DELETE FROM branches WHERE lead_id = $1`, [resolvedLeadId]);
    await client.query(`DELETE FROM additional_addresses WHERE lead_id = $1`, [resolvedLeadId]);
    await client.query(`DELETE FROM leads WHERE id = $1`, [resolvedLeadId]);

    return {
      leadId: resolvedLeadId,
      companyName: lead.companyName || null,
      organizationIds,
    };
  });

  console.log("[customer.delete]", {
    leadId: result.leadId,
    organizationIds: result.organizationIds,
    companyName: result.companyName,
    actor:
      actor && typeof actor === "object"
        ? {
            type: (actor as any).type || null,
            userId: (actor as any).userId || (actor as any).customerUserId || null,
            email: (actor as any).email || null,
            role: (actor as any).role || null,
          }
        : actor,
    at: new Date().toISOString(),
  });

  return result;
}

export function canUserDeleteLead(authUser: any, ownership: any) {
  if (!authUser || !ownership) {
    return false;
  }
  if (authUser.role === "sales_admin") {
    return true;
  }
  return canUserModifyLead(authUser, ownership);
}

export async function assertSalesCanDeleteLead(authUser: any, leadId: any) {
  const ownership = await getLeadOwnership(leadId);
  if (!ownership) {
    const error = new Error("Lead not found.");
    (error as any).status = 404;
    throw error;
  }
  if (!canUserDeleteLead(authUser, ownership)) {
    const error = new Error("You do not have permission to delete this customer.");
    (error as any).status = 403;
    throw error;
  }
  return ownership;
}
