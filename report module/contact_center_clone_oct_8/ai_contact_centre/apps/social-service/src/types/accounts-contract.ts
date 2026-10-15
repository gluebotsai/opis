import { entityIdSchema } from "@ai-contact-center/event-contracts";
import { z } from "zod";

export const whatsappRuntimeCredentialsSchema = z.object({
  channelConfigId: entityIdSchema,
  organizationId: entityIdSchema,
  provider: z.literal("whatsapp"),
  connectionStatus: z.literal("connected"),
  phoneNumberId: z.string().min(1),
  wabaId: z.string().min(1).nullable().optional(),
  accessToken: z.string().min(1),
  tokenExpiresAt: z.string().datetime().nullable(),
});

export type WhatsAppRuntimeCredentials = z.infer<typeof whatsappRuntimeCredentialsSchema>;

export const messengerRuntimeCredentialsSchema = z.object({
  channelConfigId: entityIdSchema,
  organizationId: entityIdSchema,
  provider: z.enum(["facebook", "instagram"]),
  connectionStatus: z.literal("connected"),
  pageId: z.string().min(1),
  igBusinessAccountId: z.string().min(1).nullable().optional(),
  igWebhookAccountId: z.string().min(1).nullable().optional(),
  instagramLoginUserId: z.string().min(1).nullable().optional(),
  instagramLoginScopedId: z.string().min(1).nullable().optional(),
  authType: z.enum(["facebook_page", "instagram_login"]).nullable().optional(),
  metaAppId: z.string().min(1).nullable().optional(),
  grantedScopes: z.array(z.string()).optional(),
  accessToken: z.string().min(1),
  tokenExpiresAt: z.string().datetime().nullable(),
});

export type MessengerRuntimeCredentials = z.infer<typeof messengerRuntimeCredentialsSchema>;

export const accountsErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean().optional().default(false),
  }),
});

export type AccountsErrorEnvelope = z.infer<typeof accountsErrorEnvelopeSchema>;

export type TokenRenewalReason = "expiring_soon" | "provider_auth_failure";

export type NeedsReauthInput = {
  reason: "meta_oauth_error";
  providerErrorCode: number;
};
