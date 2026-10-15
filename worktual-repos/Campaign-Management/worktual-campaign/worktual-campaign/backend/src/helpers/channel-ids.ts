/**
 * Channel id helpers.
 * Agents/DB store: push | web
 * Config UI / FE pickers: app_push | web_push
 */

export type AgentPushChannel = "push" | "web";
export type ConfigPushChannel = "app_push" | "web_push";

export function toAgentChannel(raw: string): string {
  const c = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  if (c === "app_push" || c === "apppush") return "push";
  if (c === "web_push" || c === "webpush") return "web";
  return c;
}

export function toConfigChannel(raw: string): string {
  const c = toAgentChannel(raw);
  if (c === "push") return "app_push";
  if (c === "web") return "web_push";
  return c;
}

export function isPushAgentChannel(raw: string): raw is AgentPushChannel {
  const c = toAgentChannel(raw);
  return c === "push" || c === "web";
}

/** Email is the only channel that records opens (pixel / inferred from click). */
export function isOpenTrackedAgentChannel(raw: string): boolean {
  return toAgentChannel(raw) === "email";
}

/** Email, app push, and web push each record their own clicks — never blended. */
export function isClickTrackedAgentChannel(raw: string): boolean {
  const c = toAgentChannel(raw);
  return c === "email" || c === "push" || c === "web";
}

export function pushChannelLabel(raw: string): string {
  const c = toAgentChannel(raw);
  if (c === "push") return "App Push";
  if (c === "web") return "Web Push";
  return raw;
}
