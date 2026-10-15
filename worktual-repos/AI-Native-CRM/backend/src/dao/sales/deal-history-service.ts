import type { AuditAction, Prisma } from "@prisma/client";
import { prisma } from "@/dao/db/prisma";
import { getUserLabelsByIds } from "@/service/account/user-directory";
import { DEAL_STAGE_LABELS } from "@/service/sales/stages";
import type { DealStage } from "@prisma/client";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";

export type DealHistoryEntry = {
  id: string;
  action: AuditAction;
  createdAt: string;
  actorUserId: string | null;
  actorLabel: string;
  summary: string;
};

type FieldChange = {
  field: string;
  label: string;
  from: string | null;
  to: string | null;
};

type AuditMeta = {
  kind?: string;
  fromStage?: string;
  toStage?: string;
  stage?: string;
  fromAmount?: string | null;
  toAmount?: string | null;
  fromOwnerUserId?: string | null;
  toOwnerUserId?: string | null;
  lostReason?: string | null;
  title?: string;
  changes?: FieldChange[];
};

function moneyLabel(raw: string | null | undefined): string {
  if (raw == null || raw === "") return "—";
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `$${Math.round(n).toLocaleString()}`;
  }
}

function stageLabel(stage: string | undefined): string {
  if (!stage) return "—";
  return DEAL_STAGE_LABELS[stage as DealStage] ?? stage.replace(/_/g, " ");
}

function displayValue(raw: string | null | undefined): string {
  const v = raw?.trim();
  return v ? v : "—";
}

function summarizeFieldChanges(
  scope: string,
  changes: FieldChange[] | undefined,
): string {
  if (!changes?.length) return `${scope} updated`;
  if (changes.length === 1) {
    const c = changes[0]!;
    return `${scope} ${c.label}: ${displayValue(c.from)} → ${displayValue(c.to)}`;
  }
  if (changes.length <= 3) {
    return `${scope}: ${changes
      .map(
        (c) =>
          `${c.label} ${displayValue(c.from)} → ${displayValue(c.to)}`,
      )
      .join(" · ")}`;
  }
  return `${scope} updated · ${changes.length} fields (${changes
    .map((c) => c.label)
    .join(", ")})`;
}

function summarize(
  action: AuditAction,
  meta: AuditMeta,
  ownerLabels: Map<string, string>,
): string {
  if (action === "create") {
    return `Deal created · ${stageLabel(meta.stage ?? "qualification")}`;
  }
  if (action === "stage_change") {
    const from = meta.fromStage ? stageLabel(meta.fromStage) : null;
    const to = stageLabel(meta.toStage ?? meta.stage);
    if (from) return `Stage ${from} → ${to}`;
    return `Stage → ${to}`;
  }
  if (action === "assign") {
    const from = meta.fromOwnerUserId
      ? ownerLabels.get(meta.fromOwnerUserId)?.split(" (")[0] ?? "Unassigned"
      : "Unassigned";
    const to = meta.toOwnerUserId
      ? ownerLabels.get(meta.toOwnerUserId)?.split(" (")[0] ?? "Unassigned"
      : "Unassigned";
    return `Owner ${from} → ${to}`;
  }
  if (action === "update" && meta.kind === "amount") {
    return `Amount ${moneyLabel(meta.fromAmount)} → ${moneyLabel(meta.toAmount)}`;
  }
  if (action === "update" && meta.kind === "contact") {
    return summarizeFieldChanges("Contact", meta.changes);
  }
  if (action === "update" && meta.kind === "company") {
    return summarizeFieldChanges("Company", meta.changes);
  }
  if (action === "update" && meta.kind === "location") {
    return summarizeFieldChanges("Location", meta.changes);
  }
  if (action === "update") {
    return "Deal updated";
  }
  return action.replace(/_/g, " ");
}

export async function writeDealRelatedEdits(input: {
  dealId: string;
  actorUserId?: string | null;
  organizationId?: string | null;
  kind: "contact" | "company" | "location";
  changes: FieldChange[];
}): Promise<void> {
  const changes = input.changes.filter(
    (c) => (c.from ?? "").trim() !== (c.to ?? "").trim(),
  );
  if (changes.length === 0) return;

  const { writeAuditLog } = await import("@/dao/audit/audit-log");
  await writeAuditLog({
    actorUserId: input.actorUserId,
    action: "update",
    entityType: "deal",
    entityId: input.dealId,
    organizationId: input.organizationId,
    meta: {
      kind: input.kind,
      changes,
    },
  });
}

export type { FieldChange };

export async function listDealHistory(
  dealId: string,
  options?: { organizationId?: string | null; limit?: number },
): Promise<DealHistoryEntry[]> {
  const organizationId = await resolveRequestOrganizationId(options?.organizationId);
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);

  const rows = await prisma.auditLog.findMany({
    where: {
      organizationId,
      entityType: "deal",
      entityId: dealId,
      action: { in: ["create", "update", "stage_change", "assign"] },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const actorIds = rows.map((r) => r.actorUserId);
  const ownerIdsFromMeta: string[] = [];
  for (const row of rows) {
    const meta = (row.meta ?? {}) as AuditMeta;
    if (meta.fromOwnerUserId) ownerIdsFromMeta.push(meta.fromOwnerUserId);
    if (meta.toOwnerUserId) ownerIdsFromMeta.push(meta.toOwnerUserId);
  }

  const labels = await getUserLabelsByIds([...actorIds, ...ownerIdsFromMeta]);

  return rows.map((row) => {
    const meta = (row.meta ?? {}) as AuditMeta;
    return {
      id: row.id,
      action: row.action,
      createdAt: row.createdAt.toISOString(),
      actorUserId: row.actorUserId,
      actorLabel: row.actorUserId
        ? labels.get(row.actorUserId) ?? "Unknown user"
        : "System",
      summary: summarize(row.action, meta, labels),
    };
  });
}

export type OpenDuplicateDeal = {
  id: string;
  title: string;
  stage: string;
  stageLabel: string;
  amount: string | null;
  companyName: string;
  contactId: string | null;
  contactName: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  matchOn: "company" | "contact" | "both";
};

export async function findOpenDuplicateDeals(input: {
  companyId?: string | null;
  contactId?: string | null;
  excludeDealId?: string | null;
  organizationId?: string | null;
}): Promise<OpenDuplicateDeal[]> {
  const companyId = input.companyId?.trim() || null;
  const contactId = input.contactId?.trim() || null;
  if (!companyId && !contactId) return [];

  const organizationId = await resolveRequestOrganizationId(input.organizationId);
  const or: Prisma.DealWhereInput[] = [];
  if (companyId) or.push({ companyId });
  if (contactId) or.push({ contactId });

  const deals = await prisma.deal.findMany({
    where: {
      organizationId,
      stage: { notIn: ["closed_won", "closed_lost"] },
      OR: or,
      ...(input.excludeDealId
        ? { id: { not: input.excludeDealId } }
        : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 8,
    include: {
      company: { select: { name: true } },
    },
  });

  const ownerLabels = await getUserLabelsByIds(deals.map((d) => d.ownerUserId));

  return deals.map((d) => {
    const onCompany = Boolean(companyId && d.companyId === companyId);
    const onContact = Boolean(contactId && d.contactId === contactId);
    const matchOn: OpenDuplicateDeal["matchOn"] =
      onCompany && onContact ? "both" : onContact ? "contact" : "company";
    return {
      id: d.id,
      title: d.title,
      stage: d.stage,
      stageLabel: DEAL_STAGE_LABELS[d.stage] ?? d.stage,
      amount: d.amount?.toString() ?? null,
      companyName: d.company.name,
      contactId: d.contactId,
      contactName: d.contactName,
      ownerUserId: d.ownerUserId,
      ownerName: d.ownerUserId
        ? ownerLabels.get(d.ownerUserId)?.split(" (")[0] ?? null
        : null,
      matchOn,
    };
  });
}
