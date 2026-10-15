import { z } from "zod";
import { isValidEmailFormat, parseAndValidatePhone } from "../../helpers/contact-validation.js";

const optionalEmail = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (typeof v === "string" ? v.trim().toLowerCase() : ""))
  .refine((v) => !v || isValidEmailFormat(v), "Enter a valid email address.");

const requiredPhone = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (typeof v === "string" ? v.trim() : ""));

export const contactBodySchema = z
  .object({
    firstName: z.string().trim().min(1, "First name is required."),
    lastName: z.string().trim().optional().nullable(),
    email: optionalEmail,
    phone: requiredPhone,
    companyName: z.string().trim().optional().nullable(),
    city: z.string().trim().optional().nullable(),
    /** Explicit extras; unknown body keys also merge into custom_fields. */
    customFields: z.record(z.unknown()).optional().nullable(),
    /** App push device token (pushNotificationId / FCM / APNs). */
    appPushToken: z.string().trim().optional().nullable(),
    appPushPlatform: z.string().trim().optional().nullable(),
    /** Web push browser subscription. */
    webPushEndpoint: z.string().trim().optional().nullable(),
    webPushP256dh: z.string().trim().optional().nullable(),
    webPushAuth: z.string().trim().optional().nullable(),
  })
  .passthrough()
  .superRefine((val, ctx) => {
    const parsed = parseAndValidatePhone(val.phone);
    if (!parsed.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: parsed.message,
        path: ["phone"],
      });
    }
  });

export const contactFilterBodySchema = z.object({
  filters: z
    .object({
      city: z.string().trim().optional().nullable(),
      company: z.string().trim().optional().nullable(),
      job_title: z.string().trim().max(120).optional().nullable(),
      has_email: z.boolean().optional().nullable(),
      has_phone: z.boolean().optional().nullable(),
      search: z.string().trim().optional().nullable(),
      emails: z
        .array(z.string().trim().min(1))
        .max(500)
        .optional()
        .nullable(),
      phones: z
        .array(z.string().trim().min(1))
        .max(500)
        .optional()
        .nullable(),
      /** Optional soft CPMA — only when user asks to narrow by consent source. */
      consent_source: z.string().trim().max(120).optional().nullable(),
      /** B2C audience dimensions (custom_fields). */
      segment: z.string().trim().max(120).optional().nullable(),
      product_interest: z.string().trim().max(120).optional().nullable(),
      min_score: z.number().finite().optional().nullable(),
      custom_fields: z
        .record(z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .nullable(),
      /** preferences_json.<channel> = 1 (email|whatsapp|push|web|sms). */
      preferred_channel: z
        .enum(["email", "whatsapp", "push", "web", "sms"])
        .optional()
        .nullable(),
    })
    .optional()
    .default({}),
});

export const contactPreferencesBodySchema = z
  .object({
    preferences_json: z.record(z.unknown()).optional().nullable(),
    preferencesJson: z.record(z.unknown()).optional().nullable(),
    preferences: z.record(z.unknown()).optional().nullable(),
    email: z.union([z.number(), z.boolean()]).optional(),
    whatsapp: z.union([z.number(), z.boolean()]).optional(),
    push: z.union([z.number(), z.boolean()]).optional(),
    web: z.union([z.number(), z.boolean()]).optional(),
    sms: z.union([z.number(), z.boolean()]).optional(),
    timezone: z.string().optional(),
    timing: z.record(z.unknown()).optional(),
    channel_timing: z.record(z.unknown()).optional(),
  })
  .passthrough();

export const personalizationPreviewBodySchema = z.object({
  contact_ids: z.array(z.string().min(1)).max(50).optional().nullable(),
  sample_size: z.number().int().min(1).max(20).optional().nullable(),
  /** When true (default), resolve dynamic product offers from the adapter. */
  dynamic_offer: z.boolean().optional().nullable(),
  default_campaign_url: z.string().trim().max(2000).optional().nullable(),
  template: z
    .object({
      subject: z.string().optional().nullable(),
      html: z.string().optional().nullable(),
      text: z.string().optional().nullable(),
      title: z.string().optional().nullable(),
      body: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),
});

export const contactSchemas = {
  createBody: {
    type: "object",
    required: ["firstName"],
    properties: {
      firstName: { type: "string" },
      lastName: { type: ["string", "null"] },
      email: { type: ["string", "null"] },
      phone: { type: ["string", "null"] },
      companyName: { type: ["string", "null"] },
      city: { type: ["string", "null"] },
      customFields: { type: ["object", "null"] },
      appPushToken: { type: ["string", "null"] },
      appPushPlatform: { type: ["string", "null"] },
      webPushEndpoint: { type: ["string", "null"] },
      webPushP256dh: { type: ["string", "null"] },
      webPushAuth: { type: ["string", "null"] },
    },
  },
  updateBody: {
    type: "object",
    required: ["firstName"],
    properties: {
      firstName: { type: "string" },
      lastName: { type: ["string", "null"] },
      email: { type: ["string", "null"] },
      phone: { type: ["string", "null"] },
      companyName: { type: ["string", "null"] },
      city: { type: ["string", "null"] },
      customFields: { type: ["object", "null"] },
      appPushToken: { type: ["string", "null"] },
      appPushPlatform: { type: ["string", "null"] },
      webPushEndpoint: { type: ["string", "null"] },
      webPushP256dh: { type: ["string", "null"] },
      webPushAuth: { type: ["string", "null"] },
    },
  },
  filterBody: {
    type: "object",
    properties: {
      filters: { type: "object" },
    },
  },
  personalizationPreviewBody: {
    type: "object",
    properties: {
      contact_ids: { type: "array", items: { type: "string" } },
      sample_size: { type: "integer" },
      dynamic_offer: { type: "boolean" },
      default_campaign_url: { type: "string" },
      template: { type: "object" },
    },
  },
  idParams: {
    type: "object",
    required: ["id"],
    properties: { id: { type: "string" } },
  },
  preferencesBody: {
    type: "object",
    additionalProperties: true,
    properties: {
      preferences_json: { type: "object", additionalProperties: true },
      email: { type: ["integer", "boolean"] },
      whatsapp: { type: ["integer", "boolean"] },
      push: { type: ["integer", "boolean"] },
      web: { type: ["integer", "boolean"] },
      sms: { type: ["integer", "boolean"] },
      timezone: { type: "string" },
      timing: { type: "object", additionalProperties: true },
      channel_timing: { type: "object", additionalProperties: true },
    },
  },
};
