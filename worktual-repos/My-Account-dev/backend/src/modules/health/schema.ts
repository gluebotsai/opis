export const healthResponseSchema = {
  type: "object",
  required: ["status", "service", "timestamp", "checks"],
  properties: {
    status: { type: "string", enum: ["ok", "degraded"] },
    service: { type: "string", const: "my-accounts-api" },
    timestamp: { type: "string", format: "date-time" },
    checks: {
      type: "object",
      required: ["postgres", "redis"],
      properties: {
        postgres: { type: "string", enum: ["up", "down"] },
        redis: { type: "string", enum: ["up", "down", "disabled"] },
      },
    },
  },
} as const;
