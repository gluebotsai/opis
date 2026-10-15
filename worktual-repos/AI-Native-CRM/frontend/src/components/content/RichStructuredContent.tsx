import { parseNoteBody } from "@/lib/note-body";

const BASE_CLASS =
  "note-rich-text text-sm leading-5 [&_.note-table-wrap]:my-2 [&_.note-table-wrap]:max-w-full [&_.note-table-wrap]:overflow-x-auto [&_a]:font-medium [&_a]:text-text-link [&_a]:underline [&_h3]:mb-1.5 [&_h3]:mt-0 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:tracking-tight [&_h4]:mb-1 [&_h4]:mt-3 [&_h4]:text-[11px] [&_h4]:font-semibold [&_h4]:tracking-wide [&_h4]:text-text-secondary [&_h4]:uppercase [&_li]:my-0.5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_p]:text-sm [&_p]:leading-5 [&_p:first-child]:mt-0 [&_strong]:font-semibold [&_table.note-table]:w-full [&_table.note-table]:border-collapse [&_table.note-table]:text-left [&_table.note-table]:text-[13px] [&_table.note-table_td]:border [&_table.note-table_td]:border-neutral-200 [&_table.note-table_td]:px-2 [&_table.note-table_td]:py-1 [&_table.note-table_td]:align-top [&_table.note-table_th]:border [&_table.note-table_th]:border-neutral-200 [&_table.note-table_th]:bg-neutral-50 [&_table.note-table_th]:px-2 [&_table.note-table_th]:py-1 [&_table.note-table_th]:font-semibold [&_table.note-table_th]:align-top [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5";

const VARIANT_CLASS = {
  default:
    "max-w-prose rounded-lg bg-subtle/60 px-3.5 py-3 text-text-primary [&_h3]:text-text-primary [&_p]:text-text-primary [&_strong]:text-text-primary",
  compact:
    "max-w-prose text-text-primary [&_h3]:text-text-primary [&_p]:text-text-primary",
  feed:
    "max-w-none w-full rounded-lg bg-subtle/60 px-3.5 py-3 text-text-primary [&_h3]:text-text-primary [&_p]:text-text-primary [&_strong]:text-text-primary",
  document:
    "max-w-none text-text-secondary [&_h3]:text-text-primary [&_p]:text-sm [&_p]:leading-6 [&_p]:text-text-secondary",
  chat: "max-w-none text-inherit [&_a]:text-inherit [&_h3]:text-inherit [&_h4]:text-inherit [&_p]:text-inherit [&_strong]:text-inherit",
  muted:
    "max-w-prose text-text-caption [&_h3]:text-text-secondary [&_h4]:text-text-caption [&_p]:text-text-caption",
} as const;

export type RichStructuredContentVariant = keyof typeof VARIANT_CLASS;

export function RichStructuredContent({
  text,
  html,
  variant = "default",
  className = "",
  empty = null,
}: {
  text?: string | null;
  html?: string | null;
  variant?: RichStructuredContentVariant;
  className?: string;
  empty?: string | null;
}) {
  const resolved =
    html?.trim() ||
    (text?.trim() ? parseNoteBody(text).html : "") ||
    "";
  if (!resolved) {
    return empty ? (
      <p className="text-sm text-text-caption">{empty}</p>
    ) : null;
  }

  return (
    <div
      className={`${BASE_CLASS} ${VARIANT_CLASS[variant]} ${className}`.trim()}
      dangerouslySetInnerHTML={{ __html: resolved }}
    />
  );
}
