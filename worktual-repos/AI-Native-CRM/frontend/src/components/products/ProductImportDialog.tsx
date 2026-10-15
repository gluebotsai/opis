import { useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  productShowsRetailFields,
} from "@/lib/coworker/field-contracts/product";
import { importProductsCsv } from "@/services/products";

const SAMPLE_CSV_B2B = `name,sku,category,subcategory,product_url,price,currency,status,tagline
Starter Plan,SKU-START,Plans,Starter,,49,USD,active,For small teams
Pro Plan,SKU-PRO,Plans,Pro,,149,USD,active,Growing revenue teams
`;

const SAMPLE_CSV_B2C = `name,sku,brand,category,subcategory,stock,product_url,price,currency,status,tagline
Pulse Earbuds,WT-EARBUD-BLK,Worktual Home,Audio,Earbuds,50,https://shop.worktual.example/products/pulse-earbuds,79,USD,active,Everyday ANC earbuds
Starter plan,SKU-START,Worktual Home,Subscription,Monthly,,49,USD,active,Consumer self-serve
`;

export function ProductImportDialog({
  open,
  onClose,
  onImported,
  businessType,
}: {
  open: boolean;
  onClose: () => void;
  onImported?: () => void;
  businessType?: string | null;
}) {
  const showRetail = productShowsRetailFields(businessType);
  const sampleCsv = showRetail ? SAMPLE_CSV_B2C : SAMPLE_CSV_B2B;
  const optionalHint = [
    "sku",
    showRetail ? "brand" : null,
    "category",
    "subcategory",
    showRetail ? "stock" : null,
    "product_url",
    "price",
    "currency",
    "status",
    "active",
    "tags",
    "tagline",
    "description",
    "image_url",
  ]
    .filter(Boolean)
    .join(", ");
  const fileRef = useRef<HTMLInputElement>(null);
  const [csvText, setCsvText] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Array<{ row: number; message: string }>>(
    [],
  );

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

  async function run(dryRun: boolean) {
    if (!csvText.trim()) {
      setMessage("Paste CSV or choose a file first.");
      return;
    }
    setPending(true);
    try {
      const result = await importProductsCsv({ csvText, dryRun });
      if (!result.ok) {
        setMessage(result.error);
        setErrors([]);
        return;
      }
      setMessage(
        `${dryRun ? "Dry run" : "Import"}: ${result.parsed} rows → ${result.created} create, ${result.updated} update, ${result.skipped} skipped.`,
      );
      setErrors(result.errors);
      if (!dryRun && result.created + result.updated > 0) {
        window.setTimeout(() => {
          onClose();
          setCsvText("");
          setMessage(null);
          setErrors([]);
          onImported?.();
        }, 900);
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
        aria-labelledby="product-import-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border-default bg-surface shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border-default px-5 py-4">
          <div>
            <h2
              id="product-import-title"
              className="text-base font-semibold text-text-primary"
            >
              Import products
            </h2>
            <p className="mt-1 text-sm text-text-caption">
              Upserts by SKU. Required column:{" "}
              <span className="font-medium text-text-secondary">name</span>.
              Optional: {optionalHint}.
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
              onClick={() => {
                setCsvText(sampleCsv);
                setMessage(null);
                setErrors([]);
              }}
            >
              Load sample
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
              {errors.map((e, i) => (
                <li key={`${e.row}-${i}`}>
                  Row {e.row}: {e.message}
                </li>
              ))}
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
