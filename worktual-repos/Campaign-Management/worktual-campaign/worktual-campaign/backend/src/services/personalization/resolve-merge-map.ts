import {
  greetingFirstName,
  titleCasePersonName,
} from "../../helpers/contact-validation.js";
import type { DynamicRecipientContext } from "./types.js";

export type ResolveMergeOptions = {
  /** Used when offer.product_url is absent (Soft PDOA {{campaign_url}}). */
  defaultCampaignUrl?: string | null;
};

/**
 * Build the merge-tag map for email / push / preview.
 * Tags: first_name, company, city, job_title, campaign_url,
 * product_name, product_url, product_image, product_price, product_id,
 * plus any custom keys.
 */
export function resolveMergeMap(
  ctx: DynamicRecipientContext,
  opts?: ResolveMergeOptions,
): Record<string, string> {
  const firstName = greetingFirstName(ctx.identity.first_name);
  const company = (ctx.identity.company || "").trim();
  const city = (ctx.identity.city || "").trim();
  const jobTitle = (ctx.identity.job_title || "").trim();
  const lastName = titleCasePersonName(ctx.identity.last_name);
  const email = (ctx.identity.email || "").trim();
  const phone = (ctx.identity.phone || "").trim();

  const productUrl = (ctx.offer?.product_url || "").trim();
  const defaultUrl = (opts?.defaultCampaignUrl || "").trim();
  const campaignUrl = productUrl || defaultUrl;

  const map: Record<string, string> = {
    first_name: firstName,
    firstname: firstName,
    last_name: lastName,
    lastname: lastName,
    email,
    phone,
    company,
    company_name: company,
    city,
    job_title: jobTitle,
    jobtitle: jobTitle,
    role: jobTitle,
    campaign_url: campaignUrl,
    url: campaignUrl,
    product_name: "",
    product_url: "",
    product_image: "",
    product_price: "",
    product_id: "",
  };

  if (ctx.offer) {
    map.product_id = (ctx.offer.product_id || "").trim();
    map.product_name = (ctx.offer.name || "").trim();
    map.product_url = productUrl;
    map.product_image = (ctx.offer.image_url || "").trim();
    const price = (ctx.offer.price || "").trim();
    const currency = (ctx.offer.currency || "").trim();
    map.product_price =
      price && currency ? `${currency} ${price}` : price || currency;
  }

  if (ctx.custom) {
    for (const [key, value] of Object.entries(ctx.custom)) {
      const k = String(key || "")
        .trim()
        .toLowerCase();
      if (!k) continue;
      map[k] = String(value ?? "");
    }
  }

  map.first_name = greetingFirstName(map.first_name);
  map.firstname = greetingFirstName(map.firstname || map.first_name);
  if (map.last_name) map.last_name = titleCasePersonName(map.last_name);
  if (map.lastname) map.lastname = titleCasePersonName(map.lastname);

  return map;
}

/** Merge CRM identity over adapter context (CRM wins for known fields). */
export function mergeIdentityIntoContext(
  base: DynamicRecipientContext | null | undefined,
  contactId: string,
  identity: DynamicRecipientContext["identity"],
): DynamicRecipientContext {
  const fromAdapter = base || { contact_id: contactId, identity: {} };
  return {
    contact_id: contactId,
    identity: {
      ...fromAdapter.identity,
      ...(identity.email ? { email: identity.email } : {}),
      ...(identity.phone ? { phone: identity.phone } : {}),
      ...(identity.first_name ? { first_name: identity.first_name } : {}),
      ...(identity.last_name ? { last_name: identity.last_name } : {}),
      ...(identity.company ? { company: identity.company } : {}),
      ...(identity.city ? { city: identity.city } : {}),
      ...(identity.job_title ? { job_title: identity.job_title } : {}),
    },
    offer: fromAdapter.offer,
    custom: fromAdapter.custom,
  };
}
