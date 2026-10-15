import { ArrowUp, Mic, Paperclip, Pause, Smile, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";

import { InternalChatEmojiPicker } from "@/components/internal-chat/internal-chat-emoji-picker";
import { InternalChatPendingAttachments } from "@/components/internal-chat/internal-chat-file-attachment";
import { buttonClassName, IconButton } from "@/components/ui/button";
import {
  formatVoiceDuration,
  useVoiceRecorder,
} from "@/features/internal-chat/use-voice-recorder";
import { fitComposerTextarea } from "@/lib/fit-composer-textarea";
import { cn } from "@/lib/utils";

type InternalChatComposerProps = {
  draft: string;
  pendingAttachments: File[];
  disabled?: boolean;
  onDraftChange: (value: string) => void;
  onAddAttachments: (files: File[]) => void;
  onRemoveAttachment: (index: number) => void;
  onClearAttachments?: () => void;
  onSend: () => void;
  onSendVoiceNote?: (payload: { durationMs: number; audioBlob: Blob }) => void;
};

export function InternalChatComposer({
  draft,
  pendingAttachments,
  disabled = false,
  onDraftChange,
  onAddAttachments,
  onRemoveAttachment,
  onClearAttachments,
  onSend,
  onSendVoiceNote,
}: InternalChatComposerProps) {
  const fileInputId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [emojiOpen, setEmojiOpen] = useState(false);
  const {
    active: voiceSessionActive,
    paused: voicePaused,
    recordingMs,
    error: recordingError,
    start: startRecording,
    pause: pauseRecording,
    resume: resumeRecording,
    stop: stopRecording,
    cancel: cancelRecording,
    clearError,
  } = useVoiceRecorder();

  const canSend = (Boolean(draft.trim()) || pendingAttachments.length > 0) && !disabled;
  const canSendVoice = voiceSessionActive && recordingMs >= 500;

  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    fitComposerTextarea(textarea);
  };

  useEffect(() => {
    adjustTextareaHeight();
  }, [draft]);

  function handleDraftChange(value: string) {
    onDraftChange(value);
    requestAnimationFrame(adjustTextareaHeight);
  }

  function insertEmoji(emoji: string) {
    handleDraftChange(`${draft}${emoji}`);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend) onSend();
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files;
    if (!selected?.length || disabled) {
      event.target.value = "";
      return;
    }
    onAddAttachments(Array.from(selected));
    event.target.value = "";
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  async function handleStartRecording() {
    if (disabled) return;
    clearError();
    setEmojiOpen(false);
    await startRecording();
  }

  function handleDeleteRecording() {
    cancelRecording();
  }

  async function handleSendVoiceNote() {
    const result = await stopRecording();
    if (!result) return;

    onSendVoiceNote?.({ durationMs: result.durationMs, audioBlob: result.blob });
  }

  return (
    <div className="shrink-0 bg-white px-4 py-3 sm:px-5">
      {recordingError ? (
        <p className="mb-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {recordingError}
        </p>
      ) : null}

      <div className="relative">
        {emojiOpen && !voiceSessionActive ? (
          <InternalChatEmojiPicker
            onSelect={insertEmoji}
            onClose={() => setEmojiOpen(false)}
          />
        ) : null}

        <div
          className={cn(
            "relative rounded-xl border-[0.6px] border-[#bfbfbf] bg-neutral-50/80 transition",
            !voiceSessionActive &&
              "focus-within:border-neutral-300 focus-within:bg-white focus-within:shadow-sm focus-within:ring-2 focus-within:ring-neutral-200/70",
            voiceSessionActive && "border-neutral-300 bg-white shadow-sm",
            disabled && "opacity-60",
          )}
        >
          {pendingAttachments.length > 0 && !voiceSessionActive ? (
            <InternalChatPendingAttachments
              files={pendingAttachments}
              onRemove={onRemoveAttachment}
              onClearAll={onClearAttachments}
            />
          ) : null}

          {voiceSessionActive ? (
            <div className="flex items-center gap-2 p-1.5">
              <IconButton
                variant="ghostIcon"
                onClick={handleDeleteRecording}
                aria-label="Delete recording"
                title="Delete"
                className="size-9 shrink-0 text-neutral-600 hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 className="size-4" />
              </IconButton>

              <div className="flex min-w-0 flex-1 items-center gap-2">
                {!voicePaused ? (
                  <span className="flex size-2 shrink-0 animate-pulse rounded-full bg-red-500" />
                ) : null}
                <span className="shrink-0 text-sm font-medium tabular-nums text-neutral-800">
                  {formatVoiceDuration(recordingMs)}
                </span>
                <div className="flex h-6 min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
                  {Array.from({ length: 24 }, (_, index) => (
                    <span
                      key={index}
                      className={cn(
                        "w-0.5 shrink-0 rounded-full bg-neutral-300",
                        !voicePaused && "animate-pulse",
                      )}
                      style={{ height: `${28 + ((index * 19 + 7) % 56)}%` }}
                    />
                  ))}
                </div>
              </div>

              <IconButton
                variant="ghostIcon"
                onClick={voicePaused ? resumeRecording : pauseRecording}
                aria-label={voicePaused ? "Resume recording" : "Pause recording"}
                title={voicePaused ? "Resume" : "Pause"}
                className="size-9 shrink-0 text-neutral-600"
              >
                {voicePaused ? <Mic className="size-4" /> : <Pause className="size-4 fill-current" />}
              </IconButton>

              <button
                type="button"
                disabled={!canSendVoice}
                onClick={() => void handleSendVoiceNote()}
                aria-label="Send voice message"
                className={buttonClassName(canSendVoice ? "send" : "sendDisabled")}
              >
                <ArrowUp className="size-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-end p-1.5">
              <IconButton
                variant="ghostIcon"
                disabled={disabled}
                onClick={() => setEmojiOpen((open) => !open)}
                aria-label="Insert emoji"
                title="Emoji"
                className="mb-0.5 size-9 shrink-0"
              >
                <Smile className="size-4" />
              </IconButton>
              <input
                id={fileInputId}
                ref={fileInputRef}
                type="file"
                multiple
                disabled={disabled}
                className="sr-only"
                onChange={handleFileChange}
              />
              <label
                htmlFor={fileInputId}
                aria-label="Attach file"
                title="Attach file"
                className={cn(
                  buttonClassName("ghostIcon", "mb-0.5 size-9 shrink-0 cursor-pointer"),
                  disabled && "pointer-events-none opacity-50",
                )}
              >
                <Paperclip className="size-4" />
              </label>
              <textarea
                ref={textareaRef}
                value={draft}
                disabled={disabled}
                onChange={(event) => handleDraftChange(event.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder={pendingAttachments.length > 0 ? "Add a caption…" : "Write a message…"}
                className="min-h-[2.25rem] flex-1 resize-none overflow-hidden bg-transparent px-1.5 py-2 text-sm leading-5 text-neutral-900 outline-none placeholder:text-neutral-600"
              />
              <IconButton
                variant="ghostIcon"
                disabled={disabled}
                onClick={() => void handleStartRecording()}
                aria-label="Record voice message"
                title="Voice message"
                className="mb-0.5 size-9 shrink-0"
              >
                <Mic className="size-4" />
              </IconButton>
              <button
                type="button"
                disabled={!canSend}
                onClick={onSend}
                aria-label="Send message"
                className={buttonClassName(canSend ? "send" : "sendDisabled", "mb-0.5")}
              >
                <ArrowUp className="size-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
