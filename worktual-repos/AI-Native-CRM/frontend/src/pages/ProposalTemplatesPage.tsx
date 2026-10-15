import { useCallback, useEffect, useState } from "react";
import { DocumentTemplateWorkspace } from "@/components/configuration/DocumentTemplateWorkspace";
import {
  chatProposalTemplate,
  createProposalTemplate,
  deleteProposalTemplate,
  fetchProposalTemplates,
  generateProposalTemplate,
  updateProposalTemplate,
  uploadProposalTemplateLogo,
  type ProposalTemplate,
} from "@/services/sales";

export function ProposalTemplatesPage() {
  const [templates, setTemplates] = useState<ProposalTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchProposalTemplates();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setTemplates(result.items);
    } catch {
      setError("Failed to load templates.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <DocumentTemplateWorkspace
        title="Proposal templates"
        documentLabel="proposal"
        purpose="Build the proposal outlines your team starts from for every customer."
        usedWhen="When someone creates a proposal on a deal, CRM uses the Active template and fills in customer and deal names."
        templates={templates}
        loading={loading}
        error={error}
        message={message}
        onClearMessage={() => setMessage(null)}
        onReload={reload}
        sectionBodyRows={7}
        chatAssist={chatProposalTemplate}
        generate={async (input) => {
          const result = await generateProposalTemplate({
            brief: input.brief,
            sampleText: input.sampleText,
            sampleFileBase64: input.sampleFileBase64,
            sampleFilename: input.sampleFilename,
            existingSections: input.existingSections.map((s, i) => ({
              id: s.id,
              key: s.key || `section_${i + 1}`,
              title: s.title,
              body: s.body,
              sortOrder: s.sortOrder ?? i + 1,
            })),
          });
          if (!result.ok) return result;
          return {
            ok: true as const,
            sections: result.sections,
            warnings: result.warnings,
            blueprint: result.blueprint ?? undefined,
            assets: result.assets,
          };
        }}
        createTemplate={async (input) => {
          const result = await createProposalTemplate({
            name: input.name,
            makeActive: input.makeActive,
            sections: input.sections as ProposalTemplate["sections"],
            blueprint: input.blueprint,
            assets: input.assets,
          });
          if (!result.ok) return result;
          return {
            ok: true as const,
            id: result.id,
            template: result.template,
          };
        }}
        saveTemplate={async ({ id, name, sections, blueprint, assets }) => {
          const result = await updateProposalTemplate(id, {
            name,
            sections: sections as ProposalTemplate["sections"],
            blueprint,
            assets,
          });
          if (!result.ok) return result;
          setMessage("Proposal template saved.");
          return { ok: true as const };
        }}
        uploadLogo={async ({ id, dataBase64, mime }) => {
          const result = await uploadProposalTemplateLogo(id, {
            dataBase64,
            mime,
          });
          if (!result.ok) return result;
          setMessage("Proposal template logo updated.");
          return { ok: true as const };
        }}
        setActive={async (id) => {
          const result = await updateProposalTemplate(id, { isDefault: true });
          if (!result.ok) return result;
          setMessage("Active proposal template updated.");
          return { ok: true as const };
        }}
        deleteTemplate={async (id) => {
          const result = await deleteProposalTemplate(id);
          if (!result.ok) return result;
          setMessage("Proposal template deleted.");
          return { ok: true as const };
        }}
      />
  );
}
