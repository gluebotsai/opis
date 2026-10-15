/**
 * Ensure product default setup roles for an organization (insert-only).
 * Failures are logged and do not throw — used on login / profile save.
 */
export async function ensureProductDefaultRoles(organizationId) {
  if (!organizationId) return;

  const results = [];

  try {
    const { ensureCrmDefaultRoles } = await import("./ensureCrmDefaultRoles.js");
    results.push({ product: "crm", ...(await ensureCrmDefaultRoles(organizationId)) });
  } catch (error) {
    console.warn(
      "[defaults] Failed to ensure CRM default roles:",
      error instanceof Error ? error.message : error,
    );
  }

  try {
    const { ensureCcaasDefaultRoles } = await import("./ensureCcaasDefaultRoles.js");
    results.push({ product: "contact-center", ...(await ensureCcaasDefaultRoles(organizationId)) });
  } catch (error) {
    console.warn(
      "[defaults] Failed to ensure CCaaS default roles:",
      error instanceof Error ? error.message : error,
    );
  }

  return results;
}
