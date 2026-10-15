/**
 * Framework-agnostic deal commands for Fastify Wave 5A.
 */

import {
  createActivity,
  createDeal,
  deleteActivity,
  deleteDeal,
  getDeal,
  listContractsForDeal,
  listDeals,
  listDealsForBoard,
  updateDeal,
  updateDealStage,
  type ActivityInput,
  type DealInput,
} from "@/dao/sales/deal-service";
import {
  findOpenDuplicateDeals,
  listDealHistory,
  type OpenDuplicateDeal,
} from "@/dao/sales/deal-history-service";
import { DEAL_STAGE_LABELS, DEAL_STAGES, normalizeDealStage } from "@/service/sales/stages";
import { getServerUserId } from "@/service/account/session-cookie";
import { getUserLabelsByIds } from "@/service/account/user-directory";
import { canEditDeals } from "@/service/auth/rbac";
import {
  assertRecordAccess,
  resolveRecordOwnerScope,
} from "@/service/auth/ownership-scope";
import {
  getCurrentOrganizationId,
  getCurrentUserRole,
  requireModuleEnabled,
  requireRole,
} from "@/service/auth/require-role";
import { loadDealAmountCurrencies } from "@/service/sales/deal-amount-currency";
import { buildExportFile, type ContactExportFormat } from "@/lib/csv";
import {
  getCompany,
  listCompaniesForSelect,
} from "@/dao/companies/company-service";
import { listContactActivities } from "@/dao/contacts/contact-activity-service";
import {
  getContact,
  listContactsForSelect,
} from "@/dao/contacts/contact-service";
import { listProposalsForDeal } from "@/dao/sales/proposal-service";
import { listQuotes } from "@/dao/sales/quote-service";
import { notifyAdminsAsync } from "@/dao/notifications/notify-admins";

export type CommandResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/**
 * Role AND business-type gate for every deal mutation. B2C orgs never have
 * `sales` enabled (Commerce revenue path only) — a B2C admin/sales_manager
 * still passes `canEditDeals` on role alone, so the module gate must be
 * checked here too.
 */
async function requireDealsEdit(message: string) {
  await requireRole(canEditDeals, message);
  await requireModuleEnabled("sales", message);
}

type DealStage = (typeof DEAL_STAGES)[number];

function mapDealRow(
  deal: {
    id: string;
    title: string;
    stage: DealStage;
    amount: { toString(): string } | null;
    contactId: string | null;
    contactName: string | null;
    contactEmail: string | null;
    ownerUserId: string | null;
    notes: string | null;
    expectedCloseDate: Date | null;
    companyId: string;
    locationId: string;
    company: { name: string };
    location: { name: string };
    updatedAt: Date;
    forecastCategory?: string | null;
    forecastConfidencePercent?: number | null;
    forecastFlagged?: boolean;
    forecastReason?: string | null;
  },
  ownerLabels: Map<string, string>,
  amountCurrency: string | null = null,
) {
  return {
    id: deal.id,
    title: deal.title,
    stage: deal.stage,
    amount: deal.amount?.toString() ?? null,
    amountCurrency,
    contactId: deal.contactId,
    contactName: deal.contactName,
    contactEmail: deal.contactEmail,
    ownerUserId: deal.ownerUserId,
    ownerName: deal.ownerUserId
      ? (ownerLabels.get(deal.ownerUserId) ?? null)
      : null,
    expectedCloseDate: deal.expectedCloseDate?.toISOString() ?? null,
    companyId: deal.companyId,
    locationId: deal.locationId,
    companyName: deal.company.name,
    locationName: deal.location.name,
    notes: deal.notes,
    updatedAt: deal.updatedAt.toISOString(),
    forecastCategory: deal.forecastCategory ?? null,
    forecastConfidencePercent: deal.forecastConfidencePercent ?? null,
    forecastFlagged: Boolean(deal.forecastFlagged),
    forecastReason: deal.forecastReason ?? null,
  };
}

export async function listDealsBoardCommand(search?: string) {
  await requireModuleEnabled("sales", "Sales is not available for your business type.");
  const scope = await resolveRecordOwnerScope();
  const columns = await listDealsForBoard(search, scope.ownerUserId);
  const allOwnerIds = columns.flatMap((c) =>
    c.deals.map((d) => d.ownerUserId),
  );
  const ownerLabels = await getUserLabelsByIds(allOwnerIds);
  const amountCurrencies = await loadDealAmountCurrencies(
    await getCurrentOrganizationId(),
    columns.flatMap((col) => col.deals.map((deal) => deal.id)),
  );
  return {
    columns: columns.map((col) => ({
      stage: col.stage,
      total: col.total,
      deals: col.deals.map((d) =>
        mapDealRow(d, ownerLabels, amountCurrencies.get(d.id) ?? null),
      ),
    })),
  };
}

export async function listDealsCommand(filters: {
  page?: number;
  pageSize?: number;
  search?: string;
  stage?: string;
  companyId?: string | null;
}) {
  await requireModuleEnabled("sales", "Sales is not available for your business type.");
  const scope = await resolveRecordOwnerScope();
  const stage =
    filters.stage && DEAL_STAGES.includes(filters.stage as DealStage)
      ? (filters.stage as DealStage)
      : "all";
  const result = await listDeals({
    page: filters.page ?? 1,
    pageSize: filters.pageSize ?? 20,
    search: filters.search,
    stage,
    ownerUserId: scope.ownerUserId,
    companyId: filters.companyId ?? null,
  });
  const ownerLabels = await getUserLabelsByIds(
    result.items.map((d) => d.ownerUserId),
  );
  const amountCurrencies = await loadDealAmountCurrencies(
    await getCurrentOrganizationId(),
    result.items.map((deal) => deal.id),
  );
  return {
    items: result.items.map((d) =>
      mapDealRow(d, ownerLabels, amountCurrencies.get(d.id) ?? null),
    ),
    pagination: result.pagination,
  };
}

const MAX_DEAL_EXPORT_ROWS = 5000;

export type DealExportFormat = ContactExportFormat;

function isDealExportFormat(value: string): value is DealExportFormat {
  return (
    value === "csv" ||
    value === "tsv" ||
    value === "json" ||
    value === "xlsx" ||
    value === "txt"
  );
}

export type ExportDealsResult =
  | {
      ok: true;
      content: string;
      filename: string;
      mimeType: string;
      count: number;
      truncated: boolean;
    }
  | { ok: false; error: string };

/** Export deals matching the current pipeline filters (ownership-scoped). Shared by Next + Fastify. */
export async function exportDealsCommand(filters: {
  search?: string;
  stage?: string;
  ownerUserId?: string;
  format?: string;
}): Promise<ExportDealsResult> {
  try {
    const format: DealExportFormat = isDealExportFormat(filters.format ?? "csv")
      ? (filters.format as DealExportFormat)
      : "csv";

    const [scope, role] = await Promise.all([
      resolveRecordOwnerScope(),
      getCurrentUserRole(),
    ]);

    const search = filters.search?.trim() || undefined;
    const stageRaw = filters.stage?.trim();
    const stage =
      stageRaw && stageRaw !== "all" && DEAL_STAGES.includes(stageRaw as DealStage)
        ? (stageRaw as DealStage)
        : "all";

    const filterOwner =
      filters.ownerUserId?.trim() && filters.ownerUserId !== "all"
        ? filters.ownerUserId.trim()
        : undefined;
    // Own-only roles stay scoped; org-wide roles may further filter by owner.
    const ownerUserId = scope.ownerUserId ?? filterOwner;
    const includeOwner = role === "admin";

    type DealRow = Awaited<ReturnType<typeof listDeals>>["items"][number];
    const collected: DealRow[] = [];
    let page = 1;
    let truncated = false;

    while (collected.length < MAX_DEAL_EXPORT_ROWS) {
      const result = await listDeals({
        page,
        pageSize: 100,
        search,
        stage,
        ownerUserId,
      });
      collected.push(...result.items);
      if (!result.pagination.hasNext || result.items.length === 0) break;
      if (collected.length >= MAX_DEAL_EXPORT_ROWS) {
        truncated = collected.length < result.pagination.total;
        break;
      }
      page += 1;
    }

    if (collected.length > MAX_DEAL_EXPORT_ROWS) {
      collected.length = MAX_DEAL_EXPORT_ROWS;
      truncated = true;
    }

    const ownerLabels = includeOwner
      ? await getUserLabelsByIds(collected.map((d) => d.ownerUserId))
      : null;

    const headers = [
      "Deal",
      "Stage",
      "Amount",
      "Company",
      "Location",
      "Contact",
      "Contact email",
      ...(includeOwner ? ["Owner"] : []),
      "Expected close",
      "Updated",
      "Notes",
    ];

    const rows = collected.map((deal) => {
      const ownerRaw =
        includeOwner && deal.ownerUserId
          ? (ownerLabels?.get(deal.ownerUserId) ?? "")
          : "";
      const ownerName = ownerRaw.includes(" (")
        ? ownerRaw.slice(0, ownerRaw.indexOf(" ("))
        : ownerRaw;

      return [
        deal.title,
        DEAL_STAGE_LABELS[deal.stage] ?? deal.stage,
        deal.amount?.toString() ?? "",
        deal.company.name,
        deal.location.name,
        deal.contactName ?? "",
        deal.contactEmail ?? "",
        ...(includeOwner ? [ownerName] : []),
        deal.expectedCloseDate
          ? deal.expectedCloseDate.toISOString().slice(0, 10)
          : "",
        deal.updatedAt.toISOString(),
        deal.notes ?? "",
      ];
    });

    const stamp = new Date().toISOString().slice(0, 10);
    const baseName = `deals-export-${stamp}`;
    const file = buildExportFile(format, { headers, rows }, baseName, "Deals");

    return {
      ok: true,
      content: file.content,
      filename: file.filename,
      mimeType: file.mimeType,
      count: collected.length,
      truncated,
    };
  } catch (err) {
    console.error("exportDealsCommand failed", err);
    return { ok: false, error: "Could not export deals. Try again." };
  }
}

export async function getDealCommand(id: string) {
  try {
    await requireModuleEnabled("sales", "Sales is not available for your business type.");
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : "Forbidden",
      status: 403 as const,
    };
  }
  const deal = await getDeal(id);
  if (!deal) {
    return { ok: false as const, error: "Deal not found.", status: 404 as const };
  }
  try {
    await assertRecordAccess(deal.ownerUserId);
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : "Forbidden",
      status: 403 as const,
    };
  }

  const [contact, company, contracts, proposals, quotes, contactActivities] =
    await Promise.all([
      deal.contactId ? getContact(deal.contactId) : Promise.resolve(null),
      getCompany(deal.companyId),
      listContractsForDeal(id),
      listProposalsForDeal(id),
      listQuotes({ page: 1, dealId: id }),
      deal.contactId
        ? listContactActivities(deal.contactId)
        : Promise.resolve([]),
    ]);

  const ownerLabels = await getUserLabelsByIds([
    deal.ownerUserId,
    contact?.crm.ownerUserId,
    company?.ownerUserId,
  ]);

  return {
    ok: true as const,
    deal: {
      id: deal.id,
      title: deal.title,
      stage: deal.stage,
      amount: deal.amount?.toString() ?? null,
      amountCurrency: (
        await loadDealAmountCurrencies(String(deal.organizationId), [deal.id])
      ).get(deal.id) ?? null,
      contactId: deal.contactId,
      contactName: deal.contactName,
      contactEmail: deal.contactEmail,
      contactPhone: contact?.person.phone ?? null,
      ownerUserId: deal.ownerUserId,
      ownerName: deal.ownerUserId
        ? (ownerLabels.get(deal.ownerUserId) ?? null)
        : null,
      notes: deal.notes,
      expectedCloseDate: deal.expectedCloseDate?.toISOString() ?? null,
      companyId: deal.companyId,
      locationId: deal.locationId,
      companyName: deal.company.name,
      locationName: deal.location.name,
      locationType: deal.location.type,
      company: deal.company,
      location: deal.location,
      activities: deal.activities.map((a) => ({
        id: a.id,
        type: a.type,
        subject: a.subject,
        body: a.body,
        dueAt: a.dueAt?.toISOString() ?? null,
        createdAt: a.createdAt.toISOString(),
      })),
      contracts: contracts.map((c) => ({
        id: c.id,
        title: c.title,
        startsAt: c.startsAt.toISOString(),
        endsAt: c.endsAt?.toISOString() ?? null,
        arr: c.arr?.toString() ?? null,
      })),
      updatedAt: deal.updatedAt.toISOString(),
      createdAt: deal.createdAt.toISOString(),
    },
    contact: contact
      ? {
          id: contact.id,
          displayName: contact.displayName,
          email: contact.person.email,
          phone: contact.person.phone,
          secondaryEmails: contact.person.secondaryEmails ?? [],
          secondaryPhones: contact.person.secondaryPhones ?? [],
          title: contact.person.title,
          addressLine: contact.person.addressLine,
          city: contact.person.city,
          country: contact.person.country,
          ownerName: contact.crm.ownerUserId
            ? (ownerLabels.get(contact.crm.ownerUserId) ??
              contact.crm.ownerUserId)
            : null,
        }
      : null,
    company: company
      ? {
          id: company.id,
          name: company.name,
          domain: company.domain,
          industry: company.industry,
          employeeCount: company.employeeCount,
          ownerName: company.ownerUserId
            ? (ownerLabels.get(company.ownerUserId) ?? company.ownerUserId)
            : null,
        }
      : {
          id: deal.companyId,
          name: deal.company.name,
          domain: null as string | null,
          industry: null as string | null,
          employeeCount: null as number | null,
          ownerName: null as string | null,
        },
    proposalCount: proposals.length,
    quoteCount: quotes.items.length,
    contactActivities: contactActivities.map((a) => ({
      id: a.id,
      type: a.type,
      subject: a.subject,
      body: a.body,
      dueAt: a.dueAt,
      createdAt: a.createdAt,
      transcriptText: a.transcriptText,
      transcriptSource: a.transcriptSource,
      disposition: a.disposition,
    })),
  };
}

export async function listDealHistoryCommand(
  dealId: string,
): Promise<
  | { ok: true; items: Awaited<ReturnType<typeof listDealHistory>> }
  | { ok: false; error: string }
> {
  try {
    const deal = await getDeal(dealId);
    if (!deal) return { ok: false, error: "Deal not found." };
    await assertRecordAccess(deal.ownerUserId);
    const items = await listDealHistory(dealId, {
      organizationId: deal.organizationId,
    });
    return { ok: true, items };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load deal history.",
    };
  }
}

export async function createDealActivityCommand(
  dealId: string,
  input: {
    type: string;
    subject: string;
    body?: string | null;
    dueAt?: string | null;
  },
): Promise<CommandResult> {
  try {
    await requireDealsEdit("You do not have permission to log activities.");
    const existing = await getDeal(dealId);
    if (!existing) return { ok: false, error: "Deal not found." };
    await assertRecordAccess(existing.ownerUserId);

    const activityInput: ActivityInput = {
      type: input.type as ActivityInput["type"],
      subject: input.subject,
      body: input.body ?? null,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
    };
    const activity = await createActivity(dealId, activityInput);
    const actorUserId = await getServerUserId();
    notifyAdminsAsync({
      kind: "lead_activity",
      actorUserId,
      dealId,
      dealTitle: existing.title,
      contactId: existing.contactId,
      contactName: existing.contactName,
      companyName: existing.company?.name ?? null,
      ownerUserId: existing.ownerUserId,
      activityType: activity.type,
      activitySubject: activity.subject,
      href: `/sales/${dealId}`,
    });
    return { ok: true, id: activity.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to create activity.",
    };
  }
}

export async function deleteDealActivityCommand(
  dealId: string,
  activityId: string,
): Promise<CommandResult> {
  try {
    await requireDealsEdit("You do not have permission to delete activities.");
    const existing = await getDeal(dealId);
    if (!existing) return { ok: false, error: "Deal not found." };
    await assertRecordAccess(existing.ownerUserId);
    await deleteActivity(dealId, activityId);
    return { ok: true, id: activityId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to delete activity.",
    };
  }
}

export async function getDealFormOptionsCommand() {
  const [companies, contacts] = await Promise.all([
    listCompaniesForSelect(),
    listContactsForSelect(),
  ]);
  return {
    companies: companies.map((c) => ({
      id: c.id,
      name: c.name,
      industry: c.industry,
      locations: c.locations,
    })),
    contacts,
    stages: DEAL_STAGES,
  };
}

function bodyToDealInput(body: Record<string, unknown>): DealInput {
  const stageRaw = typeof body.stage === "string" ? body.stage : "qualification";
  const stage = normalizeDealStage(stageRaw) ?? "qualification";
  let amount: number | null = null;
  if (body.amount !== null && body.amount !== undefined && body.amount !== "") {
    const n = Number(body.amount);
    amount = Number.isFinite(n) ? n : null;
  }
  let expectedCloseDate: Date | null = null;
  if (typeof body.expectedCloseDate === "string" && body.expectedCloseDate) {
    const d = new Date(
      body.expectedCloseDate.includes("T")
        ? body.expectedCloseDate
        : `${body.expectedCloseDate}T12:00:00`,
    );
    expectedCloseDate = Number.isNaN(d.getTime()) ? null : d;
  }
  return {
    title: String(body.title ?? ""),
    stage,
    amount,
    companyId: String(body.companyId ?? ""),
    locationId: String(body.locationId ?? ""),
    contactId: body.contactId ? String(body.contactId) : null,
    notes: body.notes ? String(body.notes) : null,
    expectedCloseDate,
  };
}

export async function checkDuplicateDealsCommand(input: {
  companyId?: string | null;
  contactId?: string | null;
  excludeDealId?: string | null;
}): Promise<
  { ok: true; matches: OpenDuplicateDeal[] } | { ok: false; error: string }
> {
  try {
    await requireDealsEdit("You do not have permission to create deals.");
    const matches = await findOpenDuplicateDeals({
      companyId: input.companyId,
      contactId: input.contactId,
      excludeDealId: input.excludeDealId,
    });
    return { ok: true, matches };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to check for duplicate deals.",
    };
  }
}

export async function createDealCommand(
  body: Record<string, unknown>,
): Promise<CommandResult> {
  try {
    await requireDealsEdit("You do not have permission to create deals.");
    const input = bodyToDealInput(body);
    if (!input.title.trim()) return { ok: false, error: "Deal title is required." };
    if (!input.companyId) return { ok: false, error: "Company is required." };
    if (!input.locationId) return { ok: false, error: "Location is required." };

    const ownerUserId = await getServerUserId();
    const deal = await createDeal(
      { ...input, ownerUserId },
      { actorUserId: ownerUserId },
    );
    notifyAdminsAsync({
      kind: "deal_created",
      actorUserId: ownerUserId,
      dealId: deal.id,
      dealTitle: deal.title,
      contactId: deal.contactId,
      contactName: deal.contactName,
      ownerUserId,
      href: `/sales/${deal.id}`,
    });
    return { ok: true, id: deal.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to create deal.",
    };
  }
}

export async function updateDealCommand(
  id: string,
  body: Record<string, unknown>,
): Promise<CommandResult> {
  try {
    await requireDealsEdit("You do not have permission to edit deals.");
    const existing = await getDeal(id);
    if (!existing) return { ok: false, error: "Deal not found." };
    await assertRecordAccess(existing.ownerUserId);

    const input = bodyToDealInput(body);
    if (!input.title.trim()) return { ok: false, error: "Deal title is required." };
    if (!input.companyId) return { ok: false, error: "Company is required." };
    if (!input.locationId) return { ok: false, error: "Location is required." };

    const actorUserId = await getServerUserId();
    const deal = await updateDeal(id, input, { actorUserId });
    return { ok: true, id: deal.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to update deal.",
    };
  }
}

export async function updateDealStageCommand(
  id: string,
  stage: string,
  options?: { lostReason?: string | null },
): Promise<CommandResult & { wonExtras?: unknown }> {
  try {
    await requireDealsEdit("You do not have permission to edit deals.");
    const existing = await getDeal(id);
    if (!existing) return { ok: false, error: "Deal not found." };
    await assertRecordAccess(existing.ownerUserId);

    const resolvedStage = normalizeDealStage(stage);
    if (!resolvedStage) {
      return { ok: false, error: "Invalid stage." };
    }
    const actorUserId = await getServerUserId();
    const { deal, wonExtras } = await updateDealStage(id, resolvedStage, {
      lostReason: options?.lostReason,
      actorUserId,
    });
    if (existing.stage !== resolvedStage) {
      const kind =
        resolvedStage === "closed_won"
          ? "deal_won"
          : resolvedStage === "closed_lost"
            ? "deal_lost"
            : "deal_stage_changed";
      notifyAdminsAsync({
        kind,
        actorUserId,
        dealId: deal.id,
        dealTitle: deal.title,
        contactId: deal.contactId,
        contactName: deal.contactName ?? existing.contactName,
        companyName: existing.company?.name ?? null,
        ownerUserId: deal.ownerUserId ?? existing.ownerUserId,
        stage: resolvedStage,
        href: `/sales/${deal.id}`,
        detail:
          resolvedStage === "closed_lost" && options?.lostReason
            ? `Lost reason: ${options.lostReason}`
            : undefined,
      });
      try {
        const { emitCrmPlatformEvent } = await import(
          "@/lib/crm-platform-events"
        );
        emitCrmPlatformEvent({
          type: "deal.stage_changed",
          organizationId: existing.organizationId,
          cdpId: deal.contactId,
          entityType: "deal",
          entityId: deal.id,
          payload: { from: existing.stage, to: resolvedStage },
        });
      } catch {
        /* optional */
      }
    }
    return { ok: true, id: deal.id, wonExtras };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to update stage.",
    };
  }
}

export async function deleteDealCommand(id: string): Promise<CommandResult> {
  try {
    await requireDealsEdit("You do not have permission to delete deals.");
    const existing = await getDeal(id);
    if (!existing) return { ok: false, error: "Deal not found." };
    await assertRecordAccess(existing.ownerUserId);
    await deleteDeal(id);
    return { ok: true, id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to delete deal.",
    };
  }
}

