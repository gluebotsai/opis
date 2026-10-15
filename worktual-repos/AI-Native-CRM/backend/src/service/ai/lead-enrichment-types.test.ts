/**
 * Lightweight unit checks (run: npx tsx backend/src/service/ai/lead-enrichment-types.test.ts)
 */
import {
  emailDomain,
  isFreeMailDomain,
  FREE_MAIL_DOMAINS,
  acronymMatchesEntityText,
  companyIdentityAllowsDomain,
  companyNameMatchesDomain,
  companyNameMatchesLinkedinUrl,
  enrichmentFieldsBelongToCompany,
  isShortCompanyAcronym,
  logoUrlBelongsToCompany,
  displayCompanyLogoUrl,
  displayCompanyLocationLabel,
  isGenericLocationLabel,
  isPlausibleLogoUrl,
  isTrustedFirmographicSource,
  normalizeCompanyCity,
  trustedCompanyDomain,
  isSyntheticCompanyLogoUrl,
} from "./lead-enrichment-types";
import {
  extractEmployeeCountFromText,
  parseWikipediaInfoboxEmployees,
  parseWikipediaInfoboxHeadquarters,
  pickEmployeeCount,
} from "./lead-enrichment-wikidata";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(emailDomain("a@Acme.io") === "acme.io", "email domain");
assert(isFreeMailDomain("gmail.com"), "free mail");
assert(!isFreeMailDomain("acme.io"), "corp mail");
assert(FREE_MAIL_DOMAINS.has("outlook.com"), "outlook free");
assert(companyNameMatchesDomain("Zendesk", "zendesk.com"), "zendesk domain");
assert(!companyNameMatchesDomain("Zendesk", "zoho.com"), "block zoho on zendesk");
assert(isShortCompanyAcronym("CTS"), "CTS is an acronym");
assert(isShortCompanyAcronym("IBM"), "IBM is an acronym");
assert(!isShortCompanyAcronym("Zendesk"), "Zendesk is not an acronym");
assert(!isShortCompanyAcronym("Zepto"), "Zepto is a brand, not a ticker");
assert(!isShortCompanyAcronym("Hotstar"), "Hotstar is a brand, not a ticker");
assert(!isShortCompanyAcronym("Zoho"), "Zoho is a brand, not a ticker");
assert(companyNameMatchesDomain("CTS", "cts.com"), "exact acronym slug");
assert(companyNameMatchesDomain("IBM", "ibm.com"), "IBM domain");
assert(!companyNameMatchesDomain("CTS", "ctscorp.com"), "CTS is not ctscorp");
assert(companyNameMatchesDomain("Zepto", "zepto.com"), "zepto exact");
assert(companyNameMatchesDomain("Zepto", "zeptonow.com"), "zepto brand site");
assert(companyNameMatchesDomain("Hotstar", "hotstar.com"), "hotstar domain");
assert(
  companyNameMatchesDomain("Hotstar", "jiohotstar.com"),
  "hotstar in jiohotstar",
);
assert(
  !companyNameMatchesDomain("Hotstar", "disneyplus.com"),
  "disneyplus needs wiki evidence for Hotstar",
);
assert(
  companyIdentityAllowsDomain("Hotstar", "disneyplus.com", {
    evidenceText:
      "Disney+ Hotstar is an Indian subscription video on-demand streaming service owned by Disney India.",
    sourceUrl: "https://en.wikipedia.org/wiki/Disney%2B_Hotstar",
  }),
  "wiki Hotstar allows disneyplus.com",
);
assert(
  !companyIdentityAllowsDomain("Hotstar", "disneyplus.com", {
    evidenceText: "Some unrelated streaming notes.",
    sourceUrl: "https://en.wikipedia.org/wiki/Streaming_media",
  }),
  "unrelated wiki does not allow disneyplus for Hotstar",
);
assert(
  !companyNameMatchesDomain("CTS", "cognizant.com"),
  "CTS needs wiki evidence for cognizant.com",
);
assert(
  acronymMatchesEntityText(
    "CTS",
    "Cognizant Technology Solutions Corporation is an American domiciled Indian multinational information technology services company.",
  ),
  "CTS expands to Cognizant Technology Solutions",
);
assert(
  !acronymMatchesEntityText(
    "CTS",
    "The Cadillac CTS is a luxury car manufactured by General Motors.",
  ),
  "Cadillac CTS car is not a company expansion",
);
assert(
  !acronymMatchesEntityText(
    "CTS",
    "Cubic Corporation is an American multinational defense and public transportation equipment manufacturer. The company was founded in 1949 and was publicly traded from 1951 to 2021. It operates Cubic Transportation Systems (CTS).",
  ),
  "mid-article (CTS) segment is not the company",
);
assert(
  acronymMatchesEntityText(
    "CTS",
    "cognizant.com https://en.wikipedia.org/wiki/Cognizant Cognizant Technology Solutions Corporation is an American domiciled Indian multinational information technology services company.",
  ),
  "URL noise must not block Cognizant Technology Solutions initials",
);
assert(
  companyIdentityAllowsDomain("CTS", "cognizant.com", {
    evidenceText:
      "Cognizant Technology Solutions Corporation is an American domiciled Indian multinational information technology services company.",
    sourceUrl: "https://en.wikipedia.org/wiki/Cognizant",
  }),
  "wiki evidence allows cognizant.com for CTS",
);
assert(
  !companyIdentityAllowsDomain("CTS", "zoho.com", {
    evidenceText: "Zoho Corporation is an Indian software company.",
    sourceUrl: "https://en.wikipedia.org/wiki/Zoho_Corporation",
  }),
  "wiki Zoho does not expand to CTS",
);
assert(
  enrichmentFieldsBelongToCompany("CTS", {
    domain: {
      value: "cognizant.com",
      confidence: 80,
      sourceUrl: "https://en.wikipedia.org/wiki/Cognizant",
    },
    companyDescription: {
      value:
        "Cognizant Technology Solutions Corporation is an American domiciled Indian multinational information technology services company.",
      confidence: 82,
      sourceUrl: "https://en.wikipedia.org/wiki/Cognizant",
    },
  }),
  "CTS + cognizant wiki fields belong",
);
assert(
  !enrichmentFieldsBelongToCompany("CTS", {
    domain: { value: "zoho.com", confidence: 80 },
    employeeCount: { value: 17000, confidence: 85 },
  }),
  "gmail/zoho cache must not apply to CTS",
);
assert(
  enrichmentFieldsBelongToCompany("Zoho", {
    domain: { value: "zoho.com", confidence: 80 },
  }),
  "zoho cache belongs to zoho",
);
assert(
  !enrichmentFieldsBelongToCompany("CTS", {
    industry: { value: "Software", confidence: 45 },
  }),
  "cache without identity is not reusable",
);
assert(
  companyNameMatchesLinkedinUrl("Zendesk", "https://www.linkedin.com/company/zendesk"),
  "zendesk linkedin",
);
assert(
  !companyNameMatchesLinkedinUrl("Zendesk", "https://www.linkedin.com/company/zoho"),
  "block zoho linkedin on zendesk",
);

assert(
  !logoUrlBelongsToCompany(
    "Zendesk",
    "https://www.zoho.com/sites/default/files/zoho-logo.png",
  ),
  "zendesk must not keep zoho logo",
);
assert(
  !logoUrlBelongsToCompany(
    "Hexaware",
    "https://www.zohowebstatic.com/sites/zweb/images/commonlogo/zoho-logo.svg",
  ),
  "hexaware must not keep zoho logo",
);
assert(
  isSyntheticCompanyLogoUrl(
    "https://www.google.com/s2/favicons?domain=zendesk.com&sz=128",
  ),
  "google favicon is synthetic",
);
assert(
  !logoUrlBelongsToCompany(
    "Zendesk",
    "https://www.google.com/s2/favicons?domain=zoho.com&sz=128",
  ),
  "block google favicon for wrong domain",
);
assert(
  !logoUrlBelongsToCompany(
    "Zendesk",
    "https://www.google.com/s2/favicons?domain=zendesk.com&sz=128",
  ),
  "never persist synthetic google favicon",
);
assert(
  logoUrlBelongsToCompany(
    "Zendesk",
    "https://d1eipm3vz40hy0.cloudfront.net/images/logos/zendesk-logo.png",
  ),
  "keep zendesk logo on a CDN when the URL names zendesk",
);
assert(
  logoUrlBelongsToCompany(
    "Zendesk",
    "https://www.zendesk.com/apple-touch-icon.png",
  ),
  "keep logo fetched from zendesk.com",
);
assert(
  logoUrlBelongsToCompany(
    "Zoho",
    "https://www.zohowebstatic.com/sites/zweb/images/commonlogo/zoho-logo.svg",
  ),
  "zoho may use zohowebstatic cdn",
);
assert(
  logoUrlBelongsToCompany("Hexaware", "https://www.hexaware.com/favicon.ico"),
  "hexaware site favicon belongs",
);
assert(
  logoUrlBelongsToCompany("Zendesk", "https://www.zendesk.com/favicon.ico", {
    sourceUrl: "https://www.zendesk.com/",
  }),
  "zendesk same-origin favicon belongs",
);
assert(
  !logoUrlBelongsToCompany("Zendesk", "https://www.zoho.com/favicon.ico", {
    sourceUrl: "https://www.zendesk.com/",
  }),
  "zendesk page must not keep zoho favicon",
);
assert(
  !isPlausibleLogoUrl(
    "https://assets.nflxext.com/us/email/the Streaming Service_logo Netflix.png",
  ),
  "reject logo URLs with unencoded spaces",
);
assert(
  !logoUrlBelongsToCompany(
    "Netflix",
    "https://assets.nflxext.com/us/email/the Streaming Service_logo Netflix.png",
    { companyDomain: "netflix.com" },
  ),
  "broken Netflix CDN scrape must not belong",
);
assert(
  displayCompanyLogoUrl({
    name: "Netflix",
    domain: "netflix.com",
    logoUrl:
      "https://assets.nflxext.com/us/email/the Streaming Service_logo Netflix.png",
  }) === null,
  "API does not return broken Netflix logo",
);
assert(
  logoUrlBelongsToCompany(
    "Netflix",
    "https://commons.wikimedia.org/wiki/Special:FilePath/Netflix_2015_logo.svg",
  ),
  "Netflix Wikimedia logo belongs",
);
assert(
  logoUrlBelongsToCompany("HCL", "https://www.hcltech.com/favicon.ico", {
    companyDomain: "hcltech.com",
  }),
  "HCL favicon on known domain belongs",
);
assert(
  logoUrlBelongsToCompany(
    "HCL",
    "https://commons.wikimedia.org/wiki/Special:FilePath/HCLTech-new-logo.svg",
  ),
  "HCLTech commons logo belongs for acronym HCL",
);
assert(
  logoUrlBelongsToCompany(
    "Meta",
    "https://commons.wikimedia.org/wiki/Special:FilePath/Meta_Platforms_Inc._logo.svg",
    { companyDomain: "meta.com" },
  ),
  "Meta Platforms commons logo belongs",
);
assert(
  !logoUrlBelongsToCompany(
    "Meta",
    "https://commons.wikimedia.org/wiki/Special:FilePath/Zoho_logo.svg",
    { companyDomain: "meta.com" },
  ),
  "Meta must not keep unrelated commons logo",
);
assert(trustedCompanyDomain("Zendesk", "zoho.com") === null, "hide zoho domain on zendesk");
assert(
  trustedCompanyDomain("Hexaware", "hexaware.com") === "hexaware.com",
  "keep hexaware domain",
);
assert(
  trustedCompanyDomain("HCL", "hcltech.com") === "hcltech.com",
  "keep HCL→hcltech.com domain",
);
assert(
  trustedCompanyDomain("HCL", "zoho.com") === null,
  "HCL must not trust unrelated domain",
);
assert(
  displayCompanyLogoUrl({
    name: "Zendesk",
    domain: "zoho.com",
    logoUrl: "https://www.zoho.com/logo.png",
  }) === null,
  "no zoho mark on zendesk card",
);
assert(
  displayCompanyLogoUrl({
    name: "Hexaware",
    domain: "hexaware.com",
    logoUrl: "https://www.zoho.com/logo.png",
  }) === null,
  "hexaware card does not invent a favicon",
);
assert(
  displayCompanyLogoUrl({
    name: "Hexaware",
    domain: "hexaware.com",
    logoUrl: "https://www.hexaware.com/apple-touch-icon.png",
  }) === "https://www.hexaware.com/apple-touch-icon.png",
  "hexaware card shows fetched site logo",
);

assert(isGenericLocationLabel("Headquarters"), "hq label is generic");
assert(!isGenericLocationLabel("San Francisco, California"), "city is not generic");
assert(
  normalizeCompanyCity("Headquarters") === null,
  "never persist Headquarters as city",
);
assert(
  normalizeCompanyCity("181 Fremont") === null,
  "building/street is not a city",
);
assert(
  normalizeCompanyCity("[[San Francisco]], [[California]], U.S.") ===
    "San Francisco, California, U.S.",
  "wiki headquarters markup",
);
assert(
  displayCompanyLocationLabel({ name: "Headquarters", city: null }) === null,
  "do not display Headquarters",
);
assert(
  displayCompanyLocationLabel({
    name: "Headquarters",
    city: "Navi Mumbai, Maharashtra, India",
  }) === "Navi Mumbai, Maharashtra, India",
  "display HQ city",
);
assert(
  isTrustedFirmographicSource("https://en.wikipedia.org/wiki/Zendesk"),
  "wikipedia is trusted",
);
assert(
  isTrustedFirmographicSource("https://www.wikidata.org/wiki/Q15401349"),
  "wikidata is trusted",
);
assert(
  isTrustedFirmographicSource("https://www.zendesk.com/about", "zendesk.com"),
  "own site is trusted",
);
assert(
  !isTrustedFirmographicSource("https://www.google.com/search?q=zendesk"),
  "google search is not trusted",
);

const wikiHq = `
{{Infobox company
| name = Hexaware Technologies
| hq_location_city = [[Navi Mumbai]]
| hq_location_country = [[India]]
| num_employees = 31,605 (2024)
}}
`;
assert(
  parseWikipediaInfoboxHeadquarters(wikiHq) === "Navi Mumbai, India",
  "hexaware hq infobox",
);
assert(
  parseWikipediaInfoboxEmployees(wikiHq).count === 31605,
  "hexaware employee infobox",
);
assert(
  parseWikipediaInfoboxEmployees(wikiHq).year === 2024,
  "hexaware employee year",
);

const zendeskHq = `
{{Infobox company
| name = Zendesk
| headquarters = [[San Francisco]], [[California]], U.S.
| num_employees = {{increase}} 6,640 (2022)
}}
`;
assert(
  parseWikipediaInfoboxHeadquarters(zendeskHq) ===
    "San Francisco, California, U.S.",
  "zendesk hq infobox",
);
assert(
  parseWikipediaInfoboxEmployees(zendeskHq).count === 6640,
  "zendesk employee infobox prefers dated figure not increase template",
);
assert(
  pickEmployeeCount(
    { count: 17000, year: 2019 },
    { count: 6640, year: 2022 },
  ).count === 6640,
  "prefer newer wikipedia headcount over old wikidata",
);
assert(
  pickEmployeeCount(
    { count: 17000, year: null },
    { count: 31605, year: 2024 },
  ).count === 31605,
  "dated wikipedia beats undated wikidata",
);
assert(
  pickEmployeeCount(
    { count: 3830, year: 2020 },
    { count: 5860, year: null },
  ).count === 5860,
  "wikipedia infobox beats older dated wikidata",
);
assert(
  extractEmployeeCountFromText(
    "Hexaware Key Facts 1.5B Annual Revenue (USD) 33K+ Global Employees 68 Offices",
  ) === 33000,
  "own-site 33K+ global employees",
);
assert(
  extractEmployeeCountFromText("33+ Years of Excellence") == null,
  "years of excellence is not headcount",
);
assert(
  extractEmployeeCountFromText("Copyright 2026 employees") == null,
  "calendar year is not headcount",
);

console.log("lead-enrichment-types.test.ts: ok");
