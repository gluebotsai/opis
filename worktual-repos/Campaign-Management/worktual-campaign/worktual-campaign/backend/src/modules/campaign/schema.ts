import { z } from "zod";
import { zContactId, zDbId, zDbIdNullable } from "../../helpers/id-schema.js";

export const createCampaignBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  goal: z.string().nullable().optional(),
  objective: z.string().nullable().optional(),
  status: z
    .enum(["draft", "scheduled", "live", "completed", "cancelled"])
    .optional(),
  startsAt: z.string().nullable().optional(),
  endsAt: z.string().nullable().optional(),
});

const personalisedCrmChannelSchema = z.enum([
  "email",
  "push",
  "web",
  "whatsapp",
]);

const personalisedCrmAudienceRefine = (
  val: {
    emails?: string[];
    phones?: string[];
    contact_ids?: string[];
    customer_ids?: string[];
    people?: Array<{
      email?: string;
      phone?: string;
      contact_id?: string;
      customer_id?: string;
      id?: string;
    }>;
  },
  ctx: z.RefinementCtx,
) => {
  const hasPeople =
    (val.emails && val.emails.length > 0) ||
    (val.phones && val.phones.length > 0) ||
    (val.contact_ids && val.contact_ids.length > 0) ||
    (val.customer_ids && val.customer_ids.length > 0) ||
    (val.people || []).some(
      (p) => p.email || p.phone || p.contact_id || p.customer_id || p.id,
    );
  if (!hasPeople) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Provide people, contact_ids, customer_ids, emails, or phones.",
    });
  }
};

const personalisedCrmLaunchFields = z.object({
  name: z.string().trim().max(200).nullable().optional(),
  brief: z.string().trim().max(8000).nullable().optional(),
  goal: z.string().trim().max(400).nullable().optional(),
  objective: z.string().trim().max(800).nullable().optional(),
  channels: z.array(personalisedCrmChannelSchema).min(1).max(8),
  emails: z.array(z.string().email()).max(200).optional(),
  phones: z.array(z.string().trim().min(5)).max(200).optional(),
  contact_ids: z.array(zContactId).max(200).optional(),
  customer_ids: z.array(zContactId).max(200).optional(),
  people: z
    .array(
      z.object({
        contact_id: zContactId.optional(),
        customer_id: zContactId.optional(),
        id: zContactId.optional(),
        email: z.string().email().optional(),
        phone: z.string().trim().min(5).optional(),
      }),
    )
    .max(200)
    .optional(),
  send_at: z.string().trim().max(64).nullable().optional(),
  timezone: z.string().trim().max(64).nullable().optional(),
});

export const personalisedCrmLaunchBodySchema =
  personalisedCrmLaunchFields.superRefine(personalisedCrmAudienceRefine);

const orgIdSchema = z
  .string()
  .trim()
  .regex(/^\d+$/, "organization_id must be a numeric organization id");

const actingUserIdSchema = z
  .string()
  .trim()
  .regex(/^\d+$/, "acting_user_id must be a numeric Accounts user id")
  .optional()
  .nullable();

export const personalisedCrmAutomationBodySchema = personalisedCrmLaunchFields
  .extend({
    organization_id: orgIdSchema,
    acting_user_id: actingUserIdSchema,
  })
  .superRefine(personalisedCrmAudienceRefine);

export const onDemandLaunchBodySchema = z.object({
  request_text: z.string().trim().min(1, "Request text is required."),
  emails: z.array(z.string().email()).max(200).optional(),
  phones: z.array(z.string().trim().min(5)).max(200).optional(),
  contact_ids: z.array(zContactId).max(200).optional(),
  customer_ids: z.array(zContactId).max(200).optional(),
  channels: z
    .array(z.enum(["email", "push", "web", "whatsapp"]))
    .max(8)
    .optional(),
  orchestration_mode: z
    .enum(["prefer_primary", "staggered", "broadcast"])
    .optional(),
  broadcast_confirmed: z.boolean().optional(),
  subject: z.string().trim().max(200).nullable().optional(),
  body: z.string().trim().max(20000).nullable().optional(),
  title: z.string().trim().max(200).nullable().optional(),
  name: z.string().trim().max(200).nullable().optional(),
  source: z.enum(["agent", "spoke", "hub", "internal"]).optional(),
});

/** Hub/spoke: at least one audience key; request_text optional (defaulted). */
export const onDemandAcceptBodySchema = z
  .object({
    request_text: z.string().trim().max(20000).optional(),
    emails: z.array(z.string().email()).max(200).optional(),
    phones: z.array(z.string().trim().min(5)).max(200).optional(),
    contact_ids: z.array(zContactId).max(200).optional(),
    customer_ids: z.array(zContactId).max(200).optional(),
    channels: z
      .array(z.enum(["email", "push", "web", "whatsapp"]))
      .max(8)
      .optional(),
    orchestration_mode: z
      .enum(["prefer_primary", "staggered", "broadcast"])
      .optional(),
    broadcast_confirmed: z.boolean().optional(),
    subject: z.string().trim().max(200).nullable().optional(),
    body: z.string().trim().max(20000).nullable().optional(),
    title: z.string().trim().max(200).nullable().optional(),
    name: z.string().trim().max(200).nullable().optional(),
    source: z.enum(["spoke", "hub", "internal"]).optional(),
  })
  .superRefine((val, ctx) => {
    const hasAudience =
      (val.emails && val.emails.length > 0) ||
      (val.phones && val.phones.length > 0) ||
      (val.contact_ids && val.contact_ids.length > 0) ||
      (val.customer_ids && val.customer_ids.length > 0) ||
      Boolean(val.request_text?.trim());
    if (!hasAudience) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Provide customer_ids, contact_ids, emails, phones, or request_text.",
      });
    }
  });

export const monitorBucketSchema = z.enum([
  "live",
  "scheduled",
  "past",
  "draft",
  "all",
  "calendar",
]);

export const saveFromSessionBodySchema = z.object({
  name: z.string().trim().min(1, "Campaign name is required."),
  goal: z.string().trim().nullable().optional(),
  objective: z.string().trim().nullable().optional(),
  description: z.string().trim().nullable().optional(),
  audience_summary: z.string().trim().nullable().optional(),
  audience_filters: z.record(z.unknown()).nullable().optional(),
  audience_count: z.number().int().nonnegative().nullable().optional(),
  contact_ids: z.array(zContactId).nullable().optional(),
  status: z
    .enum(["draft", "scheduled", "live", "completed", "cancelled"])
    .optional(),
  launch_plan: z.record(z.unknown()).nullable().optional(),
  starts_at: z.string().nullable().optional(),
  timezone: z.string().trim().nullable().optional(),
  launch_local_date: z.string().trim().nullable().optional(),
  launch_local_time: z.string().trim().nullable().optional(),
  channels: z
    .array(
      z.object({
        channel: z.string().trim().min(1),
        template_id: zDbIdNullable,
        how_it_works: z.string().nullable().optional(),
        planned_launch_at: z.string().nullable().optional(),
        status: z.string().nullable().optional(),
      }),
    )
    .min(1, "At least one channel is required."),
});

export const sessionIdParamSchema = z.object({
  sessionId: zDbId,
});

export const campaignIdParamSchema = z.object({
  id: zDbId,
});

export const channelRunStateParamSchema = z.object({
  id: zDbId,
  channel: z.string().trim().min(1),
});

export const channelRunStateBodySchema = z.object({
  paused: z.boolean(),
  reason: z.string().trim().nullable().optional(),
});

export const abWinnerBodySchema = z.object({
  winner: z.enum(["a", "b"]).nullable().optional(),
  force: z.boolean().optional(),
});

export const stopCampaignBodySchema = z.object({
  reason: z.string().trim().nullable().optional(),
});

export const campaignSchemas = {
  createBody: {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string" },
      description: { type: ["string", "null"] },
      goal: { type: ["string", "null"] },
      objective: { type: ["string", "null"] },
      status: { type: "string" },
      startsAt: { type: ["string", "null"] },
      endsAt: { type: ["string", "null"] },
    },
  },
  listQuery: {
    type: "object",
    properties: {
      bucket: {
        type: "string",
        enum: ["live", "scheduled", "past", "draft", "all", "calendar"],
      },
      lite: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      relative: {
        type: "string",
        enum: ["today", "yesterday", "last_7_days", "last_month"],
      },
    },
  },
  fromSessionBody: {
    type: "object",
    required: ["name", "channels"],
    properties: {
      name: { type: "string" },
      goal: { type: ["string", "null"] },
      objective: { type: ["string", "null"] },
      description: { type: ["string", "null"] },
      audience_summary: { type: ["string", "null"] },
      audience_filters: { type: ["object", "null"] },
      audience_count: { type: ["integer", "null"] },
      contact_ids: {
        type: "array",
        items: { type: "string" },
      },
      status: { type: "string" },
      channels: {
        type: "array",
        items: {
          type: "object",
          required: ["channel"],
          properties: {
            channel: { type: "string" },
            template_id: { type: ["string", "null"] },
            how_it_works: { type: ["string", "null"] },
            planned_launch_at: { type: ["string", "null"] },
            status: { type: ["string", "null"] },
          },
        },
      },
    },
  },
  personalisedCrmBody: {
    type: "object",
    required: ["channels"],
    properties: {
      name: { type: ["string", "null"] },
      brief: { type: ["string", "null"] },
      goal: { type: ["string", "null"] },
      objective: { type: ["string", "null"] },
      channels: {
        type: "array",
        items: {
          type: "string",
          enum: ["email", "push", "web", "whatsapp"],
        },
      },
      emails: { type: "array", items: { type: "string" } },
      phones: { type: "array", items: { type: "string" } },
      contact_ids: { type: "array", items: { type: "string" } },
      customer_ids: { type: "array", items: { type: "string" } },
      people: {
        type: "array",
        items: {
          type: "object",
          properties: {
            contact_id: { type: "string" },
            customer_id: { type: "string" },
            id: { type: "string" },
            email: { type: "string" },
            phone: { type: "string" },
          },
        },
      },
      send_at: { type: ["string", "null"] },
      timezone: { type: ["string", "null"] },
    },
  },
  personalisedCrmAutomationBody: {
    type: "object",
    required: ["channels", "organization_id"],
    properties: {
      organization_id: { type: "string" },
      acting_user_id: { type: ["string", "null"] },
      name: { type: ["string", "null"] },
      brief: { type: ["string", "null"] },
      goal: { type: ["string", "null"] },
      objective: { type: ["string", "null"] },
      channels: {
        type: "array",
        items: {
          type: "string",
          enum: ["email", "push", "web", "whatsapp"],
        },
      },
      emails: { type: "array", items: { type: "string" } },
      phones: { type: "array", items: { type: "string" } },
      contact_ids: { type: "array", items: { type: "string" } },
      customer_ids: { type: "array", items: { type: "string" } },
      people: {
        type: "array",
        items: {
          type: "object",
          properties: {
            contact_id: { type: "string" },
            customer_id: { type: "string" },
            id: { type: "string" },
            email: { type: "string" },
            phone: { type: "string" },
          },
        },
      },
      send_at: { type: ["string", "null"] },
      timezone: { type: ["string", "null"] },
    },
  },
  onDemandBody: {
    type: "object",
    required: ["request_text"],
    properties: {
      request_text: { type: "string" },
      emails: { type: "array", items: { type: "string" } },
      phones: { type: "array", items: { type: "string" } },
      contact_ids: { type: "array", items: { type: "string" } },
      customer_ids: { type: "array", items: { type: "string" } },
      channels: {
        type: "array",
        items: {
          type: "string",
          enum: ["email", "push", "web", "whatsapp"],
        },
      },
      subject: { type: ["string", "null"] },
      body: { type: ["string", "null"] },
      title: { type: ["string", "null"] },
      name: { type: ["string", "null"] },
      source: {
        type: "string",
        enum: ["agent", "spoke", "hub", "internal"],
      },
    },
  },
  onDemandAcceptBody: {
    type: "object",
    properties: {
      request_text: { type: "string" },
      emails: { type: "array", items: { type: "string" } },
      phones: { type: "array", items: { type: "string" } },
      contact_ids: { type: "array", items: { type: "string" } },
      customer_ids: { type: "array", items: { type: "string" } },
      channels: {
        type: "array",
        items: {
          type: "string",
          enum: ["email", "push", "web", "whatsapp"],
        },
      },
      subject: { type: ["string", "null"] },
      body: { type: ["string", "null"] },
      title: { type: ["string", "null"] },
      name: { type: ["string", "null"] },
      source: { type: "string", enum: ["spoke", "hub", "internal"] },
    },
  },
  sessionIdParams: {
    type: "object",
    required: ["sessionId"],
    properties: {
      sessionId: { type: "string" },
    },
  },
  idParams: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string" },
    },
  },
  channelRunParams: {
    type: "object",
    required: ["id", "channel"],
    properties: {
      id: { type: "string" },
      channel: { type: "string" },
    },
  },
  channelRunBody: {
    type: "object",
    required: ["paused"],
    properties: {
      paused: { type: "boolean" },
      reason: { type: ["string", "null"] },
    },
  },
  recipientsQuery: {
    type: "object",
    properties: {
      channel: { type: "string" },
      limit: { type: "string" },
    },
  },
  abWinnerBody: {
    type: "object",
    properties: {
      winner: { type: ["string", "null"], enum: ["a", "b", null] },
      force: { type: "boolean" },
    },
  },
  stopBody: {
    type: "object",
    properties: {
      reason: { type: ["string", "null"] },
    },
  },
};
