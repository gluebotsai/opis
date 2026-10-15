import type { ModuleId } from "@/config/modules";

export type IndustryPackId = "generic-b2b" | "generic-b2c";

export type CampaignMode = "b2b" | "b2c";

/** Extra contact attrs asked/stored via custom_fields (pack catalog). */
export type ContactExtraField = {
  key: string;
  label: string;
  /** recommended = ask after push; optional = user-volunteered only */
  ask: "recommended" | "optional";
  type?: "string" | "number";
};

/**
 * Profile sent to agents on join_session.
 * - mode / industry: pack ids from business_type
 * - industry_type: vertical from accounts.organizations.industry_type (e.g. Retail & E-commerce)
 */
export type CampaignProfile = {
  mode: CampaignMode;
  industry: IndustryPackId;
  /** DB vertical — agents use this for tone/ideas. Empty string if unknown. */
  industry_type: string;
};

export type IndustryPack = {
  id: IndustryPackId;
  mode: CampaignMode;
  /** Display label */
  label: string;
  modules: {
    hide: ModuleId[];
  };
  labels: Partial<Record<ModuleId, string>>;
  descriptions: Partial<Record<ModuleId, string>>;
  /** Optional UI mirror of agent pack contact extras (source of truth is agents). */
  contactExtraFields?: ContactExtraField[];
};
