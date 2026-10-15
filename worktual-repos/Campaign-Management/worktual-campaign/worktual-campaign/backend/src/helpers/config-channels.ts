/** Config channel keys — email is implemented; others are reserved shells. */
export const CONFIG_CHANNELS = [
  { id: "email", label: "Email", group: "core" },
  { id: "sms", label: "SMS", group: "core" },
  { id: "web_push", label: "Web push", group: "core" },
  { id: "app_push", label: "App push", group: "core" },
  { id: "meta_whatsapp", label: "WhatsApp", group: "meta" },
  { id: "meta_instagram", label: "Instagram", group: "meta" },
  { id: "meta_other", label: "Meta (other)", group: "meta" },
  { id: "ppc", label: "PPC", group: "ads" },
] as const;

export type ConfigChannelId = (typeof CONFIG_CHANNELS)[number]["id"];

/** Hidden on Configuration UI — keep catalog ids for Accounts mapping. */
export const HIDDEN_CONFIG_CHANNEL_IDS = new Set<ConfigChannelId>([
  "sms",
  "ppc",
  "meta_instagram",
  "meta_other",
]);

const FREE_WEBMAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "mail.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "gmx.net",
  "zoho.com",
]);

export function parseEmailParts(email: string): {
  local: string;
  domain: string;
} | null {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return null;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (!local || !domain || domain.includes(" ")) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return { local, domain };
}

export function isFreeWebmailDomain(domain: string): boolean {
  return FREE_WEBMAIL.has(domain.trim().toLowerCase());
}

export function isAdminRole(role: string | undefined | null): boolean {
  return String(role || "")
    .trim()
    .toLowerCase() === "admin";
}
