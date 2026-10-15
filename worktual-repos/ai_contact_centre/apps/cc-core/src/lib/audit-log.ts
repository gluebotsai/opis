import { createLogger } from "@ai-contact-center/observability";

const logger = createLogger({ service: "cc-core-audit" });

export type AuditAction =
  | "queue.create"
  | "queue.update"
  | "queue.delete"
  | "queue.agents.replace"
  | "contact.create"
  | "contact.update"
  | "contact.delete"
  | "channel.queue.bind";

export async function writeAuditLog(params: {
  organizationId: string;
  userId?: string;
  action: AuditAction;
  resourceType: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  logger.info({
    audit: true,
    organizationId: params.organizationId,
    userId: params.userId,
    action: params.action,
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    metadata: params.metadata,
  });
}
