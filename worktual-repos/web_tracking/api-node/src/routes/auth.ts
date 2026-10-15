import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { z } from "zod";
import {
  overlayWebsiteSiteTypes,
  resolveOrgDashboardSite,
} from "../services/organizationSiteType.js";
import {
  findAuthUserByEmail,
  findAuthUserById,
  findCustomerByEmail,
  findWebsitesByOrganizationId,
  findWebsiteInOrganization,
  verifyPassword,
  attachDefaultWebsite,
  findWebsitesForOrganization,
  hasWebTrackingAccess,
} from "../repositories/postgres/authRepository.js";
import { env } from "../config/env.js";
import type { JwtPayload } from "../plugins/jwt.js";
import {
  consumeOnboardingCode,
  generateOnboardingCode,
  storeOnboardingCode,
} from "../services/onboardingCodes.js";
import {
  dashboardPublicUrl,
  isOnboardingRedirectEnabled,
  resolveMyAccountsOnboardingSession,
  resolveOnboardingSessionFromCode,
  verifyOnboardingServerSecret,
} from "../utils/onboardingAuth.js";

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const selectWebsiteSchema = z.object({ website_id: z.number().int().positive() });
const onboardingRedirectSchema = z.object({
  user_id: z.number().int().positive(),
  email: z.string().email(),
  organization_id: z.number().int().positive(),
  website_id: z.number().int().positive().optional(),
});
const onboardingExchangeSchema = z.object({
  code: z.string().min(16).max(128),
});

function mapWebsiteRow(row: { websiteId: number; websiteUrl: string; siteType: string }) {
  return {
    website_id: row.websiteId,
    website_url: row.websiteUrl,
    site_type: row.siteType,
  };
}

async function buildAuthResponse(
  prisma: FastifyInstance["prisma"],
  user: {
    adminName: string;
    email: string;
    websiteId: number;
    websiteUrl: string;
    siteType: string;
    organizationId: number | null;
  },
  websites: Array<{ website_id: number; website_url: string; site_type: string }>,
  token: string,
) {
  const orgSite = await resolveOrgDashboardSite(prisma, user.organizationId, user.siteType);
  return {
    token,
    admin_name: user.adminName,
    email: user.email,
    organization_id: user.organizationId,
    website_id: user.websiteId,
    website_url: user.websiteUrl,
    site_type: orgSite.siteType,
    business_type: orgSite.businessType,
    features: orgSite.features,
    websites: overlayWebsiteSiteTypes(websites, orgSite.siteType, orgSite.businessType),
  };
}

export const authRoutes = fp(async function authRoutes(app: FastifyInstance) {
  app.post("/api/auth/login", async (request, reply) => {
    const body = loginSchema.parse(request.body);

    if (env.AUTH_SOURCE === "my_accounts") {
      const row = await findCustomerByEmail(app.prisma, body.email);
      if (!row || !(await verifyPassword(body.password, row.passwordHash))) {
        return reply.status(401).send({ detail: "Invalid email or password" });
      }
      if (!row.organizationId) {
        return reply.status(403).send({ detail: "No organization linked to this account" });
      }
      const hasAccess = await hasWebTrackingAccess(app.prisma, row.id);
      if (!hasAccess) {
        return reply.status(403).send({
          detail: "No Web Tracking access for this account. Ask an admin to assign a Web Tracking role in Setup People.",
        });
      }
      const websiteRows = await findWebsitesForOrganization(app.prisma, row.organizationId);
      if (!websiteRows.length) {
        return reply.status(403).send({
          detail:
            "No Web Tracking websites configured for this organization. Save website URLs in My Accounts setup first.",
        });
      }
      const customer = attachDefaultWebsite(row, websiteRows);
      if (!customer) {
        return reply.status(403).send({ detail: "No valid Web Tracking website URLs found" });
      }
      const websites = websiteRows.map(mapWebsiteRow);
      const token = app.jwt.sign({
        sub: String(customer.id),
        email: customer.email,
        organization_id: customer.organizationId,
        website_id: customer.websiteId,
        website_url: customer.websiteUrl,
      } satisfies JwtPayload);
      return buildAuthResponse(app.prisma, customer, websites, token);
    }

    const customer = await findAuthUserByEmail(app.prisma, body.email);
    if (!customer || !(await verifyPassword(body.password, customer.passwordHash))) {
      return reply.status(401).send({ detail: "Invalid email or password" });
    }

    const websites = customer.organizationId
      ? (await findWebsitesByOrganizationId(app.prisma, customer.organizationId)).map(mapWebsiteRow)
      : [mapWebsiteRow(customer)];

    const token = app.jwt.sign({
      sub: String(customer.id),
      email: customer.email,
      organization_id: customer.organizationId,
      website_id: customer.websiteId,
      website_url: customer.websiteUrl,
    } satisfies JwtPayload);

    return buildAuthResponse(app.prisma, customer, websites, token);
  });

  app.post("/api/auth/select-website", { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = selectWebsiteSchema.parse(request.body);
    const customer = await findAuthUserById(app.prisma, request.admin.id);
    if (!customer) {
      return reply.status(404).send({ detail: "User not found" });
    }
    if (!customer.organizationId) {
      return reply.status(400).send({ detail: "Organization context is not available for this account" });
    }

    const website = await findWebsiteInOrganization(
      app.prisma,
      customer.organizationId,
      body.website_id,
    );
    if (!website) {
      return reply.status(403).send({ detail: "Website is not part of your organization" });
    }

    const websites = (await findWebsitesByOrganizationId(app.prisma, customer.organizationId)).map(
      mapWebsiteRow,
    );
    const token = app.jwt.sign({
      sub: String(customer.id),
      email: customer.email,
      organization_id: customer.organizationId,
      website_id: website.websiteId,
      website_url: website.websiteUrl,
    } satisfies JwtPayload);

    return buildAuthResponse(
      app.prisma,
      {
        adminName: customer.adminName,
        email: customer.email,
        websiteId: website.websiteId,
        websiteUrl: website.websiteUrl,
        siteType: website.siteType,
        organizationId: customer.organizationId,
      },
      websites,
      token,
    );
  });

  app.get("/api/auth/me", { preHandler: [app.authenticate] }, async (request) => {
    const customer = await findAuthUserById(app.prisma, request.admin.id, request.admin.website_id);
    if (!customer) return { detail: "User not found" };

    const websites = customer.organizationId
      ? (await findWebsitesByOrganizationId(app.prisma, customer.organizationId)).map(mapWebsiteRow)
      : [mapWebsiteRow(customer)];

    const activeWebsite = websites.find((w) => w.website_id === request.admin.website_id) ?? websites[0];
    const orgSite = await resolveOrgDashboardSite(
      app.prisma,
      customer.organizationId,
      activeWebsite?.site_type ?? customer.siteType,
    );

    return {
      admin_name: customer.adminName,
      email: customer.email,
      organization_id: customer.organizationId,
      website_id: request.admin.website_id,
      website_url: request.admin.website_url,
      created_at: customer.createdAt,
      site_type: orgSite.siteType,
      business_type: orgSite.businessType,
      features: orgSite.features,
      websites: overlayWebsiteSiteTypes(websites, orgSite.siteType, orgSite.businessType),
    };
  });

  app.post("/api/auth/onboarding/redirect", async (request, reply) => {
    if (env.AUTH_SOURCE !== "my_accounts") {
      return reply.status(501).send({ detail: "Onboarding redirect is only available with My Accounts auth" });
    }
    if (!isOnboardingRedirectEnabled()) {
      return reply
        .status(503)
        .send({ detail: "Onboarding redirect is not configured (set INTERNAL_SERVICE_KEY)" });
    }
    if (!verifyOnboardingServerSecret(request)) {
      return reply.status(401).send({ detail: "Missing or invalid x-internal-service-key" });
    }

    const body = onboardingRedirectSchema.parse(request.body);
    const resolved = await resolveMyAccountsOnboardingSession(app.prisma, body);
    if (!resolved.ok) {
      return reply.status(resolved.status).send({ detail: resolved.detail });
    }

    const { customer, websites } = resolved;
    const code = generateOnboardingCode();
    await storeOnboardingCode(app.redis, code, {
      userId: customer.id,
      organizationId: customer.organizationId!,
      websiteId: customer.websiteId,
    });

    const base = dashboardPublicUrl();
    const redirectUrl = `${base}/auth/callback?code=${encodeURIComponent(code)}`;
    const orgSite = await resolveOrgDashboardSite(
      app.prisma,
      customer.organizationId,
      customer.siteType,
    );
    return {
      redirect_url: redirectUrl,
      code,
      expires_in_seconds: env.ONBOARDING_CODE_TTL_SECONDS,
      website_id: customer.websiteId,
      websites: overlayWebsiteSiteTypes(websites, orgSite.siteType, orgSite.businessType),
    };
  });

  app.post("/api/auth/onboarding/exchange", async (request, reply) => {
    if (env.AUTH_SOURCE !== "my_accounts") {
      return reply.status(501).send({ detail: "Onboarding exchange is only available with My Accounts auth" });
    }

    const body = onboardingExchangeSchema.parse(request.body);
    const payload = await consumeOnboardingCode(app.redis, body.code);
    if (!payload) {
      return reply.status(410).send({ detail: "Onboarding link expired or already used" });
    }

    const resolved = await resolveOnboardingSessionFromCode(app.prisma, payload);
    if (!resolved.ok) {
      return reply.status(resolved.status).send({ detail: resolved.detail });
    }

    const { customer, websites } = resolved;
    const token = app.jwt.sign({
      sub: String(customer.id),
      email: customer.email,
      organization_id: customer.organizationId,
      website_id: customer.websiteId,
      website_url: customer.websiteUrl,
    } satisfies JwtPayload);

    return buildAuthResponse(app.prisma, customer, websites, token);
  });

  app.get("/api/admin/websites", { preHandler: [app.authenticate] }, async (request, reply) => {
    const customer = await findAuthUserById(app.prisma, request.admin.id);
    if (!customer) {
      return reply.status(404).send({ detail: "User not found" });
    }
    if (!customer.organizationId) {
      return [mapWebsiteRow(customer)];
    }
    const websites = (await findWebsitesByOrganizationId(app.prisma, customer.organizationId)).map(
      mapWebsiteRow,
    );
    const orgSite = await resolveOrgDashboardSite(app.prisma, customer.organizationId, customer.siteType);
    return overlayWebsiteSiteTypes(websites, orgSite.siteType, orgSite.businessType);
  });
});
