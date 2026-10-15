import { useId, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";

/**
 * Editable list for secondary emails / phones.
 * Controlled: reports the cleaned (non-empty) list on every edit.
 * Mirrors src/components/contacts/ContactMultiValueInput.tsx (Next), adapted
 * from FormData rows to a value/onChange contract for the SPA form.
 */
export function ContactMultiValueInput({
  label,
  values,
  onChange,
  kind = "text",
  placeholder,
  addLabel,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  kind?: "email" | "tel" | "text";
  placeholder?: string;
  addLabel?: string;
}) {
  const baseId = useId();
  const [rows, setRows] = useState<string[]>(() => {
    const initial = values.map((v) => v.trim()).filter(Boolean);
    return initial.length > 0 ? initial : [""];
  });

  function commit(next: string[]) {
    setRows(next);
    onChange(next.map((v) => v.trim()).filter(Boolean));
  }

  function updateAt(index: number, next: string) {
    commit(rows.map((value, i) => (i === index ? next : value)));
  }

  function removeAt(index: number) {
    commit(rows.length <= 1 ? [""] : rows.filter((_, i) => i !== index));
  }

  function addRow() {
    setRows((prev) => [...prev, ""]);
  }

  return (
    <div className="flex w-full flex-col gap-2 sm:col-span-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-text-primary">{label}</span>
        <Button
          type="button"
          variant="tertiary"
          className="h-8 px-2 text-xs"
          onClick={addRow}
        >
          <Plus className="size-3.5" strokeWidth={2} />
          {addLabel ?? "Add another"}
        </Button>
      </div>
      <div className="space-y-2">
        {rows.map((value, index) => {
          const inputId = `${baseId}-${index}`;
          return (
            <div key={inputId} className="flex min-w-0 items-center gap-2">
              <input
                id={inputId}
                type={kind}
                value={value}
                placeholder={placeholder}
                autoComplete="off"
                onChange={(e) => updateAt(index, e.target.value)}
                className="h-11 min-w-0 flex-1 rounded-lg border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-placeholder transition-colors focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-border-focus/20"
              />
              <button
                type="button"
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-border-default text-text-caption transition-colors hover:border-border-strong hover:text-text-danger disabled:cursor-not-allowed disabled:opacity-40"
                title="Remove"
                aria-label={`Remove ${label.toLowerCase()} ${index + 1}`}
                disabled={rows.length === 1 && !value.trim()}
                onClick={() => removeAt(index)}
              >
                <X className="size-4" strokeWidth={1.75} />
              </button>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-text-caption">
        Add one value per row. Empty rows are ignored on save.
      </p>
    </div>
  );
}
