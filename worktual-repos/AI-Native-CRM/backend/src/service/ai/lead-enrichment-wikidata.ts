/**
 * Firmographic lookup via Wikidata + Wikipedia (no LLM).
 * Used for employee count + LinkedIn company URL when site scrapes fail/WAF-block.
 */

import {
  companyIdentityAllowsDomain,
  companyNameMatchesDomain,
  companyNameMatchesLinkedinUrl,
  isShortCompanyAcronym,
  normalizeCompanyCity,
} from "@/service/ai/lead-enrichment-types";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const FETCH_MS = 6_000;

const BAD_LOGO_IMAGE_RE =
  /(campus|headquarters?|\bhq\b|building|aerial|skyline|office.?park|\bsez\b|factory|plant\b)/i;

function isLikelyBrandLogoImageUrl(url: string | null | undefined): boolean {
  const raw = (url ?? "").trim();
  if (!raw.startsWith("http")) return false;
  return !BAD_LOGO_IMAGE_RE.test(raw);
}

function pickBestLogoFilename(
  filenames: string[],
  companyName: string | null | undefined,
): string | null {
  const name = (companyName ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const meaningful = name
    .split(" ")
    .filter(
      (t) =>
        t.length >= 4 &&
        ![
          "services",
          "solutions",
          "technologies",
          "technology",
          "systems",
          "group",
          "company",
        ].includes(t),
    );
  const ac = isShortCompanyAcronym(companyName)
    ? (companyName ?? "").replace(/[^a-z]/gi, "").toLowerCase()
    : "";
  let best: string | null = null;
  let bestScore = -10_000;
  for (const raw of filenames) {
    const file = (raw ?? "").trim();
    if (!file || BAD_LOGO_IMAGE_RE.test(file)) continue;
    const fl = file.toLowerCase().replace(/ /g, "_");
    let score = 0;
    if (fl.includes("logo")) score += 50;
    if (fl.endsWith(".svg")) score += 20;
    if (meaningful.some((t) => fl.includes(t))) score += 40;
    const compact = fl.replace(/[_.\-]/g, "");
    if (ac && compact.includes(ac)) score += 35;
    if (
      meaningful.length &&
      !meaningful.some((t) => fl.includes(t)) &&
      /facebook|instagram|whatsapp|oculus/.test(fl) &&
      !/meta/.test(fl)
    ) {
      score -= 30;
    }
    if (score > bestScore) {
      bestScore = score;
      best = file;
    }
  }
  return best;
}

export type WikidataFirmographics = {
  employeeCount?: number;
  linkedinUrl?: string;
  domain?: string;
  industryHint?: string;
  description?: string;
  logoUrl?: string;
  products?: string;
  city?: string;
  sourceUrl: string;
};

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_MS);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "application/json",
      },
      redirect: "follow",
    });
    clearTimeout(t);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function normalizeHost(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]!;
}

function parseEmployeeNumber(raw: string): number | null {
  const cleaned = raw.replace(/\{\{[^}]+\}\}/g, " ").replace(/<[^>]+>/g, " ");
  const plus = cleaned.match(/([\d]{1,3}(?:,\d{3})+|\d+)\s*\+/);
  if (plus) {
    const n = Number(plus[1]!.replace(/,/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const plain = cleaned.match(/([\d]{1,3}(?:,\d{3})+|\d{2,})/);
  if (!plain) return null;
  const n = Number(plain[1]!.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 && n < 50_000_000 ? n : null;
}

function linkedinFromId(id: string): string {
  const slug = id.trim().replace(/^\/+|\/+$/g, "");
  return `https://www.linkedin.com/company/${slug}`;
}

type SearchHit = {
  id: string;
  label?: string;
  description?: string;
};

type WikidataClaim = {
  mainsnak?: {
    datavalue?: {
      value?: unknown;
    };
  };
  qualifiers?: Record<
    string,
    Array<{
      datavalue?: {
        value?: { time?: string } | unknown;
      };
    }>
  >;
};

type Claims = Record<string, WikidataClaim[]>;

function claimStrings(claims: Claims, prop: string): string[] {
  const out: string[] = [];
  for (const c of claims[prop] ?? []) {
    const v = c.mainsnak?.datavalue?.value;
    if (typeof v === "string") out.push(v);
    else if (v && typeof v === "object" && "amount" in (v as object)) {
      const amount = String((v as { amount: string }).amount).replace(/^\+/, "");
      out.push(amount);
    }
  }
  return out;
}

function claimEntityIds(claims: Claims, prop: string): string[] {
  const out: string[] = [];
  for (const c of claims[prop] ?? []) {
    const v = c.mainsnak?.datavalue?.value;
    if (v && typeof v === "object" && "id" in (v as object)) {
      out.push(String((v as { id: string }).id));
    } else if (typeof v === "string" && /^Q\d+$/.test(v)) {
      out.push(v);
    }
  }
  return out;
}

function claimTimeYear(claim: WikidataClaim): number | null {
  for (const q of claim.qualifiers?.P585 ?? []) {
    const time =
      q.datavalue?.value && typeof q.datavalue.value === "object"
        ? (q.datavalue.value as { time?: string }).time
        : null;
    const m = String(time ?? "").match(/\+(\d{4})/);
    if (!m) continue;
    const year = Number(m[1]);
    if (year >= 1800 && year <= 2100) return year;
  }
  return null;
}

function claimAmount(claim: WikidataClaim): string | null {
  const v = claim.mainsnak?.datavalue?.value;
  if (v && typeof v === "object" && "amount" in (v as object)) {
    return String((v as { amount: string }).amount).replace(/^\+/, "");
  }
  if (typeof v === "string") return v;
  return null;
}

export function latestEmployeeClaim(
  claims: Claims,
): { count: number | null; year: number | null } {
  let bestN: number | null = null;
  let bestYear: number | null = null;
  let bestRank = -1;
  (claims.P1128 ?? []).forEach((claim, i) => {
    const n = parseEmployeeNumber(claimAmount(claim) ?? "");
    if (!n) return;
    const year = claimTimeYear(claim);
    const rank = (year ? 10_000 : 0) + (year ?? 0) * 10 + i;
    if (rank >= bestRank) {
      bestRank = rank;
      bestN = n;
      bestYear = year;
    }
  });
  return { count: bestN, year: bestYear };
}

export function parseWikipediaInfoboxEmployees(
  content: string | null | undefined,
): { count: number | null; year: number | null } {
  if (!content) return { count: null, year: null };
  const m =
    content.match(/num[_ ]?employees\s*=\s*([^\n|]+)/i) ||
    content.match(/\|\s*employees\s*=\s*([^\n|]+)/i);
  if (!m?.[1]) return { count: null, year: null };
  const raw = m[1];
  const count = parseEmployeeNumber(raw);
  const ym =
    raw.match(/\{\{\s*as of\s*\|\s*((?:19|20)\d{2})/i) ||
    raw.match(/(?:as of|fy|year)?\s*\(?((?:19|20)\d{2})/i);
  const year = ym ? Number(ym[1]) : null;
  return { count, year: Number.isFinite(year) ? year : null };
}

export function pickEmployeeCount(
  wd: { count: number | null; year: number | null },
  wiki: { count: number | null; year: number | null },
): { count: number | null; source: "wikipedia" | "wikidata" | "" } {
  if (wiki.count && wd.count) {
    if (wiki.year && wd.year && wd.year > wiki.year) {
      return { count: wd.count, source: "wikidata" };
    }
    return { count: wiki.count, source: "wikipedia" };
  }
  if (wiki.count) return { count: wiki.count, source: "wikipedia" };
  if (wd.count) return { count: wd.count, source: "wikidata" };
  return { count: null, source: "" };
}

export function parseWikipediaInfoboxHeadquarters(
  content: string | null | undefined,
): string | null {
  if (!content) return null;
  let city: string | null = null;
  for (const key of [
    "hq_location_city",
    "headquarters",
    "hq_location",
    "hq",
    "location_city",
  ]) {
    const re = new RegExp(
      `\\|\\s*${key}\\s*=\\s*([\\s\\S]+?)(?:\\n\\s*\\||\\n\\}\\})`,
      "i",
    );
    const m = content.match(re);
    if (!m?.[1]) continue;
    const normalized = normalizeCompanyCity(m[1]);
    if (!normalized) continue;
    if (key === "hq_location_city") {
      city = normalized;
      break;
    }
    return normalized;
  }
  const countryM = content.match(
    /\|\s*hq_location_country\s*=\s*([\s\S]+?)(?:\n\s*\||\n\}\})/i,
  );
  const country = countryM?.[1] ? normalizeCompanyCity(countryM[1]) : null;
  if (city && country && !city.toLowerCase().includes(country.toLowerCase())) {
    return `${city}, ${country}`;
  }
  return city;
}

function scoreCandidate(
  hit: SearchHit,
  companyName: string,
  companyDomain: string | null,
  officialSites: string[],
): number {
  let score = 0;
  const label = (hit.label ?? "").toLowerCase();
  const desc = (hit.description ?? "").toLowerCase();
  const name = companyName.toLowerCase().trim();
  if (label === name) score += 50;
  else if (label.includes(name) || name.includes(label)) score += 25;
  if (
    /compan|manufacturer|corporation|enterprise|business|brand|firm|organization|automaker|software|bank/.test(
      desc,
    )
  ) {
    score += 30;
  }
  if (/family name|given name|surname|disambiguation|human|footballer/.test(desc)) {
    score -= 80;
  }
  if (
    companyDomain &&
    companyNameMatchesDomain(companyName, companyDomain)
  ) {
    const want = normalizeHost(companyDomain);
    for (const site of officialSites) {
      try {
        if (normalizeHost(site) === want) score += 60;
      } catch {
        /* ignore */
      }
    }
  }
  return score;
}

function parseWikipediaInfoboxProducts(content: string): string | null {
  const re =
    /\|\s*(?:products?|services?|offerings?)\s*=[ \t]*(.*?)(?:\n\s*\|\s*[A-Za-z_]|\n\}\})/gi;
  const found: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    let raw = (m[1] || "").trim();
    if (!raw || raw.startsWith("|")) continue;
    raw = raw
      .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, " ")
      .replace(/\{\{[^}]+\}\}/g, " ")
      .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, "$2")
      .replace(/\[\[([^\]]+)\]\]/g, "$1")
      .replace(/<br\s*\/?>/gi, ";")
      .replace(/<[^>]+>/g, " ");
    const parts = raw
      .split(/[,;•·\n]/)
      .map((p) => p.replace(/\s+/g, " ").trim())
      .filter(
        (p) =>
          p.length >= 2 &&
          p.length <= 80 &&
          !/^https?:\/\//i.test(p) &&
          !/^\|/.test(p) &&
          !/^[a-z_]+\s*=/i.test(p),
      )
      .slice(0, 16);
    if (parts.length) found.push(...parts);
  }
  return found.length ? [...new Set(found)].join("; ") : null;
}

async function wikipediaWikitext(title: string): Promise<string> {
  const url =
    `https://en.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=content&rvslots=main` +
    `&titles=${encodeURIComponent(title)}&format=json&formatversion=2`;
  const data = await fetchJson<{
    query?: {
      pages?: Array<{
        revisions?: Array<{ slots?: { main?: { content?: string } } }>;
      }>;
    };
  }>(url);
  return data?.query?.pages?.[0]?.revisions?.[0]?.slots?.main?.content ?? "";
}


/**
 * Resolve firmographics for a company name (+ optional domain) via Wikidata/Wikipedia.
 */
export async function lookupWikidataFirmographics(
  companyName: string,
  companyDomain?: string | null,
): Promise<WikidataFirmographics | null> {
  const name = companyName.trim();
  if (!name) return null;

  const search = await fetchJson<{ search?: SearchHit[] }>(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&format=json&limit=5&type=item`,
  );
  const hits = search?.search ?? [];
  if (!hits.length) return null;

  const ids = hits.map((h) => h.id).join("|");
  const entities = await fetchJson<{
    entities?: Record<
      string,
      {
        labels?: { en?: { value?: string } };
        descriptions?: { en?: { value?: string } };
        claims?: Claims;
        sitelinks?: { enwiki?: { title?: string } };
      }
    >;
  }>(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids}&props=labels|descriptions|claims|sitelinks&languages=en&format=json`,
  );
  if (!entities?.entities) return null;

  let bestId: string | null = null;
  let bestScore = 0;
  let bestClaims: Claims | null = null;
  let bestWikiTitle: string | null = null;
  let bestDescription = "";

  for (const hit of hits) {
    const ent = entities.entities[hit.id];
    if (!ent) continue;
    const claims = ent.claims ?? {};
    const sites = claimStrings(claims, "P856");
    const wikiDesc = ent.descriptions?.en?.value ?? hit.description ?? "";
    const score = scoreCandidate(
      {
        id: hit.id,
        label: ent.labels?.en?.value ?? hit.label,
        description: wikiDesc,
      },
      name,
      companyDomain ?? null,
      sites,
    );
    if (score > bestScore) {
      bestScore = score;
      bestId = hit.id;
      bestClaims = claims;
      bestWikiTitle = ent.sitelinks?.enwiki?.title ?? null;
      bestDescription = wikiDesc.trim();
    }
  }

  if (!bestId || !bestClaims || bestScore < 40) return null;

  const out: WikidataFirmographics = {
    sourceUrl: `https://www.wikidata.org/wiki/${bestId}`,
  };

  const linkedinIds = claimStrings(bestClaims, "P4264");
  if (linkedinIds[0]) {
    out.linkedinUrl = linkedinFromId(linkedinIds[0]);
  }

  const wdEmp = latestEmployeeClaim(bestClaims);

  const sites = claimStrings(bestClaims, "P856");
  if (sites[0]) {
    try {
      out.domain = normalizeHost(sites[0]);
    } catch {
      /* ignore */
    }
  }

  const logos = claimStrings(bestClaims, "P154").concat(
    claimStrings(bestClaims, "P18"),
  );
  const bestLogo = pickBestLogoFilename(logos, name);
  if (bestLogo) {
    out.logoUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(bestLogo.trim().replace(/ /g, "_"))}`;
  }

  const hqIds = claimEntityIds(bestClaims, "P159");
  let wikiText = "";
  let wikiEmp: { count: number | null; year: number | null } = {
    count: null,
    year: null,
  };
  if (bestWikiTitle) {
    wikiText = await wikipediaWikitext(bestWikiTitle);
    wikiEmp = parseWikipediaInfoboxEmployees(wikiText);
    const products = wikiText ? parseWikipediaInfoboxProducts(wikiText) : null;
    if (products) out.products = products;
    const infoboxCity = parseWikipediaInfoboxHeadquarters(wikiText);
    if (infoboxCity) out.city = infoboxCity;
  }
  const picked = pickEmployeeCount(wdEmp, wikiEmp);
  if (picked.count) {
    out.employeeCount = picked.count;
    if (picked.source === "wikipedia" && bestWikiTitle) {
      out.sourceUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(bestWikiTitle.replace(/ /g, "_"))}`;
    }
  }
  if (!out.city && hqIds.length) {
    const hqEnts = await fetchJson<{
      entities?: Record<
        string,
        { labels?: { en?: { value?: string } } }
      >;
    }>(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(hqIds.slice(0, 3).join("|"))}&props=labels&languages=en&format=json`,
    );
    for (const qid of hqIds.slice(0, 3)) {
      const label = hqEnts?.entities?.[qid]?.labels?.en?.value;
      const city = normalizeCompanyCity(label);
      if (city) {
        out.city = city;
        break;
      }
    }
  }

  if (!out.employeeCount && !out.linkedinUrl && !out.domain) return null;
  const wikiEvidence = [bestWikiTitle, bestDescription, out.sourceUrl]
    .filter(Boolean)
    .join(" ");
  if (
    out.domain &&
    !companyIdentityAllowsDomain(name, out.domain, {
      evidenceText: wikiEvidence,
      sourceUrl: out.sourceUrl,
    })
  ) {
    return null;
  }
  if (
    out.linkedinUrl &&
    !companyNameMatchesLinkedinUrl(name, out.linkedinUrl) &&
    !companyIdentityAllowsDomain(name, out.linkedinUrl, {
      evidenceText: wikiEvidence,
      sourceUrl: out.sourceUrl,
    })
  ) {
    return null;
  }
  if (!out.domain && !out.linkedinUrl) return null;
  if (bestWikiTitle) {
    const summary = await wikipediaSummaryBundle(bestWikiTitle);
    if (summary.description) out.description = summary.description;
    else if (bestDescription.length >= 20) out.description = bestDescription.slice(0, 800);
    if (summary.logoUrl) out.logoUrl = out.logoUrl ?? summary.logoUrl;
  } else if (bestDescription.length >= 20) {
    out.description = bestDescription.slice(0, 800);
  }
  return out;
}

async function wikipediaSummaryBundle(title: string): Promise<{
  description?: string;
  logoUrl?: string;
}> {
  const data = await fetchJson<{
    extract?: string;
    originalimage?: { source?: string };
    thumbnail?: { source?: string };
  }>(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`,
  );
  const out: { description?: string; logoUrl?: string } = {};
  const extract = data?.extract?.replace(/\s+/g, " ").trim() ?? "";
  if (extract.length >= 40 && extract.length <= 1200) {
    out.description = extract.slice(0, 800);
  }
  const src = data?.originalimage?.source || data?.thumbnail?.source;
  if (src?.startsWith("http") && isLikelyBrandLogoImageUrl(src)) out.logoUrl = src;
  return out;
}

export function extractLinkedInCompanyUrl(html: string): string | null {
  const re =
    /https?:\/\/(?:www\.)?linkedin\.com\/company\/[a-zA-Z0-9_-]+\/?/gi;
  const m = html.match(re);
  if (!m?.[0]) return null;
  return m[0].replace(/\/$/, "").split("?")[0]!;
}

function parseHeadcountToken(raw: string): number | null {
  const hadComma = raw.includes(",");
  const s = raw.trim().toLowerCase().replace(/[\s,]/g, "").replace(/\+$/, "");
  const m = s.match(/^(\d+(?:\.\d+)?)([km])?$/);
  if (!m) return null;
  let n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  if (m[2] === "k") n *= 1_000;
  else if (m[2] === "m") n *= 1_000_000;
  const count = Math.round(n);
  if (!m[2] && !hadComma && count >= 1990 && count <= 2035) return null;
  return count >= 10 && count <= 20_000_000 ? count : null;
}

export function extractEmployeeCountFromText(text: string): number | null {
  const blob = text.replace(/\s+/g, " ");
  const patterns = [
    /((?:\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*[kKmM]?)\s*\+?\s*(?:global\s+)?(?:employees?|workforce|associates|professionals|team members|headcount)/gi,
    /(?:employees?|workforce|associates|professionals|headcount)\s*(?:of|:)?\s*((?:\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*[kKmM]?)\s*\+?/gi,
  ];
  let best: number | null = null;
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(blob))) {
      const n = parseHeadcountToken(m[1]!);
      if (!n) continue;
      best = best == null ? n : Math.max(best, n);
    }
  }
  return best;
}

export { BROWSER_UA, parseEmployeeNumber };
