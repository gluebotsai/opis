import { env } from "../../config/env.js";
import type { PersonalizationAdapter } from "./adapter.js";
import { FixturePersonalizationAdapter } from "./fixture-adapter.js";
import { NoopPersonalizationAdapter } from "./noop-adapter.js";
import {
  mergeIdentityIntoContext,
  resolveMergeMap,
} from "./resolve-merge-map.js";
import type {
  DynamicRecipientContext,
  LaunchPlanPersonalization,
  PersonalizationMode,
} from "./types.js";

export type { PersonalizationAdapter } from "./adapter.js";
export type {
  DynamicRecipientContext,
  LaunchPlanPersonalization,
  PersonalizationMode,
} from "./types.js";
export {
  mergeIdentityIntoContext,
  resolveMergeMap,
} from "./resolve-merge-map.js";
export { listFixtureRecipients } from "./fixture-adapter.js";

let cached: PersonalizationAdapter | null = null;
let cachedName: string | null = null;

function resolveAdapterName(): string {
  const raw = (env.personalization.adapter || "").trim().toLowerCase();
  if (raw === "fixture" || raw === "noop") return raw;
  // Dev demo default when unset; prod-safe noop otherwise.
  return env.nodeEnv === "production" ? "noop" : "fixture";
}

export function getPersonalizationAdapterName(): string {
  return resolveAdapterName();
}

export function getPersonalizationAdapter(): PersonalizationAdapter {
  const name = resolveAdapterName();
  if (cached && cachedName === name) return cached;
  cached =
    name === "fixture"
      ? new FixturePersonalizationAdapter()
      : new NoopPersonalizationAdapter();
  cachedName = name;
  return cached;
}

/** Read launch_plan.personalization without breaking unknown JSON shapes. */
export function readLaunchPlanPersonalization(
  launchPlan: unknown,
): LaunchPlanPersonalization {
  if (!launchPlan || typeof launchPlan !== "object") {
    return { mode: "none" };
  }
  const plan = launchPlan as Record<string, unknown>;
  const raw = plan.personalization;
  if (!raw || typeof raw !== "object") {
    return { mode: "none" };
  }
  const p = raw as Record<string, unknown>;
  const mode: PersonalizationMode =
    p.mode === "dynamic_offer" ? "dynamic_offer" : "none";
  const adapter =
    typeof p.adapter === "string" && p.adapter.trim()
      ? p.adapter.trim()
      : undefined;
  return { mode, adapter };
}

export function isDynamicOfferEnabled(launchPlan: unknown): boolean {
  return readLaunchPlanPersonalization(launchPlan).mode === "dynamic_offer";
}

/**
 * Load adapter contexts for contact ids and build merge maps.
 * When dynamic offers are disabled, still resolves identity-only maps.
 */
export async function buildMergeMapsForContacts(
  contactIds: string[],
  identityById: Map<
    string,
    {
      email?: string;
      phone?: string;
      firstName?: string;
      lastName?: string;
      company?: string;
      city?: string;
      jobTitle?: string;
    }
  >,
  opts?: {
    dynamicOffer?: boolean;
    defaultCampaignUrl?: string | null;
  },
): Promise<Map<string, Record<string, string>>> {
  const dynamic = opts?.dynamicOffer !== false;
  const adapter = getPersonalizationAdapter();
  const fromAdapter =
    dynamic && adapter.name !== "noop"
      ? await adapter.getContexts(contactIds)
      : new Map<string, DynamicRecipientContext>();

  const out = new Map<string, Record<string, string>>();
  for (const id of contactIds) {
    const idn = identityById.get(id) || {};
    const ctx = mergeIdentityIntoContext(fromAdapter.get(id) || null, id, {
      email: idn.email,
      phone: idn.phone,
      first_name: idn.firstName,
      last_name: idn.lastName,
      company: idn.company,
      city: idn.city,
      job_title: idn.jobTitle,
    });
    // Strip offer when dynamic mode off (noop path already has none).
    if (!dynamic) {
      delete ctx.offer;
      delete ctx.custom;
    }
    out.set(
      id,
      resolveMergeMap(ctx, {
        defaultCampaignUrl: opts?.defaultCampaignUrl,
      }),
    );
  }
  return out;
}
