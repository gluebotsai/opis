export const domainOwnershipSchema = {
  type: "array",
  items: {
    type: "object",
    required: ["domain", "prefixes", "owner", "state", "notes"],
    properties: {
      domain: { type: "string" },
      prefixes: { type: "array", items: { type: "string" } },
      owner: {
        type: "string",
        enum: [
          "platform",
          "identity",
          "accounts",
          "sales",
          "finance",
          "operations",
        ],
      },
      state: { type: "string", enum: ["fastify", "legacy", "hybrid"] },
      notes: { type: "string" },
    },
  },
} as const;
