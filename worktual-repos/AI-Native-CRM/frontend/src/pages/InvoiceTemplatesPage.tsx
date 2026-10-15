import { useCallback, useEffect, useState } from "react";
import { DocumentTemplateWorkspace } from "@/components/configuration/DocumentTemplateWorkspace";
import {
  chatInvoiceTemplate,
  createInvoiceTemplate,
  deleteInvoiceTemplate,
  fetchInvoiceTemplates,
  generateInvoiceTemplate,
  updateInvoiceTemplate,
  uploadInvoiceTemplateLogo,
  type InvoiceTemplate,
} from "@/services/finance";

export function InvoiceTemplatesPage() {
  const [templates, setTemplates] = useState<InvoiceTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchInvoiceTemplates();
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
        title="Invoice templates"
        documentLabel="invoice"
        purpose="Build the invoice outlines your team starts from for every customer."
        usedWhen="When someone creates an invoice from a deal or accepted quote, CRM uses the Active template and fills in company, dates, and totals."
        templates={templates}
        loading={loading}
        error={error}
        message={message}
        onClearMessage={() => setMessage(null)}
        onReload={reload}
        sectionBodyRows={6}
        chatAssist={chatInvoiceTemplate}
        generate={async (input) => {
          const result = await generateInvoiceTemplate({
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
          const result = await createInvoiceTemplate({
            name: input.name,
            makeActive: input.makeActive,
            sections: input.sections as InvoiceTemplate["sections"],
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
          const result = await updateInvoiceTemplate(id, {
            name,
            sections: sections as InvoiceTemplate["sections"],
            blueprint,
            assets,
          });
          if (!result.ok) return result;
          setMessage("Invoice template saved.");
          return { ok: true as const };
        }}
        uploadLogo={async ({ id, dataBase64, mime }) => {
          const result = await uploadInvoiceTemplateLogo(id, {
            dataBase64,
            mime,
          });
          if (!result.ok) return result;
          setMessage("Invoice template logo updated.");
          return { ok: true as const };
        }}
        setActive={async (id) => {
          const result = await updateInvoiceTemplate(id, { isDefault: true });
          if (!result.ok) return result;
          setMessage("Active invoice template updated.");
          return { ok: true as const };
        }}
        deleteTemplate={async (id) => {
          const result = await deleteInvoiceTemplate(id);
          if (!result.ok) return result;
          setMessage("Invoice template deleted.");
          return { ok: true as const };
        }}
      />
  );
}
