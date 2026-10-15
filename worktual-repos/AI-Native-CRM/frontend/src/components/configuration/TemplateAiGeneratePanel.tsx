import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { RichStructuredContent } from "@/components/content/RichStructuredContent";
import { Textarea } from "@/components/ui/Textarea";

const MAX_SAMPLE_BYTES = 8 * 1024 * 1024;
const ACCEPT_PDF_DOCX =
  ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type TemplateSectionPreview = {
  id: string;
  key: string;
  title: string;
  body: string;
  sortOrder: number;
};

type GenerateResult =
  | {
      ok: true;
      sections: TemplateSectionPreview[];
      warnings?: string[];
    }
  | { ok: false; error: string };

type Props = {
  documentLabel: string;
  existingSections: TemplateSectionPreview[];
  onApply: (sections: TemplateSectionPreview[]) => void;
  generate: (input: {
    brief: string;
    sampleText: string;
    sampleFileBase64?: string;
    sampleFilename?: string;
    existingSections: TemplateSectionPreview[];
  }) => Promise<GenerateResult>;
};

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Optional AI path: describe / paste / upload → preview → apply into editor.
 * Collapsed by default so manual editing stays primary.
 */
export function TemplateAiGeneratePanel({
  documentLabel,
  existingSections,
  onApply,
  generate,
}: Props) {
  const fileInputId = useId();
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [sampleText, setSampleText] = useState("");
  const [sampleFile, setSampleFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<TemplateSectionPreview[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);

  const onGenerate = async () => {
    setBusy(true);
    setError(null);
    setWarnings([]);
    setPreview(null);
    setApplied(false);
    try {
      let sampleFileBase64: string | undefined;
      let sampleFilename: string | undefined;
      if (sampleFile) {
        if (sampleFile.size > MAX_SAMPLE_BYTES) {
          setError("Sample file must be 8 MB or smaller.");
          setBusy(false);
          return;
        }
        const lower = sampleFile.name.toLowerCase();
        if (!lower.endsWith(".pdf") && !lower.endsWith(".docx")) {
          setError("Sample must be a PDF or Word (.docx) document.");
          setBusy(false);
          return;
        }
        sampleFileBase64 = await fileToBase64(sampleFile);
        sampleFilename = sampleFile.name;
      }
      const result = await generate({
        brief: brief.trim(),
        sampleText: sampleText.trim(),
        sampleFileBase64,
        sampleFilename,
        existingSections,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPreview(result.sections);
      setWarnings(result.warnings ?? []);
      if (result.sections.length === 0) {
        setError("No sections were generated. Try a clearer description.");
      }
    } catch {
      setError("Generation failed. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  const canGenerate =
    brief.trim().length >= 8 ||
    sampleText.trim().length >= 40 ||
    sampleFile != null;

  return (
    <details
      className="rounded-xl border border-border-default bg-subtle/30 open:bg-subtle/40"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer list-none px-4 py-3 marker:content-none [&::-webkit-details-marker]:hidden">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-text-primary">
              Optional: generate with AI
            </p>
            <p className="mt-0.5 text-xs text-text-caption">
              Describe the {documentLabel} you want, or paste/upload a sample.
              You will preview and apply before anything is saved.
            </p>
          </div>
          <span className="shrink-0 text-xs font-medium text-brand">
            {open ? "Hide" : "Show"}
          </span>
        </div>
      </summary>

      <div className="space-y-4 border-t border-border-default px-4 py-4">
        <ol className="space-y-1 text-xs text-text-caption">
          <li>
            <span className="font-medium text-text-secondary">Step A</span> —
            Add a short description (and optionally a sample).
          </li>
          <li>
            <span className="font-medium text-text-secondary">Step B</span> —
            Generate a draft and read the preview.
          </li>
          <li>
            <span className="font-medium text-text-secondary">Step C</span> —
            Apply into the editor above, then click Save.
          </li>
        </ol>

        <Textarea
          label="What should this document include?"
          rows={3}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder={`Example: Formal B2B ${documentLabel} with introduction, scope of work, pricing notes, and closing.`}
        />
        <Textarea
          label="Paste sample wording (optional)"
          rows={3}
          value={sampleText}
          onChange={(e) => setSampleText(e.target.value)}
          placeholder="Paste text from an old proposal or quote you like…"
        />
        <div>
          <label
            htmlFor={fileInputId}
            className="mb-1 block text-sm font-medium text-text-primary"
          >
            Or upload a sample file (optional)
          </label>
          <input
            id={fileInputId}
            type="file"
            accept={ACCEPT_PDF_DOCX}
            className="block w-full text-sm text-text-secondary file:mr-3 file:rounded-lg file:border-0 file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-text-primary"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              setSampleFile(file);
            }}
          />
          <p className="mt-1 text-xs text-text-caption">
            PDF or Word (.docx) · max 8 MB · exact visual clone of the sample
            {sampleFile ? ` · selected: ${sampleFile.name}` : ""}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={busy || !canGenerate}
            onClick={() => void onGenerate()}
          >
            {busy ? "Generating…" : "1. Generate draft"}
          </Button>
          {preview && preview.length > 0 ? (
            <Button
              type="button"
              variant="primary"
              disabled={busy}
              onClick={() => {
                onApply(preview);
                setApplied(true);
                setError(null);
              }}
            >
              2. Apply to editor above
            </Button>
          ) : null}
        </div>

        {!canGenerate && !busy ? (
          <p className="text-xs text-text-caption">
            Enter at least a short description (a sentence or two), or add a
            sample, to enable Generate.
          </p>
        ) : null}

        {error ? (
          <p className="text-sm text-text-danger" role="alert">
            {error}
          </p>
        ) : null}
        {applied ? (
          <p className="text-sm text-text-secondary" role="status">
            Draft copied into the editor above. Review the sections, then click
            Save.
          </p>
        ) : null}
        {warnings.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-xs text-text-caption">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}

        {preview && preview.length > 0 ? (
          <div className="space-y-3 border-t border-border-default pt-4">
            <p className="text-xs font-medium text-text-secondary">
              Draft preview ({preview.length} sections) — not saved yet
            </p>
            {preview.map((section, idx) => (
              <div
                key={section.id || `${section.key}-${idx}`}
                className="rounded-lg border border-border-default bg-surface p-3"
              >
                <p className="text-sm font-medium text-text-primary">
                  {section.title || `Section ${idx + 1}`}
                </p>
                <div className="mt-1 max-h-28 overflow-y-auto">
                  <RichStructuredContent
                    text={section.body}
                    variant="muted"
                  />
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </details>
  );
}
