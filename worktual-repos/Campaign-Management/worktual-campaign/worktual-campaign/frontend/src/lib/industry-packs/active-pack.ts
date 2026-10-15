import {
  DEFAULT_PACK_ID,
  getIndustryPack,
} from "./packs";
import type {
  CampaignMode,
  CampaignProfile,
  IndustryPack,
  IndustryPackId,
} from "./types";

const listeners = new Set<() => void>();

/** Set from auth session after login (/auth/me). Default B2B until session loads. */
let sessionProfile: CampaignProfile = {
  mode: "b2b",
  industry: DEFAULT_PACK_ID,
  industry_type: "",
};

function notify() {
  for (const fn of listeners) fn();
}

export function setSessionCampaignProfile(profile: {
  mode?: string | null;
  industry?: string | null;
  /** From accounts.organizations.industry_type */
  industryType?: string | null;
  industry_type?: string | null;
}) {
  const mode: CampaignMode =
    String(profile.mode || "").toLowerCase() === "b2c" ? "b2c" : "b2b";
  const rawIndustry = String(profile.industry || "").toLowerCase();
  const industry: IndustryPackId =
    mode === "b2c" || rawIndustry === "generic-b2c"
      ? "generic-b2c"
      : "generic-b2b";
  const industry_type = String(
    profile.industry_type ?? profile.industryType ?? "",
  ).trim();
  const next: CampaignProfile = {
    mode: industry === "generic-b2c" ? "b2c" : mode,
    industry,
    industry_type,
  };
  if (
    next.mode === sessionProfile.mode &&
    next.industry === sessionProfile.industry &&
    next.industry_type === sessionProfile.industry_type
  ) {
    return;
  }
  sessionProfile = next;
  notify();
}

export function getActivePackId(): IndustryPackId {
  return sessionProfile.industry;
}

export function getActivePack(): IndustryPack {
  return getIndustryPack(getActivePackId());
}

export function getActivePackServerSnapshot(): IndustryPack {
  return getIndustryPack(DEFAULT_PACK_ID);
}

export function getCampaignProfile(): CampaignProfile {
  return { ...sessionProfile };
}

/** Keep generic-b2b on the original key so existing data is not orphaned. */
export function packStorageKey(base: string): string {
  const id = getActivePackId();
  if (id === DEFAULT_PACK_ID) return base;
  return `${base}.${id}`;
}

export function isB2cPack(): boolean {
  return getActivePackId() === "generic-b2c";
}

/** No-op identity — pack comes from login, no tenant overlay. */
export function overlaySessionForPack<
  T extends { organizationId: string; orgName: string },
>(user: T): T {
  return user;
}

export function isIndustrySwitcherEnabled(): boolean {
  return false;
}

export function setActivePackId(_id: IndustryPackId) {
  /* Pack comes from login business_type — no manual switcher. */
}

export function subscribeActivePack(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
