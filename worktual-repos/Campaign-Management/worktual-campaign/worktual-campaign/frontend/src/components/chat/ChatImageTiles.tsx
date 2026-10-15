import { Loader2, X } from "lucide-react";
import {
  chatMediaPreviewFallbackSrc,
  chatMediaPreviewSrc,
} from "@/lib/template-preview-images";
import type { ChatImageAttachment } from "@/lib/chat-message-images";

type ComposerTile = ChatImageAttachment & {
  /** Blob or https — show spinner until server URL is ready. */
  uploading?: boolean;
};

type ComposerImageStripProps = {
  items: ComposerTile[];
  onRemove?: (index: number) => void;
  disabled?: boolean;
};

/** ChatGPT-style thumbnails above the textarea while composing. */
export function ComposerImageStrip({
  items,
  onRemove,
  disabled = false,
}: ComposerImageStripProps) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-2 px-2 pt-2">
      {items.map((item, index) => {
        const src = chatMediaPreviewSrc(item.url) || item.url;
        const fallback = chatMediaPreviewFallbackSrc(item.url);
        return (
          <div
            key={`${item.url}-${index}`}
            className="relative size-[4.5rem] shrink-0 overflow-hidden rounded-xl border border-[#bfbfbf]/80 bg-neutral-100"
          >
            <img
              src={src}
              alt={item.filename || "Selected image"}
              className="size-full object-cover"
              onError={(e) => {
                const el = e.currentTarget;
                if (fallback && el.src !== fallback) el.src = fallback;
              }}
            />
            {item.uploading ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/35">
                <Loader2
                  className="size-5 animate-spin text-white"
                  strokeWidth={2}
                />
              </div>
            ) : null}
            {onRemove ? (
              <button
                type="button"
                disabled={disabled}
                onClick={() => onRemove(index)}
                className="absolute right-0.5 top-0.5 inline-flex size-6 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/75 disabled:opacity-40"
                aria-label="Remove image"
              >
                <X className="size-3.5" strokeWidth={2.5} />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

type ChatBubbleImageStripProps = {
  images: ChatImageAttachment[];
  /** Edit user bubble uses dark background. */
  variant?: "create" | "edit-user";
};

/** Sent message: row of thumbnails, then caption below in parent. */
export function ChatBubbleImageStrip({
  images,
  variant = "create",
}: ChatBubbleImageStripProps) {
  if (!images.length) return null;
  const ring =
    variant === "edit-user"
      ? "ring-1 ring-white/20"
      : "ring-1 ring-black/10";
  return (
    <div
      className={`mb-2 flex max-w-[min(100%,20rem)] flex-wrap gap-1.5 ${
        images.length === 1 ? "" : ""
      }`}
    >
      {images.map((item, index) => {
        const src = chatMediaPreviewSrc(item.url) || item.url;
        const fallback = chatMediaPreviewFallbackSrc(item.url);
        const single = images.length === 1;
        return (
          <img
            key={`${item.url}-${index}`}
            src={src}
            alt={item.filename || "Uploaded image"}
            className={`rounded-lg object-cover ${ring} ${
              single
                ? "max-h-40 max-w-[14rem]"
                : "size-[4.5rem] shrink-0"
            }`}
            onError={(e) => {
              const el = e.currentTarget;
              if (fallback && el.src !== fallback) el.src = fallback;
            }}
          />
        );
      })}
    </div>
  );
}
