/**
 * Agentic page turn — thin pass-through to Python crm-agent orchestrator.
 * Friendly error when ai-service is unavailable.
 */

import {
  lastUserText,
  coworkerFailureSpeech,
  type CoworkerMessage,
} from "@/service/ai/coworker-shared";
import { callAiServiceAgent, AI_SERVICE_JOB_TIMEOUT_MS } from "@/service/ai/ai-service-client";
import { coworkerExecutionMode } from "@/service/ai/coworker-execution-mode";
import { getServerUserId } from "@/service/account/session-cookie";
import {
  getCurrentBusinessType,
  getCurrentOrganizationId,
  getCurrentUserRole,
} from "@/service/auth/require-role";
import { getCompanyFormOptionsCommand } from "@/service/companies/company-commands";
import { getContactFormOptionsCommand } from "@/service/contacts/contact-commands";
import { getDealFormOptionsCommand } from "@/service/sales/deal-commands";
import { getQuoteFormOptionsCommand } from "@/service/sales/quote-commands";
import { getInvoiceCreateOptionsCommand } from "@/service/finance/invoice-commands";
import type { ExecutionIds } from "@/service/ai/execution-context";
import { effectiveContactType } from "@/lib/contact-lifecycle";
import { enrichActivitiesCreateCatalog } from "@/service/ai/coworker-activity-catalog";

export type AgentTurnContext = {
  module?: string | null;
  surface?: string | null;
  entityId?: string | null;
  pathname?: string | null;
  draft?: Record<string, unknown> | null;
  sessionMemory?: Record<string, unknown> | null;
};

export type AgentToolProposal = {
  id: string;
  name: string;
  label: string;
  args: Record<string, unknown>;
  risk: "low" | "high";
};

async function enrichOpenProduct(
  catalog: Record<string, unknown>,
  entityId: string | null | undefined,
): Promise<void> {
  const id = typeof entityId === "string" ? entityId.trim() : "";
  if (!id) return;
  try {
    const { getProduct } = await import("@/dao/products/product-service");
    const product = await getProduct(id);
    if (!product) return;
    catalog.openProduct = {
      id: product.id,
      name: product.name,
      sku: product.sku,
      price: product.price,
      currency: product.currency ?? null,
      category: product.category ?? null,
      description: product.description ?? null,
      status: product.status,
    };
  } catch {
    // open product optional
  }
}

async function enrichOpenCompany(
  catalog: Record<string, unknown>,
  entityId: string | null | undefined,
): Promise<void> {
  const id = typeof entityId === "string" ? entityId.trim() : "";
  if (!id) return;
  try {
    const { getCompany } = await import("@/dao/companies/company-service");
    const company = await getCompany(id);
    if (!company) return;
    catalog.openCompany = {
      id: company.id,
      name: company.name,
      domain: company.domain ?? null,
      industry: company.industry ?? null,
      employeeCount: company.employeeCount ?? null,
      linkedinUrl: company.linkedinUrl ?? null,
    };
  } catch {
    // open company optional
  }
}

async function enrichOpenContact(
  catalog: Record<string, unknown>,
  entityId: string | null | undefined,
): Promise<void> {
  const id = typeof entityId === "string" ? entityId.trim() : "";
  if (!id) return;
  try {
    const { getContact } = await import("@/dao/contacts/contact-service");
    const view = await getContact(id);
    if (!view) return;
    const person = view.person;
    const emails = [person.email, ...(person.secondaryEmails ?? [])]
      .map((value) => String(value ?? "").trim())
      .filter(
        (value, index, all) =>
          value.includes("@") &&
          all.findIndex((item) => item.toLowerCase() === value.toLowerCase()) ===
            index,
      );
    const linkedLocationId = person.locationId?.trim() || null;
    catalog.openContact = {
      id: view.id,
      displayName: view.displayName,
      firstName: person.firstName,
      lastName: person.lastName,
      email: person.email,
      emails,
      secondaryEmails: person.secondaryEmails ?? [],
      phone: person.phone ?? null,
      secondaryPhones: person.secondaryPhones ?? [],
      title: person.title ?? null,
      notes: person.notes ?? null,
      city: person.city ?? null,
      country: person.country ?? null,
      addressLine: person.addressLine ?? null,
      companyId: person.companyId ?? null,
      companyName: person.company?.name || person.companyName || null,
      locationId: linkedLocationId,
      contactType: effectiveContactType(person.contactType),
      leadStatus: person.leadStatus ?? null,
      status: person.status ?? null,
    };
    const companyId = person.companyId?.trim();
    if (companyId) {
      try {
        const { getCompany } = await import("@/dao/companies/company-service");
        const company = await getCompany(companyId);
        if (company) {
          catalog.openCompany = {
            id: company.id,
            name: company.name,
            domain: company.domain ?? null,
            industry: company.industry ?? null,
            employeeCount: company.employeeCount ?? null,
            linkedinUrl: company.linkedinUrl ?? null,
          };
          const locations = Array.isArray(company.locations)
            ? company.locations
            : [];
          const linked =
            locations.find((loc) => loc.id === linkedLocationId) ??
            locations[0] ??
            null;
          if (linked) {
            catalog.openCompanyLocation = {
              id: linked.id,
              name: linked.name,
              city: linked.city ?? null,
              address: linked.address ?? null,
              type: linked.type ?? null,
            };
            if (!linkedLocationId) {
              (catalog.openContact as Record<string, unknown>).locationId =
                linked.id;
            }
          }
        }
      } catch {
        // company optional
      }
    }
  } catch {
    // open contact optional
  }
}

function extractEmailFromUserText(text: string | null | undefined): string | null {
  const raw = text?.trim() ?? "";
  if (!raw) return null;
  const match = raw.match(/[\w.+-]+@[\w.-]+\.\w+/);
  return match?.[0]?.toLowerCase() ?? null;
}

async function enrichCatalog(
  mod: string,
  catalog: Record<string, unknown>,
  entityId?: string | null,
  userText?: string | null,
  sessionMemory?: Record<string, unknown> | null,
): Promise<void> {
  try {
    if (mod === "contact") {
      const options = await getContactFormOptionsCommand();
      if (options.ok) {
        catalog.companies = (options.companies ?? []).map((c) => ({
          id: c.id,
          name: c.name,
          locations: (c.locations ?? []).map((l) => ({
            id: l.id,
            name: l.name,
          })),
        }));
      }
      try {
        const { listContactsForSelect } = await import(
          "@/dao/contacts/contact-service"
        );
        const contacts = await listContactsForSelect({ limit: 200 });
        catalog.contacts = contacts.map((c) => ({
          id: c.id,
          displayName: c.displayName,
          email: c.email,
          companyId: c.companyId,
        }));
      } catch {
        // optional for open/edit matching
      }
      const emailQuery = extractEmailFromUserText(userText);
      if (emailQuery) {
        try {
          const organizationId = String(catalog.organizationId ?? "").trim();
          if (organizationId) {
            const { findCrmContactIdByEmail } = await import(
              "@/dao/inbox/contact-by-email"
            );
            const { getContact } = await import("@/dao/contacts/contact-service");
            const contactId = await findCrmContactIdByEmail(
              emailQuery,
              organizationId,
            );
            if (contactId) {
              const contact = await getContact(contactId);
              if (contact) {
                const rows = Array.isArray(catalog.contacts)
                  ? (catalog.contacts as Array<Record<string, unknown>>)
                  : [];
                const exists = rows.some((row) => String(row.id) === contactId);
                if (!exists) {
                  catalog.contacts = [
                    {
                      id: contact.id,
                      displayName: contact.displayName,
                      email: contact.person.email,
                      companyId: contact.person.companyId,
                    },
                    ...rows,
                  ];
                }
              }
            }
          }
        } catch {
          // optional email lookup for find/open matching
        }
      }
      await enrichOpenContact(catalog, entityId);
      const stm = sessionMemory ?? {};
      const slots =
        stm.slots && typeof stm.slots === "object"
          ? (stm.slots as Record<string, unknown>)
          : {};
      const pending = slots.pendingDuplicateContacts;
      if (Array.isArray(pending) && pending.length > 0) {
        catalog.pendingDuplicateContacts = pending
          .filter(
            (row): row is Record<string, unknown> =>
              Boolean(row) && typeof row === "object" && typeof (row as { id?: unknown }).id === "string",
          )
          .map((row) => ({
            id: String(row.id),
            displayName: String(row.displayName ?? ""),
            email: String(row.email ?? ""),
            phone: row.phone == null ? null : String(row.phone),
            companyName: row.companyName == null ? null : String(row.companyName),
          }));
      }
      return;
    }
    if (mod === "sales" || mod === "activities") {
      const options = await getDealFormOptionsCommand();
      catalog.companies = (options.companies ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        locations: (c.locations ?? []).map((l) => ({
          id: l.id,
          name: l.name,
          type: l.type,
        })),
      }));
      catalog.contacts = (options.contacts ?? []).map((c) => ({
        id: c.id,
        displayName: c.displayName,
        email: c.email,
        companyId: c.companyId,
      }));
      if (mod === "sales") {
        try {
          const { listDealsForSelect } = await import(
            "@/dao/sales/deal-service"
          );
          const deals = await listDealsForSelect({ limit: 200 });
          catalog.deals = deals.map((d) => ({
            id: d.id,
            title: d.title,
            stage: d.stage,
            companyName: d.company?.name ?? "",
            contactName: d.contactName ?? "",
          }));
        } catch {
          // optional for open/edit matching
        }
        try {
          const { listProductsForSelect } = await import(
            "@/dao/products/product-service"
          );
          catalog.products = await listProductsForSelect(200);
        } catch {
          // optional for proposal product matching
        }
        try {
          const { canAssignDealOwner, normalizeRole } = await import(
            "@/service/auth/rbac"
          );
          const canAssign = canAssignDealOwner(
            normalizeRole(String(catalog.role ?? "")),
          );
          catalog.canAssignOwner = canAssign;
          if (canAssign) {
            const { listAssignableUsers } = await import(
              "@/service/account/user-directory"
            );
            const users = await listAssignableUsers();
            catalog.assignableUsers = users
              .filter((u) => u.id && u.label)
              .map((u) => ({ id: u.id, label: u.label }));
          }
        } catch {
          // Role stays unknown; the agent must not invent a reassign.
        }
        // Open proposal page: entityId is proposal id — load deal + meetings via proposal.
        if (entityId) {
          try {
            const { getProposal } = await import("@/dao/sales/proposal-service");
            const openProp = await getProposal(entityId);
            if (openProp?.dealId) {
              const { getDeal } = await import("@/dao/sales/deal-service");
              const { prisma } = await import("@/dao/db/prisma");
              const { parseProposalSections } = await import(
                "@/lib/proposal-sections"
              );
              const { parseBlueprintAssets, parseDocumentBlueprint } = await import(
                "@/lib/document-blueprint"
              );
              const { extractFullCloneVisibleText } = await import(
                "@/service/sales/document-clone-personalize"
              );
              const { isProposalDocHtml, sectionsFromProposalDocHtml } = await import(
                "@/lib/proposal-doc-html"
              );
              const { repairMarkdownEmphasisInHtml } = await import(
                "@/lib/template-edit-patch"
              );
              const deal = await getDeal(openProp.dealId);
              const blueprint = parseDocumentBlueprint(openProp.blueprint);
              if (blueprint?.html) {
                blueprint.html = repairMarkdownEmphasisInHtml(blueprint.html);
              }
              const assets = parseBlueprintAssets(openProp.assets);
              const jsonSections = parseProposalSections(openProp.sections);
              const htmlSections =
                blueprint?.html && isProposalDocHtml(blueprint.html)
                  ? sectionsFromProposalDocHtml(blueprint.html, jsonSections)
                  : jsonSections;
              const visibleText =
                extractFullCloneVisibleText(blueprint, assets, 12_000) ||
                htmlSections
                  .map((s) => `${s.title}\n${s.body ?? ""}`.trim())
                  .filter(Boolean)
                  .join("\n\n")
                  .slice(0, 12_000);
              catalog.openProposal = {
                id: openProp.id,
                dealId: openProp.dealId,
                number: openProp.number,
                title: openProp.title,
                customerName: openProp.customerName ?? null,
                dealTitle: deal?.title ?? null,
                status: openProp.status,
                isPageClone: (() => {
                  const mode = String(blueprint?.mode || "");
                  return mode === "page-clone";
                })(),
                visibleText,
                sections: htmlSections.map((s) => ({
                  key: s.key,
                  title: s.title,
                  ...(visibleText
                    ? {}
                    : { bodyPreview: (s.body ?? "").slice(0, 1500) }),
                })),
                documentAssets: assets.map((a) => ({
                  id: a.id,
                  kind: a.kind,
                })),
              };
              const contactId = deal?.contactId?.trim() || null;
              if (contactId) {
                const meetings = await prisma.contactActivity.findMany({
                  where: {
                    contactId,
                    type: { in: ["meeting", "call", "note"] },
                  },
                  orderBy: { createdAt: "desc" },
                  take: 12,
                  select: {
                    id: true,
                    type: true,
                    subject: true,
                    body: true,
                    transcriptText: true,
                    createdAt: true,
                  },
                });
                catalog.meetings = meetings.map((m) => ({
                  id: m.id,
                  type: m.type,
                  subject: m.subject,
                  body: (m.body ?? "").slice(0, 800),
                  transcriptExcerpt: (m.transcriptText ?? "").slice(0, 1200),
                  createdAt: m.createdAt.toISOString(),
                }));
                try {
                  const { loadMeetingNotesForDeal } = await import(
                    "@/service/ai/proposal-brief"
                  );
                  const notes = await loadMeetingNotesForDeal(openProp.dealId);
                  if (notes?.trim()) {
                    catalog.meetingNotes = notes.slice(0, 8000);
                  }
                } catch {
                  // optional
                }
              } else {
                catalog.meetings = [];
              }
            } else {
              // Deal detail: entityId is deal id
              const { getDeal } = await import("@/dao/sales/deal-service");
              const { prisma } = await import("@/dao/db/prisma");
              const deal = await getDeal(entityId);
              if (deal) {
                catalog.openDeal = {
                  id: deal.id,
                  title: deal.title,
                  stage: deal.stage,
                  companyName: deal.company?.name ?? "",
                  contactName: deal.contactName ?? "",
                };
                try {
                  const { listProposalsForDeal } = await import(
                    "@/dao/sales/proposal-service"
                  );
                  const proposals = await listProposalsForDeal(deal.id);
                  catalog.dealProposals = proposals.map((p) => ({
                    id: p.id,
                    number: p.number,
                    title: p.title,
                    status: p.status,
                  }));
                } catch {
                  catalog.dealProposals = [];
                }
              }
              const contactId = deal?.contactId?.trim() || null;
              if (contactId) {
                const meetings = await prisma.contactActivity.findMany({
                  where: {
                    contactId,
                    type: { in: ["meeting", "call", "note"] },
                  },
                  orderBy: { createdAt: "desc" },
                  take: 12,
                  select: {
                    id: true,
                    type: true,
                    subject: true,
                    body: true,
                    transcriptText: true,
                    createdAt: true,
                  },
                });
                catalog.meetings = meetings.map((m) => ({
                  id: m.id,
                  type: m.type,
                  subject: m.subject,
                  body: (m.body ?? "").slice(0, 800),
                  transcriptExcerpt: (m.transcriptText ?? "").slice(0, 1200),
                  createdAt: m.createdAt.toISOString(),
                }));
                try {
                  const { loadMeetingNotesForDeal } = await import(
                    "@/service/ai/proposal-brief"
                  );
                  const notes = await loadMeetingNotesForDeal(entityId);
                  if (notes?.trim()) {
                    catalog.meetingNotes = notes.slice(0, 8000);
                  }
                } catch {
                  // optional
                }
              } else {
                catalog.meetings = [];
              }
            }
          } catch {
            catalog.meetings = [];
          }
        }
      }
      if (mod === "activities") {
        try {
          const { listActivitiesPageCommand } = await import(
            "@/service/activities/activity-commands"
          );
          const page = await listActivitiesPageCommand({
            page: 1,
          });
          catalog.activities = (page.items ?? []).map((a) => ({
            id: a.id,
            subject: a.subject,
            contactName: a.contactName,
            type: a.type,
          }));
        } catch {
          // optional for find/open matching
        }
        await enrichActivitiesCreateCatalog(catalog, sessionMemory);
      }
      return;
    }
    if (mod === "company") {
      const options = await getCompanyFormOptionsCommand();
      if (options.ok) {
        catalog.assignableUsers = options.assignableUsers ?? [];
        catalog.canAssignOwner = options.canAssignOwner;
      }
      try {
        const { getPrismaClient } = await import("@/dao/db/prisma");
        const { getCurrentOrganizationId } = await import("@/service/auth/require-role");
        const prisma = getPrismaClient();
        const organizationId = await getCurrentOrganizationId();
        const companies = await prisma.company.findMany({
          where: { organizationId },
          orderBy: { name: "asc" },
          take: 200,
          select: { id: true, name: true, domain: true },
        });
        catalog.companies = companies.map((c) => ({
          id: c.id,
          name: c.name,
          domain: c.domain ?? "",
        }));
      } catch {
        // optional for open/edit matching
      }
      await enrichOpenCompany(catalog, entityId);
      return;
    }
    if (mod === "product") {
      try {
        const { listProductsForSelect } = await import(
          "@/dao/products/product-service"
        );
        catalog.products = await listProductsForSelect(200);
      } catch {
        // optional for open/edit matching
      }
      await enrichOpenProduct(catalog, entityId);
      return;
    }
    if (mod === "quotes") {
      const { parseQuoteDocumentSections } = await import(
        "@/lib/quote-document-sections"
      );

      // Quote detail: load only the open record — skip 500-product pricing catalog.
      if (entityId) {
        try {
          const { getQuote } = await import("@/dao/sales/quote-service");
          const { parseBlueprintAssets } = await import(
            "@/lib/document-blueprint"
          );
          const openQuote = await getQuote(entityId);
          if (openQuote) {
            const documentSections = parseQuoteDocumentSections(
              openQuote.documentSections,
            );
            catalog.openQuote = {
              id: openQuote.id,
              number: openQuote.number,
              dealTitle: openQuote.deal?.title ?? "",
              status: openQuote.status,
              notes: openQuote.notes,
              customerName: openQuote.customerName,
              companyName: openQuote.companyName,
              vendorName: openQuote.vendorName,
              discountPct:
                openQuote.discountPct?.toString?.() ?? openQuote.discountPct,
              documentSections: documentSections.map((s) => ({
                id: s.id,
                key: s.key,
                title: s.title,
                body: s.body,
                sortOrder: s.sortOrder,
              })),
              documentAssets: parseBlueprintAssets(openQuote.assets).map((a) => ({
                id: a.id,
                kind: a.kind,
              })),
              lines: openQuote.lines.map((line) => ({
                id: line.id,
                productId: line.productId,
                name: line.name,
                quantity: line.quantity?.toString?.() ?? line.quantity,
                unitPrice: line.unitPrice?.toString?.() ?? line.unitPrice,
                amount: line.amount?.toString?.() ?? line.amount,
              })),
            };
            catalog.products = openQuote.lines
              .filter((line) => line.productId || line.name?.trim())
              .map((line) => ({
                id: line.productId,
                name: line.name,
                listPrice: line.unitPrice?.toString?.() ?? line.unitPrice,
              }));
            catalog.deals = [
              {
                id: openQuote.dealId,
                title: openQuote.deal?.title ?? "",
                companyName: openQuote.deal?.company?.name ?? "",
                contactName: openQuote.deal?.contactName ?? "",
              },
            ];
          }
        } catch {
          // optional for open-record edit
        }
        return;
      }

      const options = await getQuoteFormOptionsCommand();
      // Prefer richer deal rows (company/contact) for fuzzy coworker matching;
      // fall back to the slim form-options list if the select query fails.
      try {
        const { listDealsForSelect } = await import(
          "@/dao/sales/deal-service"
        );
        const deals = await listDealsForSelect({ limit: 200 });
        catalog.deals = deals.map((d) => ({
          id: d.id,
          title: d.title,
          stage: d.stage,
          companyName: d.company?.name ?? "",
          contactName: d.contactName ?? "",
        }));
      } catch {
        catalog.deals = options.deals ?? [];
      }
      catalog.products = options.products ?? [];
      try {
        const { listQuotesCommand } = await import(
          "@/service/sales/quote-commands"
        );
        const quotes = await listQuotesCommand({ page: 1 });
        catalog.quotes = (quotes.items ?? []).map((q) => ({
          id: q.id,
          number: q.number,
          dealTitle: q.dealTitle,
          status: q.status,
        }));
      } catch {
        // optional for find/open matching
      }
      return;
    }
    if (mod === "finance") {
      try {
        // Include contact/company so "invoice for Manoj / Ticketing" can match.
        const { listDealsForSelect } = await import(
          "@/dao/sales/deal-service"
        );
        const { resolveRecordOwnerScope } = await import(
          "@/service/auth/ownership-scope"
        );
        const scope = await resolveRecordOwnerScope();
        const deals = await listDealsForSelect({
          limit: 200,
          ownerUserId: scope.ownerUserId,
        });
        catalog.deals = deals.map((d) => ({
          id: d.id,
          title: d.title,
          stage: d.stage,
          companyName: d.company?.name ?? "",
          contactName: d.contactName ?? "",
        }));
      } catch {
        try {
          const options = await getInvoiceCreateOptionsCommand();
          catalog.deals = (options.deals ?? []).map((d) => ({
            id: d.id,
            title: d.title,
            companyName: d.companyName ?? "",
            contactName: "",
          }));
        } catch {
          catalog.deals = [];
        }
      }
      try {
        const { listInvoicesPageCommand } = await import(
          "@/service/finance/invoice-commands"
        );
        const invoices = await listInvoicesPageCommand({ page: 1 });
        catalog.invoices = (invoices.items ?? []).map((inv) => ({
          id: inv.id,
          number: inv.number,
          dealTitle: inv.dealTitle,
          companyName: inv.companyName,
          status: inv.status,
        }));
      } catch {
        // optional for find/open matching
      }
      if (entityId) {
        try {
          const { getInvoice } = await import("@/dao/finance/invoice-service");
          const openInv = await getInvoice(entityId);
          if (openInv) {
            catalog.openInvoice = {
              id: openInv.id,
              number: openInv.number,
              dealTitle: openInv.deal?.title ?? null,
              companyName: openInv.company?.name ?? null,
              status: openInv.status,
              notes: openInv.notes,
              paymentTerms: openInv.paymentTerms,
              lines: (openInv.lines ?? []).map((line) => ({
                name: line.name,
                quantity: Number(line.quantity),
                unitPrice: Number(line.unitPrice),
                amount: Number(line.amount),
              })),
            };
          }
        } catch {
          // optional for open-record edit
        }
      }
      return;
    }
  } catch {
    // catalog optional
  }
}

export async function agentTurnCommand(input: {
  messages?: CoworkerMessage[];
  context?: AgentTurnContext;
  sessionMemory?: Record<string, unknown> | null;
  confirmTool?: { name: string; args?: Record<string, unknown> } | null;
  execution?: ExecutionIds;
  signal?: AbortSignal;
}): Promise<
  | {
      ok: true;
      assistantText: string;
      toolProposals?: AgentToolProposal[];
      contactDraftPatch?: Record<string, string>;
      patch?: Record<string, string>;
      workspaceHint?: { mode: string; label: string; search?: string };
      sessionMemoryPatch?: Record<string, unknown>;
      sessionMemory?: Record<string, unknown>;
      uiRefresh?: {
        modules?: string[];
        entityIds?: string[];
        reason?: string;
        href?: string;
        seoProgress?: { stage?: string; label?: string; detail?: string | null };
        seoContent?: Record<string, unknown>;
      };
      suggestions?: string[];
      analytics?: {
        plan: Record<string, unknown>;
        findings: { summary: string; rows: Array<Record<string, unknown>>; comparison?: string };
        chart?: Record<string, unknown> | null;
        visual?: Record<string, unknown> | null;
        visuals?: Array<Record<string, unknown>> | null;
        audit: Record<string, unknown>;
      };
    }
  | { ok: false; error?: string; assistantText?: string; suggestions?: string[] }
> {
  try {
    const { agentTrace } = await import("@/helpers/agent-trace.js");
    const turnStart = performance.now();
    const actingUserId = await getServerUserId();
    const role = await getCurrentUserRole();
    const businessType = await getCurrentBusinessType();
    const ctx = input.context ?? {};
    const messages = input.messages ?? [];
    const userText = lastUserText(messages);
    const confirmTool = input.confirmTool ?? null;

    agentTrace("coworker", {
      agent: "coworker-turn",
      step: "receive",
      module: ctx.module,
      surface: ctx.surface,
      user: (userText || "").slice(0, 600),
      entityId: ctx.entityId,
      confirmTool: confirmTool?.name ?? null,
      traceId: input.execution?.traceId,
    });

    if (!userText && !confirmTool?.name) {
      return { ok: false, error: "Send a message to work with the agent." };
    }

    if (ctx.module === "finance" && businessType === "b2c") {
      return {
        ok: true,
        assistantText:
          "Finance isn’t available for B2C workspaces. Try Contacts or Commerce instead.",
      };
    }

    let organizationId: string | null = null;
    try {
      organizationId = await getCurrentOrganizationId();
    } catch {
      organizationId = null;
    }

    const catalog: Record<string, unknown> = {
      role,
      businessType,
      organizationId,
      currentDraft: ctx.draft ?? {},
    };

    if (organizationId && actingUserId) {
      try {
        const {
          listAgentMemories,
          memoriesToPromptMap,
        } = await import("@/dao/ai/agent-memory");
        const contactId =
          ctx.module === "contact" && typeof ctx.entityId === "string"
            ? ctx.entityId
            : typeof ctx.draft?.contactId === "string"
              ? ctx.draft.contactId
              : null;
        const dealId =
          ctx.module === "sales" && typeof ctx.entityId === "string"
            ? ctx.entityId
            : typeof ctx.draft?.dealId === "string"
              ? ctx.draft.dealId
              : null;
        const slots = await listAgentMemories({
          organizationId,
          userId: actingUserId,
          contactId,
          dealId,
        });
        catalog.durableMemory = memoriesToPromptMap(slots);
        catalog.durableMemorySlots = slots;
      } catch {
        catalog.durableMemory = {};
      }
    }

    const mod = (ctx.module || "").toLowerCase();
    const pathname = typeof ctx.pathname === "string" ? ctx.pathname : "";
    if (mod === "activities" && pathname.includes("fromDeal=")) {
      try {
        const query = pathname.includes("?")
          ? pathname.slice(pathname.indexOf("?") + 1)
          : "";
        const fromDeal = new URLSearchParams(query).get("fromDeal")?.trim();
        if (fromDeal) catalog.handoffDealId = fromDeal.slice(0, 80);
      } catch {
        // optional
      }
    }
    await enrichCatalog(
      mod,
      catalog,
      typeof ctx.entityId === "string" ? ctx.entityId : null,
      userText,
      input.sessionMemory ?? ctx.sessionMemory ?? null,
    );

    const openContact = catalog.openContact as
      | { emails?: unknown; email?: unknown }
      | undefined;
    const openEmails = Array.isArray(openContact?.emails)
      ? openContact.emails.filter((value) => typeof value === "string" && value.includes("@"))
      : typeof openContact?.email === "string" && openContact.email.includes("@")
        ? [openContact.email]
        : [];
    agentTrace("coworker", {
      agent: "coworker-turn",
      step: "context",
      module: mod,
      catalogKeys: Object.keys(catalog).filter((k) => catalog[k] != null),
      openContactEmails: openEmails,
      hasDurableMemory: Boolean(catalog.durableMemory && Object.keys(catalog.durableMemory as object).length),
      executionMode: coworkerExecutionMode(organizationId, actingUserId),
    });

    const result = await callAiServiceAgent<{
      ok?: boolean;
      error?: string;
      assistantText?: string;
      toolProposals?: AgentToolProposal[];
      contactDraftPatch?: Record<string, string>;
      patch?: Record<string, string>;
      workspaceHint?: { mode: string; label: string; search?: string };
      suggestions?: string[];
      sessionMemoryPatch?: Record<string, unknown>;
      sessionMemory?: Record<string, unknown>;
      uiRefresh?: {
        modules?: string[];
        entityIds?: string[];
        reason?: string;
        href?: string;
        seoProgress?: { stage?: string; label?: string; detail?: string | null };
        seoContent?: Record<string, unknown>;
      };
      analytics?: {
        plan?: Record<string, unknown>;
        findings?: { summary?: string; rows?: Array<Record<string, unknown>>; comparison?: string };
        chart?: Record<string, unknown> | null;
        visual?: Record<string, unknown> | null;
        visuals?: Array<Record<string, unknown>> | null;
        audit?: Record<string, unknown>;
      };
      durableMemoryWrites?: Array<{
        scopeType?: string;
        scopeId?: string;
        slotKey?: string;
        slotValue?: unknown;
        clear?: boolean;
        expiresInSeconds?: number;
      }>;
    }>(
      "crm-agent",
      {
        intent: "agent_turn",
        messages,
        context: {
          ...ctx,
          organizationId,
          role,
          sessionMemory: input.sessionMemory ?? ctx.sessionMemory ?? {},
          durableMemory: catalog.durableMemory ?? {},
        },
        catalog,
        sessionMemory: input.sessionMemory ?? {},
        organizationId,
        role,
        businessType,
        actingUserId,
        executionMode: coworkerExecutionMode(organizationId, actingUserId),
        ...(input.execution
          ? {
              conversationId: input.execution.conversationId,
              runId: input.execution.runId,
              traceId: input.execution.traceId,
              traceparent: input.execution.traceparent,
              idempotencyKey: input.execution.idempotencyKey,
            }
          : {}),
        ...(confirmTool?.name
          ? {
              confirmTool: {
                name: confirmTool.name,
                args: confirmTool.args ?? {},
              },
            }
          : {}),
      },
      { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS, signal: input.signal, traceparent: input.execution?.traceparent },
    );

    agentTrace("coworker", {
      agent: "coworker-turn",
      step: "ai_response",
      ok: result?.ok !== false,
      ms: Math.round(performance.now() - turnStart),
      hasText: Boolean(result?.assistantText),
      toolCount: result?.toolProposals?.length ?? 0,
      hasPatch: Boolean(result?.patch || result?.contactDraftPatch),
      source: (result as Record<string, unknown> | null)?.source,
      traceId: input.execution?.traceId,
    });

    if (result?.ok === false) {
      const speech = coworkerFailureSpeech(result);
      return { ok: false, error: speech, assistantText: speech };
    }

    // Persist durable memory writes from the agent (structured slots only).
    if (
      organizationId &&
      Array.isArray(result?.durableMemoryWrites) &&
      result.durableMemoryWrites.length
    ) {
      try {
        const {
          upsertAgentMemory,
          clearAgentMemory,
          isAllowedMemoryScopeType,
        } = await import(
          "@/dao/ai/agent-memory"
        );
        for (const w of result.durableMemoryWrites.slice(0, 10)) {
          const rawScopeType = String(w.scopeType || "user");
          if (!isAllowedMemoryScopeType(rawScopeType)) continue;
          const scopeType = rawScopeType;
          const scopeId =
            scopeType === "user"
              ? actingUserId || ""
              : String(w.scopeId || "");
          const slotKey = String(w.slotKey || "").trim();
          if (!slotKey) continue;
          if (w.clear) {
            await clearAgentMemory({
              organizationId,
              scopeType,
              scopeId,
              slotKey,
            });
          } else if (w.slotValue !== undefined) {
            const expiresInSeconds =
              Number.isInteger(w.expiresInSeconds) &&
              Number(w.expiresInSeconds) >= 60 &&
              Number(w.expiresInSeconds) <= 31_536_000
                ? Number(w.expiresInSeconds)
                : null;
            await upsertAgentMemory({
              organizationId,
              scopeType,
              scopeId,
              slotKey,
              slotValue: w.slotValue,
              source: "chat",
              expiresAt:
                expiresInSeconds === null
                  ? null
                  : new Date(Date.now() + expiresInSeconds * 1000),
            });
          }
        }
      } catch (err) {
        console.error("durable memory write failed", err);
      }
    }

    if (result?.assistantText) {
      const patch = result.patch ?? result.contactDraftPatch;
      const analyticsSource = String(
        (result.analytics?.audit as { source?: string } | undefined)?.source ||
          (result.analytics?.plan as { source?: string } | undefined)?.source ||
          "",
      );
      agentTrace("coworker", {
        agent: "coworker-turn",
        step: "finish",
        ok: true,
        ms: Math.round(performance.now() - turnStart),
        speech: String(result.assistantText).slice(0, 200),
        toolNames: result.toolProposals?.map((t) => t.name) ?? [],
        patchKeys: patch ? Object.keys(patch) : [],
        traceId: input.execution?.traceId,
        analyticsSource: analyticsSource || undefined,
      });
      return {
        ok: true,
        assistantText: String(result.assistantText),
        toolProposals: result.toolProposals,
        contactDraftPatch: result.contactDraftPatch ?? result.patch,
        patch,
        workspaceHint: result.workspaceHint,
        sessionMemoryPatch: result.sessionMemoryPatch,
        sessionMemory: result.sessionMemory,
        uiRefresh: result.uiRefresh,
        suggestions: Array.isArray(result.suggestions) ? result.suggestions : undefined,
        analytics:
          result.analytics &&
          result.analytics.findings &&
          result.analytics.audit &&
          (result.analytics.plan || result.analytics.visual)
            ? {
                plan:
                  result.analytics.plan ??
                  { source: analyticsSource || "semantic_layer" },
                findings: {
                  summary: String(result.analytics.findings.summary || ""),
                  rows: Array.isArray(result.analytics.findings.rows)
                    ? result.analytics.findings.rows
                    : [],
                  comparison: result.analytics.findings.comparison,
                },
                chart: result.analytics.chart,
                visual: result.analytics.visual,
                ...(Array.isArray(result.analytics.visuals) && result.analytics.visuals.length > 1
                  ? { visuals: result.analytics.visuals }
                  : {}),
                audit: result.analytics.audit,
              }
            : undefined,
      };
    }

    const patch = result?.patch ?? result?.contactDraftPatch;
    const tools = result?.toolProposals;
    const hasUiRefresh =
      result?.uiRefresh &&
      typeof result.uiRefresh === "object" &&
      Object.keys(result.uiRefresh).length > 0;
    if (
      result?.ok !== false &&
      ((Array.isArray(tools) && tools.length > 0) ||
        (patch && typeof patch === "object") ||
        hasUiRefresh)
    ) {
      agentTrace("coworker", {
        agent: "coworker-turn",
        step: "finish",
        ok: true,
        ms: Math.round(performance.now() - turnStart),
        speech: "",
        toolNames: tools?.map((t) => t.name) ?? [],
        patchKeys: patch ? Object.keys(patch as object) : [],
        traceId: input.execution?.traceId,
      });
      return {
        ok: true,
        assistantText: "",
        toolProposals: tools,
        contactDraftPatch: result?.contactDraftPatch ?? result?.patch,
        patch: patch as Record<string, string> | undefined,
        workspaceHint: result?.workspaceHint,
        sessionMemoryPatch: result?.sessionMemoryPatch,
        sessionMemory: result?.sessionMemory,
        uiRefresh: result?.uiRefresh,
        suggestions: Array.isArray(result?.suggestions) ? result.suggestions : undefined,
      };
    }

    return {
      ok: false,
      assistantText:
        "AI service is temporarily unavailable. Please try again shortly.",
    };
  } catch (err) {
    const ctx = input.context ?? {};
    const userText = lastUserText(input.messages ?? []);
    if (userText) {
      return {
        ok: false,
        assistantText:
          "AI service is temporarily unavailable. Please try again shortly.",
      };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Agent turn failed.",
    };
  }
}
