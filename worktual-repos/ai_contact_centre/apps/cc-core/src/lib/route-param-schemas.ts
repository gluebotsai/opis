/** Fastify/OpenAPI JSON Schema for bigint entity ids in URL params (digits as string). */
export const entityIdJsonSchema = {
  type: "string",
  pattern: "^[0-9]+$",
} as const;

/** CDP `cdp_id` — text column; numeric string or legacy UUID. */
export const cdpIdJsonSchema = {
  type: "string",
  minLength: 1,
} as const;

export function routeIdParams(idProperty = "id") {
  return {
    params: {
      type: "object",
      required: [idProperty],
      properties: { [idProperty]: entityIdJsonSchema },
    },
  } as const;
}

export function routeCdpIdParams(idProperty = "id") {
  return {
    params: {
      type: "object",
      required: [idProperty],
      properties: { [idProperty]: cdpIdJsonSchema },
    },
  } as const;
}
