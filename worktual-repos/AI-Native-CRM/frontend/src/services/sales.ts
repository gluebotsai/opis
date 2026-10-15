import { api } from "./api";

export type PipelineDeal = {
  id: string;
  title: string;
  stage: string;
  amount: string | null;
  /** Quote currency, or the tenant country currency when the quote is the old USD default. */
  amountCurrency: string | null;
  contactId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  expectedCloseDate: string | null;
  companyId: string;
  locationId: string;
  companyName: string;
  locationName: string;
  notes: string | null;
  updatedAt: string;
  /** Pipeline Forecast Auditor overlay — display only, never editable here. */
  forecastCategory: "commit" | "best_case" | "pipeline" | "omitted" | null;
  forecastConfidencePercent: number | null;
  forecastFlagged: boolean;
  forecastReason: string | null;
};

export type BoardColumn = {
  stage: string;
  total: number;
  deals: PipelineDeal[];
};

export type DealFormOptions = {
  companies: Array<{
    id: string;
    name: string;
    industry: string | null;
    locations: Array<{
      id: string;
      name: string;
      type: string;
      ownerUserId: string | null;
    }>;
  }>;
  contacts: Array<{
    id: string;
    displayName: string;
    email: string;
    phone: string | null;
    companyId: string | null;
  }>;
  stages: string[];
};

export async function fetchDealsBoard(search?: string) {
  const { data } = await api.get<{ ok: true; columns: BoardColumn[] }>(
    "/api/sales/deals/board",
    { params: search ? { search } : undefined },
  );
  return data;
}

export async function fetchDealsPage(params: {
  page?: number;
  search?: string;
  stage?: string;
}) {
  const { data } = await api.get<{
    ok: true;
    items: PipelineDeal[];
    pagination: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
      hasNext?: boolean;
    };
  }>("/api/sales/deals", { params });
  return data;
}

export async function exportDeals(params: {
  search?: string;
  stage?: string;
  ownerUserId?: string;
  format?: string;
}) {
  const { data } = await api.get("/api/sales/deals/export", { params });
  return data as
    | {
        ok: true;
        content: string;
        filename: string;
        mimeType: string;
        count: number;
        truncated: boolean;
      }
    | { ok: false; error: string };
}

export async function fetchDealFormOptions() {
  const { data } = await api.get<{ ok: true } & DealFormOptions>(
    "/api/sales/deals/form-options",
  );
  return data;
}

export type ClosedWonExtras = {
  contactPromoted: boolean;
  contactId: string | null;
  contractId: string | null;
  contractCreated: boolean;
  serviceHandoff: {
    ok: boolean;
    externalId?: string;
    skipped?: boolean;
    error?: string;
  } | null;
};

export type DealContactCard = {
  id: string;
  displayName: string;
  email: string;
  phone: string | null;
  secondaryEmails: string[];
  secondaryPhones: string[];
  title: string | null;
  addressLine: string | null;
  city: string | null;
  country: string | null;
  ownerName: string | null;
};

export type DealCompanyCard = {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  employeeCount: number | null;
  ownerName: string | null;
};

export type DealContractRow = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  arr: string | number | null;
  autoRenew?: boolean;
  status?: string;
  renewDealId?: string | null;
};

export async function fetchDeal(id: string) {
  const { data } = await api.get(`/api/sales/deals/${id}`);
  return data as
    | {
        ok: true;
        deal: PipelineDeal & {
          contactPhone: string | null;
          locationType: string;
          activities: DealActivityRow[];
          contracts: DealContractRow[];
          createdAt: string;
        };
        contact: DealContactCard | null;
        company: DealCompanyCard;
        proposalCount: number;
        quoteCount: number;
        contactActivities: DealActivityRow[];
      }
    | { ok: false; error: string };
}

export async function createDeal(body: Record<string, unknown>) {
  const { data } = await api.post("/api/sales/deals", body);
  return data as { ok: true; id: string } | { ok: false; error: string };
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

export async function checkDuplicateDeals(input: {
  companyId?: string | null;
  contactId?: string | null;
  excludeDealId?: string | null;
}) {
  const { data } = await api.post("/api/sales/deals/duplicates/check", input);
  return data as
    | { ok: true; matches: OpenDuplicateDeal[] }
    | { ok: false; error: string };
}

export async function updateDeal(id: string, body: Record<string, unknown>) {
  const { data } = await api.patch(`/api/sales/deals/${id}`, body);
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export async function updateDealStage(
  id: string,
  stage: string,
  lostReason?: string | null,
) {
  const { data } = await api.post(`/api/sales/deals/${id}/stage`, {
    stage,
    lostReason,
  });
  return data as
    | { ok: true; id: string; wonExtras?: ClosedWonExtras | null }
    | { ok: false; error: string };
}

export async function deleteDeal(id: string) {
  const { data } = await api.delete(`/api/sales/deals/${id}`);
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export type DealHistoryEntry = {
  id: string;
  action: string;
  createdAt: string;
  actorUserId: string | null;
  actorLabel: string;
  summary: string;
};

export async function fetchDealHistory(dealId: string) {
  const { data } = await api.get<
    { ok: true; items: DealHistoryEntry[] } | { ok: false; error: string }
  >(`/api/sales/deals/${dealId}/history`);
  return data;
}

export async function fetchDealContracts(dealId: string) {
  const { data } = await api.get<
    { ok: true; items: DealContractRow[] } | { ok: false; error: string }
  >(`/api/sales/deals/${dealId}/contracts`);
  return data;
}

export type CompanyContractRow = DealContractRow & {
  companyId: string;
  companyName: string | null;
  daysUntilEnd: number;
  atRisk: boolean;
};

/** Every deal raised against this company, newest activity first. */
export async function fetchCompanyDeals(companyId: string, pageSize = 50) {
  const { data } = await api.get<
    | {
        ok: true;
        items: PipelineDeal[];
        pagination: {
          page: number;
          pageSize: number;
          total: number;
          totalPages: number;
          hasNext?: boolean;
        };
      }
    | { ok: false; error: string }
  >(`/api/sales/companies/${companyId}/deals`, { params: { pageSize } });
  return data;
}

export async function fetchCompanyContracts(companyId: string) {
  const { data } = await api.get<
    { ok: true; items: CompanyContractRow[] } | { ok: false; error: string }
  >(`/api/sales/companies/${companyId}/contracts`);
  return data;
}

export async function createRenewalQuoteForContract(contractId: string) {
  const { data } = await api.post<
    | { ok: true; quote: { id: string; number: string } }
    | { ok: false; error: string }
  >(`/api/sales/contracts/${contractId}/renewal-quote`);
  return data;
}

export type DealActivityRow = {
  id: string;
  type: string;
  subject: string;
  body: string | null;
  dueAt: string | null;
  createdAt: string;
  transcriptText?: string | null;
  transcriptSource?: string | null;
  disposition?: string | null;
};

export async function createDealActivity(
  dealId: string,
  body: {
    type: string;
    subject: string;
    body?: string | null;
    dueAt?: string | null;
  },
) {
  const { data } = await api.post(`/api/sales/deals/${dealId}/activities`, body);
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export async function deleteDealActivity(dealId: string, activityId: string) {
  const { data } = await api.delete(
    `/api/sales/deals/${dealId}/activities/${activityId}`,
  );
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export type ProposalSection = {
  id: string;
  key: string;
  title: string;
  body: string;
  sortOrder: number;
  tableRows?: Array<{ cells: string[] }>;
};

export type ProposalRow = {
  id: string;
  number: string;
  title: string;
  summary: string | null;
  customerName: string | null;
  version: number;
  status: "draft" | "shared" | "accepted" | "declined";
  attachmentUrl: string | null;
  hasSections: boolean;
  templateName: string | null;
  updatedAt: string;
  approvalStatus?: string | null;
  generationRun?: {
    id: string;
    status: string;
    progress?: { done: number; total: number; label: string };
    pricingIssues?: { sendBlocked?: boolean; issues?: Array<{ message?: string }> };
  } | null;
};

export type ProposalDetail = {
  id: string;
  number: string;
  title: string;
  summary: string | null;
  customerName: string | null;
  version: number;
  status: ProposalRow["status"];
  attachmentUrl: string | null;
  sections: ProposalSection[];
  blueprint?: {
    version: number;
    html: string;
    css: string;
    mode?: string;
    chrome?: boolean;
    theme?: Record<string, string>;
    slots?: Array<{ key: string; label: string }>;
  } | null;
  assets?: Array<{
    id: string;
    kind: "logo" | "image";
    mime: string;
    dataBase64: string;
  }>;
  dealId: string;
  dealTitle: string;
  companyName: string | null;
  contactName: string | null;
  templateId: string | null;
  templateName: string | null;
  vendorName?: string | null;
  productScope?: string | null;
  seller?: {
    companyName: string | null;
    industryType: string | null;
    businessType: string | null;
    websiteUrl: string | null;
    country: string | null;
    companySize: string | null;
    contactName: string | null;
    workEmail: string | null;
    billingAddress?: string | null;
  } | null;
  sharedAt: string | null;
  createdAt: string;
  updatedAt: string;
  approvalStatus?: string | null;
  generationRun?: ProposalRow["generationRun"];
};

export type ProposalTemplate = {
  id: string;
  name: string;
  code: string | null;
  kind: string;
  isDefault: boolean;
  sections: ProposalSection[];
  blueprint?: ProposalDetail["blueprint"];
  assets?: ProposalDetail["assets"];
  updatedAt: string;
};

export async function fetchDealProposals(dealId: string) {
  const { data } = await api.get<
    { ok: true; items: ProposalRow[] } | { ok: false; error: string }
  >(`/api/sales/deals/${dealId}/proposals`);
  return data;
}

export async function fetchProposal(id: string) {
  const { data } = await api.get<
    { ok: true; proposal: ProposalDetail } | { ok: false; error: string }
  >(`/api/sales/proposals/${id}`);
  return data;
}

export async function createProposal(body: {
  dealId: string;
  title?: string;
  summary?: string | null;
  attachmentUrl?: string | null;
  fromTemplate?: boolean;
  templateId?: string | null;
  productHint?: string | null;
  productIds?: string[] | null;
  requirementPdfBase64?: string | null;
  requirementFilename?: string | null;
}) {
  const { data } = await api.post("/api/sales/proposals", body, {
    timeout: 360_000,
  });
  return data as
    | { ok: true; id: string; warnings?: string[] }
    | { ok: false; error: string };
}

export async function createProposalFromPlaybook(body: {
  dealId: string;
  requirementText?: string;
  title?: string | null;
  templateId?: string | null;
  playbookId?: string | null;
  productHint?: string | null;
  productIds?: string[] | null;
  requirementPdfBase64?: string | null;
  requirementFilename?: string | null;
}) {
  const { data } = await api.post("/api/sales/proposals/from-playbook", body, {
    timeout: 120_000,
  });
  return data as
    | {
        ok: true;
        id: string;
        playbookId?: string;
        status?: string;
        warnings?: string[];
      }
    | { ok: false; error: string };
}

export async function updateProposal(
  id: string,
  body: {
    title?: string;
    summary?: string | null;
    attachmentUrl?: string | null;
    status?: ProposalRow["status"];
    customerName?: string | null;
    sections?: ProposalSection[];
  },
) {
  const { data } = await api.patch(`/api/sales/proposals/${id}`, body);
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export async function shareProposal(id: string) {
  const { data } = await api.post(`/api/sales/proposals/${id}/share`);
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export async function sendProposal(id: string) {
  const { data } = await api.post(`/api/sales/proposals/${id}/send`, undefined, {
    timeout: 120_000,
  });
  return data as
    | { ok: true; id: string; warning?: string }
    | { ok: false; error: string };
}

export async function resendProposal(id: string) {
  const { data } = await api.post(`/api/sales/proposals/${id}/resend`, undefined, {
    timeout: 120_000,
  });
  return data as
    | { ok: true; id: string; warning?: string }
    | { ok: false; error: string };
}

export async function personalizeProposal(
  id: string,
  body?: {
    productIds?: string[];
    productHint?: string;
    requirementPdfBase64?: string;
    requirementFilename?: string;
  },
) {
  const { data } = await api.post(
    `/api/sales/proposals/${id}/personalize`,
    body ?? {},
    { timeout: 360_000 },
  );
  return data as
    | { ok: true; id: string; warnings?: string[] }
    | { ok: false; error: string };
}

export async function patchProposalSection(
  id: string,
  body: { sectionKey: string; title?: string; body?: string },
) {
  const { data } = await api.post(
    `/api/sales/proposals/${id}/patch-section`,
    body,
    { timeout: 30_000 },
  );
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export async function patchProposalBlueprintHtml(
  id: string,
  html: string,
) {
  const { data } = await api.post(
    `/api/sales/proposals/${id}/blueprint-html`,
    { html },
    { timeout: 30_000 },
  );
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export async function patchProposalDocumentText(
  id: string,
  body: {
    textReplacements?: Array<{ find: string; replace?: string }>;
    pageId?: string | null;
    removeImageAssetIds?: string[] | null;
    tableBorders?: boolean | null;
  },
) {
  const { data } = await api.post(
    `/api/sales/proposals/${id}/patch-document-text`,
    body,
    { timeout: 30_000 },
  );
  return data as
    | { ok: true; id: string; applied: number }
    | { ok: false; error: string };
}

export async function updateProposalDocumentAsset(
  id: string,
  body: {
    assetId?: string;
    imageUrl?: string;
    dataBase64?: string;
    mime?: string;
    kind?: "logo" | "image";
  },
) {
  const { data } = await api.post(
    `/api/sales/proposals/${id}/document-asset`,
    body,
    { timeout: 60_000 },
  );
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export async function rewriteProposalSection(
  id: string,
  body: { sectionKey: string; instruction?: string },
) {
  const { data } = await api.post(
    `/api/sales/proposals/${id}/rewrite-section`,
    body,
    { timeout: 90_000 },
  );
  return data as
    | { ok: true; id: string; warnings?: string[] }
    | { ok: false; error: string };
}

export async function createProposalVersion(id: string) {
  const { data } = await api.post(`/api/sales/proposals/${id}/version`);
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export async function deleteProposal(id: string) {
  const { data } = await api.delete(`/api/sales/proposals/${id}`);
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export async function fetchProposalTemplates() {
  const { data } = await api.get<
    { ok: true; items: ProposalTemplate[] } | { ok: false; error: string }
  >("/api/sales/proposal-templates");
  return data;
}

export async function updateProposalTemplate(
  id: string,
  body: {
    name?: string;
    isDefault?: boolean;
    sections?: ProposalSection[];
    blueprint?: ProposalDetail["blueprint"];
    assets?: ProposalDetail["assets"];
  },
) {
  const { data } = await api.patch(`/api/sales/proposal-templates/${id}`, body);
  return data as
    | { ok: true; id: string; template: ProposalTemplate }
    | { ok: false; error: string };
}

export async function uploadProposalTemplateLogo(
  id: string,
  body: { dataBase64: string; mime: string },
) {
  const { data } = await api.post(`/api/sales/proposal-templates/${id}/logo`, body);
  return data as
    | { ok: true; id: string; template: ProposalTemplate }
    | { ok: false; error: string };
}

export async function createProposalTemplate(body: {
  name: string;
  makeActive?: boolean;
  sections?: ProposalSection[];
  blueprint?: ProposalDetail["blueprint"];
  assets?: ProposalDetail["assets"];
}) {
  const { data } = await api.post("/api/sales/proposal-templates", body);
  return data as
    | { ok: true; id: string; template: ProposalTemplate }
    | { ok: false; error: string };
}

export async function deleteProposalTemplate(id: string) {
  const { data } = await api.delete(`/api/sales/proposal-templates/${id}`);
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export async function downloadProposalPdf(id: string) {
  const res = await api.get(`/api/sales/proposals/${id}/pdf`, {
    responseType: "blob",
    timeout: 120_000,
    // Avoid JSON Content-Type on the request; accept PDF or error JSON.
    headers: { Accept: "application/pdf, application/json" },
  });

  const status = res.status ?? 0;
  const data = res.data as Blob;
  const contentType = String(res.headers?.["content-type"] || "").toLowerCase();

  // Axios interceptor resolves 4xx/5xx — error bodies arrive as blobs here.
  if (status >= 400 || contentType.includes("application/json") || contentType.includes("text/")) {
    let message = "Could not generate PDF.";
    try {
      const text = await data.text();
      const parsed = JSON.parse(text) as {
        message?: string;
        error?: string;
        ok?: boolean;
      };
      message =
        parsed.message ||
        parsed.error ||
        (typeof parsed === "object" && parsed.ok === false
          ? String((parsed as { error?: string }).error || message)
          : message);
    } catch {
      /* keep default */
    }
    throw new Error(message);
  }

  const head = new Uint8Array(await data.slice(0, 5).arrayBuffer());
  const magic = String.fromCharCode(...head);
  if (!magic.startsWith("%PDF")) {
    throw new Error(
      "Download was not a valid PDF. Try again, or ask an admin to install Playwright Chromium on the API.",
    );
  }

  return data;
}

export async function downloadProposalDocx(id: string) {
  const res = await api.get(`/api/sales/proposals/${id}/docx`, {
    responseType: "blob",
    timeout: 120_000,
    headers: {
      Accept:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document, application/json",
    },
  });

  const status = res.status ?? 0;
  const data = res.data as Blob;
  const contentType = String(res.headers?.["content-type"] || "").toLowerCase();

  if (status >= 400 || contentType.includes("application/json") || contentType.includes("text/")) {
    let message = "Could not generate Word document.";
    try {
      const text = await data.text();
      const parsed = JSON.parse(text) as {
        message?: string;
        error?: string;
        ok?: boolean;
      };
      message =
        parsed.message ||
        parsed.error ||
        (typeof parsed === "object" && parsed.ok === false
          ? String((parsed as { error?: string }).error || message)
          : message);
    } catch {
      /* keep default */
    }
    throw new Error(message);
  }

  return data;
}

export async function generateProposalTemplate(body: {
  brief?: string;
  sampleText?: string;
  sampleFileBase64?: string;
  sampleFilename?: string;
  organizationName?: string;
  existingSections?: ProposalSection[];
}) {
  const { data } = await api.post("/api/sales/proposal-templates/generate", body);
  return data as
    | {
        ok: true;
        kind: "proposal";
        sections: ProposalSection[];
        blueprint?: {
          version: number;
          html: string;
          css: string;
          mode?: string;
          chrome?: boolean;
          theme?: Record<string, string>;
          slots?: Array<{ key: string; label: string }>;
        };
        assets?: Array<{
          id: string;
          kind: "logo" | "image";
          mime: string;
          dataBase64: string;
        }>;
        warnings?: string[];
      }
    | { ok: false; error: string };
}

export async function chatProposalTemplate(body: {
  message: string;
  currentStep: "idle" | "awaiting_name" | "awaiting_description" | "done";
  turnHint: string;
  createName?: string;
  templateNames?: string[];
  hasSample?: boolean;
  skipEdit?: boolean;
  templateContext?: {
    templateId?: string;
    templateName?: string;
    blueprint?: ProposalTemplate["blueprint"];
    assets?: ProposalTemplate["assets"];
    sections?: Array<{
      id: string;
      key?: string;
      title: string;
      body: string;
      sortOrder?: number;
    }>;
  };
}) {
  const { data } = await api.post("/api/sales/proposal-templates/chat", body);
  return data as
    | {
        ok: true;
        text: string;
        fromAgent?: boolean;
        edits?: {
          sections?: Array<{
            id: string;
            key?: string;
            title: string;
            body: string;
            sortOrder?: number;
          }>;
          blueprint?: ProposalTemplate["blueprint"];
          assets?: ProposalTemplate["assets"];
          rename?: string;
          makeActive?: boolean;
          applied?: string[];
        };
      }
    | { ok: false; error: string };
}
