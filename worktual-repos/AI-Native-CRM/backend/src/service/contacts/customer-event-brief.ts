/**
 * Readable lines from cdp.customer_events. Presentation only:
 * the words come from the stored event, not from a new story.
 */

import type { BusinessType } from "@/config/modules";

const SALES_EVENTS = [
  "page_view",
  "click",
  "form_start",
  "form_submit",
  "form_success",
  "form_abandon",
  "site_search",
  "outbound_link",
  "rage_click",
  "dead_click",
  "email_open",
] as const;

const COMMERCE_EVENTS = [
  "product_view",
  "add_to_cart",
  "remove_from_cart",
  "add_to_wishlist",
  "remove_from_wishlist",
  "begin_checkout",
  "payment_failure",
  "refund",
  "return_requested",
  "return_approved",
  "return_processed",
  "email_open",
] as const;

export type CustomerEventFact = {
  eventName: string;
  channel: string | null;
  pagePath: string | null;
  pageTitle: string | null;
  amount: number | null;
  currency: string | null;
  occurredAt: string | null;
  properties: Record<string, unknown> | null;
};

export type DescribedCustomerEvent = {
  name: string;
  channel: string | null;
  page: string | null;
  amount: number | null;
  occurredAt: string | null;
  campaignTitle: string | null;
};

export function eventNamesForBusinessType(businessType: BusinessType): string[] {
  if (businessType === "b2c") return [...COMMERCE_EVENTS];
  if (businessType === "b2b2c") {
    return [...new Set([...SALES_EVENTS, ...COMMERCE_EVENTS])];
  }
  return [...SALES_EVENTS];
}

export function describeCustomerEvent(fact: CustomerEventFact): DescribedCustomerEvent | null {
  const props = fact.properties;
  const page = pageLabel(fact);
  const rawChannel = cleanLabel(fact.channel);
  const channel = rawChannel && /^\d{6,}$/.test(rawChannel) ? null : rawChannel;
  const occurredAt = fact.occurredAt;
  let name = "";
  let campaignTitle: string | null = null;

  switch (fact.eventName) {
    case "page_view":
      name = page ? `Opened ${page}` : "Opened a page";
      break;
    case "click": {
      const element = propText(props, "elementText", "text", "element");
      name = element
        ? `Clicked ${element}${page ? ` on ${page}` : ""}`
        : page
          ? `Clicked on ${page}`
          : "Clicked a control";
      break;
    }
    case "form_start":
      name = `Started ${formLabel(props)}`;
      break;
    case "form_submit":
      name = `Submitted ${formLabel(props)}`;
      break;
    case "form_success":
      name = `Completed ${formLabel(props)}`;
      break;
    case "form_abandon":
      name = `Left ${formLabel(props)} unfinished`;
      break;
    case "site_search": {
      const query = propText(props, "query");
      name = query ? `Searched for ${query}` : "Searched the site";
      break;
    }
    case "outbound_link": {
      const label = propText(props, "text");
      name = label ? `Opened ${label}` : "Opened an external link";
      break;
    }
    case "rage_click":
      name = page ? `Clicked repeatedly on ${page}` : "Clicked repeatedly";
      break;
    case "dead_click":
      name = page ? `Clicked with no result on ${page}` : "Clicked with no result";
      break;
    case "email_open": {
      campaignTitle = propText(props, "campaign_name", "campaign");
      name = campaignTitle ? `Opened ${campaignTitle}` : "Opened a campaign email";
      break;
    }
    case "product_view":
      name = productLine("Viewed", props, fact);
      break;
    case "add_to_cart":
      name = productLine("Added", props, fact, "to the cart");
      break;
    case "remove_from_cart":
      name = productLine("Removed", props, fact, "from the cart");
      break;
    case "add_to_wishlist":
      name = productLine("Saved", props, fact, "to a wishlist");
      break;
    case "remove_from_wishlist":
      name = productLine("Removed", props, fact, "from a wishlist");
      break;
    case "begin_checkout":
      name = moneyLine("Started checkout", propNumber(props, "cartValue") ?? fact.amount, fact, props);
      break;
    case "payment_failure": {
      const reason = propText(props, "errorMessage");
      const base = moneyLine("Payment failed", propNumber(props, "cartValue") ?? fact.amount, fact, props);
      name = reason ? `${base}. ${reason}` : base;
      break;
    }
    case "refund":
      name = moneyLine("Refund recorded", propNumber(props, "revenue") ?? fact.amount, fact, props);
      break;
    case "return_requested":
      name = "Requested a return";
      break;
    case "return_approved":
      name = "Return approved";
      break;
    case "return_processed":
      name = "Return processed";
      break;
    default:
      return null;
  }

  const cleaned = cleanLabel(name);
  if (!cleaned) return null;
  return {
    name: cleaned,
    channel,
    page: null,
    amount: null,
    occurredAt,
    campaignTitle,
  };
}

function productLine(
  verb: string,
  props: Record<string, unknown> | null,
  fact: CustomerEventFact,
  tail?: string,
): string {
  const product = propText(props, "productName", "product_name") ?? "a product";
  const price = money(propNumber(props, "productPrice", "product_price") ?? fact.amount, currencyOf(fact, props));
  const action = tail ? `${verb} ${product} ${tail}` : `${verb} ${product}`;
  return price ? `${action}, ${price}` : action;
}

function moneyLine(
  verb: string,
  amount: number | null,
  fact: CustomerEventFact,
  props: Record<string, unknown> | null,
): string {
  const priced = money(amount, currencyOf(fact, props));
  return priced ? `${verb} for ${priced}` : verb;
}

function formLabel(props: Record<string, unknown> | null): string {
  return propText(props, "formName", "form_name") ?? "a form";
}

function pageLabel(fact: CustomerEventFact): string | null {
  return (
    cleanLabel(fact.pageTitle) ??
    propText(fact.properties, "page_title", "title", "pageName") ??
    pathLabel(fact.pagePath) ??
    pathLabel(propText(fact.properties, "page_path", "path"))
  );
}

function pathLabel(path: string | null): string | null {
  const value = cleanLabel(path);
  if (!value || value === "/") return null;
  return value;
}

function currencyOf(
  fact: CustomerEventFact,
  props: Record<string, unknown> | null,
): string | null {
  return cleanLabel(fact.currency) ?? propText(props, "currency");
}

function money(amount: number | null, currency: string | null): string | null {
  if (amount == null || !Number.isFinite(amount)) return null;
  const formatted = Number.isInteger(amount)
    ? String(amount)
    : amount.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return currency ? `${currency} ${formatted}` : formatted;
}

function propText(props: Record<string, unknown> | null, ...keys: string[]): string | null {
  if (!props) return null;
  for (const key of keys) {
    const raw = props[key];
    if (raw == null || typeof raw === "object") continue;
    const value = cleanLabel(String(raw));
    if (value) return value;
  }
  return null;
}

function propNumber(props: Record<string, unknown> | null, ...keys: string[]): number | null {
  if (!props) return null;
  for (const key of keys) {
    const raw = props[key];
    if (raw == null || raw === "") continue;
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Drop ids, addresses, and links. Keep a short human label. */
export function cleanLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  if (/^\{[^}]+\}$/.test(text)) return null;
  if (/https?:\/\//i.test(text) || /\bwww\./i.test(text)) return null;
  if (/\S+@\S+/.test(text)) return null;
  if (/\bCDP-/i.test(text)) return null;
  if (/^[0-9a-f-]{16,}$/i.test(text)) return null;
  return text.slice(0, 160);
}
