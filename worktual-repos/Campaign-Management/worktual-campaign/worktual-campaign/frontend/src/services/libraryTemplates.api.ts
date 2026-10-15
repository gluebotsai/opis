import { apiDelete, apiGet, apiPatch, apiPost } from "@/services/api";

export type LibraryTemplateDto = {
  id: string;
  source?: string;
  seedSlug?: string | null;
  seedCatalog?: string;
  name: string;
  description: string;
  styleNotes?: string;
  goal: string;
  primaryChannel: string;
  externalTemplateId?: string;
  channels: string[];
  audience: string;
  flowSteps: string[];
  starterMessage: string;
  approvalStatus: "draft" | "approved" | string;
  bodyPreview: string;
  contentBody?: string;
  usedCount: number;
  previewImage?: string | null;
  preview?: Record<string, unknown> | null;
  fields?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  createdByUserId?: string | null;
  createdAt: string;
  updatedAt: string;
};

type ApiBody<T> = {
  statusCode?: number;
  message?: string;
} & T;

export type CreateLibraryTemplatePayload = {
  name: string;
  description?: string;
  styleNotes?: string;
  goal?: string;
  primaryChannel: string;
  channels?: string[];
  audience?: string;
  flowSteps?: string[];
  starterMessage?: string;
  approvalStatus?: "draft" | "approved";
  bodyPreview?: string;
  contentBody?: string;
  previewImage?: string | null;
  preview?: Record<string, unknown> | null;
  fields?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  externalTemplateId?: string;
};

export async function fetchLibraryTemplates(): Promise<LibraryTemplateDto[]> {
  const { data } = await apiGet<ApiBody<{ templates: LibraryTemplateDto[] }>>(
    "/templates/library",
  );
  return Array.isArray(data.templates) ? data.templates : [];
}

export async function createLibraryTemplateApi(
  payload: CreateLibraryTemplatePayload,
): Promise<LibraryTemplateDto> {
  const { data } = await apiPost<ApiBody<{ template: LibraryTemplateDto }>>(
    "/templates/library",
    payload,
  );
  if (!data.template) throw new Error("Create did not return a template");
  return data.template;
}

export async function updateLibraryTemplateApi(
  id: string,
  payload: Partial<CreateLibraryTemplatePayload>,
): Promise<LibraryTemplateDto> {
  const { data } = await apiPatch<ApiBody<{ template: LibraryTemplateDto }>>(
    `/templates/library/${id}`,
    payload,
  );
  if (!data.template) throw new Error("Update did not return a template");
  return data.template;
}

export async function deleteLibraryTemplateApi(id: string): Promise<void> {
  await apiDelete(`/templates/library/${id}`);
}

export async function bumpLibraryTemplateUsedApi(
  id: string,
): Promise<LibraryTemplateDto | null> {
  const { data } = await apiPost<ApiBody<{ template: LibraryTemplateDto }>>(
    `/templates/library/${id}/use`,
    {},
  );
  return data.template ?? null;
}
