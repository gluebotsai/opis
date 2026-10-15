import { z } from "zod";

export const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  remember: z.boolean().optional(),
});

export const onboardingDashboardLinkBodySchema = z
  .object({
    email: z.string().email().optional(),
    userId: z.string().min(1).optional(),
  })
  .refine((v) => Boolean(v.email?.trim() || v.userId?.trim()), {
    message: "Provide email or userId.",
  });

export const onboardingExchangeBodySchema = z.object({
  code: z.string().min(8),
});

export const authSchemas = {
  loginBody: {
    type: "object",
    required: ["email", "password"],
    properties: {
      email: { type: "string", format: "email" },
      password: { type: "string" },
      remember: { type: "boolean" },
    },
  },
  onboardingDashboardLinkBody: {
    type: "object",
    properties: {
      email: { type: "string", format: "email" },
      userId: { type: "string" },
    },
  },
  onboardingExchangeBody: {
    type: "object",
    required: ["code"],
    properties: {
      code: { type: "string" },
    },
  },
};
