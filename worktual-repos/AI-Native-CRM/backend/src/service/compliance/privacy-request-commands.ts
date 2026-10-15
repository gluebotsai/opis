/**
 * Admin review commands for Compliance & Privacy Control Agent output.
 *
 * HITL rule (hard constraint): the agent only ever classifies + drafts (see
 * `compliance-privacy-assess.ts`). Deletion execution here re-uses the
 * existing `deleteContactCommand` cascade — no new deletion logic is
 * invented — and requires an explicit admin action.
 */

import { canManageCompliance } from "@/service/auth/rbac";
import {
  ForbiddenError,
  getCurrentOrganizationId,
  requireRole,
} from "@/service/auth/require-role";
import { getServerUserId } from "@/service/account/session-cookie";
import { prisma } from "@/dao/db/prisma";
import { getContact } from "@/dao/contacts/contact-service";
import { deleteContactCommand } from "@/service/contacts/contact-commands";
import { writeAuditLog } from "@/dao/audit/audit-log";

export type PrivacyRequestView = {
  id: string;
  contactId: string;
  activityId: string;
  contactName: string | null;
  requestType: string;
  confidence: string;
  status: string;
  reason: string | null;
  draftConfirmation: string | null;
  createdAt: string;
  reviewedAt: string | null;
  executedAt: string | null;
};

export async function listPrivacyRequestsCommand() {
  try {
    await requireRole(
      canManageCompliance,
      "Only admins can review privacy requests.",
    );
    const organizationId = await getCurrentOrganizationId();
    const rows = await prisma.privacyRequest.findMany({
      where: { organizationId: BigInt(organizationId) },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    const contacts = await Promise.all(
      rows.map((row) => getContact(row.contactId).catch(() => null)),
    );
    const nameByContactId = new Map<string, string | null>();
    rows.forEach((row, i) => {
      const contact = contacts[i];
      const name =
        contact?.displayName?.trim() ||
        [contact?.person.firstName, contact?.person.lastName]
          .filter(Boolean)
          .join(" ")
          .trim() ||
        contact?.person.email ||
        null;
      nameByContactId.set(row.contactId, name);
    });

    const items: PrivacyRequestView[] = rows.map((row) => ({
      id: row.id,
      contactId: row.contactId,
      activityId: row.activityId,
      contactName: nameByContactId.get(row.contactId) ?? null,
      requestType: row.requestType,
      confidence: row.confidence,
      status: row.status,
      reason: row.reason,
      draftConfirmation: row.draftConfirmation,
      createdAt: row.createdAt.toISOString(),
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      executedAt: row.executedAt?.toISOString() ?? null,
    }));

    return { ok: true as const, items };
  } catch (err) {
    return {
      ok: false as const,
      error:
        err instanceof Error ? err.message : "Failed to list privacy requests.",
      status: err instanceof ForbiddenError ? 403 : 400,
    };
  }
}

export async function executePrivacyRequestCommand(id: string) {
  try {
    await requireRole(
      canManageCompliance,
      "Only admins can execute privacy requests.",
    );
    const organizationId = await getCurrentOrganizationId();
    const userId = await getServerUserId();
    const request = await prisma.privacyRequest.findFirst({
      where: { id, organizationId: BigInt(organizationId) },
    });
    if (!request) {
      return { ok: false as const, error: "Privacy request not found.", status: 404 };
    }
    if (request.status !== "pending_review") {
      return {
        ok: false as const,
        error: "This request has already been resolved.",
        status: 400,
      };
    }

    if (request.requestType === "data_deletion") {
      const result = await deleteContactCommand(request.contactId);
      if (!result.ok) {
        return { ok: false as const, error: result.error, status: 400 };
      }
    }
    // data_access: no deletion — an admin executes by exporting/sending data
    // outside the CRM (out of scope for v1); marking it executed here just
    // records that the request was handled.

    await prisma.privacyRequest.update({
      where: { id },
      data: {
        status: "executed",
        reviewedByUserId: userId ? BigInt(userId) : null,
        reviewedAt: new Date(),
        executedAt: new Date(),
      },
    });

    await writeAuditLog({
      actorUserId: userId,
      action: "delete",
      entityType: "privacy_request",
      entityId: id,
      organizationId,
      meta: { agent: "compliance_privacy", requestType: request.requestType },
    });

    return { ok: true as const, id };
  } catch (err) {
    return {
      ok: false as const,
      error:
        err instanceof Error ? err.message : "Failed to execute privacy request.",
      status: err instanceof ForbiddenError ? 403 : 400,
    };
  }
}

export async function dismissPrivacyRequestCommand(id: string) {
  try {
    await requireRole(
      canManageCompliance,
      "Only admins can dismiss privacy requests.",
    );
    const organizationId = await getCurrentOrganizationId();
    const userId = await getServerUserId();
    const request = await prisma.privacyRequest.findFirst({
      where: { id, organizationId: BigInt(organizationId) },
    });
    if (!request) {
      return { ok: false as const, error: "Privacy request not found.", status: 404 };
    }
    if (request.status !== "pending_review") {
      return {
        ok: false as const,
        error: "This request has already been resolved.",
        status: 400,
      };
    }

    await prisma.privacyRequest.update({
      where: { id },
      data: {
        status: "dismissed",
        reviewedByUserId: userId ? BigInt(userId) : null,
        reviewedAt: new Date(),
      },
    });

    await writeAuditLog({
      actorUserId: userId,
      action: "update",
      entityType: "privacy_request",
      entityId: id,
      organizationId,
      meta: { agent: "compliance_privacy", outcome: "dismissed" },
    });

    return { ok: true as const, id };
  } catch (err) {
    return {
      ok: false as const,
      error:
        err instanceof Error ? err.message : "Failed to dismiss privacy request.",
      status: err instanceof ForbiddenError ? 403 : 400,
    };
  }
}
