/**
 * Seller (tenant) org profile from accounts.organizations — used for proposal briefs.
 * Read-only. Falls back to public.organizations when accounts schema is unavailable.
 */

import { accountQuery } from "@/dao/db/account-pool";

export type SellerOrganization = {
  id: string;
  companyName: string | null;
  industryType: string | null;
  businessType: string | null;
  websiteUrl: string | null;
  country: string | null;
  companySize: string | null;
  contactName: string | null;
  workEmail: string | null;
  /** Billing / letterhead address when present on the org row. */
  billingAddress: string | null;
};

function mapRow(row: {
  id: string;
  company_name: string | null;
  industry_type?: string | null;
  business_type?: string | null;
  website_url?: string | null;
  country?: string | null;
  company_size?: string | null;
  contact_name?: string | null;
  work_email?: string | null;
  billing_address?: string | null;
}): SellerOrganization {
  return {
    id: row.id,
    companyName: row.company_name,
    industryType: row.industry_type ?? null,
    businessType: row.business_type ?? null,
    websiteUrl: row.website_url ?? null,
    country: row.country ?? null,
    companySize: row.company_size ?? null,
    contactName: row.contact_name ?? null,
    workEmail: row.work_email ?? null,
    billingAddress: row.billing_address ?? null,
  };
}

export async function loadSellerOrganization(
  organizationId: string,
): Promise<SellerOrganization | null> {
  const id = organizationId?.trim();
  if (!id) return null;

  try {
    const { rows } = await accountQuery<{
      id: string;
      company_name: string | null;
      industry_type: string | null;
      business_type: string | null;
      website_url: string | null;
      country: string | null;
      company_size: string | null;
      contact_name: string | null;
      work_email: string | null;
    }>(
      `SELECT id::text AS id,
              company_name,
              industry_type,
              business_type,
              website_url,
              country,
              company_size,
              contact_name,
              work_email
       FROM accounts.organizations
       WHERE id = $1::bigint
       LIMIT 1`,
      [id],
    );
    const row = rows[0];
    if (row) return mapRow({ ...row, billing_address: null });
  } catch (err) {
    console.warn(
      "loadSellerOrganization accounts.organizations failed; trying public.organizations",
      id,
      err instanceof Error ? err.message : err,
    );
  }

  // Local / alternate DBs sometimes expose organizations without the accounts schema.
  try {
    const { rows } = await accountQuery<{
      id: string;
      company_name: string | null;
      industry_type: string | null;
      website_url: string | null;
      country: string | null;
      company_size: string | null;
      contact_name: string | null;
      work_email: string | null;
      billing_address: string | null;
    }>(
      `SELECT id::text AS id,
              company_name,
              industry_type,
              website_url,
              country,
              company_size,
              contact_name,
              work_email,
              NULLIF(TRIM(COALESCE(billing_address, '')), '') AS billing_address
       FROM public.organizations
       WHERE id = $1::bigint
       LIMIT 1`,
      [id],
    );
    const row = rows[0];
    if (row) return mapRow(row);
  } catch (err) {
    console.error("loadSellerOrganization failed", id, err);
  }
  return null;
}
