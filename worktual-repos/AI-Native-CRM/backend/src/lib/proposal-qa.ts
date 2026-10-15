/**
 * Deterministic proposal QA (leakage / copy / numeric / guardrails).
 * LLM content QA stays in shadow until trusted.
 */

import { formatProductPrice } from "@/dao/products/product-labels";

const GOLD_LEAK_RE =
  /\b(PROP-\d{3,}|note for\s+[A-Z][a-z]+|confidential to\s)/i;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PLACEHOLDER_RE =
  /\b(lorem ipsum|todo:|tbd\b|insert (text|here)|\[placeholder\])/i;
const INVENTED_MONEY_RE = /\$\s?\d[\d,]*(?:\.\d{2})?/g;

export type ProposalQaFinding = {
  code: "leakage" | "placeholder" | "numeric" | "guardrail";
  sectionKey?: string;
  message: string;
};

export type ProposalQaReport = {
  schemaVersion: 1;
  source: "deterministic";
  ok: boolean;
  findings: ProposalQaFinding[];
};

/** Substrings that may appear in draft money cells when sourced from catalog + LLM. */
export function catalogAmountAllowlist(
  products: Array<{
    price?: string | null;
    currency?: string | null;
    addons?: Array<{
      flatPrice?: number | null;
      unitPrice?: number | null;
      stepPrice?: number | null;
      tiers?: Array<{ unitPrice?: number }>;
    }>;
  }>,
): string[] {
  const out = new Set<string>();
  for (const p of products) {
    const currency = String(p.currency || "USD");
    if (p.price) {
      out.add(String(p.price));
      const formatted = formatProductPrice(String(p.price), currency);
      if (formatted && !formatted.startsWith("Contact")) {
        out.add(formatted);
        out.add(formatted.replace(/\s/g, ""));
      }
    }
    for (const addon of p.addons ?? []) {
      for (const n of [
        addon.flatPrice,
        addon.unitPrice,
        addon.stepPrice,
        ...(addon.tiers ?? []).map((t) => t.unitPrice),
      ]) {
        if (n == null || !Number.isFinite(n)) continue;
        out.add(String(n));
      }
    }
  }
  return [...out].filter((s) => s.length >= 2);
}

export function runDeterministicProposalQa(input: {
  sections: Array<{ key?: string; title?: string; body?: string }>;
  forbiddenCustomerNames?: string[];
  allowedPriceTokens?: string[];
  requirementText?: string;
}): ProposalQaReport {
  const findings: ProposalQaFinding[] = [];
  const forbidden = (input.forbiddenCustomerNames || [])
    .map((n) => n.trim())
    .filter((n) => n.length >= 4);
  const allowedTokens = new Set(input.allowedPriceTokens || []);
  const req = String(input.requirementText || "");

  for (const section of input.sections) {
    const key = String(section.key || "");
    const body = `${section.title || ""}\n${section.body || ""}`;
    if (GOLD_LEAK_RE.test(body)) {
      findings.push({
        code: "leakage",
        sectionKey: key,
        message: "Looks like another customer's gold document leaked in.",
      });
    }
    for (const name of forbidden) {
      if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(body)) {
        findings.push({
          code: "leakage",
          sectionKey: key,
          message: `Forbidden customer string "${name}" appeared in the draft.`,
        });
      }
    }
    if (PLACEHOLDER_RE.test(body)) {
      findings.push({
        code: "placeholder",
        sectionKey: key,
        message: "Placeholder copy is not customer-ready.",
      });
    }
    const emails = body.match(EMAIL_RE) || [];
    for (const email of emails) {
      if (req && !req.includes(email)) {
        findings.push({
          code: "guardrail",
          sectionKey: key,
          message: `Email ${email} is not in the requirement.`,
        });
      }
    }
    const money = body.match(INVENTED_MONEY_RE) || [];
    for (const hit of money) {
      const okToken = [...allowedTokens].some((token) => body.includes(token));
      if (!okToken && !req.includes(hit.replace(/\s/g, ""))) {
        findings.push({
          code: "numeric",
          sectionKey: key,
          message: `Numeric amount ${hit} was not supplied as a pricing token.`,
        });
      }
    }
  }

  return {
    schemaVersion: 1,
    source: "deterministic",
    ok: findings.length === 0,
    findings,
  };
}
