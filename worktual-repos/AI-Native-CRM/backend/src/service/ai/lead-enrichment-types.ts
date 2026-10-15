/** Shared contracts for lead enrichment (agent ↔ CRM). */

export type EnrichmentFieldKey =
  | "domain"
  | "industry"
  | "employeeCount"
  | "linkedinUrl"
  | "logoUrl"
  | "city"
  | "address"
  | "title"
  | "companyName"
  | "companyDescription"
  | "products";

export type EnrichmentFieldValue = {
  value: string | number;
  confidence: number;
  sourceUrl?: string | null;
};

export type LeadEnrichmentPayload = {
  contactId: string;
  fields: Partial<Record<EnrichmentFieldKey, EnrichmentFieldValue>>;
  status?: "enriched" | "skipped" | "failed";
  reason?: string | null;
};

export type LeadEnrichmentContext = {
  contactId: string;
  organizationId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  title: string | null;
  companyId: string | null;
  locationId: string | null;
  companyName: string | null;
  companyDomain: string | null;
  companyIndustry: string | null;
  companyDescription: string | null;
  products: string | null;
  employeeCount: number | null;
  linkedinUrl: string | null;
  logoUrl: string | null;
  city: string | null;
  address: string | null;
  blanks: EnrichmentFieldKey[];
};

export const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "mail.com",
  "yandex.com",
  "gmx.com",
]);

export function emailDomain(email: string | null | undefined): string | null {
  const e = (email ?? "").trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 0) return null;
  const domain = e.slice(at + 1).replace(/^www\./, "");
  return domain || null;
}

export function isFreeMailDomain(domain: string | null | undefined): boolean {
  if (!domain) return false;
  return FREE_MAIL_DOMAINS.has(domain.toLowerCase().trim());
}

const GENERIC_LOCATION_LABELS = new Set([
  "headquarters",
  "hq",
  "head office",
  "headoffice",
  "corporate office",
  "main office",
  "registered office",
  "worldwide",
  "global",
  "remote",
  "multiple locations",
  "n/a",
  "na",
  "none",
  "unknown",
  "tbd",
  "address",
]);

/** True for type labels like "Headquarters" — not a real city. */
export function isGenericLocationLabel(
  value: string | null | undefined,
): boolean {
  const lower = (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!lower) return true;
  if (GENERIC_LOCATION_LABELS.has(lower)) return true;
  if (/^(headquarters|hq|head office)\b/i.test(lower) && !lower.includes(",")) {
    return true;
  }
  return false;
}

/** HQ city/region/country from Wikipedia/Wikidata. Never "Headquarters". */
export function normalizeCompanyCity(
  value: string | null | undefined,
): string | null {
  let text = (value ?? "")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, " ")
    .replace(/\{\{[^}]+\}\}/g, " ")
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/<br\s*\/?>/gi, ", ")
    .replace(/<[^>]+>/g, " ")
    .replace(/^(headquarters|hq|head office)\s*[,:]\s*/i, "")
    .replace(/\s+/g, " ")
    .replace(/^[ ,;]+|[ ,;]+$/g, "")
    .trim();
  if (text.length < 2 || text.length > 90) return null;
  if (isGenericLocationLabel(text)) return null;
  if (!/[A-Za-z]/.test(text)) return null;
  if (/^\d/.test(text)) return null;
  if (/\b(worldwide|global|remote only|multiple locations)\b/i.test(text)) {
    return null;
  }
  return text;
}

/** Wikipedia, Wikidata, or the company's own site. */
export function isTrustedFirmographicSource(
  sourceUrl: string | null | undefined,
  companyDomain?: string | null,
): boolean {
  const raw = (sourceUrl ?? "").trim();
  if (!raw) return false;
  try {
    const host = new URL(raw).hostname.replace(/^www\./i, "").toLowerCase();
    if (host === "wikidata.org" || host.endsWith(".wikidata.org")) return true;
    if (host === "wikipedia.org" || host.endsWith(".wikipedia.org")) return true;
    const trusted = (companyDomain ?? "")
      .trim()
      .toLowerCase()
      .replace(/^www\./, "");
    if (trusted && (host === trusted || host.endsWith(`.${trusted}`))) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Prefer street / city over a generic HQ type label. */
export function displayCompanyLocationLabel(input: {
  name?: string | null;
  city?: string | null;
  address?: string | null;
}): string | null {
  const address = (input.address ?? "").trim();
  if (address && !isGenericLocationLabel(address)) return address;
  const city = normalizeCompanyCity(input.city);
  if (city) return city;
  const name = (input.name ?? "").trim();
  if (name && !isGenericLocationLabel(name)) return name;
  return null;
}

/** Reject location labels / junk that are not real street addresses. */
export function isPlausibleCompanyAddress(
  value: string | null | undefined,
): boolean {
  const raw = (value ?? "").trim();
  if (raw.length < 8 || raw.length > 180) return false;
  const lower = raw.toLowerCase().replace(/\s+/g, " ");
  const banned = new Set([
    "headquarters",
    "hq",
    "head office",
    "headoffice",
    "corporate office",
    "main office",
    "registered office",
    "n/a",
    "na",
    "none",
    "unknown",
    "address",
    "tbd",
  ]);
  if (banned.has(lower)) return false;
  // Pure label like "Headquarters, Seattle" still wrong.
  if (/^(headquarters|hq|head office)\b/i.test(lower) && !/\d/.test(lower)) {
    return false;
  }
  if (/^https?:\/\//i.test(raw)) return false;
  // Marketing / metric copy scraped from homepages.
  if (
    /\b(projects?|clients?|chatbot|gpt-?\d|leveraging|running|happy clients|testimonials?|subscribe|cookie|privacy)\b/i.test(
      lower,
    )
  ) {
    return false;
  }
  // Need a street-like signal: a number plus a place/street word.
  const hasStreetWord =
    /\b(st|street|rd|road|ave|avenue|blvd|lane|ln|dr|drive|way|court|ct|plot|floor|suite|ste|building|bldg|near|cross|nagar|colony|phase|sector|block|apartment|apt|marg|chowk)\b/i.test(
      lower,
    );
  if (!/\d/.test(raw) || !hasStreetWord) return false;
  if (
    /\b(google rating|rating score|best digital|reviews?|stars?)\b/i.test(lower)
  ) {
    return false;
  }
  return true;
}

/** Absolute http(s) image URL suitable for a company logo. */
export function isPlausibleLogoUrl(value: string | null | undefined): boolean {
  const raw = (value ?? "").trim();
  if (!raw) return false;
  // Unencoded whitespace breaks <img src> in browsers (e.g. bad CDN scrapes).
  if (/[\s\u00A0\u2000-\u200B\u202F\uFEFF]/.test(raw)) return false;
  try {
    const u = new URL(raw);
    if (!["http:", "https:"].includes(u.protocol)) return false;
    if (!u.hostname) return false;
    // Reject empty or junk paths that are not real image assets.
    if (u.pathname.length > 512) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Same-origin icon candidates for a trusted company domain (never Clearbit /
 * Google favicon APIs — those stay synthetic).
 */
export function companySiteLogoCandidates(
  domain: string | null | undefined,
): string[] {
  const host = (domain ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
  if (!host || !host.includes(".")) return [];
  return [
    `https://www.${host}/apple-touch-icon.png`,
    `https://www.${host}/apple-touch-icon-precomposed.png`,
    `https://${host}/apple-touch-icon.png`,
    `https://www.${host}/favicon.ico`,
    `https://${host}/favicon.ico`,
  ];
}

/**
 * Brand host implied by a logo URL (google favicons ?domain=, Clearbit path, or
 * the image host itself). Null when the brand cannot be verified.
 */
export function brandHostFromLogoUrl(
  value: string | null | undefined,
): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  if (/^favicon:/i.test(raw)) {
    const host = raw
      .slice(raw.indexOf(":") + 1)
      .trim()
      .toLowerCase()
      .replace(/^www\./, "");
    return host || null;
  }
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    if (!host) return null;
    if (host.includes("google.") && /favicon/i.test(u.pathname)) {
      const domain = (u.searchParams.get("domain") ?? "")
        .trim()
        .toLowerCase()
        .replace(/^www\./, "")
        .split("/")[0];
      return domain || null;
    }
    if (host.includes("clearbit.com")) {
      const slug = u.pathname
        .replace(/^\/+/, "")
        .split("/")[0]
        ?.toLowerCase()
        .replace(/^www\./, "");
      return slug?.includes(".") ? slug : null;
    }
    if (
      host.endsWith("googleusercontent.com") ||
      host.endsWith("gstatic.com") ||
      host.endsWith("fbcdn.net")
    ) {
      return null;
    }
    return host;
  } catch {
    return null;
  }
}

/** Google favicon / Clearbit URLs we synthesize — never treat as a fetched logo. */
export function isSyntheticCompanyLogoUrl(
  value: string | null | undefined,
): boolean {
  const raw = (value ?? "").trim();
  if (!raw) return false;
  if (/^favicon:/i.test(raw)) return true;
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    if (host.includes("google.") && /favicon/i.test(u.pathname)) return true;
    if (host === "logo.clearbit.com" || host.endsWith(".clearbit.com")) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * True when the company name and domain likely refer to the same org.
 * Blocks cases like "Aadhya it services" + tcs.com from a contact's work email.
 */
/**
 * True when cached/agent fields identify this company (domain or LinkedIn).
 * Missing identity → too weak to reuse as another company's cache.
 */
const ACRONYM_SKIP_WORDS = new Set([
  "the",
  "and",
  "of",
  "a",
  "an",
  "inc",
  "incorporated",
  "ltd",
  "llc",
  "corp",
  "corporation",
  "company",
  "co",
  "plc",
  "sa",
  "ag",
  "gmbh",
  "group",
  "holding",
  "holdings",
  "international",
  "worldwide",
  "limited",
  "private",
  "http",
  "https",
  "www",
  "com",
  "org",
  "net",
  "wiki",
  "wikipedia",
  "wikidata",
  "html",
]);

export function isShortCompanyAcronym(
  name: string | null | undefined,
): boolean {
  // Title-case brands (Zepto, Zoho) are not tickers — only ALL-CAPS 2–5
  // letter names get the strict exact-slug path (CTS → cts.com, not ctscorp).
  const compact = (name ?? "").trim().replace(/[.\s]/g, "");
  if (!/^[A-Za-z]{2,5}$/.test(compact)) return false;
  return compact === compact.toUpperCase();
}

export function acronymMatchesEntityText(
  acronym: string | null | undefined,
  text: string | null | undefined,
): boolean {
  const ac = (acronym ?? "").replace(/[^A-Za-z]/g, "").toUpperCase();
  const blob = (text ?? "").replace(/https?:\/\/\S+/g, " ");
  if (ac.length < 2 || !blob.trim()) return false;
  const lead = blob.slice(0, 240);
  if (
    new RegExp(
      `\\b(?:known as|also called|abbreviated(?:\\s+as)?|short(?:ened)?(?:\\s+for)?|trading as|dba)\\s+${ac}\\b`,
      "i",
    ).test(lead)
  ) {
    return true;
  }
  if (new RegExp(`\\(${ac}\\)`).test(blob.slice(0, 100))) return true;
  // Brand form: "HCL Technologies…", "TCS" + company suffix in the lead.
  if (
    new RegExp(
      `(?:^|[\\s(])${ac}\\s+(?:Technologies|Technology|Tech|Group|Systems|Solutions|Services|Software|Consulting|Corporation|Corp|Limited|Ltd|Inc|Labs|Communications|Infosystems)\\b`,
      "i",
    ).test(lead)
  ) {
    return true;
  }
  // Compound wiki titles like HCLTech when the extract is clearly a company.
  const first = lead.trim().match(/^[A-Za-z0-9]+/);
  if (first) {
    const token = first[0]!;
    if (
      token.toUpperCase().startsWith(ac) &&
      token.length > ac.length &&
      token.length <= ac.length + 10 &&
      /\b(compan(?:y|ies)|corporation|multinational|headquartered|enterprise|information technology|it services)\b/i.test(
        blob.slice(0, 500),
      )
    ) {
      return true;
    }
  }
  const words = blob.match(/[A-Za-z]+/g) ?? [];
  const significant: string[] = [];
  for (const w of words) {
    if (ACRONYM_SKIP_WORDS.has(w.toLowerCase())) continue;
    if (w.toUpperCase() === ac) continue;
    significant.push(w);
    if (significant.length >= Math.max(12, ac.length + 6)) break;
  }
  const n = ac.length;
  if (significant.length < n) return false;
  for (let i = 0; i <= significant.length - n; i++) {
    const initials = significant
      .slice(i, i + n)
      .map((w) => w[0]!.toUpperCase())
      .join("");
    if (initials === ac) return true;
  }
  return false;
}

export function companyIdentityAllowsDomain(
  companyName: string | null | undefined,
  domain: string | null | undefined,
  options?: { evidenceText?: string | null; sourceUrl?: string | null },
): boolean {
  if (companyNameMatchesDomain(companyName, domain)) return true;
  if (!isTrustedFirmographicSource(options?.sourceUrl)) return false;
  const evidence = [options?.evidenceText, options?.sourceUrl]
    .filter(Boolean)
    .join(" ");
  if (isShortCompanyAcronym(companyName)) {
    return acronymMatchesEntityText(companyName, evidence);
  }
  // Brand article (Hotstar) may list a parent official site (disneyplus.com).
  const name = (companyName ?? "").trim();
  if (name.length < 4) return false;
  const lead = evidence.replace(/\s+/g, " ").trim().slice(0, 280);
  if (!lead) return false;
  return new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(
    lead,
  );
}

export function enrichmentFieldsBelongToCompany(
  companyName: string | null | undefined,
  fields:
    | Partial<Record<EnrichmentFieldKey, EnrichmentFieldValue>>
    | null
    | undefined,
): boolean {
  const evidence = [
    fields?.companyDescription?.value,
    fields?.companyDescription?.sourceUrl,
    fields?.domain?.sourceUrl,
    fields?.linkedinUrl?.sourceUrl,
  ]
    .filter((v) => v != null && String(v).trim() !== "")
    .join(" ");
  const domainVal = fields?.domain?.value;
  if (typeof domainVal === "string" && domainVal.trim()) {
    return companyIdentityAllowsDomain(companyName, domainVal, {
      evidenceText: evidence,
      sourceUrl:
        (typeof fields?.domain?.sourceUrl === "string"
          ? fields.domain.sourceUrl
          : null) ||
        (typeof fields?.companyDescription?.sourceUrl === "string"
          ? fields.companyDescription.sourceUrl
          : null),
    });
  }
  const linkedinVal = fields?.linkedinUrl?.value;
  if (typeof linkedinVal === "string" && linkedinVal.trim()) {
    return (
      companyNameMatchesLinkedinUrl(companyName, linkedinVal) ||
      companyIdentityAllowsDomain(companyName, linkedinVal, {
        evidenceText: evidence,
        sourceUrl:
          typeof fields?.linkedinUrl?.sourceUrl === "string"
            ? fields.linkedinUrl.sourceUrl
            : null,
      })
    );
  }
  return acronymMatchesEntityText(
    companyName,
    String(fields?.companyDescription?.value ?? ""),
  );
}

export function companyNameMatchesDomain(
  companyName: string | null | undefined,
  domain: string | null | undefined,
): boolean {
  const name = (companyName ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const host = (domain ?? "")
    .toLowerCase()
    .replace(/^www\./, "")
    .split(".")[0] ?? "";
  if (!name.trim() || !host || host.length < 3) return false;
  if (isShortCompanyAcronym(companyName)) {
    const compact = (companyName ?? "").replace(/[.\s]/g, "").toLowerCase();
    return host === compact || host.replace(/-/g, "") === compact;
  }
  const tokens = name.split(" ").filter((t) => t.length >= 3);
  const generic = new Set([
    "services",
    "solutions",
    "technologies",
    "technology",
    "systems",
    "group",
    "company",
    "limited",
    "private",
    "india",
    "global",
    "digital",
  ]);
  const meaningful = tokens.filter((t) => !generic.has(t));
  if (meaningful.length === 0) return host.length >= 4 && name.includes(host);
  return meaningful.some(
    (t) => host.includes(t) || t.includes(host) || name.includes(host),
  );
}

/** True when a LinkedIn company slug matches the company name. */
export function companyNameMatchesLinkedinUrl(
  companyName: string | null | undefined,
  linkedinUrl: string | null | undefined,
): boolean {
  const raw = (linkedinUrl ?? "").trim();
  if (!raw) return false;
  const slug =
    raw.match(/linkedin\.com\/company\/([^/?#]+)/i)?.[1]?.replace(/\/+$/, "").toLowerCase() ??
    raw.replace(/^\/+|\/+$/g, "").toLowerCase();
  if (!slug || slug === "company" || slug === "school" || slug === "in") {
    return false;
  }
  return companyNameMatchesDomain(companyName, `${slug}.com`);
}

/** Domain only when it belongs to this company name (never Zendesk + zoho.com). */
export function trustedCompanyDomain(
  companyName: string | null | undefined,
  domain: string | null | undefined,
): string | null {
  const d = (domain ?? "").trim();
  if (!d) return null;
  if (companyNameMatchesDomain(companyName, d)) return d;
  // Short tickers whose official site embeds the acronym (HCL → hcltech.com).
  if (isShortCompanyAcronym(companyName)) {
    const ac = (companyName ?? "").replace(/[^a-z]/gi, "").toLowerCase();
    const slug = d
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]
      ?.split(".")[0] ?? "";
    if (ac && slug.startsWith(ac) && slug.length <= ac.length + 12) return d;
  }
  return null;
}

function logoUrlMentionsCompany(
  companyName: string | null | undefined,
  logoUrl: string | null | undefined,
): boolean {
  const name = (companyName ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const url = (logoUrl ?? "").toLowerCase();
  if (!name.trim() || !url) return false;
  const generic = new Set([
    "services",
    "solutions",
    "technologies",
    "technology",
    "systems",
    "group",
    "company",
    "limited",
    "private",
    "india",
    "global",
    "digital",
  ]);
  const tokens = name
    .split(" ")
    .filter((t) => t.length >= 4 && !generic.has(t));
  if (tokens.some((t) => url.includes(t))) return true;
  // Short tickers (HCL): commons filenames often embed the acronym + brand form.
  if (isShortCompanyAcronym(companyName)) {
    const ac = (companyName ?? "").replace(/[^a-z]/gi, "").toLowerCase();
    const fname = url.split("/").pop()?.split("?")[0] ?? "";
    if (
      ac.length >= 2 &&
      fname.includes(ac) &&
      (fname.includes("logo") ||
        fname.includes("tech") ||
        fname.startsWith(ac) ||
        fname.includes(`${ac}_`) ||
        fname.includes(`${ac}-`))
    ) {
      return true;
    }
  }
  return false;
}

function hostsSameCompanySite(a: string | null, b: string | null): boolean {
  const ha = (a ?? "").toLowerCase().replace(/^www\./, "");
  const hb = (b ?? "").toLowerCase().replace(/^www\./, "");
  if (!ha || !hb) return false;
  if (ha === hb || ha.endsWith(`.${hb}`) || hb.endsWith(`.${ha}`)) return true;
  const ra = ha.split(".").slice(-2).join(".");
  const rb = hb.split(".").slice(-2).join(".");
  return ra.length >= 4 && ra === rb;
}

/**
 * True when the logo image is for this company — not another brand's mark
 * scraped onto the wrong account (Hexaware / Zendesk showing Zoho).
 */
export function logoUrlBelongsToCompany(
  companyName: string | null | undefined,
  logoUrl: string | null | undefined,
  options?: {
    sourceUrl?: string | null;
    companyDomain?: string | null;
    evidenceText?: string | null;
  },
): boolean {
  const raw = (logoUrl ?? "").trim();
  if (!raw || isSyntheticCompanyLogoUrl(raw) || !isPlausibleLogoUrl(raw)) {
    return false;
  }
  const host = brandHostFromLogoUrl(raw);
  const trustedDomain = (options?.companyDomain ?? "")
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
  // Icon on the company's known domain — only when that domain is really theirs
  // (Zendesk must not keep a zoho.com favicon just because domain was mis-set).
  if (host && trustedDomain && hostsSameCompanySite(host, trustedDomain)) {
    if (companyNameMatchesDomain(companyName, trustedDomain)) return true;
    if (
      companyIdentityAllowsDomain(companyName, trustedDomain, {
        evidenceText: options?.evidenceText,
        sourceUrl: options?.sourceUrl,
      })
    ) {
      return true;
    }
    if (isShortCompanyAcronym(companyName)) {
      const ac = (companyName ?? "").replace(/[^a-z]/gi, "").toLowerCase();
      const slug =
        trustedDomain.split(".")[0]?.toLowerCase().replace(/^www\./, "") ?? "";
      if (ac && slug.startsWith(ac) && slug.length <= ac.length + 12) {
        return true;
      }
    }
  }
  if (
    host &&
    (host === "wikimedia.org" ||
      host.endsWith(".wikimedia.org") ||
      host === "wikipedia.org" ||
      host.endsWith(".wikipedia.org"))
  ) {
    if (logoUrlMentionsCompany(companyName, raw)) return true;
    if (
      isTrustedFirmographicSource(options?.sourceUrl) &&
      (companyIdentityAllowsDomain(companyName, trustedDomain || host, {
        evidenceText: options?.evidenceText,
        sourceUrl: options?.sourceUrl,
      }) ||
        acronymMatchesEntityText(
          companyName,
          `${options?.evidenceText ?? ""} ${options?.sourceUrl ?? ""}`,
        ))
    ) {
      return true;
    }
  }
  if (host && companyNameMatchesDomain(companyName, host)) {
    const trusted = trustedCompanyDomain(companyName, options?.companyDomain);
    if (!trusted) return true;
    const trustedSlug =
      trusted.toLowerCase().replace(/^www\./, "").split(".")[0] ?? "";
    const logoSlug = host.toLowerCase().replace(/^www\./, "").split(".")[0] ?? "";
    if (trustedSlug.length < 3 || logoSlug.length < 3) return true;
    if (trustedSlug === logoSlug) return true;
    if (host.includes(trustedSlug) || trusted.toLowerCase().includes(logoSlug)) {
      return true;
    }
    return logoUrlMentionsCompany(companyName, raw);
  }
  if (logoUrlMentionsCompany(companyName, raw)) return true;
  const pageHost = brandHostFromLogoUrl(options?.sourceUrl ?? null);
  if (
    host &&
    pageHost &&
    companyNameMatchesDomain(companyName, pageHost) &&
    hostsSameCompanySite(host, pageHost)
  ) {
    return true;
  }
  return false;
}

/** Logo to render: only a URL the enrichment agent fetched for this company. */
export function displayCompanyLogoUrl(input: {
  name: string;
  domain?: string | null;
  logoUrl?: string | null;
}): string | null {
  if (
    logoUrlBelongsToCompany(input.name, input.logoUrl, {
      companyDomain: input.domain,
    })
  ) {
    return (input.logoUrl ?? "").trim() || null;
  }
  return null;
}

/** Ordered logo URLs for clients that may try same-origin icons after a broken store. */
export function companyLogoDisplayCandidates(input: {
  name: string;
  domain?: string | null;
  logoUrl?: string | null;
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (url: string | null | undefined) => {
    const raw = (url ?? "").trim();
    if (!raw || seen.has(raw)) return;
    if (
      !logoUrlBelongsToCompany(input.name, raw, {
        companyDomain: input.domain,
      })
    ) {
      return;
    }
    seen.add(raw);
    out.push(raw);
  };
  push(input.logoUrl);
  // Only add site icons when there is no usable stored logo.
  if (out.length === 0) {
    for (const candidate of companySiteLogoCandidates(input.domain)) {
      push(candidate);
    }
  }
  return out;
}
