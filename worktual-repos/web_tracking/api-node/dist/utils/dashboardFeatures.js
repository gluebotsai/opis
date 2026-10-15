const DEFAULT_FEATURES = { product_analytics: false, conversions: true, forms: true };
const SITE_TYPE_FEATURES = {
    ecommerce: { product_analytics: true, conversions: true, forms: true },
    b2c: { product_analytics: true, conversions: true, forms: true },
    b2b: { product_analytics: false, conversions: true, forms: false },
    blog: { product_analytics: false, conversions: false, forms: true },
};
export function resolveDashboardFeatures(siteType) {
    const normalized = (siteType || "blog").toLowerCase();
    return { ...DEFAULT_FEATURES, ...(SITE_TYPE_FEATURES[normalized] ?? SITE_TYPE_FEATURES.blog) };
}
