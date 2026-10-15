import { useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import { RichTextEditor } from "@/components/email/RichTextEditor";
import { Button } from "@/components/ui/Button";
import { NoteAttachmentsList } from "@/components/contacts/NoteAttachmentPreview";
import {
  encodeNoteBody,
  noteBodyIsEmpty,
  NOTE_MAX_ATTACHMENTS,
  NOTE_MAX_FILE_BYTES,
  type NoteAttachment,
} from "@/lib/note-body";

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const base64 = result.includes(",") ? result.split(",")[1]! : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

export function NoteComposer({
  pending = false,
  error = null,
  submitLabel = "Save note",
  onCancel,
  onSubmit,
}: {
  pending?: boolean;
  error?: string | null;
  submitLabel?: string;
  onCancel?: () => void;
  onSubmit: (encodedBody: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [html, setHtml] = useState("");
  const [attachments, setAttachments] = useState<NoteAttachment[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);

  async function onPickFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    setLocalError(null);
    const next = [...attachments];
    for (const file of Array.from(fileList)) {
      if (next.length >= NOTE_MAX_ATTACHMENTS) {
        setLocalError(`You can attach up to ${NOTE_MAX_ATTACHMENTS} files.`);
        break;
      }
      if (file.size > NOTE_MAX_FILE_BYTES) {
        setLocalError(`“${file.name}” exceeds the 5 MB per-file limit.`);
        continue;
      }
      try {
        const contentBase64 = await readFileAsBase64(file);
        next.push({
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
          contentBase64,
        });
      } catch {
        setLocalError(`Could not read “${file.name}”.`);
      }
    }
    setAttachments(next);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function save() {
    setLocalError(null);
    if (noteBodyIsEmpty(html) && attachments.length === 0) {
      setLocalError("Write a note or attach a file.");
      return;
    }
    onSubmit(
      encodeNoteBody({
        html: noteBodyIsEmpty(html) ? "<p></p>" : html,
        attachments,
      }),
    );
  }

  const displayError = localError || error;

  return (
    <div className="grid gap-3">
      <div>
        <label className="mb-2 block text-sm font-medium text-text-primary">
          Description
        </label>
        <RichTextEditor
          valueHtml={html}
          onChange={setHtml}
          placeholder="Write your note… Use the toolbar for bold, italic, lists, and links."
          disabled={pending}
          minHeightClass="min-h-[140px]"
        />
      </div>

      <div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
          className="hidden"
          onChange={(e) => void onPickFiles(e.target.files)}
        />
        <Button
          type="button"
          variant="secondary"
          disabled={pending || attachments.length >= NOTE_MAX_ATTACHMENTS}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip className="size-4" strokeWidth={1.75} />
          Attach files
        </Button>
        <p className="mt-1.5 text-xs text-text-caption">
          Up to {NOTE_MAX_ATTACHMENTS} files, 5 MB each. Images and PDFs preview
          as soon as you attach them.
        </p>
        <div className="mt-2">
          <NoteAttachmentsList
            attachments={attachments}
            compact
            onRemove={(index) =>
              setAttachments((prev) => prev.filter((_, i) => i !== index))
            }
          />
        </div>
      </div>

      {displayError ? (
        <p className="text-sm text-text-danger" role="alert">
          {displayError}
        </p>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        {onCancel ? (
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={onCancel}
          >
            Cancel
          </Button>
        ) : null}
        <Button type="button" variant="primary" disabled={pending} onClick={save}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </div>
  );
}
