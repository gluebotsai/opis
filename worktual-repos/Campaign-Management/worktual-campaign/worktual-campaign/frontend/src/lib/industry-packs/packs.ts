import { B2B_PACK } from "./b2b/pack";
import { B2C_PACK } from "./b2c/pack";
import type { IndustryPack, IndustryPackId } from "./types";

export const INDUSTRY_PACKS: Record<IndustryPackId, IndustryPack> = {
  "generic-b2b": B2B_PACK,
  "generic-b2c": B2C_PACK,
};

export const DEFAULT_PACK_ID: IndustryPackId = "generic-b2b";

export const PACK_OPTIONS: IndustryPackId[] = ["generic-b2b", "generic-b2c"];

export function getIndustryPack(id: string | null | undefined): IndustryPack {
  if (id === "generic-b2c") return INDUSTRY_PACKS["generic-b2c"];
  return INDUSTRY_PACKS["generic-b2b"];
}

export function profileFromBusinessType(
  businessType: string | null | undefined,
): { mode: "b2b" | "b2c"; industry: IndustryPackId } {
  const t = String(businessType || "")
    .trim()
    .toUpperCase();
  if (t === "B2C") {
    return { mode: "b2c", industry: "generic-b2c" };
  }
  return { mode: "b2b", industry: "generic-b2b" };
}
