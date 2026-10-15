// @ts-nocheck
import { prisma } from "../plugins/prisma.js";

export async function hasDailyReportBeenSent(input: {
  organizationId: string;
  userId: string;
  reportDate: string;
}): Promise<boolean> {
  const row = await prisma.dailyReportEmailDelivery.findUnique({
    where: {
      organizationId_userId_reportDate: {
        organizationId: input.organizationId,
        userId: input.userId,
        reportDate: input.reportDate,
      },
    },
    select: { id: true, status: true },
  });
  return Boolean(row && row.status === "sent");
}

export async function recordDailyReportDelivery(input: {
  organizationId: string;
  userId: string;
  reportDate: string;
  timezone: string;
  recipientEmail: string;
  status: "sent" | "failed";
  providerId?: string | null;
  errorMessage?: string | null;
}) {
  return prisma.dailyReportEmailDelivery.upsert({
    where: {
      organizationId_userId_reportDate: {
        organizationId: input.organizationId,
        userId: input.userId,
        reportDate: input.reportDate,
      },
    },
    create: {
      organizationId: input.organizationId,
      userId: input.userId,
      reportDate: input.reportDate,
      timezone: input.timezone,
      recipientEmail: input.recipientEmail,
      status: input.status,
      providerId: input.providerId ?? null,
      errorMessage: input.errorMessage ?? null,
    },
    update: {
      timezone: input.timezone,
      recipientEmail: input.recipientEmail,
      status: input.status,
      providerId: input.providerId ?? null,
      errorMessage: input.errorMessage ?? null,
      sentAt: new Date(),
    },
  });
}
