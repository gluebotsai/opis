import { FileText, Paperclip, X } from "lucide-react";
import { formatFileSize, type NoteAttachment } from "@/lib/note-body";

function isImageAttachment(file: NoteAttachment): boolean {
  return (
    file.contentType.startsWith("image/") ||
    /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.filename)
  );
}

function isPdfAttachment(file: NoteAttachment): boolean {
  return (
    file.contentType === "application/pdf" || /\.pdf$/i.test(file.filename)
  );
}

export function attachmentDataUrl(file: NoteAttachment): string {
  const type = file.contentType || "application/octet-stream";
  return `data:${type};base64,${file.contentBase64}`;
}

export function NoteAttachmentPreview({
  file,
  onRemove,
  compact = false,
}: {
  file: NoteAttachment;
  onRemove?: () => void;
  compact?: boolean;
}) {
  const dataUrl = attachmentDataUrl(file);
  const image = isImageAttachment(file);
  const pdf = isPdfAttachment(file);

  return (
    <li className="overflow-hidden rounded-lg border border-border-default bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-border-default px-2.5 py-1.5">
        <p className="min-w-0 truncate text-xs text-text-primary">
          {file.filename}
          <span className="ml-1.5 text-text-caption">
            {formatFileSize(file.size)}
          </span>
        </p>
        {onRemove ? (
          <button
            type="button"
            aria-label={`Remove ${file.filename}`}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-text-caption hover:bg-subtle hover:text-text-danger"
            onClick={onRemove}
          >
            <X className="size-3.5" strokeWidth={2} />
          </button>
        ) : null}
      </div>

      {image ? (
        <img
          src={dataUrl}
          alt={file.filename}
          className={`w-full bg-subtle object-contain ${
            compact ? "max-h-40" : "max-h-72"
          }`}
        />
      ) : pdf ? (
        <iframe
          title={file.filename}
          src={dataUrl}
          className={`w-full border-0 bg-subtle ${
            compact ? "h-40" : "h-64"
          }`}
        />
      ) : (
        <a
          href={dataUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-3 py-3 text-sm text-text-link hover:bg-subtle"
        >
          <FileText className="size-4 shrink-0" strokeWidth={1.75} />
          <span className="min-w-0 truncate">Open {file.filename}</span>
        </a>
      )}
    </li>
  );
}

export function NoteAttachmentsList({
  attachments,
  onRemove,
  compact = false,
}: {
  attachments: NoteAttachment[];
  onRemove?: (index: number) => void;
  compact?: boolean;
}) {
  if (attachments.length === 0) return null;

  return (
    <div className="rounded-lg border border-border-default bg-subtle/50 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-text-caption uppercase">
        <Paperclip className="size-3.5" strokeWidth={1.75} />
        Attachments ({attachments.length})
      </div>
      <ul className="mt-2 space-y-2">
        {attachments.map((file, index) => (
          <NoteAttachmentPreview
            key={`${file.filename}-${index}`}
            file={file}
            compact={compact}
            onRemove={onRemove ? () => onRemove(index) : undefined}
          />
        ))}
      </ul>
    </div>
  );
}
