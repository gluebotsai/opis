import { useRef, useState } from "react";
import { FileText, X } from "lucide-react";

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileMatchesAccept(file: File, accept: string) {
  const name = file.name.toLowerCase();
  return accept
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .some((ext) => {
      if (ext.startsWith(".")) return name.endsWith(ext);
      if (ext.includes("/")) return file.type === ext;
      return name.endsWith(`.${ext}`);
    });
}

type Props = {
  title: string;
  hint: string;
  accept: string;
  file: File | null;
  disabled?: boolean;
  onFile: (file: File | null) => void;
};

/** Click or drag-and-drop sample upload (same interaction as Proposal patterns). */
export function TemplateSampleUploadDropzone({
  title,
  hint,
  accept,
  file,
  disabled,
  onFile,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [rejectHint, setRejectHint] = useState<string | null>(null);
  const dragCount = useRef(0);

  const openPicker = () => {
    if (disabled) return;
    inputRef.current?.click();
  };

  const takeFile = (next: File | undefined) => {
    if (!next) return;
    if (!fileMatchesAccept(next, accept)) {
      setRejectHint(`Use ${hint}.`);
      return;
    }
    setRejectHint(null);
    onFile(next);
  };

  const shell = dragOver
    ? "border-[#2563eb] bg-[#eef4ff]"
    : "border-[#d4d4d4] bg-[#f7f7f8] hover:border-[#2563eb] hover:bg-[#eef4ff]";

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      aria-label={
        file
          ? `${title}: ${file.name}. Click to change.`
          : `${title}. Click or drop a file.`
      }
      onClick={openPicker}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openPicker();
        }
      }}
      onDragEnter={(event) => {
        event.preventDefault();
        if (disabled) return;
        dragCount.current += 1;
        setDragOver(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragCount.current = Math.max(0, dragCount.current - 1);
        if (dragCount.current === 0) setDragOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragCount.current = 0;
        setDragOver(false);
        if (disabled) return;
        takeFile(event.dataTransfer.files[0]);
      }}
      className={`flex min-h-[8.5rem] w-full cursor-pointer flex-col rounded-xl border border-dashed px-4 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-400 disabled:cursor-not-allowed ${
        disabled ? "cursor-not-allowed opacity-50" : ""
      } ${shell}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-text-primary">{title}</p>
        {file ? (
          <button
            type="button"
            aria-label={`Remove ${file.name}`}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-text-caption hover:bg-white hover:text-text-danger"
            onClick={(event) => {
              event.stopPropagation();
              setRejectHint(null);
              onFile(null);
            }}
          >
            <X className="size-3.5" strokeWidth={2} />
          </button>
        ) : null}
      </div>
      <span className="mt-3 flex flex-1 flex-col items-center justify-center text-center">
        <FileText className="size-4 text-neutral-400" strokeWidth={1.75} />
        {file ? (
          <>
            <span className="mt-1.5 max-w-full truncate text-sm font-medium text-text-primary">
              {file.name}
            </span>
            <span className="text-[11px] text-text-caption">
              {formatBytes(file.size)} · Click to change or drop a new file
            </span>
          </>
        ) : dragOver ? (
          <>
            <span className="mt-1.5 text-sm font-medium text-text-primary">
              Drop to add
            </span>
            <span className="text-[11px] text-text-caption">{hint}</span>
          </>
        ) : (
          <>
            <span className="mt-1.5 text-sm font-medium text-text-primary">
              Add file
            </span>
            <span className="text-[11px] text-text-caption">
              Click or drag and drop · {hint}
            </span>
          </>
        )}
        {rejectHint ? (
          <span className="mt-1 text-[11px] text-text-danger">{rejectHint}</span>
        ) : null}
      </span>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(event) => {
          takeFile(event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
    </div>
  );
}
