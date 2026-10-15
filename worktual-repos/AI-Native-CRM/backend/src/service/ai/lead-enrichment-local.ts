/**
 * Local (TypeScript) enrichment fallback when ai-service is unreachable.
 * Sources: known domain page fetch, Wikidata/Wikipedia, DuckDuckGo HTML.
 */

import {
  emailDomain,
  isFreeMailDomain,
  isPlausibleCompanyAddress,
  logoUrlBelongsToCompany,
  companyIdentityAllowsDomain,
  companyNameMatchesDomain,
  companyNameMatchesLinkedinUrl,
  normalizeCompanyCity,
  type LeadEnrichmentContext,
  type LeadEnrichmentPayload,
  type EnrichmentFieldValue,
} from "@/service/ai/lead-enrichment-types";
import {
  BROWSER_UA,
  extractEmployeeCountFromText,
  extractLinkedInCompanyUrl,
  lookupWikidataFirmographics,
} from "@/service/ai/lead-enrichment-wikidata";

const FETCH_TIMEOUT_MS = 5_000;
const MAX_HTML_BYTES = 400_000;

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (
    h === "localhost" ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h === "0.0.0.0"
  ) {
    return true;
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

async function safeFetchText(url: string): Promise<string | null> {
  try {
    const u = new URL(url);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    if (isPrivateHost(u.hostname)) return null;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    clearTimeout(t);
    if (!res.ok) return null;
    finalHostCheck(res.url);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_HTML_BYTES) return null;
    return new TextDecoder("utf-8", { fatal: false }).decode(buf);
  } catch {
    return null;
  }
}

function finalHostCheck(finalUrl: string) {
  try {
    const u = new URL(finalUrl);
    if (isPrivateHost(u.hostname)) throw new Error("SSRF");
  } catch {
    throw new Error("SSRF");
  }
}

function extractMeta(html: string, prop: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`,
    "i",
  );
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`,
    "i",
  );
  return html.match(re)?.[1] ?? html.match(re2)?.[1] ?? null;
}

function absolutizeUrl(href: string, pageUrl: string): string | null {
  try {
    return new URL(href, pageUrl).toString();
  } catch {
    return null;
  }
}

/** Prefer JSON-LD / apple-touch-icon / site icon; never a third-party favicon API. */
function extractLogoFromHtml(html: string, pageUrl: string): string | null {
  const ld =
    html.match(/"logo"\s*:\s*"(https?:[^"]+)"/i)?.[1] ??
    html.match(/"logo"\s*:\s*\{[^}]*"(?:url|contentUrl)"\s*:\s*"(https?:[^"]+)"/i)?.[1];
  if (ld) {
    const abs = absolutizeUrl(ld, pageUrl);
    if (abs) return abs;
  }
  const apple = html.match(
    /<link[^>]+rel=["']apple-touch-icon[^"']*["'][^>]+href=["']([^"']+)["']/i,
  );
  const apple2 = html.match(
    /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']apple-touch-icon[^"']*["']/i,
  );
  const icon = html.match(
    /<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i,
  );
  const icon2 = html.match(
    /<link[^>]+href=["']([^"']+)["'][^>]+rel=["'](?:shortcut )?icon["']/i,
  );
  const candidate =
    apple?.[1] ?? apple2?.[1] ?? icon?.[1] ?? icon2?.[1] ?? null;
  if (candidate) {
    const abs = absolutizeUrl(candidate, pageUrl);
    if (abs) return abs;
  }
  const og = extractMeta(html, "og:image");
  if (og) {
    let sameHost = false;
    try {
      sameHost = og
        .toLowerCase()
        .includes(new URL(pageUrl).hostname.replace(/^www\./i, "").toLowerCase());
    } catch {
      sameHost = false;
    }
    if (/logo|icon|brand|mark/i.test(og) || sameHost) {
      const abs = absolutizeUrl(og, pageUrl);
      if (abs) return abs;
    }
  }
  try {
    const origin = new URL(pageUrl);
    if (origin.protocol === "http:" || origin.protocol === "https:") {
      return `${origin.origin}/favicon.ico`;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function formatPostalAddress(a: Record<string, unknown>): string | null {
  const street =
    typeof a.streetAddress === "string" ? a.streetAddress.trim() : "";
  const city =
    typeof a.addressLocality === "string" ? a.addressLocality.trim() : "";
  const region =
    typeof a.addressRegion === "string" ? a.addressRegion.trim() : "";
  const postal =
    typeof a.postalCode === "string" ? a.postalCode.trim() : "";
  const country =
    typeof a.addressCountry === "string"
      ? a.addressCountry.trim()
      : a.addressCountry &&
          typeof a.addressCountry === "object" &&
          typeof (a.addressCountry as { name?: unknown }).name === "string"
        ? String((a.addressCountry as { name: string }).name).trim()
        : "";
  if (!street) return null;
  const parts = [street, city, region, postal, country].filter(Boolean);
  const joined = parts.join(", ");
  return isPlausibleCompanyAddress(joined) ? joined : null;
}

/** Pull a street-like address from visible page text / footer. */
function extractAddressFromText(html: string): {
  address?: string;
  city?: string;
} {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .slice(0, 60_000);
  const patterns = [
    /(?:Address|Office|Visit us|Head\s*office|Registered\s*office)\s*[:\-]?\s*(\d[^|]{10,140}?)(?:\||$|\. [A-Z])/i,
    /(\d{1,5}\s+[A-Za-z][A-Za-z0-9\s.,'#\-]{4,60}(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|plot|floor|suite|sector|nagar|colony|phase|block)\b[A-Za-z0-9\s.,'#\-]{0,60})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m?.[1]) continue;
    const candidate = m[1].trim().replace(/\s+/g, " ");
    if (!isPlausibleCompanyAddress(candidate)) continue;
    const cityMatch = candidate.match(
      /,\s*([A-Za-z][A-Za-z\s]{2,30})(?:,|\s+\d{5,6}|$)/,
    );
    const city = cityMatch?.[1]?.trim();
    return {
      address: candidate,
      city:
        city && city.length >= 3 && !/^(gpt|ai|ml|it)$/i.test(city)
          ? city
          : undefined,
    };
  }
  return {};
}

function linkedInSlugMatchesCompany(
  linkedInUrl: string,
  companyName: string,
): boolean {
  return companyNameMatchesLinkedinUrl(companyName, linkedInUrl);
}

function extractJsonLdOrg(html: string): {
  name?: string;
  industry?: string;
  description?: string;
  products?: string;
  employees?: number;
  address?: string;
  city?: string;
} {
  const out: {
    name?: string;
    industry?: string;
    description?: string;
    products?: string;
    employees?: number;
    address?: string;
    city?: string;
  } = {};
  const scripts = [
    ...html.matchAll(
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ];
  for (const m of scripts) {
    try {
      const data = JSON.parse(m[1]!) as unknown;
      const nodes = Array.isArray(data) ? data : [data];
      for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        const n = node as Record<string, unknown>;
        const type = String(n["@type"] ?? "");
        if (!/Organization|Corporation|LocalBusiness/i.test(type)) continue;
        if (typeof n.name === "string") out.name = n.name;
        if (typeof n.industry === "string") out.industry = n.industry;
        if (typeof n.description === "string" && n.description.trim().length >= 40) {
          out.description = n.description.replace(/\s+/g, " ").trim().slice(0, 800);
        }
        const offers = n.makesOffer ?? n.hasOfferCatalog;
        const productNames = collectOfferNames(offers);
        if (productNames.length) out.products = productNames.slice(0, 16).join("; ");
        const emp = n.numberOfEmployees;
        if (typeof emp === "number") out.employees = emp;
        else if (emp && typeof emp === "object" && "value" in emp) {
          const v = Number((emp as { value: unknown }).value);
          if (!Number.isNaN(v)) out.employees = v;
        }
        const addr = n.address;
        if (addr && typeof addr === "object") {
          const a = addr as Record<string, unknown>;
          const formatted = formatPostalAddress(a);
          if (formatted) out.address = formatted;
          else if (typeof a.streetAddress === "string") {
            const street = a.streetAddress.trim();
            if (isPlausibleCompanyAddress(street)) out.address = street;
          }
          if (typeof a.addressLocality === "string") out.city = a.addressLocality;
        }
      }
    } catch {
      /* ignore bad json-ld */
    }
  }
  return out;
}

function collectOfferNames(node: unknown, acc: string[] = []): string[] {
  if (!node) return acc;
  if (Array.isArray(node)) {
    for (const child of node) collectOfferNames(child, acc);
    return acc;
  }
  if (typeof node !== "object") return acc;
  const rec = node as Record<string, unknown>;
  const item = rec.itemOffered ?? rec.item ?? rec;
  if (item && typeof item === "object") {
    const name = (item as Record<string, unknown>).name;
    if (typeof name === "string") {
      const cleaned = name.replace(/\s+/g, " ").trim();
      if (
        cleaned.length >= 2 &&
        cleaned.length <= 80 &&
        !/^(learn more|get started|contact|sign up)$/i.test(cleaned) &&
        !acc.includes(cleaned)
      ) {
        acc.push(cleaned);
      }
    }
  }
  if (rec.itemListElement) collectOfferNames(rec.itemListElement, acc);
  return acc;
}

function rankDomain(candidate: string, companyName: string | null): number {
  const d = candidate.toLowerCase().replace(/^www\./, "");
  let score = 10;
  const name = (companyName ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  const slug = d.split(".")[0] ?? "";
  if (
    name &&
    slug &&
    (name.includes(slug) ||
      slug.includes(name) ||
      (name.length >= 4 && slug.includes(name.slice(0, 6))))
  ) {
    score += 70;
  }
  if (/\.(com|io|co|ai|net|org)$/i.test(d)) score += 10;
  if (/linkedin\.com|facebook\.com|twitter\.com|crunchbase\.com/i.test(d)) {
    score -= 50;
  }
  return score;
}

async function searchDuckDuckGo(
  query: string,
): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const html = await safeFetchText(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
  );
  if (!html) return [];
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const blocks = [
    ...html.matchAll(
      /<div[^>]+class="[^"]*result[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]+class="[^"]*result[^"]*"|$)/gi,
    ),
  ];
  for (const block of blocks) {
    if (results.length >= 8) break;
    const chunk = block[1] ?? "";
    const a = chunk.match(
      /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!a) continue;
    let href = a[1]!;
    const title = a[2]!.replace(/<[^>]+>/g, "").trim();
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) {
      try {
        href = decodeURIComponent(uddg[1]!);
      } catch {
        /* keep */
      }
    }
    if (!/^https?:\/\//i.test(href)) continue;
    const snip =
      chunk
        .match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|td|div)/i)?.[1]
        ?.replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim() ?? "";
    results.push({ title, url: href, snippet: snip });
  }
  if (!results.length) {
    // Fallback simpler regex when block parsing misses.
    const re =
      /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && results.length < 8) {
      let href = m[1]!;
      const title = m[2]!.replace(/<[^>]+>/g, "").trim();
      const uddg = href.match(/[?&]uddg=([^&]+)/);
      if (uddg) {
        try {
          href = decodeURIComponent(uddg[1]!);
        } catch {
          /* keep */
        }
      }
      if (!/^https?:\/\//i.test(href)) continue;
      results.push({ title, url: href, snippet: "" });
    }
  }
  return results;
}

function field(
  value: string | number,
  confidence: number,
  sourceUrl?: string | null,
): EnrichmentFieldValue {
  return { value, confidence, sourceUrl: sourceUrl ?? null };
}

function normalizeHost(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]!;
}

export async function enrichLeadLocally(
  ctx: LeadEnrichmentContext,
): Promise<LeadEnrichmentPayload> {
  const companyName = ctx.companyName?.trim() || null;
  if (!companyName) {
    return {
      contactId: ctx.contactId,
      fields: {},
      status: "skipped",
      reason: "no_company_name",
    };
  }

  const fields: LeadEnrichmentPayload["fields"] = {};
  const mailDomain = emailDomain(ctx.email);
  const blanks = new Set(ctx.blanks);

  if (
    blanks.has("domain") &&
    mailDomain &&
    !isFreeMailDomain(mailDomain) &&
    companyNameMatchesDomain(companyName, mailDomain)
  ) {
    fields.domain = field(mailDomain, 88, `mailto:${ctx.email}`);
  }

  // 1) Wikidata / Wikipedia — reliable for LinkedIn + employees.
  if (
    blanks.has("employeeCount") ||
    blanks.has("linkedinUrl") ||
    blanks.has("domain") ||
    blanks.has("companyDescription") ||
    blanks.has("logoUrl") ||
    blanks.has("products") ||
    blanks.has("city")
  ) {
    const trustedExisting =
      ctx.companyDomain &&
      companyNameMatchesDomain(companyName, ctx.companyDomain)
        ? ctx.companyDomain
        : null;
    const wiki = await lookupWikidataFirmographics(
      companyName,
      trustedExisting,
    );
    const wikiEvidence = [wiki?.description, wiki?.sourceUrl]
      .filter(Boolean)
      .join(" ");
    const wikiOk =
      wiki &&
      (!wiki.domain ||
        companyIdentityAllowsDomain(companyName, wiki.domain, {
          evidenceText: wikiEvidence,
          sourceUrl: wiki.sourceUrl,
        })) &&
      (!wiki.linkedinUrl ||
        companyNameMatchesLinkedinUrl(companyName, wiki.linkedinUrl) ||
        companyIdentityAllowsDomain(companyName, wiki.linkedinUrl, {
          evidenceText: wikiEvidence,
          sourceUrl: wiki.sourceUrl,
        })) &&
      Boolean(wiki.domain || wiki.linkedinUrl || wiki.description);
    if (wiki && wikiOk) {
      if (blanks.has("linkedinUrl") && wiki.linkedinUrl) {
        fields.linkedinUrl = field(wiki.linkedinUrl, 90, wiki.sourceUrl);
      }
      if (blanks.has("employeeCount") && wiki.employeeCount) {
        fields.employeeCount = field(wiki.employeeCount, 85, wiki.sourceUrl);
      }
      if (blanks.has("domain") && !fields.domain && wiki.domain) {
        fields.domain = field(wiki.domain, 80, wiki.sourceUrl);
      }
      if (blanks.has("companyDescription") && wiki.description) {
        fields.companyDescription = field(wiki.description, 82, wiki.sourceUrl);
      }
      if (blanks.has("logoUrl") && wiki.logoUrl) {
        fields.logoUrl = field(wiki.logoUrl, 72, wiki.sourceUrl);
      }
      if (blanks.has("products") && wiki.products) {
        fields.products = field(wiki.products, 78, wiki.sourceUrl);
      }
      if (blanks.has("city") && wiki.city) {
        const city = normalizeCompanyCity(wiki.city);
        if (city) fields.city = field(city, 85, wiki.sourceUrl);
      }
    }
  }

  // 2) Company website (browser UA) for remaining blanks + LinkedIn footer links.
  let bestUrl: string | null = null;
  let bestScore = 0;
  if (
    ctx.companyDomain?.trim() &&
    companyNameMatchesDomain(companyName, ctx.companyDomain)
  ) {
    const host = normalizeHost(ctx.companyDomain);
    if (host) {
      bestUrl = `https://${host}`;
      bestScore = 90;
      if (blanks.has("domain") && !fields.domain) {
        fields.domain = field(host, 90, bestUrl);
      }
    }
  }

  const needSearch =
    !bestUrl ||
    (blanks.has("linkedinUrl") && !fields.linkedinUrl) ||
    (blanks.has("employeeCount") && !fields.employeeCount);

  if (needSearch && !bestUrl) {
    const hits = await searchDuckDuckGo(`${companyName} official website`);
    for (const hit of hits) {
      try {
        const host = new URL(hit.url).hostname.replace(/^www\./, "");
        const score = rankDomain(host, companyName);
        if (
          score > bestScore &&
          companyNameMatchesDomain(companyName, host)
        ) {
          bestScore = score;
          bestUrl = hit.url;
        }
      } catch {
        /* skip */
      }
    }
    if (!fields.domain && bestUrl && bestScore >= 70) {
      const host = new URL(bestUrl).hostname.replace(/^www\./, "");
      if (companyNameMatchesDomain(companyName, host)) {
        fields.domain = field(host, Math.min(85, bestScore), bestUrl);
      }
    }
  }

  // Dedicated LinkedIn / employees DDG searches when still blank.
  if (blanks.has("linkedinUrl") && !fields.linkedinUrl) {
    const liHits = await searchDuckDuckGo(
      `"${companyName}" site:linkedin.com/company`,
    );
    for (const hit of liHits) {
      const fromUrl = extractLinkedInCompanyUrl(hit.url);
      const hay = `${hit.title} ${hit.snippet} ${fromUrl ?? ""}`.toLowerCase();
      const tokens = companyName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .split(" ")
        .filter((t) => t.length >= 4);
      const titleOk =
        tokens.length === 0 || tokens.every((t) => hay.includes(t));
      if (
        fromUrl &&
        linkedInSlugMatchesCompany(fromUrl, companyName) &&
        titleOk
      ) {
        fields.linkedinUrl = field(fromUrl, 75, hit.url);
        break;
      }
    }
  }

  if (blanks.has("employeeCount") && !fields.employeeCount) {
    const empHits = await searchDuckDuckGo(`${companyName} number of employees`);
    for (const hit of empHits) {
      const n =
        extractEmployeeCountFromText(`${hit.title} ${hit.snippet}`) ??
        extractEmployeeCountFromText(hit.title);
      if (n) {
        fields.employeeCount = field(n, 60, hit.url);
        break;
      }
    }
  }

  const pageUrl =
    bestUrl ||
    (fields.domain ? `https://${String(fields.domain.value)}` : null);

  const needsPageFetch =
    Boolean(pageUrl) &&
    ((blanks.has("industry") && !fields.industry) ||
      (blanks.has("employeeCount") && !fields.employeeCount) ||
      (blanks.has("linkedinUrl") && !fields.linkedinUrl) ||
      (blanks.has("logoUrl") && !fields.logoUrl) ||
      (blanks.has("city") && !fields.city) ||
      (blanks.has("address") && !fields.address) ||
      (blanks.has("companyDescription") && !fields.companyDescription) ||
      (blanks.has("products") && !fields.products));

  if (needsPageFetch && pageUrl) {
    const html = await safeFetchText(pageUrl);
    if (html) {
      const ld = extractJsonLdOrg(html);
      const desc =
        extractMeta(html, "og:description") ||
        extractMeta(html, "description") ||
        "";

      if (blanks.has("industry") && !fields.industry && (ld.industry || desc)) {
        const industry = (ld.industry || guessIndustry(desc) || "").trim();
        if (industry) {
          fields.industry = field(
            industry.slice(0, 80),
            ld.industry ? 70 : 45,
            pageUrl,
          );
        }
      }
      if (
        blanks.has("companyDescription") &&
        !fields.companyDescription
      ) {
        const about = (ld.description || desc).replace(/\s+/g, " ").trim();
        if (about.length >= 40) {
          fields.companyDescription = field(about.slice(0, 800), 75, pageUrl);
        }
      }
      if (blanks.has("products") && !fields.products && ld.products) {
        fields.products = field(ld.products, 70, pageUrl);
      }
      if (
        blanks.has("employeeCount") &&
        !fields.employeeCount &&
        ld.employees &&
        ld.employees > 0
      ) {
        fields.employeeCount = field(ld.employees, 65, pageUrl);
      }
      if (blanks.has("employeeCount") && !fields.employeeCount) {
        const n = extractEmployeeCountFromText(html.slice(0, 80_000));
        if (n) fields.employeeCount = field(n, 50, pageUrl);
      }
      if (blanks.has("linkedinUrl") && !fields.linkedinUrl) {
        const li = extractLinkedInCompanyUrl(html);
        if (li && linkedInSlugMatchesCompany(li, companyName)) {
          fields.linkedinUrl = field(li, 80, pageUrl);
        }
      }
      if (blanks.has("logoUrl") && !fields.logoUrl) {
        const logo = extractLogoFromHtml(html, pageUrl);
        const pageHost = (() => {
          try {
            return new URL(pageUrl).hostname.replace(/^www\./i, "");
          } catch {
            return null;
          }
        })();
        if (
          logo &&
          logoUrlBelongsToCompany(companyName, logo, {
            sourceUrl: pageUrl,
            companyDomain: pageHost,
          })
        ) {
          fields.logoUrl = field(logo, 75, pageUrl);
        }
      }
      if (blanks.has("city") && ld.city) {
        const city = normalizeCompanyCity(ld.city);
        if (city) fields.city = field(city, 70, pageUrl);
      }
      if (blanks.has("address") && ld.address && isPlausibleCompanyAddress(ld.address)) {
        fields.address = field(ld.address, 65, pageUrl);
      }
      if (
        (blanks.has("address") && !fields.address) ||
        (blanks.has("city") && !fields.city)
      ) {
        const fromText = extractAddressFromText(html);
        if (blanks.has("address") && !fields.address && fromText.address) {
          fields.address = field(fromText.address, 55, pageUrl);
        }
        if (blanks.has("city") && !fields.city && fromText.city) {
          const city = normalizeCompanyCity(fromText.city);
          if (city) fields.city = field(city, 55, pageUrl);
        }
      }
    }
  }

  // Drop junk addresses before returning.
  if (fields.address && !isPlausibleCompanyAddress(String(fields.address.value))) {
    delete fields.address;
  }
  if (fields.city && !normalizeCompanyCity(String(fields.city.value))) {
    delete fields.city;
  }

  const filledKeys = Object.keys(fields);
  return {
    contactId: ctx.contactId,
    fields,
    status: filledKeys.length ? "enriched" : "skipped",
    reason: filledKeys.length ? null : "no_confident_fields",
  };
}

function guessIndustry(text: string): string | null {
  const t = text.toLowerCase();
  const map: Array<[RegExp, string]> = [
    [/software|saas|cloud|devops/, "Software"],
    [/financ|bank|fintech|insur/, "Financial Services"],
    [/health|pharma|biotech|clinic/, "Healthcare"],
    [/retail|e-?commerce|shop/, "Retail"],
    [/manufactur|industrial|automotiv|sports?\s*car|automaker/, "Automotive"],
    [/educat|university|school/, "Education"],
    [/real estate|property/, "Real Estate"],
    [/telecom|network/, "Telecommunications"],
    [/media|publish|news/, "Media"],
    [/consult/, "Consulting"],
  ];
  for (const [re, label] of map) {
    if (re.test(t)) return label;
  }
  return null;
}
