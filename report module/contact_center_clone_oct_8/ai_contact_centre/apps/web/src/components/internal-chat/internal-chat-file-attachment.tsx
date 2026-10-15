import { Download, FileText, X } from "lucide-react";
import { useEffect, useState } from "react";

import {
  fileAccentClass,
  fileExtension,
  formatFileSize,
  isImageAttachment,
  isImageFile,
} from "@/features/internal-chat/attachment-utils";
import { downloadInternalChatAttachment } from "@/features/internal-chat/api";
import { useAuthenticatedMediaUrl } from "@/features/internal-chat/use-authenticated-media-url";
import type { InternalChatAttachment } from "@/features/internal-chat/types";
import { formatMessageTime } from "@/features/internal-chat/internal-chat-utils";
import { cn } from "@/lib/utils";

function AttachmentDownloadButton({
  attachment,
  className,
  variant = "default",
}: {
  attachment: InternalChatAttachment;
  className?: string;
  variant?: "default" | "overlay";
}) {
  const [downloading, setDownloading] = useState(false);

  if (!attachment.previewUrl) return null;

  async function handleDownload() {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadInternalChatAttachment(attachment);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleDownload()}
      disabled={downloading}
      aria-label={`Download ${attachment.name}`}
      title="Download"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md transition",
        variant === "overlay"
          ? "size-7 bg-black/50 text-white hover:bg-black/70 disabled:opacity-60"
          : "size-7 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-50",
        className,
      )}
    >
      <Download className={variant === "overlay" ? "size-3.5" : "size-3.5"} />
    </button>
  );
}

type InternalChatFileAttachmentCardProps = {
  attachment: InternalChatAttachment;
  size?: "default" | "mini";
  onRemove?: () => void;
  sentAt?: string;
  isOutgoing?: boolean;
};

export function InternalChatFileAttachmentCard({
  attachment,
  size = "default",
  onRemove,
  sentAt,
  isOutgoing = false,
}: InternalChatFileAttachmentCardProps) {
  const extension = fileExtension(attachment.name);
  const mini = size === "mini";

  return (
    <div
      className={cn(
        "flex min-w-0 items-center rounded-lg border bg-white/90",
        mini ? "max-w-[11.5rem] gap-2 p-1.5" : "gap-3 rounded-xl p-2.5",
        isOutgoing ? "border-neutral-300/80" : "border-neutral-200",
      )}
    >
      <div
        className={cn(
          "flex shrink-0 items-center justify-center rounded-md font-bold tracking-wide text-white",
          mini ? "size-7 text-[9px]" : "size-11 rounded-lg text-[10px]",
          fileAccentClass(extension),
        )}
      >
        {extension.length <= 4 ? extension : <FileText className={mini ? "size-3.5" : "size-5"} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn("truncate font-medium text-neutral-900", mini ? "text-[11px]" : "text-sm")}>
          {attachment.name}
        </p>
        <p className={cn("text-neutral-600", mini ? "text-[10px]" : "mt-0.5 text-[11px]")}>
          {formatFileSize(attachment.sizeBytes)}
        </p>
      </div>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove attachment"
          className="flex size-5 shrink-0 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
        >
          <X className="size-3" />
        </button>
      ) : (
        <AttachmentDownloadButton attachment={attachment} />
      )}
      {sentAt ? <span className="sr-only">Sent at {formatMessageTime(sentAt)}</span> : null}
    </div>
  );
}

type InternalChatImageAttachmentProps = {
  attachment: InternalChatAttachment;
  sentAt?: string;
  className?: string;
};

export function InternalChatImageAttachment({
  attachment,
  sentAt,
  className,
}: InternalChatImageAttachmentProps) {
  const previewUrl = useAuthenticatedMediaUrl(attachment.previewUrl);
  if (!previewUrl) return null;

  return (
    <div className={cn("group relative overflow-hidden rounded-xl bg-neutral-100", className)}>
      <img
        src={previewUrl}
        alt={attachment.name}
        className="block max-h-72 w-full max-w-[17rem] object-cover"
      />
      <div className="absolute top-2 right-2 flex items-center gap-1.5 sm:opacity-0 sm:transition sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
        <AttachmentDownloadButton attachment={attachment} variant="overlay" />
      </div>
      {sentAt ? (
        <span className="absolute right-2 bottom-1.5 rounded-md bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white">
          {formatMessageTime(sentAt)}
        </span>
      ) : null}
    </div>
  );
}

type InternalChatMessageAttachmentsProps = {
  attachments: InternalChatAttachment[];
  sentAt: string;
  isOutgoing: boolean;
  hasCaption: boolean;
};

export function InternalChatMessageAttachments({
  attachments,
  sentAt,
  isOutgoing,
  hasCaption,
}: InternalChatMessageAttachmentsProps) {
  const imageAttachments = attachments.filter(
    (attachment) => isImageAttachment(attachment) && attachment.previewUrl,
  );
  const fileAttachments = attachments.filter(
    (attachment) => !isImageAttachment(attachment) || !attachment.previewUrl,
  );

  return (
    <>
      {imageAttachments.length > 0 ? (
        <div
          className={cn(
            "grid gap-1",
            imageAttachments.length > 1 ? "grid-cols-2" : "grid-cols-1",
          )}
        >
          {imageAttachments.map((attachment, index) => (
            <InternalChatImageAttachment
              key={`${attachment.name}-${attachment.sizeBytes}-${index}`}
              attachment={attachment}
              sentAt={
                !hasCaption && fileAttachments.length === 0 && index === imageAttachments.length - 1
                  ? sentAt
                  : undefined
              }
              className={imageAttachments.length > 1 ? "max-w-[8.5rem]" : undefined}
            />
          ))}
        </div>
      ) : null}
      {fileAttachments.length > 0 ? (
        <div className={cn("space-y-1.5", imageAttachments.length > 0 && "mt-1.5")}>
          {fileAttachments.map((attachment, index) => (
            <InternalChatFileAttachmentCard
              key={`${attachment.name}-${attachment.sizeBytes}-${index}`}
              attachment={attachment}
              isOutgoing={isOutgoing}
              sentAt={
                !hasCaption && index === fileAttachments.length - 1 && imageAttachments.length === 0
                  ? sentAt
                  : undefined
              }
            />
          ))}
        </div>
      ) : null}
    </>
  );
}

function useFilePreviewUrl(file: File) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isImageFile(file)) return;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  return url;
}

function PendingAttachmentChip({ file, onRemove }: { file: File; onRemove: () => void }) {
  const previewUrl = useFilePreviewUrl(file);
  const extension = fileExtension(file.name);
  const image = isImageFile(file);

  if (image && previewUrl) {
    return (
      <div className="group relative size-14 shrink-0 overflow-hidden rounded-xl border-[0.6px] border-[#bfbfbf] bg-neutral-100 shadow-sm">
        <img src={previewUrl} alt={file.name} className="size-full object-cover" />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-1.5 pb-1 pt-4">
          <p className="truncate text-[9px] font-medium text-white">{formatFileSize(file.size)}</p>
        </div>
        <RemoveAttachmentButton onRemove={onRemove} className="absolute top-1 right-1" />
      </div>
    );
  }

  return (
    <div className="relative flex w-[9.5rem] shrink-0 items-center gap-2 rounded-xl border-[0.6px] border-[#bfbfbf] bg-white px-2 py-1.5 shadow-sm">
      <div
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg text-[9px] font-bold text-white",
          fileAccentClass(extension),
        )}
      >
        {extension.length <= 4 ? extension : <FileText className="size-3.5" />}
      </div>
      <div className="min-w-0 flex-1 pr-4">
        <p className="truncate text-[11px] font-medium leading-tight text-neutral-900">{file.name}</p>
        <p className="mt-0.5 text-[10px] text-neutral-600">{formatFileSize(file.size)}</p>
      </div>
      <RemoveAttachmentButton onRemove={onRemove} className="absolute top-1 right-1" />
    </div>
  );
}

function RemoveAttachmentButton({
  onRemove,
  className,
}: {
  onRemove: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label="Remove attachment"
      className={cn(
        "flex size-5 items-center justify-center rounded-full bg-neutral-900/75 text-white shadow-sm transition hover:bg-neutral-900",
        className,
      )}
    >
      <X className="size-3" />
    </button>
  );
}

type InternalChatPendingAttachmentsProps = {
  files: File[];
  onRemove: (index: number) => void;
  onClearAll?: () => void;
};

export function InternalChatPendingAttachments({
  files,
  onRemove,
  onClearAll,
}: InternalChatPendingAttachmentsProps) {
  if (files.length === 0) return null;

  return (
    <div className="border-b-[0.6px] border-[#bfbfbf]/70 bg-neutral-100/50 px-2.5 pt-2 pb-2">
      <div className="mb-2 flex items-center justify-between gap-2 px-0.5">
        <p className="text-[11px] font-medium text-neutral-600">
          {files.length} file{files.length === 1 ? "" : "s"} attached
        </p>
        {onClearAll && files.length > 1 ? (
          <button
            type="button"
            onClick={onClearAll}
            className="text-[11px] font-medium text-neutral-600 hover:text-neutral-800"
          >
            Clear all
          </button>
        ) : null}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {files.map((file, index) => (
          <PendingAttachmentChip
            key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
            file={file}
            onRemove={() => onRemove(index)}
          />
        ))}
      </div>
    </div>
  );
}
