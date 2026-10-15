import {
  useRef,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Send, Square } from "lucide-react";
import { ComposerImageStrip } from "@/components/chat/ChatImageTiles";
import { useAutoGrowTextarea } from "@/hooks/useAutoGrowTextarea";

export type ComposerPendingImage = {
  previewUrl: string;
  filename: string;
  /** Set after warm-upload succeeds. */
  imageUrl?: string;
  mediaId?: string;
};

type AgentChatComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  /** While busy: show Stop and block send; input stays typable unless disabled. */
  busy?: boolean;
  onStop?: () => void;
  /** Hard disable (paused / no template) — blocks typing too. */
  disabled?: boolean;
  placeholder?: string;
  busyPlaceholder?: string;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  /** Left of the textarea (e.g. attach). */
  leading?: ReactNode;
  /** Right of textarea, before Send/Stop (e.g. mic). */
  trailing?: ReactNode;
  className?: string;
  /** Outer max width wrapper; pass empty string to skip. */
  maxWidthClass?: string;
  /** Selected image waiting to send (blob preview and/or uploaded URL). */
  pendingImage?: ComposerPendingImage | null;
  /** Several files on one send (edit space). Takes precedence over pendingImage. */
  pendingImages?: ComposerPendingImage[];
  onClearPendingImage?: () => void;
  onRemovePendingImage?: (index: number) => void;
};

/**
 * Shared co-worker chat composer — CCaaS CopilotChatInput pattern.
 */
export function AgentChatComposer({
  value,
  onChange,
  onSend,
  busy = false,
  onStop,
  disabled = false,
  placeholder = "Ask your question",
  busyPlaceholder = "Type next message…",
  inputRef,
  leading,
  trailing,
  className = "shrink-0 px-4 py-2.5",
  maxWidthClass = "max-w-3xl",
  pendingImage = null,
  pendingImages,
  onClearPendingImage,
  onRemovePendingImage,
}: AgentChatComposerProps) {
  const localRef = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef || localRef;
  useAutoGrowTextarea(ref, value);

  const previews =
    pendingImages && pendingImages.length > 0
      ? pendingImages
      : pendingImage
        ? [pendingImage]
        : [];
  const canSend = Boolean(value.trim() || previews.length);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (disabled || busy) return;
    if (!canSend) return;
    onSend();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (disabled || busy) return;
      if (!canSend) return;
      onSend();
    }
  };

  const showStop = Boolean(busy && onStop);

  const composerTiles = previews
    .map((item) => {
      const url = item.previewUrl?.trim() || item.imageUrl?.trim() || "";
      if (!url) return null;
      return {
        url,
        filename: item.filename,
        uploading: !item.imageUrl?.trim(),
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));

  return (
    <form onSubmit={submit} className={className}>
      <div className={`mx-auto w-full ${maxWidthClass}`.trim()}>
        <div className="rounded-2xl border-[0.6px] border-[#bfbfbf] bg-neutral-50 focus-within:border-[#bfbfbf] focus-within:bg-white focus-within:ring-2 focus-within:ring-neutral-200">
          <ComposerImageStrip
            items={composerTiles}
            disabled={disabled || busy}
            onRemove={
              onRemovePendingImage
                ? onRemovePendingImage
                : onClearPendingImage
                  ? () => onClearPendingImage()
                  : undefined
            }
          />
          <div
            className={`flex items-end gap-1.5 p-1.5 ${composerTiles.length ? "pt-0" : ""}`}
          >
          {leading}
          <textarea
            ref={ref}
            rows={1}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              disabled
                ? placeholder
                : busy
                  ? busyPlaceholder
                  : previews.length
                    ? "Add a caption (optional)"
                    : placeholder
            }
            className="min-h-[38px] flex-1 resize-none overflow-hidden bg-transparent px-2 py-2 text-sm leading-5 text-neutral-900 outline-none placeholder:text-neutral-400 disabled:cursor-not-allowed disabled:opacity-60"
          />
          {trailing}
          {showStop ? (
            <button
              type="button"
              onClick={onStop}
              className="inline-flex size-[38px] shrink-0 items-center justify-center rounded-xl bg-[#171717] text-white shadow-[0_2px_8px_rgba(0,0,0,0.18)] hover:bg-neutral-800"
              aria-label="Stop generating"
              title="Stop"
            >
              <Square className="size-[18px] fill-current" strokeWidth={0} />
            </button>
          ) : (
            <button
              type="submit"
              disabled={disabled || busy || !canSend}
              className="inline-flex size-[38px] shrink-0 items-center justify-center rounded-xl bg-[#171717] text-white shadow-[0_2px_8px_rgba(0,0,0,0.18)] hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 disabled:shadow-none"
              aria-label="Send"
              title="Send"
            >
              <Send className="size-[18px]" strokeWidth={2.25} />
            </button>
          )}
          </div>
        </div>
      </div>
    </form>
  );
}
