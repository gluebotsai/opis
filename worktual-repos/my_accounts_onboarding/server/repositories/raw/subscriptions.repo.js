function runnerQuery(runner) {
  if (typeof runner?.query === "function") {
    return runner;
  }
  throw new Error("A database client or pool is required.");
}

export async function selectSubscriptionById(runner, subscriptionId) {
  const { rows } = await runnerQuery(runner).query(`SELECT * FROM subscriptions WHERE id = $1`, [
    subscriptionId,
  ]);
  return rows[0] || null;
}

export async function selectSubscriptionsByOrganization(runner, organizationId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM subscriptions WHERE organization_id = $1 ORDER BY product_id, location_id`,
    [organizationId],
  );
  return rows;
}

export async function selectSubscriptionsByLeadId(runner, leadId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM subscriptions WHERE source_lead_id = $1 ORDER BY product_id, location_id`,
    [leadId],
  );
  return rows;
}

export async function selectQuotationRow(runner, quotationId) {
  const { rows } = await runnerQuery(runner).query(`SELECT * FROM quotations WHERE id = $1`, [
    quotationId,
  ]);
  return rows[0] || null;
}

export async function selectQuotationAssignments(runner, quotationId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM product_assignments WHERE quotation_id = $1`,
    [quotationId],
  );
  return rows;
}

export async function selectProductSummaryItems(runner, quotationId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT product_id, price_label FROM product_summary_items WHERE quotation_id = $1`,
    [quotationId],
  );
  return rows;
}

export async function upsertPurchaseOrderRow(runner, values) {
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

export async function deleteSubscriptionItemsForPurchaseOrder(runner, purchaseOrderId) {
  await runnerQuery(runner).query(`DELETE FROM subscription_items WHERE purchase_order_id = $1`, [
    purchaseOrderId,
  ]);
}

export async function upsertSubscriptionRow(runner, values) {
  const { rows } = await runnerQuery(runner).query(
    `INSERT INTO subscriptions (
      key, organization_id, source_lead_id, product_id, location_id, billing_target_id,
      status, change_type, entitlement_config, price_label, implementation_purchased,
      mrr, starts_at, renews_at, approved_at, payment_confirmed_at, quotation_id,
      source_purchase_order_id
    ) VALUES (
      $1,$2,$3,$4,$5,$6,'active',$7,$8,$9,$10,$11,$12,$13,$14,COALESCE($15, NOW()),$16,$17
    )
    ON CONFLICT (key) DO UPDATE SET
      status = 'active',
      change_type = EXCLUDED.change_type,
      entitlement_config = EXCLUDED.entitlement_config,
      price_label = EXCLUDED.price_label,
      implementation_purchased = EXCLUDED.implementation_purchased,
      mrr = EXCLUDED.mrr,
      renews_at = EXCLUDED.renews_at,
      approved_at = EXCLUDED.approved_at,
      payment_confirmed_at = COALESCE(subscriptions.payment_confirmed_at, EXCLUDED.payment_confirmed_at),
      quotation_id = EXCLUDED.quotation_id,
      source_purchase_order_id = EXCLUDED.source_purchase_order_id,
      updated_at = NOW()
    RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function selectSubscriptionEntitlementExists(runner, subscriptionId, purchaseOrderId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT id FROM subscription_entitlements
     WHERE subscription_id = $1 AND purchase_order_id = $2
     LIMIT 1`,
    [subscriptionId, purchaseOrderId],
  );
  return rows[0] || null;
}

export async function insertSubscriptionEntitlementRow(runner, values) {
  await runnerQuery(runner).query(
    `INSERT INTO subscription_entitlements (
      subscription_id, schema_version, config, change_type, effective_from, purchase_order_id
    ) VALUES ($1, $2, $3, $4, $5, $6)`,
    values,
  );
}

export async function insertSubscriptionItemRow(runner, values) {
  await runnerQuery(runner).query(
    `INSERT INTO subscription_items (
      purchase_order_id, subscription_id, product_id, location_id, change_type, config_snapshot
    ) VALUES ($1, $2, $3, $4, $5, $6)`,
    values,
  );
}

export async function selectSubscriptionEntitlements(runner, subscriptionId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM subscription_entitlements
     WHERE subscription_id = $1
     ORDER BY effective_from DESC
     LIMIT 20`,
    [subscriptionId],
  );
  return rows;
}

export async function selectPaidActiveProducts(runner) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM active_products WHERE payment_confirmed_at IS NOT NULL`,
  );
  return rows;
}
