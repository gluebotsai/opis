/**
 * Product view detection for fact_product_interactions.
 * MV maps event_name → section (e.g. product_view), not product_page_view.
 */
export const CH_PRODUCT_VIEW_PREDICATE = `
  section IN ('product_view', 'product_page_view')
  OR coalesce(JSONExtractString(extra_data, 'source'), '') IN ('product_view', 'page_view_fallback')
`.trim();

export const CH_PRODUCT_VIEW_COUNT_EXPR = `countIf(${CH_PRODUCT_VIEW_PREDICATE})`;

export const CH_PRODUCT_NON_VIEW_COUNT_EXPR = `countIf(NOT (${CH_PRODUCT_VIEW_PREDICATE}))`;
