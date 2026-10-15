import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { env } from "../config/env.js";
import { resolveOrgDashboardSite } from "../services/organizationSiteType.js";
import { findAuthUserById } from "../repositories/postgres/authRepository.js";

const DEFAULT_SDK_SCRIPT_URL =
  "https://nlp-storage.worktual.co.uk/wsnlp/Web_Tracking/JavaScript_sdk/sdk/v1/web_tracking_v3.js";

const TRACKING_SCRIPT_TEMPLATE = `<!-- Worktual Analytics -->
<script src="{sdk_script_url}"></script>
<script>
  WorktualAnalytics.init({
    websiteId: {website_id},
    websiteUrl: '{website_url}',
    organizationId: {organization_id}{hmac_option}
  });
</script>`;

export const adminRoutes = fp(async function adminRoutes(app: FastifyInstance) {
  app.get("/api/admin/tracking-script", { preHandler: [app.authenticate] }, async (request) => {
    const sdkScriptUrl = env.SDK_SCRIPT_URL ?? DEFAULT_SDK_SCRIPT_URL;
    const script = TRACKING_SCRIPT_TEMPLATE.replace("{website_id}", String(request.admin.website_id))
      .replace("{website_url}", request.admin.website_url.replace(/'/g, "\\'"))
      .replace("{organization_id}", request.admin.organization_id != null ? String(request.admin.organization_id) : "null")
      .replace("{sdk_script_url}", sdkScriptUrl)
      .replace("{hmac_option}", "");
    return {
      website_id: request.admin.website_id,
      website_url: request.admin.website_url,
      email: request.admin.email,
      script,
    };
  });

  app.get("/api/admin/account", { preHandler: [app.authenticate] }, async (request) => {
    const admin = await findAuthUserById(app.prisma, request.admin.id, request.admin.website_id);
    if (!admin) return null;
    const orgSite = await resolveOrgDashboardSite(app.prisma, admin.organizationId, admin.siteType);
    return {
      admin_name: admin.adminName,
      email: admin.email,
      organization_id: admin.organizationId,
      website_id: admin.websiteId,
      website_url: admin.websiteUrl,
      created_at: admin.createdAt,
      site_type: orgSite.siteType,
      business_type: orgSite.businessType,
      features: orgSite.features,
    };
  });
});
