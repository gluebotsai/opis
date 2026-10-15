"use server";

import type { CampaignStatus, SourceChannel } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { requireCampaignSession } from "@/server/auth/login-action";

export type CampaignListItem = {
  id: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  startsAt: string | null;
  endsAt: string | null;
  sourceChannel: SourceChannel;
  createdAt: string;
};

function toItem(row: {
  id: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  startsAt: Date | null;
  endsAt: Date | null;
  sourceChannel: SourceChannel;
  createdAt: Date;
}): CampaignListItem {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    sourceChannel: row.sourceChannel,
    createdAt: row.createdAt.toISOString(),
  };
}

export type CreateCampaignInput = {
  name: string;
  description?: string | null;
  status?: CampaignStatus;
  startsAt?: string | null;
  endsAt?: string | null;
};

export async function createCampaign(
  input: CreateCampaignInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const session = await requireCampaignSession();
    const name = input.name.trim();
    if (!name) {
      return { ok: false, error: "Campaign name is required." };
    }

    const startsAt = input.startsAt ? new Date(input.startsAt) : null;
    const endsAt = input.endsAt ? new Date(input.endsAt) : null;
    if (startsAt && Number.isNaN(startsAt.getTime())) {
      return { ok: false, error: "Invalid start date." };
    }
    if (endsAt && Number.isNaN(endsAt.getTime())) {
      return { ok: false, error: "Invalid end date." };
    }
    if (startsAt && endsAt && endsAt < startsAt) {
      return { ok: false, error: "End date must be after start date." };
    }

    let status: CampaignStatus = input.status ?? "draft";
    if (!input.status) {
      const now = new Date();
      if (startsAt && startsAt > now) status = "scheduled";
      else if (startsAt && (!endsAt || endsAt >= now)) status = "live";
      else if (endsAt && endsAt < now) status = "completed";
    }

    const created = await prisma.campaign.create({
      data: {
        tenantId: session.tenantId,
        branchId: session.branchId,
        name,
        description: input.description?.trim() || null,
        status,
        startsAt,
        endsAt,
        sourceChannel: "standalone_campaign",
        createdByUserId: session.id,
      },
      select: { id: true },
    });

    return { ok: true, id: created.id };
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return { ok: false, error: "Please sign in again." };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to create campaign.",
    };
  }
}

export type MonitorBucket = "live" | "scheduled" | "past";

export async function listCampaignsByBucket(
  bucket: MonitorBucket,
): Promise<{ ok: true; items: CampaignListItem[] } | { ok: false; error: string }> {
  try {
    const session = await requireCampaignSession();

    const statusFilter: CampaignStatus[] =
      bucket === "live"
        ? ["live"]
        : bucket === "scheduled"
          ? ["scheduled", "draft"]
          : ["completed", "cancelled"];

    const rows = await prisma.campaign.findMany({
      where: {
        tenantId: session.tenantId,
        branchId: session.branchId,
        status: { in: statusFilter },
      },
      orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
      take: 100,
    });

    return { ok: true, items: rows.map(toItem) };
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return { ok: false, error: "Please sign in again." };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to list campaigns.",
    };
  }
}
