import { parseNoteBody } from "@/lib/note-body";
import { NoteAttachmentsList } from "@/components/contacts/NoteAttachmentPreview";
import { RichStructuredContent } from "@/components/content/RichStructuredContent";

export function NoteActivityDetails({ body }: { body: string | null }) {
  const note = parseNoteBody(body);

  if (!note.plain && note.attachments.length === 0) {
    return <p className="mt-1.5 text-sm text-text-caption">Empty note</p>;
  }

  return (
    <div className="mt-2.5 space-y-2.5">
      {note.plain ? (
        <RichStructuredContent html={note.html} />
      ) : null}
      <NoteAttachmentsList attachments={note.attachments} />
    </div>
  );
}
