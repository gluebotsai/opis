import { buildCreateHandoffHref } from "@/lib/coworker/create-handoff";
import type { AgentToolProposal } from "@/services/coworker";

const LIST_TO_CREATE: Record<string, string> = {
  "/contact": "/contact/new",
  "/company": "/company/new",
  "/sales": "/sales/new",
  "/product": "/product/new",
  "/finance": "/finance/new",
  "/activities": "/activities/log",
  "/sales/quotes": "/sales/quotes/new",
};

const MODULE_CREATE: Record<string, string> = {
  contact: "/contact/new",
  sales: "/sales/new",
  company: "/company/new",
  product: "/product/new",
  finance: "/finance/new",
  activities: "/activities/log",
  quotes: "/sales/quotes/new",
};

const MODULE_LIST: Record<string, string> = {
  contact: "/contact",
  sales: "/sales",
  company: "/company",
  product: "/product",
  finance: "/finance",
  activities: "/activities",
  quotes: "/sales/quotes",
};

function pathOnly(href: string): string {
  return href.split("?")[0]?.split("#")[0] || href;
}

function currentPath(): string {
  if (typeof window === "undefined") return "";
  return window.location.pathname.replace(/\/+$/, "") || "/";
}

function inferCreateHrefFromLabel(label: string): string | null {
  const l = label.toLowerCase();
  if (/\bactivit|\bcall|\bmeeting|\bdemo|\btask|\bemail/.test(l)) return "/activities/log";
  if (/\bcompan/.test(l)) return "/company/new";
  if (/\bcontact|\blead|\bperson/.test(l)) return "/contact/new";
  if (/\bdeal|\bpipeline/.test(l)) return "/sales/new";
  if (/\bproduct|\bcatalog|\bsku/.test(l)) return "/product/new";
  if (/\binvoice|\bbill/.test(l)) return "/finance/new";
  if (/\bquote/.test(l) && !/\btemplate/.test(l)) return "/sales/quotes/new";
  return null;
}

function looksLikeCreateSeed(seed: string): boolean {
  return /\b(create|add|new|log)\b/i.test(seed.trim());
}

function withSeed(href: string, seed?: string, displayText?: string): string {
  const prompt = seed?.trim();
  if (!prompt) return href;
  const path = pathOnly(href);
  const createPath = LIST_TO_CREATE[path] ?? path;
  return buildCreateHandoffHref(createPath, prompt, displayText);
}

function hrefFromTool(
  tool: AgentToolProposal,
  seedFallback?: string,
): string | null {
  const seed =
    (typeof tool.args.seedPrompt === "string" && tool.args.seedPrompt.trim()) ||
    seedFallback?.trim() ||
    "";
  const typed = seedFallback?.trim() || "";
  const displayText = typed && typed !== seed ? typed : undefined;

  if (tool.name === "navigate" || tool.name === "open_entity") {
    const raw = String(tool.args.href || "").trim();
    if (!raw.startsWith("/") || raw.startsWith("//")) return null;
    const path = pathOnly(raw);
    // "save" / "yes" must not turn a list link into another module's create page.
    const mapped =
      seed && looksLikeCreateSeed(seed) ? (LIST_TO_CREATE[path] ?? path) : path;
    return withSeed(mapped, seed, displayText);
  }

  if (tool.name === "set_workspace") {
    const mode = String(tool.args.mode || "list");
    const fromLabel = inferCreateHrefFromLabel(String(tool.label || ""));
    if (mode === "list") {
      if (!fromLabel) return null;
      const mod = Object.entries(MODULE_CREATE).find(([, href]) => href === fromLabel)?.[0];
      return mod ? MODULE_LIST[mod] ?? null : null;
    }
    if (mode === "create" && fromLabel) {
      return withSeed(fromLabel, seed, displayText);
    }
    return null;
  }

  return null;
}

/**
 * Honor LLM navigate / set_workspace on dedicated /…/new create pages.
 * Returns true when the browser left this page (caller must not apply a local draft patch).
 */
export function followCreateShellTools(options: {
  tools: AgentToolProposal[] | undefined;
  navigate: (href: string) => void;
  seedFallback?: string;
}): boolean {
  const here = currentPath();
  for (const tool of options.tools ?? []) {
    const href = hrefFromTool(tool, options.seedFallback);
    if (!href) continue;
    const next = pathOnly(href);
    if (!next || next === here) continue;
    options.navigate(href);
    return true;
  }
  return false;
}
