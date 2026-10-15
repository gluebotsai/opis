import type { AuditAction, Prisma } from "@prisma/client";
import { prisma } from "@/dao/db/prisma";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";
export async function writeAuditLog(input: {
  actorUserId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  organizationId?: string | null;
  meta?: Prisma.InputJsonValue;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: await resolveRequestOrganizationId(input.organizationId),
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        meta: input.meta ?? undefined,
      },
    });
  } catch (err) {
    console.error("audit log failed", err);
  }
}
