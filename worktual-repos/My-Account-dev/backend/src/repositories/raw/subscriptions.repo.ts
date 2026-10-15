function runnerQuery(runner: any) {
  if (typeof runner?.query === "function") {
    return runner;
  }
  throw new Error("A database client or pool is required.");
}

export async function selectSubscriptionById(runner: any, subscriptionId: any) {
  const { rows } = await runnerQuery(runner).query(`SELECT * FROM subscriptions WHERE id = $1`, [
    subscriptionId,
  ]);
  return rows[0] || null;
}

export async function updateSubscriptionMrr(runner: any, subscriptionId: any, { mrr, entitlementConfig, priceLabel }: any) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE subscriptions
     SET mrr = $2,
         entitlement_config = COALESCE($3::jsonb, entitlement_config),
         price_label = COALESCE($4, price_label),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      subscriptionId,
      mrr,
      entitlementConfig != null ? JSON.stringify(entitlementConfig) : null,
      priceLabel ?? null,
    ],
  );
  return rows[0] || null;
}

export async function selectSubscriptionByQuotationProductLocation(
  runner: any,
  { quotationId, productId, branchId, organizationId = null }: any,
) {
  const params = [quotationId, productId, branchId];
  let sql = `SELECT * FROM subscriptions
             WHERE quotation_id = $1
               AND product_id = $2
               AND branch_id = $3`;
  if (organizationId) {
    params.push(organizationId);
    sql += ` AND organization_id = $4`;
  }
  sql += ` ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, created_at DESC LIMIT 1`;
  const { rows } = await runnerQuery(runner).query(sql, params);
  return rows[0] || null;
}

export async function selectSubscriptionsByOrganization(runner: any, organizationId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM subscriptions WHERE organization_id = $1 ORDER BY product_id, branch_id`,
    [organizationId],
  );
  return rows;
}

/** Products that qualify a customer for number mapping (CCaaS / CRM / Campaign). */
export const NUMBER_MAPPING_PRODUCT_IDS = ["contact-center", "crm", "campaign"] as const;

/**
 * Organizations with an active subscription for Contact Center, CRM, or Campaign.
 * These are the only customers shown in number-management / finance usage customer lists.
 */
export async function selectOrganizationIdsEligibleForNumberMapping(
  runner: any,
  productIds: readonly string[] = NUMBER_MAPPING_PRODUCT_IDS,
) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT DISTINCT organization_id
     FROM subscriptions
     WHERE status = 'active'
       AND organization_id IS NOT NULL
       AND product_id = ANY($1::text[])`,
    [productIds],
  );
  return rows.map((row: any) => String(row.organization_id));
}

export async function organizationHasNumberMappingProduct(
  runner: any,
  organizationId: any,
  productIds: readonly string[] = NUMBER_MAPPING_PRODUCT_IDS,
) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT 1
     FROM subscriptions
     WHERE organization_id = $1
       AND status = 'active'
       AND product_id = ANY($2::text[])
     LIMIT 1`,
    [organizationId, productIds],
  );
  return rows.length > 0;
}

/** Distinct active number-mapping product ids for one organization (ordered). */
export async function selectActiveNumberMappingProductIds(
  runner: any,
  organizationId: any,
  productIds: readonly string[] = NUMBER_MAPPING_PRODUCT_IDS,
) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT DISTINCT product_id
     FROM subscriptions
     WHERE organization_id = $1
       AND status = 'active'
       AND product_id = ANY($2::text[])`,
    [organizationId, productIds],
  );
  const order = new Map(productIds.map((id, index) => [id, index]));
  return rows
    .map((row: any) => String(row.product_id))
    .sort((left: string, right: string) => (order.get(left) ?? 99) - (order.get(right) ?? 99));
}

/** Active number-mapping subscriptions with entitlement configs (all branches). */
export async function selectActiveNumberMappingEntitlements(
  runner: any,
  organizationId: any,
  productIds: readonly string[] = NUMBER_MAPPING_PRODUCT_IDS,
) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT product_id, entitlement_config
     FROM subscriptions
     WHERE organization_id = $1
       AND status = 'active'
       AND product_id = ANY($2::text[])`,
    [organizationId, productIds],
  );
  return rows.map((row: any) => ({
    productId: String(row.product_id),
    entitlementConfig: row.entitlement_config || {},
  }));
}

/** All orgs' active NM entitlements (for dashboard eligibility filtering). */
export async function selectAllActiveNumberMappingEntitlements(
  runner: any,
  productIds: readonly string[] = NUMBER_MAPPING_PRODUCT_IDS,
) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT organization_id, product_id, entitlement_config
     FROM subscriptions
     WHERE status = 'active'
       AND organization_id IS NOT NULL
       AND product_id = ANY($1::text[])`,
    [productIds],
  );
  return rows.map((row: any) => ({
    organizationId: String(row.organization_id),
    productId: String(row.product_id),
    entitlementConfig: row.entitlement_config || {},
  }));
}

export async function selectActiveSubscriptionByProductLocation(
  runner: any,
  { organizationId, branchId, productId }: any,
) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM subscriptions
     WHERE organization_id = $1
       AND branch_id = $2
       AND product_id = $3
       AND status = 'active'
     ORDER BY created_at DESC
     LIMIT 1`,
    [organizationId, branchId, productId],
  );
  return rows[0] || null;
}

export async function selectSubscriptionByKey(runner: any, key: any) {
  const { rows } = await runnerQuery(runner).query(`SELECT * FROM subscriptions WHERE key = $1 LIMIT 1`, [
    key,
  ]);
  return rows[0] || null;
}

export async function selectSubscriptionsByLeadId(runner: any, leadId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM subscriptions WHERE source_lead_id = $1 ORDER BY product_id, branch_id`,
    [leadId],
  );
  return rows;
}

export async function selectQuotationRow(runner: any, quotationId: any) {
  const { rows } = await runnerQuery(runner).query(`SELECT * FROM quotations WHERE id = $1`, [
    quotationId,
  ]);
  return rows[0] || null;
}

export async function selectQuotationAssignments(runner: any, quotationId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM product_assignments WHERE quotation_id = $1`,
    [quotationId],
  );
  return rows;
}

export async function selectProductSummaryItems(runner: any, quotationId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT product_id, price_label FROM product_summary_items WHERE quotation_id = $1`,
    [quotationId],
  );
  return rows;
}

export async function upsertPurchaseOrderRow(runner: any, values: any) {
  const { rows } = await runnerQuery(runner).query(
    `INSERT INTO purchase_orders (organization_id, lead_id, quotation_id, status, paid_at)
     VALUES ($1, $2, $3, 'paid', $4)
     ON CONFLICT (quotation_id) DO UPDATE SET
       status = 'paid',
       paid_at = COALESCE(purchase_orders.paid_at, EXCLUDED.paid_at)
     RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function deleteSubscriptionItemsForPurchaseOrder(runner: any, purchaseOrderId: any) {
  await runnerQuery(runner).query(`DELETE FROM subscription_items WHERE purchase_order_id = $1`, [
    purchaseOrderId,
  ]);
}

export async function upsertSubscriptionRow(runner: any, values: any) {
  const { rows } = await runnerQuery(runner).query(
    `INSERT INTO subscriptions (
      key, organization_id, source_lead_id, product_id, branch_id, billing_branch_id,
      status, change_type, entitlement_config, price_label, implementation_purchased,
      mrr, starts_at, renews_at, approved_at, payment_confirmed_at, quotation_id,
      source_purchase_order_id,
      agent_count, included_number_count, queue_capacity_count, total_number_count
    ) VALUES (
      $1,$2,$3,$4,$5,$6,'active',$7,$8,$9,$10,$11,$12,$13,$14,COALESCE($15, NOW()),$16,$17,
      COALESCE($18, 0), COALESCE($19, 0), COALESCE($20, 0), COALESCE($21, 0)
    )
    ON CONFLICT (key) DO UPDATE SET
      status = CASE
        WHEN subscriptions.status = 'cancelled'
          AND EXCLUDED.quotation_id IS NOT DISTINCT FROM subscriptions.quotation_id
          THEN subscriptions.status
        ELSE 'active'
      END,
      change_type = EXCLUDED.change_type,
      entitlement_config = EXCLUDED.entitlement_config,
      price_label = EXCLUDED.price_label,
      implementation_purchased = EXCLUDED.implementation_purchased,
      mrr = EXCLUDED.mrr,
      agent_count = EXCLUDED.agent_count,
      included_number_count = EXCLUDED.included_number_count,
      queue_capacity_count = EXCLUDED.queue_capacity_count,
      total_number_count = EXCLUDED.total_number_count,
      renews_at = CASE
        WHEN EXCLUDED.change_type = 'addon' THEN COALESCE(subscriptions.renews_at, EXCLUDED.renews_at)
        ELSE EXCLUDED.renews_at
      END,
      approved_at = EXCLUDED.approved_at,
      payment_confirmed_at = COALESCE(subscriptions.payment_confirmed_at, EXCLUDED.payment_confirmed_at),
      quotation_id = EXCLUDED.quotation_id,
      source_purchase_order_id = EXCLUDED.source_purchase_order_id,
      updated_at = NOW()
    WHERE NOT (
      subscriptions.status = 'cancelled'
      AND EXCLUDED.quotation_id IS NOT DISTINCT FROM subscriptions.quotation_id
    )
    RETURNING *`,
    values,
  );
  if (rows[0]) {
    return rows[0];
  }
  // Conflict update skipped (cancelled same-quote repair) — return existing row unchanged.
  const key = values[0];
  return selectSubscriptionByKey(runner, key);
}

export async function selectSubscriptionEntitlementExists(runner: any, subscriptionId: any, purchaseOrderId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT id FROM subscription_entitlements
     WHERE subscription_id = $1 AND purchase_order_id = $2
     LIMIT 1`,
    [subscriptionId, purchaseOrderId],
  );
  return rows[0] || null;
}

export async function insertSubscriptionEntitlementRow(runner: any, values: any) {
  await runnerQuery(runner).query(
    `INSERT INTO subscription_entitlements (
      subscription_id, schema_version, config, change_type, effective_from, purchase_order_id
    ) VALUES ($1, $2, $3, $4, $5, $6)`,
    values,
  );
}

export async function insertSubscriptionItemRow(runner: any, values: any) {
  await runnerQuery(runner).query(
    `INSERT INTO subscription_items (
      purchase_order_id, subscription_id, product_id, branch_id, change_type, config_snapshot
    ) VALUES ($1, $2, $3, $4, $5, $6)`,
    values,
  );
}

export async function selectSubscriptionEntitlements(runner: any, subscriptionId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM subscription_entitlements
     WHERE subscription_id = $1
     ORDER BY effective_from DESC
     LIMIT 20`,
    [subscriptionId],
  );
  return rows;
}

export async function selectPaidActiveProducts(runner: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM active_products WHERE payment_confirmed_at IS NOT NULL`,
  );
  return rows;
}
