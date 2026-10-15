/**
 * Tenant invoice templates (standard document skeletons + optional HTML blueprints).
 */
import { prisma } from "@/dao/db/prisma";
import type { Prisma } from "@prisma/client";
import { getCurrentOrganizationId } from "@/service/auth/require-role";
import {
  defaultDocumentBlueprint,
  parseBlueprintAssets,
  parseDocumentBlueprint,
  type BlueprintAsset,
  type DocumentBlueprint,
} from "@/lib/document-blueprint";
import {
  patchTemplateLogo,
  type LogoUpload,
} from "@/lib/template-logo-patch";
import {
  defaultStandardInvoiceSections,
  parseInvoiceDocumentSections,
  type InvoiceDocumentSection,
} from "@/lib/invoice-document-sections";

export type InvoiceTemplateView = {
  id: string;
  name: string;
  code: string | null;
  kind: string;
  isDefault: boolean;
  sections: InvoiceDocumentSection[];
  blueprint: DocumentBlueprint | null;
  assets: BlueprintAsset[];
  updatedAt: string;
};

function mapTemplate(row: {
  id: string;
  name: string;
  code: string | null;
  kind: string;
  isDefault: boolean;
  sections: unknown;
  blueprint?: unknown;
  assets?: unknown;
  updatedAt: Date;
}): InvoiceTemplateView {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    kind: row.kind,
    isDefault: row.isDefault,
    sections: parseInvoiceDocumentSections(row.sections),
    blueprint: parseDocumentBlueprint(row.blueprint) ?? null,
    assets: parseBlueprintAssets(row.assets),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function ensureDefaultInvoiceTemplate(
  organizationId?: string,
): Promise<InvoiceTemplateView> {
  const orgId = organizationId ?? (await getCurrentOrganizationId());
  const existing = await prisma.invoiceTemplate.findFirst({
    where: { organizationId: orgId, isDefault: true },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return mapTemplate(existing);

  const byCode = await prisma.invoiceTemplate.findFirst({
    where: { organizationId: orgId, code: "STANDARD" },
  });
  if (byCode) {
    if (!byCode.isDefault) {
      await prisma.invoiceTemplate.update({
        where: { id: byCode.id },
        data: { isDefault: true },
      });
    }
    return mapTemplate({ ...byCode, isDefault: true });
  }

  const created = await prisma.invoiceTemplate.create({
    data: {
      organizationId: orgId,
      name: "Standard invoice",
      code: "STANDARD",
      kind: "standard",
      isDefault: true,
      sections: defaultStandardInvoiceSections(),
      blueprint: defaultDocumentBlueprint(
        "invoice",
      ) as unknown as Prisma.InputJsonValue,
      assets: [],
    },
  });
  return mapTemplate(created);
}

export async function listInvoiceTemplates(): Promise<InvoiceTemplateView[]> {
  const organizationId = await getCurrentOrganizationId();
  await ensureDefaultInvoiceTemplate(organizationId);
  const rows = await prisma.invoiceTemplate.findMany({
    where: { organizationId },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
  return rows.map(mapTemplate);
}

export async function getInvoiceTemplate(id: string) {
  const organizationId = await getCurrentOrganizationId();
  const row = await prisma.invoiceTemplate.findFirst({
    where: { id, organizationId },
  });
  return row ? mapTemplate(row) : null;
}

export async function createInvoiceTemplate(input: {
  name: string;
  sections?: InvoiceDocumentSection[];
  makeActive?: boolean;
  blueprint?: DocumentBlueprint | null;
  assets?: BlueprintAsset[];
}) {
  const organizationId = await getCurrentOrganizationId();
  const name = input.name.trim();
  if (name.length < 2) throw new Error("Enter a template name.");

  const sections =
    input.sections && input.sections.length > 0
      ? input.sections
      : defaultStandardInvoiceSections();

  const blueprint =
    parseDocumentBlueprint(input.blueprint) ??
    defaultDocumentBlueprint("invoice");
  const assets = parseBlueprintAssets(input.assets ?? []);

  const activeCount = await prisma.invoiceTemplate.count({
    where: { organizationId, isDefault: true },
  });
  const makeActive = Boolean(input.makeActive) || activeCount === 0;

  if (makeActive) {
    await prisma.invoiceTemplate.updateMany({
      where: { organizationId, isDefault: true },
      data: { isDefault: false },
    });
  }

  const row = await prisma.invoiceTemplate.create({
    data: {
      organizationId,
      name,
      code: null,
      kind: "standard",
      isDefault: makeActive,
      sections,
      blueprint: blueprint as unknown as Prisma.InputJsonValue,
      assets: assets as unknown as Prisma.InputJsonValue,
    },
  });
  return mapTemplate(row);
}

export async function updateInvoiceTemplate(
  id: string,
  input: {
    name?: string;
    sections?: InvoiceDocumentSection[];
    isDefault?: boolean;
    blueprint?: DocumentBlueprint | null;
    assets?: BlueprintAsset[];
  },
) {
  const organizationId = await getCurrentOrganizationId();
  const existing = await prisma.invoiceTemplate.findFirst({
    where: { id, organizationId },
  });
  if (!existing) throw new Error("Invoice template not found.");

  if (input.isDefault === false && existing.isDefault) {
    throw new Error(
      "Choose another template as active first. Exactly one must stay active.",
    );
  }

  if (input.isDefault) {
    await prisma.invoiceTemplate.updateMany({
      where: { organizationId, isDefault: true },
      data: { isDefault: false },
    });
  }

  const row = await prisma.invoiceTemplate.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.sections !== undefined ? { sections: input.sections } : {}),
      ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
      ...(input.blueprint !== undefined
        ? {
            blueprint: (parseDocumentBlueprint(input.blueprint) ??
              null) as unknown as Prisma.InputJsonValue,
          }
        : {}),
      ...(input.assets !== undefined
        ? {
            assets: parseBlueprintAssets(
              input.assets,
            ) as unknown as Prisma.InputJsonValue,
          }
        : {}),
    },
  });
  return mapTemplate(row);
}

export async function updateInvoiceTemplateLogo(id: string, logo: LogoUpload) {
  const organizationId = await getCurrentOrganizationId();
  const existing = await prisma.invoiceTemplate.findFirst({
    where: { id, organizationId },
  });
  if (!existing) throw new Error("Invoice template not found.");

  const parsed = parseDocumentBlueprint(existing.blueprint);
  if (!parsed) throw new Error("Invoice template blueprint is invalid.");
  const patched = patchTemplateLogo(parsed, existing.assets, logo);

  const row = await prisma.invoiceTemplate.update({
    where: { id },
    data: {
      assets: patched.assets as unknown as Prisma.InputJsonValue,
      blueprint: patched.blueprint as unknown as Prisma.InputJsonValue,
    },
  });
  return mapTemplate(row);
}

export async function deleteInvoiceTemplate(id: string) {
  const organizationId = await getCurrentOrganizationId();
  const existing = await prisma.invoiceTemplate.findFirst({
    where: { id, organizationId },
  });
  if (!existing) throw new Error("Invoice template not found.");

  const count = await prisma.invoiceTemplate.count({
    where: { organizationId },
  });
  if (count <= 1) {
    throw new Error(
      "You need at least one invoice template. Create another before deleting this one.",
    );
  }

  if (existing.isDefault) {
    const replacement = await prisma.invoiceTemplate.findFirst({
      where: { organizationId, id: { not: id } },
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
    });
    if (!replacement) {
      throw new Error(
        "You need at least one invoice template. Create another before deleting this one.",
      );
    }
    await prisma.invoiceTemplate.update({
      where: { id: replacement.id },
      data: { isDefault: true },
    });
  }

  await prisma.invoiceTemplate.delete({ where: { id } });
  return { id };
}
