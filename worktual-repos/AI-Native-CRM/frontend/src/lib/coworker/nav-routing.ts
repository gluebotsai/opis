/** Disambiguate Sales modules vs Configuration document templates when routing. */

export const CONFIGURATION_SUB_HREFS = {
  email: "/configuration/email",
  "proposal-patterns": "/configuration/proposal-patterns",
  "proposal-templates": "/configuration/proposal-patterns",
  "quote-templates": "/configuration/quote-templates",
  "invoice-templates": "/configuration/invoice-templates",
  developers: "/configuration/developers",
} as const;

export const QUOTE_VS_TEMPLATE_CLARIFY =
  "Did you mean **Sales quotes** (customer quotations on deals) or **Quote templates** under Configuration (document layout for quotes)?";

export const PROPOSAL_VS_TEMPLATE_CLARIFY =
  "Did you mean **Sales proposals** on a deal or **Proposal patterns** under Configuration?";

export const INVOICE_VS_TEMPLATE_CLARIFY =
  "Did you mean **Finance invoices** or **Invoice templates** under Configuration (document layout)?";

function hasSalesQuoteSignal(lower: string): boolean {
  return /\b(customer|deal|sales|send|accept|reject|discount|pipeline|create|draft|new|pending|approval)\b/.test(
    lower,
  );
}

function hasTemplateSignal(lower: string): boolean {
  return /\b(template|templates|layout|document|brand|config|setting)\b/.test(lower);
}

export function configurationSubHref(text: string): string | null {
  const lower = text.toLowerCase();
  if (/\bproposal (templates?|patterns?)\b/.test(lower)) {
    return CONFIGURATION_SUB_HREFS["proposal-patterns"];
  }
  if (/\bquote templates?\b/.test(lower)) {
    return CONFIGURATION_SUB_HREFS["quote-templates"];
  }
  if (/\binvoice templates?\b/.test(lower)) {
    return CONFIGURATION_SUB_HREFS["invoice-templates"];
  }
  if (/\b(developer|api keys?)\b/.test(lower)) {
    return CONFIGURATION_SUB_HREFS.developers;
  }
  if (/\bemail\b/.test(lower) && /\b(config|setting|connect|mail)\b/.test(lower)) {
    return CONFIGURATION_SUB_HREFS.email;
  }
  return null;
}

export function quoteNavigationAmbiguous(text: string): boolean {
  const lower = text.toLowerCase();
  if (configurationSubHref(lower)) return false;
  if (!/\bquot(?:e|ation)s?\b/.test(lower)) return false;
  if (hasTemplateSignal(lower)) return false;
  if (hasSalesQuoteSignal(lower)) return false;
  return true;
}

export function proposalNavigationAmbiguous(text: string): boolean {
  const lower = text.toLowerCase();
  if (configurationSubHref(lower)) return false;
  if (!/\bproposals?\b/.test(lower)) return false;
  if (hasTemplateSignal(lower)) return false;
  if (/\b(deal|sales|customer|create|draft|send)\b/.test(lower)) return false;
  return true;
}

export function invoiceNavigationAmbiguous(text: string): boolean {
  const lower = text.toLowerCase();
  if (configurationSubHref(lower)) return false;
  if (!/\binvoices?\b/.test(lower)) return false;
  if (hasTemplateSignal(lower)) return false;
  if (/\b(finance|billing|payment|deal|customer|create|draft)\b/.test(lower)) {
    return false;
  }
  return true;
}

export function navigationClarification(text: string): string | null {
  const lower = text.toLowerCase();
  if (quoteNavigationAmbiguous(lower)) return QUOTE_VS_TEMPLATE_CLARIFY;
  if (proposalNavigationAmbiguous(lower)) return PROPOSAL_VS_TEMPLATE_CLARIFY;
  if (invoiceNavigationAmbiguous(lower)) return INVOICE_VS_TEMPLATE_CLARIFY;
  return null;
}

export function inferModuleFromLabel(label: string): string | null {
  const lower = label.toLowerCase();
  if (configurationSubHref(lower)) return null;
  if (navigationClarification(lower)) return null;
  if (/\bcalendar\b/.test(lower)) return "calendar";
  if (/\bcontacts?\b|\bleads?\b|\bpeople\b/.test(lower)) return "contact";
  if (/\bcompan|\baccounts?\b/.test(lower)) return "company";
  if (/\bquotes?\b/.test(lower)) return "quotes";
  if (/\bdeals?\b|\bpipeline\b|\bsales\b/.test(lower)) return "sales";
  if (/\bproducts?\b|\bcatalog\b/.test(lower)) return "product";
  if (/\binvoices?\b|\bfinance\b|\bbilling\b/.test(lower)) return "finance";
  if (/\bactivit|\btasks?\b/.test(lower)) return "activities";
  if (/\bdashboard\b|\bhome\b/.test(lower)) return "dashboard";
  if (/\binbox\b/.test(lower)) return "inbox";
  if (/\breports?\b/.test(lower)) return "reports";
  if (/\bmarketing\b/.test(lower)) return "marketing";
  if (/\bagents?\b/.test(lower)) return "agents";
  if (/\bcommerce\b/.test(lower)) return "commerce";
  if (/\bservice\b/.test(lower)) return "service";
  if (/\bconfig|\bsettings\b/.test(lower)) return "configuration";
  return null;
}

export type NavResolve =
  | { kind: "href"; href: string }
  | { kind: "clarify"; message: string }
  | { kind: "unknown" };

export function resolveNavigationFromText(text: string): NavResolve {
  const sub = configurationSubHref(text);
  if (sub) return { kind: "href", href: sub };
  const clarify = navigationClarification(text);
  if (clarify) return { kind: "clarify", message: clarify };
  const mod = inferModuleFromLabel(text);
  if (mod?.startsWith("configuration-")) {
    return { kind: "unknown" };
  }
  return { kind: "unknown" };
}
