/**
 * Flip past-due sent invoices to overdue and notify the deal owner plus admins.
 */

import { getPrismaClient } from "@/dao/db/prisma";
import { notifyAdminsAsync } from "@/dao/notifications/notify-admins";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";
export async function processOverdueInvoices(limit = 100): Promise<{
  scanned: number;
  marked: number;
  notified: number;
}> {
  const prisma = getPrismaClient();
  const now = new Date();

  const due = await prisma.invoice.findMany({
    where: {
      status: "sent",
      dueAt: { lt: now },
    },
    orderBy: { dueAt: "asc" },
    take: Math.min(Math.max(limit, 1), 500),
    select: {
      id: true,
      number: true,
      organizationId: true,
      dealId: true,
      companyId: true,
      dueAt: true,
      company: { select: { name: true } },
      deal: {
        select: {
          id: true,
          title: true,
          contactId: true,
          contactName: true,
          ownerUserId: true,
        },
      },
    },
  });

  let marked = 0;
  let notified = 0;

  for (const invoice of due) {
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: "overdue" },
    });
    marked += 1;

    notifyAdminsAsync({
      kind: "invoice_overdue",
      organizationId: await resolveRequestOrganizationId(invoice.organizationId),
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      dealId: invoice.dealId,
      dealTitle: invoice.deal?.title ?? null,
      contactId: invoice.deal?.contactId ?? null,
      contactName: invoice.deal?.contactName ?? null,
      companyName: invoice.company?.name ?? null,
      ownerUserId: invoice.deal?.ownerUserId ?? null,
      href: `/finance/${invoice.id}`,
      detail: invoice.dueAt
        ? `Due ${invoice.dueAt.toLocaleDateString()}.`
        : null,
      excludeUserId: null,
    });
    notified += 1;
  }

  return { scanned: due.length, marked, notified };
}
