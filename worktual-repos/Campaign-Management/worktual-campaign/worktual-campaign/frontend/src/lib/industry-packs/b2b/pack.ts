import type { IndustryPack } from "../types";

/** Generic B2B pack — company / job-title audience, business hours. */
export const B2B_PACK: IndustryPack = {
  id: "generic-b2b",
  mode: "b2b",
  label: "Generic B2B",
  modules: { hide: [] },
  labels: {},
  descriptions: {},
  contactExtraFields: [
    { key: "job_title", label: "job title", ask: "recommended" },
  ],
};
