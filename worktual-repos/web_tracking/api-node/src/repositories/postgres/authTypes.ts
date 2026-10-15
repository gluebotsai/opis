/** Normalized auth user for dashboard login (My Accounts or legacy admin_accounts). */

export type AuthUser = {
  id: number;
  email: string;
  passwordHash: string;
  adminName: string;
  organizationId: number | null;
  websiteId: number;
  websiteUrl: string;
  siteType: string;
  createdAt: Date | null;
};

export type WebsiteRow = {
  websiteId: number;
  websiteUrl: string;
  siteType: string;
  label: string | null;
};
