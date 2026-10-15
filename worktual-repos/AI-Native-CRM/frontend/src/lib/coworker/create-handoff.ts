/**
 * Handoff from module agent chat → create hybrid pages.
 * Seed prompt continues the conversation on the create co-worker.
 */

export const CREATE_HANDOFF_PATHS = [
  "/sales/new",
  "/contact/new",
  "/company/new",
  "/product/new",
  "/finance/new",
  "/activities/log",
  "/sales/quotes/new",
] as const;

export type CreateHandoffPath = (typeof CREATE_HANDOFF_PATHS)[number];

export function isCreateHandoffHref(href: string): boolean {
  const path = href.split("?")[0]?.split("#")[0] ?? "";
  return (CREATE_HANDOFF_PATHS as readonly string[]).includes(path);
}

const SEEDED_CREATE_LIST_PATHS = new Set([
  "/contact",
  "/company",
  "/sales",
  "/product",
  "/finance",
  "/activities",
  "/sales/quotes",
]);

/** Navigate/create that the destination page will continue via ?prompt=. */
export function isSeededCreateHandoffTool(tool: {
  name?: string;
  args?: Record<string, unknown>;
}): boolean {
  const args = tool.args ?? {};
  const seed =
    typeof args.seedPrompt === "string" ? args.seedPrompt.trim() : "";
  if (!seed) return false;
  const name = String(tool.name || "");
  if (name === "set_workspace") {
    const mode = String(args.mode || "");
    return mode === "create" || mode === "create_quote";
  }
  if (name !== "navigate" && name !== "open_entity") return false;
  const path = String(args.href || "").split("?")[0]?.split("#")[0] ?? "";
  return isCreateHandoffHref(path) || SEEDED_CREATE_LIST_PATHS.has(path);
}

export function buildCreateHandoffHref(
  path: string,
  seedPrompt?: string | null,
  displayText?: string | null,
): string {
  const base = path.split("?")[0] || path;
  const prompt = seedPrompt?.trim();
  if (!prompt) return base;
  const params = new URLSearchParams();
  params.set("prompt", prompt.slice(0, 2000));
  const said = displayText?.trim();
  // Internal rephrase stays in `prompt`. The bubble shows what the user typed.
  if (said && said !== prompt) {
    params.set("said", said.slice(0, 500));
  }
  return `${base}?${params.toString()}`;
}

export function readCreateSeedPrompt(
  searchParams: URLSearchParams,
): string | null {
  const prompt = searchParams.get("prompt")?.trim();
  return prompt ? prompt.slice(0, 2000) : null;
}

const FROM_CONTACT_KEY = "crm-coworker-from-contact";

/** Remember the open contact so a deal handoff can use that company's name. */
export function rememberHandoffContact(contactId: string | null | undefined) {
  if (typeof sessionStorage === "undefined") return;
  const id = contactId?.trim();
  if (!id) return;
  try {
    sessionStorage.setItem(FROM_CONTACT_KEY, id);
  } catch {
    /* private mode */
  }
}

export function readHandoffContact(): string | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    return sessionStorage.getItem(FROM_CONTACT_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

/** Attach the open contact when a contact page routes into a new deal. */
export function withHandoffContact(href: string, contactId: string): string {
  const id = contactId.trim();
  if (!id) return href;
  const [path, query = ""] = href.split("?");
  if (path !== "/sales/new") return href;
  const params = new URLSearchParams(query);
  params.set("fromContact", id);
  return `${path}?${params.toString()}`;
}

/** Original user words, when the seed prompt was rewritten for the agent. */
export function readCreateUserText(
  searchParams: URLSearchParams,
): string | null {
  const said = searchParams.get("said")?.trim();
  return said ? said.slice(0, 500) : null;
}

/** Clear ?prompt= after consuming so refresh does not re-run the seed. */
export function stripCreateSeedPrompt(
  searchParams: URLSearchParams,
): URLSearchParams {
  const next = new URLSearchParams(searchParams);
  next.delete("prompt");
  next.delete("said");
  next.delete("fromDeal");
  return next;
}

/** When scheduling from an open deal, pass deal id into activity create. */
export function withHandoffDeal(href: string, dealId: string): string {
  const id = dealId.trim();
  if (!id) return href;
  const [path, query = ""] = href.split("?");
  if (path !== "/activities/log") return href;
  const params = new URLSearchParams(query);
  params.set("fromDeal", id);
  return `${path}?${params.toString()}`;
}

export function readHandoffDealId(
  searchParams: URLSearchParams,
): string | null {
  const id = searchParams.get("fromDeal")?.trim();
  return id ? id.slice(0, 80) : null;
}
