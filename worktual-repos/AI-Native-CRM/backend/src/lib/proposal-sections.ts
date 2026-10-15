/**
 * Tenant-agnostic proposal section model (standard template + customer docs).
 * Merge tokens: {{customerName}} {{companyName}} {{dealTitle}} {{date}} {{vendorName}}
 */

import {
  normalizeSectionKeyHint,
  PROPOSAL_SECTION_ALIASES,
  resolveDocumentSection,
  type DocumentSectionLike,
} from "./document-section-resolve";

export type ProposalSection = DocumentSectionLike;

export {
  normalizeSectionKeyHint,
  PROPOSAL_SECTION_ALIASES,
  QUOTE_SECTION_ALIASES,
  DOCUMENT_SECTION_ALIASES,
  resolveDocumentSection,
} from "./document-section-resolve";

/** @deprecated use resolveDocumentSection */
export function resolveProposalSection(
  sections: ProposalSection[],
  sectionKey: string,
): ProposalSection | null {
  return resolveDocumentSection(sections, sectionKey, PROPOSAL_SECTION_ALIASES);
}

export type ProposalMergeContext = {
  customerName: string;
  companyName: string;
  dealTitle: string;
  date: string;
  vendorName: string;
};

export function defaultStandardProposalSections(): ProposalSection[] {
  return [
    {
      id: "sec-intro",
      key: "introduction",
      title: "1. Introduction",
      body: `We are pleased to submit this proposal for the consideration of {{customerName}} (referred to as the customer in this document).

We understand the business objectives and requirements of the customer and believe our solutions would meet these needs and add significant value for {{companyName}}.

This proposal relates to the opportunity: {{dealTitle}}.`,
      sortOrder: 1,
    },
    {
      id: "sec-features",
      key: "features",
      title: "2. Key Product Features",
      body: `Edit this section to describe the products and capabilities relevant to this customer.

• Core platform capabilities
• Omnichannel engagement (as applicable)
• Automation and AI assistance (as applicable)
• Reporting and analytics
• Integrations

Replace with your catalog feature lists. Links to public pricing or capability pages may be added here.`,
      sortOrder: 2,
    },
    {
      id: "sec-scope",
      key: "scope",
      title: "3. Scope of Work",
      body: `Following discussions with {{customerName}}, this proposal covers the scope below. Adjust items to match what was agreed.

Capabilities in scope
• [Capability 1]
• [Capability 2]
• [Capability 3]

Implementation
• Account configuration
• Solution build / training (as applicable)
• Agreed integrations

Items not listed above are out of scope and may be quoted separately if required.

A detailed list of use cases will be finalized during onboarding with the {{customerName}} team.`,
      sortOrder: 3,
    },
    {
      id: "sec-plan",
      key: "plan_of_action",
      title: "3.1 Plan of Action",
      body: `| Activity | Responsibility | Target |
| --- | --- | --- |
| Kick-off | {{vendorName}} / {{customerName}} | Week 1 |
| Account set-up & inputs | Shared | Week 1–2 |
| Configuration / build | {{vendorName}} | Week 2–3 |
| UAT | {{customerName}} | Week 3–4 |
| Go-live | Shared | Week 4 |`,
      sortOrder: 4,
    },
    {
      id: "sec-commercials",
      key: "commercials",
      title: "4. Commercials",
      body: `a. Pricing
Summarize commercial terms here, or link to a CRM quote for line-level pricing.

• Subscription / license fees — [describe]
• Usage / sessions / seats — [describe]
• One-time setup fee — [describe]

b. Terms and conditions
1. Pricing & taxes — Prices are exclusive of applicable taxes unless stated otherwise. Validity: [e.g. 7–30 days] from submission ({{date}}).
2. Scope — Prices apply to the agreed scope only. Changes may attract additional charges.
3. Setup & payment milestones — [e.g. 50% on PO, 50% on UAT].
4. Subscription fees — [billing cadence and due dates].
5. Defaults — Late payment may result in service suspension.

Replace this text with your standard commercial terms or paste totals from the related quote.`,
      sortOrder: 5,
    },
    {
      id: "sec-onboarding",
      key: "onboarding",
      title: "5. Onboarding Process",
      body: `Typical onboarding activities (edit responsibilities for {{customerName}} vs {{vendorName}}):

1. Account creation — {{vendorName}}
2. Knowledge base / content inputs — {{customerName}} / {{vendorName}}
3. Configuration and training — {{vendorName}}
4. Channel / integration setup — shared
5. UAT — {{customerName}}
6. Go-live — shared

Timelines are subject to timely inputs from {{customerName}}.`,
      sortOrder: 6,
    },
    {
      id: "sec-implementation",
      key: "implementation",
      title: "6. Implementation Plan",
      body: `A detailed implementation plan with timelines will be shared during the kick-off call with {{customerName}}.

Sample milestones (replace with agreed dates):
1. Kick-off
2. Account set-up & inputs
3. Build / configuration
4. UAT
5. Go-live`,
      sortOrder: 7,
    },
    {
      id: "sec-support",
      key: "support",
      title: "7. Support",
      body: `{{vendorName}} will provide technical support as defined in the subscription agreement. A dedicated account contact may be assigned for the tenure of the subscription.`,
      sortOrder: 8,
    },
    {
      id: "sec-conclusion",
      key: "conclusion",
      title: "8. Conclusion",
      body: `{{vendorName}} is committed to providing {{customerName}} with a robust solution aligned to {{dealTitle}}. We look forward to partnering with you.`,
      sortOrder: 9,
    },
  ];
}

export function applyProposalMerge(
  sections: ProposalSection[],
  ctx: ProposalMergeContext,
): ProposalSection[] {
  const replace = (text: string) =>
    text
      .replaceAll("{{customerName}}", ctx.customerName)
      .replaceAll("{{companyName}}", ctx.companyName)
      .replaceAll("{{dealTitle}}", ctx.dealTitle)
      .replaceAll("{{date}}", ctx.date)
      .replaceAll("{{vendorName}}", ctx.vendorName);

  return sections.map((s) => ({
    ...s,
    title: replace(s.title),
    body: replace(s.body),
  }));
}

/**
 * Older drafts baked the contact person into section text via {{customerName}}.
 * At render time, swap that person for the deal company so covers say
 * "Submitted to Hexaware" / "Proposal for Hexaware", not "santhosh s".
 */
export function rewriteContactAsCompanyRecipient(
  sections: ProposalSection[],
  input: {
    contactName?: string | null;
    companyName?: string | null;
  },
): ProposalSection[] {
  const contact = (input.contactName || "").trim();
  const company = (input.companyName || "").trim();
  if (!contact || !company) return sections;
  if (contact.toLowerCase() === company.toLowerCase()) return sections;

  const escapeRe = (s: string) =>
    s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const contactRe = new RegExp(escapeRe(contact), "gi");

  // "Proposal for Santh" style truncations from short titles
  const firstToken = contact.split(/\s+/).filter(Boolean)[0] || "";
  const shortRe =
    firstToken.length >= 4
      ? new RegExp(
          `\\bProposal\\s+for\\s+${escapeRe(firstToken)}\\b`,
          "gi",
        )
      : null;

  return sections.map((s) => {
    let title = s.title.replace(contactRe, company);
    let body = s.body.replace(contactRe, company);
    if (shortRe) {
      title = title.replace(shortRe, `Proposal for ${company}`);
      body = body.replace(shortRe, `Proposal for ${company}`);
    }
    // Deal-title leak on cover: "Opportunity — <person>"
    title = title.replace(
      /^Opportunity\s*[—:-]\s*.+$/i,
      company,
    );
    body = body.replace(
      /Opportunity\s*[—:-]\s*[^\n]+/gi,
      company,
    );
    return { ...s, title, body };
  });
}

/**
 * AI personalization sometimes uses the seller org *contact* (e.g. Yaswanth)
 * as if it were the vendor company. Swap that person for the real vendor name.
 */
export function rewriteSellerContactAsVendor(
  sections: ProposalSection[],
  input: {
    sellerContactName?: string | null;
    vendorName?: string | null;
  },
): ProposalSection[] {
  const person = (input.sellerContactName || "").trim();
  const vendor = (input.vendorName || "").trim();
  if (!person || !vendor) return sections;
  if (person.toLowerCase() === vendor.toLowerCase()) return sections;
  if (person.length < 3) return sections;

  const escapeRe = (s: string) =>
    s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Whole-word, case-insensitive — avoids eating substrings inside other names.
  const personRe = new RegExp(`\\b${escapeRe(person)}\\b`, "gi");

  return sections.map((s) => ({
    ...s,
    title: s.title.replace(personRe, vendor),
    body: s.body.replace(personRe, vendor),
  }));
}

/** Title-case a company label for cover lines (keeps all-caps brands as-is). */
export function formatCompanyDisplayName(name: string | null | undefined): string {
  const raw = (name || "").trim();
  if (!raw) return "";
  if (raw === raw.toUpperCase() && /[A-Z]/.test(raw)) return raw;
  return raw.replace(/\w\S*/g, (w) => {
    if (w.length <= 2 && w === w.toUpperCase()) return w;
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  });
}

/** Decode escaped newlines / soft-strip markdown for stored proposal bodies. */
export function normalizeProposalSectionText(raw: string): string {
  let s = raw ?? "";
  for (let i = 0; i < 4; i++) {
    if (!/\\[nrt]/.test(s)) break;
    s = s
      .replace(/\\r\\n/g, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\r/g, "\n");
  }
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/__([^_]+)__/g, "$1");
  s = s.replace(/`([^`]+)`/g, "$1");
  s = s.replace(/^#{1,6}\s+/gm, "");
  s = s.replace(/\*\*/g, "").replace(/__/g, "");
  return stripEmbeddedMarkdownImagery(s).trim();
}

/**
 * Letterhead logo/hero belong in the HTML blueprint + assets — not as raw
 * markdown in section bodies (which renders as visible `![Logo](...)` text).
 */
export function stripEmbeddedMarkdownImagery(raw: string): string {
  const lines = (raw ?? "").split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (
      /^!\[[^\]]*\]\((asset:[a-z0-9_-]+|data:image\/[^)]+)\)\s*$/i.test(t)
    ) {
      continue;
    }
    kept.push(
      line.replace(
        /!\[[^\]]*\]\((asset:[a-z0-9_-]+|data:image\/[^)]+)\)/gi,
        "",
      ),
    );
  }
  return kept
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeProposalSections(
  sections: ProposalSection[],
): ProposalSection[] {
  return sections.map((s) => ({
    ...s,
    title: normalizeProposalSectionText(s.title),
    body: normalizeProposalSectionText(s.body),
  }));
}

export function parseProposalSections(raw: unknown): ProposalSection[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, idx) => {
      if (!item || typeof item !== "object") return null;
      const o = item as Record<string, unknown>;
      const title = typeof o.title === "string" ? o.title.trim() : "";
      const body = typeof o.body === "string" ? o.body : "";
      const tableRows = Array.isArray(o.tableRows)
        ? o.tableRows
            .filter((row): row is { cells: unknown } => !!row && typeof row === "object")
            .map((row) => ({
              cells: Array.isArray((row as { cells?: unknown }).cells)
                ? ((row as { cells: unknown[] }).cells as unknown[]).map((c) =>
                    String(c ?? ""),
                  )
                : [],
            }))
            .filter((row) => row.cells.some((cell) => cell.trim()))
        : undefined;
      if (!title && !body && !tableRows?.length) return null;
      return {
        id:
          typeof o.id === "string" && o.id.trim()
            ? o.id
            : `sec-${idx + 1}`,
        key:
          typeof o.key === "string" && o.key.trim()
            ? o.key
            : `section_${idx + 1}`,
        title: title || `Section ${idx + 1}`,
        body,
        sortOrder:
          typeof o.sortOrder === "number" && Number.isFinite(o.sortOrder)
            ? o.sortOrder
            : idx + 1,
        ...(tableRows?.length ? { tableRows } : {}),
      } satisfies ProposalSection;
    })
    .filter((s): s is ProposalSection => s != null)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}
