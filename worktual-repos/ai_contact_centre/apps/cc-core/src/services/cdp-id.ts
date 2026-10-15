import { createHash } from "node:crypto";
import { z } from "zod";

const MAX_EXTERNAL_ID_LEN = 200;

export type InboundCdpChannel = "email" | "webchat" | "whatsapp" | "instagram" | "facebook" | "call" | "voice";

const INBOUND_CHANNEL_SOURCE_NAMES: Record<InboundCdpChannel, string> = {
  email: "email",
  webchat: "webchat",
  whatsapp: "whatsapp",
  instagram: "instagram",
  facebook: "facebook",
  call: "call",
  voice: "voice",
};

const CDP_ID_PATTERN = /^CDP-([a-z0-9_]+)-org(\d+)-(.+)$/;

/** `cdp.customer_profile.cdp_id` and ccass conversation/task `contact_id` (TEXT). */
export const cdpContactIdSchema = z
  .string()
  .trim()
  .min(1, "Expected a CDP contact id.")
  .max(320);

export type InboundCdpIdentityInput = {
  channel: InboundCdpChannel;
  email?: string | null;
  phone?: string | null;
  visitorId?: string | null;
};

/** Normalize source-scoped external ids for CDP profile keys. */
export function sanitizeCdpExternalId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.length <= MAX_EXTERNAL_ID_LEN) return trimmed;
  return createHash("sha256").update(trimmed).digest("hex").slice(0, 32);
}

export function buildInboundCdpId(
  sourceName: string,
  organizationId: string,
  externalId: string,
): string {
  const source = sourceName.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (!source) {
    throw new Error("source_name is required for CDP id");
  }
  const org = String(organizationId).replace(/\D/g, "");
  if (!org) {
    throw new Error("organization_id is required for CDP id");
  }
  const external = sanitizeCdpExternalId(externalId);
  if (!external) {
    throw new Error("external_id is required for CDP id");
  }
  return `CDP-${source}-org${org}-${external}`;
}

export function resolveInboundCdpExternalId(input: InboundCdpIdentityInput): string {
  const email = input.email?.trim().toLowerCase() || null;
  const phone = input.phone?.trim() || null;

  if (input.channel === "webchat" && input.visitorId?.trim()) {
    return sanitizeCdpExternalId(input.visitorId);
  }
  if ((input.channel === "whatsapp" || input.channel === "call" || input.channel === "voice") && phone) {
    return phone;
  }
  if (
    (input.channel === "instagram" || input.channel === "facebook") &&
    input.visitorId?.trim()
  ) {
    return sanitizeCdpExternalId(input.visitorId);
  }
  if (email) {
    return email;
  }
  if (phone) {
    return phone;
  }

  throw new Error(`Cannot resolve external id for inbound ${input.channel} contact`);
}

export function buildInboundCdpIdFromInput(
  organizationId: string,
  input: InboundCdpIdentityInput,
): string {
  const sourceName = INBOUND_CHANNEL_SOURCE_NAMES[input.channel];
  const externalId = resolveInboundCdpExternalId(input);
  return buildInboundCdpId(sourceName, organizationId, externalId);
}

export function parseInboundCdpId(
  cdpId: string,
): { sourceName: string; organizationId: string; externalId: string } | null {
  const match = CDP_ID_PATTERN.exec(cdpId);
  if (!match) return null;
  return {
    sourceName: match[1]!,
    organizationId: match[2]!,
    externalId: match[3]!,
  };
}
