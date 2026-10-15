import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { ChevronDown, Eye, Paperclip, Send, X, ArrowLeft } from "lucide-react";
import type { ComposeContactOption } from "@/components/email/types";
import { ComposeAssistField } from "@/components/email/ComposeAssistField";
import { RecipientEmailField } from "@/components/email/RecipientEmailField";
import { RichTextEditor } from "@/components/email/RichTextEditor";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { htmlToPlainText, plainTextToEmailHtml, sanitizeEmailHtml } from "@/lib/email-body";
import { validateOutboundEmailContent } from "@/lib/outbound-email-guard";
import { searchContactsForCompose } from "@/services/contacts";
import { composeInboxAssist, resolveContactForEmail, sendInboxEmail } from "@/services/inbox";

type PendingAttachment = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  contentBase64: string;
};

const MAX_ATTACHMENTS = 5;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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

function messageIsEmpty(html: string): boolean {
  return !htmlToPlainText(html).trim();
}

/** Close only on a primary press that started on the dimmed backdrop. */
function closeOnBackdropPress(
  event: { target: EventTarget | null; currentTarget: EventTarget; button: number },
  close: () => void,
) {
  if (event.button !== 0) return;
  if (event.target !== event.currentTarget) return;
  close();
}

export function EmailComposeDialog({
  onClose,
  onSent,
  initialContact,
  initialTo = "",
  initialSubject = "",
  initialMessage = "",
}: {
  onClose: () => void;
  onSent?: () => void;
  initialContact?: ComposeContactOption | null;
  initialTo?: string;
  initialSubject?: string;
  initialMessage?: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contacts, setContacts] = useState<ComposeContactOption[]>(
    initialContact ? [initialContact] : [],
  );
  const [toEmail, setToEmail] = useState(initialTo || initialContact?.email || "");
  const [selectedContact, setSelectedContact] = useState<ComposeContactOption | null>(
    initialContact ?? null,
  );
  const [subject, setSubject] = useState(initialSubject);
  const [messageHtml, setMessageHtml] = useState(() => {
    if (!initialMessage.trim()) return "";
    if (/<[a-z][\s\S]*>/i.test(initialMessage)) return initialMessage;
    return initialMessage
      .split(/\n{2,}/)
      .map((block) => `<p>${block.replace(/\n/g, "<br>")}</p>`)
      .join("");
  });
  const [showCc, setShowCc] = useState(false);
  const [cc, setCc] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [assistPrompt, setAssistPrompt] = useState("");
  const [assistPending, setAssistPending] = useState(false);
  const [assistError, setAssistError] = useState<string | null>(null);
  const [assistSource, setAssistSource] = useState<"ai" | "heuristic" | null>(null);

  useEffect(() => {
    let cancelled = false;
    void searchContactsForCompose().then((items) => {
      if (cancelled) return;
      setContacts((prev) => {
        const merged = [...prev];
        for (const item of items) {
          if (!merged.some((c) => c.id === item.id)) merged.push(item);
        }
        return merged;
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function resolveContactId(): Promise<string | null> {
    if (selectedContact) return selectedContact.id;
    const result = await resolveContactForEmail(toEmail);
    if (!result.ok) {
      setError(result.error);
      return null;
    }
    return result.contactId;
  }

  async function onPickFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    setError(null);
    const next = [...attachments];
    for (const file of Array.from(fileList)) {
      if (next.length >= MAX_ATTACHMENTS) {
        setError(`You can attach up to ${MAX_ATTACHMENTS} files.`);
        break;
      }
      if (file.size > MAX_FILE_BYTES) {
        setError(`“${file.name}” exceeds the 5 MB per-file limit.`);
        continue;
      }
      try {
        const contentBase64 = await readFileAsBase64(file);
        next.push({
          id: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`,
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
          contentBase64,
        });
      } catch {
        setError(`Could not read “${file.name}”.`);
      }
    }
    setAttachments(next);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function validateBeforeSend(): boolean {
    setError(null);
    if (!toEmail.trim()) {
      setError("Enter a recipient email address.");
      return false;
    }
    if (messageIsEmpty(messageHtml) && !subject.trim()) {
      setError("Write a subject or message before sending.");
      return false;
    }
    const recipientLabel = selectedContact?.displayName ?? toEmail.trim();
    const subj = subject.trim() || `Message for ${recipientLabel}`;
    const bodyHtml = messageIsEmpty(messageHtml)
      ? "<p>(No message body)</p>"
      : sanitizeEmailHtml(messageHtml);
    const contentCheck = validateOutboundEmailContent({
      subject: subj,
      body: bodyHtml,
    });
    if (!contentCheck.ok) {
      setError(contentCheck.error);
      return false;
    }
    return true;
  }

  function openPreview() {
    if (!validateBeforeSend()) return;
    setPreviewOpen(true);
  }

  async function onSend() {
    if (!validateBeforeSend()) return;
    setPending(true);

    const contactId = await resolveContactId();
    if (!contactId) {
      setPending(false);
      return;
    }

    const recipientLabel = selectedContact?.displayName ?? toEmail.trim();
    const subj = subject.trim() || `Message for ${recipientLabel}`;
    const bodyHtml = messageIsEmpty(messageHtml)
      ? "<p>(No message body)</p>"
      : sanitizeEmailHtml(messageHtml);

    const sendResult = await sendInboxEmail({
      contactId,
      to: toEmail.trim(),
      subject: subj,
      body: bodyHtml,
      cc: cc.trim() || undefined,
      attachments: attachments.map((file) => ({
        filename: file.filename,
        contentType: file.contentType,
        content: file.contentBase64,
      })),
    });

    setPending(false);

    if (sendResult.ok) {
      // Activity is already logged by /api/inbox/send — do not create a second
      // contact_activity with the same gmail_message_id (unique constraint).
      onSent?.();
      onClose();
      return;
    }

    if (sendResult.needsConnect) {
      setError(
        `${sendResult.error} Open Configuration → Email to connect Google or Microsoft, then try again.`,
      );
      return;
    }

    setError(sendResult.error);
  }

  function runComposeAssist(instruction: string) {
    const trimmed = instruction.trim();
    if (!trimmed) return;
    setAssistError(null);
    setAssistPending(true);
    const draftText = htmlToPlainText(messageHtml).trim();
    void composeInboxAssist({
      instruction: trimmed,
      contactId: selectedContact?.id,
      contactName: selectedContact?.displayName || toEmail.trim() || "there",
      subject,
      currentBody: draftText || undefined,
    }).then((result) => {
      setAssistPending(false);
      if (!result.ok) {
        setAssistError(result.error);
        return;
      }
      setSubject(result.subject);
      setMessageHtml(plainTextToEmailHtml(result.body.trim()));
      setAssistPrompt("");
      setAssistSource(result.source);
    });
  }

  const previewHtml = sanitizeEmailHtml(
    messageIsEmpty(messageHtml) ? "<p>(No message body)</p>" : messageHtml,
  );

  return createPortal(
    <>
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => closeOnBackdropPress(e, onClose)}
    >
      <div
        className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border-default bg-surface shadow-lg"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-default px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-text-primary">New email</h3>
            <p className="mt-0.5 text-xs text-text-caption">
              Format, attach files, and preview before sending
            </p>
          </div>
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1 text-sm text-text-caption hover:text-text-primary"
            onClick={() => setShowCc((v) => !v)}
          >
            Cc
            <ChevronDown className="size-3.5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="border-b border-border-default">
            <RecipientEmailField
              toEmail={toEmail}
              onToEmailChange={setToEmail}
              selectedContact={selectedContact}
              onSelectContact={setSelectedContact}
              contacts={contacts}
              disabled={pending}
            />
            {showCc ? (
              <label className="flex items-center gap-3 border-t border-border-default px-4 py-2.5 sm:px-5">
                <span className="w-14 shrink-0 text-xs text-text-caption">Cc</span>
                <input
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  placeholder="cc@example.com"
                  disabled={pending}
                  autoComplete="off"
                  name="crm-compose-cc"
                  data-1p-ignore
                  data-lpignore="true"
                  className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-placeholder"
                />
              </label>
            ) : null}
          </div>

          <div className="space-y-3 px-5 py-4">
            <Input
              label="Subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              disabled={pending}
              autoComplete="off"
              name="crm-compose-subject"
              data-1p-ignore
              data-lpignore="true"
              data-form-type="other"
            />
            <div>
              <p className="mb-1.5 text-sm font-medium text-text-primary">Message</p>
              <RichTextEditor
                valueHtml={messageHtml}
                onChange={setMessageHtml}
                disabled={pending || assistPending}
              />
            </div>
            {assistError ? (
              <p className="text-sm text-text-danger">{assistError}</p>
            ) : assistSource ? (
              <p className="text-xs text-text-caption">
                {assistSource === "ai"
                  ? "Generated by AI — review before sending."
                  : "Offline draft (AI unavailable) — edit before sending."}
              </p>
            ) : null}
            <ComposeAssistField
              value={assistPrompt}
              onChange={setAssistPrompt}
              onSubmit={runComposeAssist}
              pending={assistPending}
              disabled={pending}
            />

            {attachments.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {attachments.map((file) => (
                  <li
                    key={file.id}
                    className="inline-flex max-w-full items-center gap-2 rounded-lg border border-border-default bg-subtle/70 px-2.5 py-1.5 text-xs text-text-secondary"
                  >
                    <Paperclip className="size-3.5 shrink-0" />
                    <span className="min-w-0 truncate font-medium text-text-primary">
                      {file.filename}
                    </span>
                    <span className="shrink-0 text-text-caption">
                      {formatFileSize(file.size)}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${file.filename}`}
                      disabled={pending}
                      className="rounded p-0.5 text-text-caption hover:bg-surface hover:text-text-primary"
                      onClick={() =>
                        setAttachments((prev) =>
                          prev.filter((item) => item.id !== file.id),
                        )
                      }
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {error ? (
            <p className="px-5 pb-2 text-sm text-text-danger">
              {error}{" "}
              {error.includes("Configuration") ? (
                <Link
                  to="/configuration/email"
                  className="font-medium text-text-link hover:underline"
                >
                  Open Email settings
                </Link>
              ) : null}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border-default px-5 py-4">
          <div className="flex items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => void onPickFiles(e.target.files)}
            />
            <Button
              type="button"
              variant="secondary"
              className="h-10 px-3"
              disabled={pending || attachments.length >= MAX_ATTACHMENTS}
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="size-4" />
              Attach
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="h-10 px-3"
              disabled={pending}
              onClick={openPreview}
            >
              <Eye className="size-4" />
              Preview
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" variant="primary" onClick={() => void onSend()} disabled={pending}>
              <Send className="size-4" />
              {pending ? "Sending…" : "Send"}
            </Button>
          </div>
        </div>
      </div>
    </div>

      {previewOpen ? (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Email preview"
          onMouseDown={(e) =>
            closeOnBackdropPress(e, () => setPreviewOpen(false))
          }
        >
          <div
            className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border-default bg-surface shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-border-default px-5 py-4">
              <div>
                <h3 className="text-base font-semibold text-text-primary">
                  Preview
                </h3>
                <p className="mt-0.5 text-xs text-text-caption">
                  Review the message before it leaves your mailbox
                </p>
              </div>
              <button
                type="button"
                className="rounded-md p-1.5 text-text-caption hover:bg-subtle hover:text-text-primary"
                aria-label="Close preview"
                onClick={() => setPreviewOpen(false)}
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4 text-sm">
              <dl className="space-y-2 border-b border-border-default pb-3">
                <div className="flex gap-3">
                  <dt className="w-16 shrink-0 text-text-caption">To</dt>
                  <dd className="min-w-0 break-all text-text-primary">
                    {toEmail.trim()}
                  </dd>
                </div>
                {cc.trim() ? (
                  <div className="flex gap-3">
                    <dt className="w-16 shrink-0 text-text-caption">Cc</dt>
                    <dd className="min-w-0 break-all text-text-primary">
                      {cc.trim()}
                    </dd>
                  </div>
                ) : null}
                <div className="flex gap-3">
                  <dt className="w-16 shrink-0 text-text-caption">Subject</dt>
                  <dd className="min-w-0 text-text-primary">
                    {subject.trim() ||
                      `Message for ${selectedContact?.displayName ?? toEmail.trim()}`}
                  </dd>
                </div>
              </dl>

              <div
                className="prose-sm max-w-none text-text-primary [&_a]:text-text-link [&_a]:underline [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />

              {attachments.length > 0 ? (
                <div className="border-t border-border-default pt-3">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-caption">
                    Attachments
                  </p>
                  <ul className="space-y-1 text-sm text-text-secondary">
                    {attachments.map((file) => (
                      <li key={file.id} className="flex items-center gap-2">
                        <Paperclip className="size-3.5" />
                        <span>
                          {file.filename}{" "}
                          <span className="text-text-caption">
                            ({formatFileSize(file.size)})
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>

            <div className="flex shrink-0 justify-end gap-2 border-t border-border-default px-5 py-4">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setPreviewOpen(false)}
                disabled={pending}
              >
                <ArrowLeft className="size-4" strokeWidth={1.75} />
                Back to edit
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={pending}
                onClick={() => {
                  setPreviewOpen(false);
                  void onSend();
                }}
              >
                <Send className="size-4" />
                {pending ? "Sending…" : "Send"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>,
    document.body,
  );
}
