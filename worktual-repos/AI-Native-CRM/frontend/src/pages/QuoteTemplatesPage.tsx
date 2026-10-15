import { useCallback, useEffect, useState } from "react";
import { DocumentTemplateWorkspace } from "@/components/configuration/DocumentTemplateWorkspace";
import {
  chatQuoteTemplate,
  createQuoteTemplate,
  deleteQuoteTemplate,
  fetchQuoteTemplates,
  generateQuoteTemplate,
  updateQuoteTemplate,
  uploadQuoteTemplateLogo,
  type QuoteTemplate,
} from "@/services/quotes";

export function QuoteTemplatesPage() {
  const [templates, setTemplates] = useState<QuoteTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchQuoteTemplates();
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
        title="Quote templates"
        documentLabel="quote"
        purpose="Build the quotation outlines your team starts from for every customer."
        usedWhen="When someone creates a quote on a deal, CRM uses the Active template and fills in customer, deal, and totals."
        templates={templates}
        loading={loading}
        error={error}
        message={message}
        onClearMessage={() => setMessage(null)}
        onReload={reload}
        sectionBodyRows={6}
        chatAssist={chatQuoteTemplate}
        generate={async (input) => {
          const result = await generateQuoteTemplate({
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
          const result = await createQuoteTemplate({
            name: input.name,
            makeActive: input.makeActive,
            sections: input.sections as QuoteTemplate["sections"],
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
          const result = await updateQuoteTemplate(id, {
            name,
            sections: sections as QuoteTemplate["sections"],
            blueprint,
            assets,
          });
          if (!result.ok) return result;
          setMessage("Quote template saved.");
          return { ok: true as const };
        }}
        uploadLogo={async ({ id, dataBase64, mime }) => {
          const result = await uploadQuoteTemplateLogo(id, { dataBase64, mime });
          if (!result.ok) return result;
          setMessage("Quote template logo updated.");
          return { ok: true as const };
        }}
        setActive={async (id) => {
          const result = await updateQuoteTemplate(id, { isDefault: true });
          if (!result.ok) return result;
          setMessage("Active quote template updated.");
          return { ok: true as const };
        }}
        deleteTemplate={async (id) => {
          const result = await deleteQuoteTemplate(id);
          if (!result.ok) return result;
          setMessage("Quote template deleted.");
          return { ok: true as const };
        }}
      />
  );
}
