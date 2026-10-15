import { useEffect, useRef, useState } from "react";
import { Download, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  CONTACT_CSV_REQUIRED_HINT,
  contactCsvSample,
} from "@/lib/contact-csv-import";
import { importContactsCsv } from "@/services/contacts";
import { useAppSelector } from "@/store";

export function ContactImportDialog({
  open,
  onClose,
  onImported,
  initialCsv,
}: {
  open: boolean;
  onClose: () => void;
  onImported?: () => void;
  initialCsv?: string | null;
}) {
  const businessType = useAppSelector((s) => s.auth.user?.businessType) ?? "b2b";
  const sampleCsv = contactCsvSample(businessType);
  const fileRef = useRef<HTMLInputElement>(null);
  const [csvText, setCsvText] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<
    Array<{ row: number; message: string; email?: string; displayName?: string }>
  >([]);

  useEffect(() => {
    if (!open) return;
    const seed = (initialCsv ?? "").trim();
    setCsvText(seed);
    setMessage(null);
    setErrors([]);
  }, [open, initialCsv]);

  if (!open) return null;

  function onFile(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCsvText(String(reader.result ?? ""));
      setMessage(null);
      setErrors([]);
    };
    reader.readAsText(file);
  }

  function loadSample() {
    setCsvText(sampleCsv);
    setMessage(null);
    setErrors([]);
  }

  function downloadSample() {
    window.location.assign("/api/contacts/import/sample");
  }

  async function run(dryRun: boolean) {
    if (!csvText.trim()) {
      setMessage("Paste CSV, choose a file, or load the sample first.");
      return;
    }
    setPending(true);
    try {
      const result = await importContactsCsv({ csvText, dryRun });
      if (!result.ok) {
        setMessage(result.error);
        setErrors([]);
        return;
      }
      setMessage(
        `${dryRun ? "Dry run" : "Import"}: ${result.parsed} rows → ${result.created} create, ${result.skipped} duplicate skipped, ${result.errors.length} failed.`,
      );
      setErrors([
        ...result.errors,
        ...(result.duplicates ?? []).map((d) => ({
          row: d.row,
          message: d.reason,
          email: d.email,
          displayName: d.displayName,
        })),
      ]);
      if (
        !dryRun &&
        result.created > 0 &&
        result.errors.length === 0 &&
        (result.duplicates?.length ?? 0) === 0
      ) {
        window.setTimeout(() => {
          onClose();
          setCsvText("");
          setMessage(null);
          setErrors([]);
          onImported?.();
        }, 900);
      } else if (!dryRun && result.created > 0) {
        onImported?.();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal
        aria-labelledby="contact-import-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border-default bg-surface shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border-default px-5 py-4">
          <div>
            <h2
              id="contact-import-title"
              className="text-base font-semibold text-text-primary"
            >
              Import contacts
            </h2>
            <p className="mt-1 text-sm text-text-caption">
              {CONTACT_CSV_REQUIRED_HINT}
              {businessType === "b2c"
                ? " Company columns are ignored for B2C."
                : " Company name creates or links the account."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-text-caption hover:bg-subtle hover:text-text-primary"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            />
            <Button
              type="button"
              variant="secondary"
              className="h-9"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="size-4" />
              Choose file
            </Button>
            <Button
              type="button"
              variant="tertiary"
              className="h-9"
              onClick={loadSample}
            >
              Load sample
            </Button>
            <Button
              type="button"
              variant="tertiary"
              className="h-9"
              onClick={downloadSample}
            >
              <Download className="size-4" />
              Download sample
            </Button>
          </div>

          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            rows={10}
            placeholder="Paste CSV here…"
            className="mt-3 w-full rounded-lg border border-border-default bg-subtle px-3 py-2 font-mono text-xs text-text-primary outline-none focus:border-brand"
          />

          {message ? (
            <p className="mt-3 text-sm text-text-secondary">{message}</p>
          ) : null}
          {errors.length > 0 ? (
            <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto text-xs text-text-caption">
              {errors.map((e, i) => {
                const who = [e.displayName, e.email].filter(Boolean).join(", ");
                return (
                  <li key={`${e.row}-${i}`}>
                    Row {e.row}
                    {who ? ` (${who})` : ""}: {e.message}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-border-default px-5 py-4">
          <Button
            type="button"
            variant="tertiary"
            className="h-9"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="h-9"
            disabled={pending}
            onClick={() => void run(true)}
          >
            Dry run
          </Button>
          <Button
            type="button"
            variant="primary"
            className="h-9"
            disabled={pending}
            onClick={() => void run(false)}
          >
            {pending ? "Working…" : "Import"}
          </Button>
        </div>
      </div>
    </div>
  );
}
