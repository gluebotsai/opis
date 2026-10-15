/**
 * Tenant (seller) branding for outbound emails — read-only.
 * Logo: CRM verticalConfig.logoUrl → org website icon → default Worktual mark.
 */

import { prisma } from "@/dao/db/prisma";
import { loadSellerOrganization } from "@/service/ai/seller-org";

export type OrgBrand = {
  sellerName: string;
  logoUrl: string;
};

function appPublicBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    process.env.APP_URL?.replace(/\/$/, "") ||
    "http://localhost:3000"
  );
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function hostFromWebsite(website: string): string | null {
  const raw = website.trim();
  if (!raw) return null;
  try {
    const u = raw.startsWith("http") ? new URL(raw) : new URL(`https://${raw}`);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

/** Same-origin brand icon candidates as the company card UI. */
export function siteLogoFromWebsite(
  website: string | null | undefined,
): string | null {
  const host = hostFromWebsite(website ?? "");
  if (!host) return null;
  return `https://www.${host}/apple-touch-icon.png`;
}

export function defaultOrgLogoUrl(): string {
  return `${appPublicBaseUrl()}/brand/worktual-logo.png`;
}

export async function resolveOrgBrand(
  organizationId: string | null | undefined,
): Promise<OrgBrand> {
  const id = organizationId?.trim();
  if (!id) {
    return { sellerName: "Worktual", logoUrl: defaultOrgLogoUrl() };
  }

  const [seller, profile] = await Promise.all([
    loadSellerOrganization(id),
    prisma.organizationProfile
      .findUnique({ where: { organizationId: BigInt(id) } })
      .catch(() => null),
  ]);

  const sellerName = seller?.companyName?.trim() || "Worktual";

  let configLogo: string | null = null;
  const config = profile?.verticalConfig;
  if (config && typeof config === "object" && !Array.isArray(config)) {
    const raw = (config as Record<string, unknown>).logoUrl;
    if (typeof raw === "string" && isHttpUrl(raw)) {
      configLogo = raw.trim();
    }
  }

  const logoUrl =
    configLogo ||
    siteLogoFromWebsite(seller?.websiteUrl) ||
    defaultOrgLogoUrl();

  return { sellerName, logoUrl };
}
