/**
 * Tenant proposal templates (standard skeletons + optional HTML blueprints).
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
  defaultStandardProposalSections,
  parseProposalSections,
  type ProposalSection,
} from "@/lib/proposal-sections";

export type ProposalTemplateView = {
  id: string;
  name: string;
  code: string | null;
  kind: string;
  isDefault: boolean;
  sections: ProposalSection[];
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
}): ProposalTemplateView {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    kind: row.kind,
    isDefault: row.isDefault,
    sections: parseProposalSections(row.sections),
    blueprint: parseDocumentBlueprint(row.blueprint) ?? null,
    assets: parseBlueprintAssets(row.assets),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Ensure org has a default standard template (generic, not vendor-specific). */
export async function ensureDefaultProposalTemplate(
  organizationId?: string,
): Promise<ProposalTemplateView> {
  const orgId = organizationId ?? (await getCurrentOrganizationId());
  const existing = await prisma.proposalTemplate.findFirst({
    where: { organizationId: orgId, isDefault: true },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return mapTemplate(existing);

  const byCode = await prisma.proposalTemplate.findFirst({
    where: { organizationId: orgId, code: "STANDARD" },
  });
  if (byCode) {
    if (!byCode.isDefault) {
      await prisma.proposalTemplate.update({
        where: { id: byCode.id },
        data: { isDefault: true },
      });
    }
    return mapTemplate({ ...byCode, isDefault: true });
  }

  const created = await prisma.proposalTemplate.create({
    data: {
      organizationId: orgId,
      name: "Standard proposal",
      code: "STANDARD",
      kind: "standard",
      isDefault: true,
      sections: defaultStandardProposalSections(),
      blueprint: defaultDocumentBlueprint("proposal") as unknown as Prisma.InputJsonValue,
      assets: [],
    },
  });
  return mapTemplate(created);
}

export async function listProposalTemplates(): Promise<ProposalTemplateView[]> {
  const organizationId = await getCurrentOrganizationId();
  await ensureDefaultProposalTemplate(organizationId);
  const rows = await prisma.proposalTemplate.findMany({
    where: { organizationId },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
  return rows.map(mapTemplate);
}

export async function getProposalTemplate(id: string) {
  const organizationId = await getCurrentOrganizationId();
  const row = await prisma.proposalTemplate.findFirst({
    where: { id, organizationId },
  });
  return row ? mapTemplate(row) : null;
}

export async function createProposalTemplate(input: {
  name: string;
  sections?: ProposalSection[];
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
      : defaultStandardProposalSections();

  const blueprint =
    parseDocumentBlueprint(input.blueprint) ??
    defaultDocumentBlueprint("proposal");
  const assets = parseBlueprintAssets(input.assets ?? []);

  const activeCount = await prisma.proposalTemplate.count({
    where: { organizationId, isDefault: true },
  });
  const makeActive = Boolean(input.makeActive) || activeCount === 0;

  if (makeActive) {
    await prisma.proposalTemplate.updateMany({
      where: { organizationId, isDefault: true },
      data: { isDefault: false },
    });
  }

  const row = await prisma.proposalTemplate.create({
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

export async function updateProposalTemplate(
  id: string,
  input: {
    name?: string;
    sections?: ProposalSection[];
    isDefault?: boolean;
    blueprint?: DocumentBlueprint | null;
    assets?: BlueprintAsset[];
  },
) {
  const organizationId = await getCurrentOrganizationId();
  const existing = await prisma.proposalTemplate.findFirst({
    where: { id, organizationId },
  });
  if (!existing) throw new Error("Proposal template not found.");

  if (input.isDefault === false && existing.isDefault) {
    throw new Error(
      "Choose another template as active first. Exactly one must stay active.",
    );
  }

  if (input.isDefault) {
    await prisma.proposalTemplate.updateMany({
      where: { organizationId, isDefault: true },
      data: { isDefault: false },
    });
  }

  const row = await prisma.proposalTemplate.update({
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

export async function updateProposalTemplateLogo(id: string, logo: LogoUpload) {
  const organizationId = await getCurrentOrganizationId();
  const existing = await prisma.proposalTemplate.findFirst({
    where: { id, organizationId },
  });
  if (!existing) throw new Error("Proposal template not found.");

  const parsed = parseDocumentBlueprint(existing.blueprint);
  if (!parsed) throw new Error("Proposal template blueprint is invalid.");
  const patched = patchTemplateLogo(parsed, existing.assets, logo);

  const row = await prisma.proposalTemplate.update({
    where: { id },
    data: {
      assets: patched.assets as unknown as Prisma.InputJsonValue,
      blueprint: patched.blueprint as unknown as Prisma.InputJsonValue,
    },
  });
  return mapTemplate(row);
}

/** Delete a template. Keeps exactly one active; cannot delete the last template. */
export async function deleteProposalTemplate(id: string) {
  const organizationId = await getCurrentOrganizationId();
  const existing = await prisma.proposalTemplate.findFirst({
    where: { id, organizationId },
  });
  if (!existing) throw new Error("Proposal template not found.");

  const count = await prisma.proposalTemplate.count({
    where: { organizationId },
  });
  if (count <= 1) {
    throw new Error(
      "You need at least one proposal template. Create another before deleting this one.",
    );
  }

  if (existing.isDefault) {
    const replacement = await prisma.proposalTemplate.findFirst({
      where: { organizationId, id: { not: id } },
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
    });
    if (!replacement) {
      throw new Error(
        "You need at least one proposal template. Create another before deleting this one.",
      );
    }
    await prisma.proposalTemplate.update({
      where: { id: replacement.id },
      data: { isDefault: true },
    });
  }

  await prisma.proposalTemplate.delete({ where: { id } });
  return { id };
}
