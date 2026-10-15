export const currentUserResponseSchema = {
  type: "object",
  required: ["id", "organizationId", "role", "permissions"],
  properties: {
    id: { type: "string" },
    organizationId: { type: "string" },
    role: { type: "string" },
    permissions: { type: "array", items: { type: "string" } },
  },
} as const;
