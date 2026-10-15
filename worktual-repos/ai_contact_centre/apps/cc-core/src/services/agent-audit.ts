import { z } from "zod";

import { entityIdSchema } from "../lib/id-schema.js";
import type { DbClient } from "../lib/rls.js";

export const recordAgentAuditSchema = z.object({
  organizationId: entityIdSchema,
  userId: entityIdSchema.optional(),
  agentName: z.string().min(1).max(128),
  agentLayer: z.string().min(1).max(32).default("executor"),
  serverKey: z.string().min(1).max(128),
  toolKey: z.string().min(1).max(128),
  outcome: z.string().min(1).max(32),
  argumentBytes: z.number().int().nonnegative().default(0),
  resultBytes: z.number().int().nonnegative().default(0),
  latencyMs: z.number().int().nonnegative().optional(),
  requestId: z.string().max(128).optional(),
  surface: z.string().max(64).optional(),
});

export async function recordAgentAudit(
  db: DbClient,
  input: z.infer<typeof recordAgentAuditSchema>,
): Promise<void> {
  const payload = recordAgentAuditSchema.parse(input);
  const metadata = JSON.stringify({
    requestId: payload.requestId,
    surface: payload.surface,
    userId: payload.userId,
  });
  await db.$executeRaw`
    INSERT INTO ccass.copilot_skill_executions (
      organization_id, skill_key, tool_key, status, latency_ms,
      agent_name, agent_layer, server_key, argument_bytes,
      result_bytes, outcome, metadata
    ) VALUES (
      ${payload.organizationId}::bigint,
      ${`agent:${payload.agentName}`},
      ${payload.toolKey},
      ${payload.outcome},
      ${payload.latencyMs ?? null},
      ${payload.agentName},
      ${payload.agentLayer},
      ${payload.serverKey},
      ${payload.argumentBytes},
      ${payload.resultBytes},
      ${payload.outcome},
      ${metadata}::jsonb
    )
  `;
}

