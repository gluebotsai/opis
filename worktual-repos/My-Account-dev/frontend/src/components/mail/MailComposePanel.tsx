// @ts-nocheck
import { useRef } from "react";
import { Paperclip, PenSquare, Send, X } from "lucide-react";

import { MailMessageBody } from "../MailMessageBody.tsx";
import { MailRichEditor } from "../MailRichEditor.tsx";
import { htmlToPlainText } from "../../lib/mailSignature.js";
import { validateMailRecipients } from "../../lib/emailValidation.js";

export function MailComposePanel({
  title = "New message",
  composeForm,
  setComposeForm,
  showCc,
  setShowCc,
  showBcc,
  setShowBcc,
  attachments,
  onAttachmentsSelected,
  onRemoveAttachment,
  importance,
  onImportanceChange,
  sensitivity,
  onSensitivityChange,
  onInsertSignature,
  onCheckNames,
  onClose,
  onSubmit,
  sending,
  error,
  success,
  templates = [],
  onApplyTemplate,
  signatureHtml = "",
}) {
  const attachmentInputRef = useRef(null);
  const signatureRef = useRef(null);
  const hasSignature = Boolean(String(signatureHtml || "").trim());

  function handleInsertSignature() {
    if (hasSignature && signatureRef.current) {
      signatureRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    onInsertSignature?.();
  }


  function handleSubmit(event) {
    event.preventDefault();
    const recipientCheck = validateMailRecipients({
      to: composeForm.to,
      cc: composeForm.cc,
      bcc: composeForm.bcc,
    });
    if (!recipientCheck.valid) {
      onSubmit(event, { error: recipientCheck.message });
      return;
    }

    if (!composeForm.subject.trim()) {
      onSubmit(event, { error: "Subject is required." });
      return;
    }

    onSubmit(event, {
      payload: {
        to: recipientCheck.to,
        cc: recipientCheck.cc,
        bcc: recipientCheck.bcc,
        subject: composeForm.subject,
        body: htmlToPlainText(composeForm.htmlBody),
        htmlBody: composeForm.htmlBody,
        importance,
        sensitivity,
        attachments: attachments.map((attachment) => ({
          fileName: attachment.fileName,
          contentType: attachment.contentType,
          contentBase64: attachment.contentBase64,
        })),
      },
    });
  }

  const headerFields = (
      <div className="mail-compose__header-fields">
        <label className="mail-compose-row mail-compose-row--to">
          <span className="mail-compose-row__label">To</span>
          <input
            className="mail-compose-row__input"
            onChange={(event) => setComposeForm((current) => ({ ...current, to: event.target.value }))}
            placeholder="recipient@company.com"
            required
            type="text"
            value={composeForm.to}
          />
          <div className="mail-compose-row__actions">
            {!showCc ? (
              <button onClick={() => setShowCc(true)} type="button">
                Cc
              </button>
            ) : null}
            {!showBcc ? (
              <button onClick={() => setShowBcc(true)} type="button">
                Bcc
              </button>
            ) : null}
          </div>
        </label>

        {showCc ? (
          <label className="mail-compose-row">
            <span className="mail-compose-row__label">Cc</span>
            <input
              className="mail-compose-row__input"
              onChange={(event) => setComposeForm((current) => ({ ...current, cc: event.target.value }))}
              placeholder="Optional Cc recipients"
              type="text"
              value={composeForm.cc}
            />
          </label>
        ) : null}

        {showBcc ? (
          <label className="mail-compose-row">
            <span className="mail-compose-row__label">Bcc</span>
            <input
              className="mail-compose-row__input"
              onChange={(event) => setComposeForm((current) => ({ ...current, bcc: event.target.value }))}
              placeholder="Optional Bcc recipients"
              type="text"
              value={composeForm.bcc}
            />
          </label>
        ) : null}

        <label className="mail-compose-row">
          <span className="mail-compose-row__label">Subject</span>
          <input
            className="mail-compose-row__input"
            onChange={(event) =>
              setComposeForm((current) => ({ ...current, subject: event.target.value }))
            }
            required
            type="text"
            value={composeForm.subject}
          />
        </label>

        {templates.length > 0 ? (
          <label className="mail-compose-row">
            <span className="mail-compose-row__label">Template</span>
            <select
              className="mail-compose-row__input"
              defaultValue=""
              onChange={(event) => {
                const templateId = event.target.value;
                if (!templateId) {
                  return;
                }
                const template = templates.find((entry) => entry.id === templateId);
                if (template) {
                  onApplyTemplate?.(template);
                }
                event.target.value = "";
              }}
            >
              <option value="">Insert template…</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
  );

  return (
    <form className="mail-compose mail-compose--overlay" onSubmit={handleSubmit}>
      <div className="mail-compose__chrome">
        <div className="mail-compose__chrome-title">
          <PenSquare size={16} />
          {title}
        </div>
        <button aria-label="Close compose" className="mail-compose__chrome-close" onClick={onClose} type="button">
          <X size={16} />
        </button>
      </div>

      <MailRichEditor
        beforeContent={headerFields}
        className="mail-rich-editor--compose"
        importance={importance}
        minHeight={140}
        onAttachFiles={() => attachmentInputRef.current?.click()}
        onChange={(htmlBody) =>
          setComposeForm((current) => ({
            ...current,
            htmlBody,
            body: htmlToPlainText(htmlBody),
          }))
        }
        onCheckNames={onCheckNames}
        onImportanceChange={onImportanceChange}
        onInsertSignature={hasSignature ? handleInsertSignature : onInsertSignature}
        onSensitivityChange={onSensitivityChange}
        placeholder="Write your message..."
        sensitivity={sensitivity}
        value={composeForm.htmlBody}
      />

      {hasSignature ? (
        <div
          ref={signatureRef}
          aria-label="Email signature"
          className="mail-compose__signature"
        >
          <div className="mail-compose__signature-label">Signature</div>
          <div className="mail-compose__signature-body">
            <MailMessageBody
              htmlBody={signatureHtml}
              maxHeight={220}
              minHeight={40}
              textBody=""
            />
          </div>
        </div>
      ) : null}

      <div className="mail-compose__footer">
        <input
          className="sr-only"
          multiple
          onChange={onAttachmentsSelected}
          ref={attachmentInputRef}
          type="file"
        />
        {attachments.length ? (
          <div className="mail-compose__attachment-chips">
            {attachments.map((attachment) => (
              <span className="mail-compose__attachment-chip" key={attachment.id}>
                <Paperclip size={14} />
                {attachment.fileName}
                <button
                  aria-label={`Remove ${attachment.fileName}`}
                  onClick={() => onRemoveAttachment(attachment.id)}
                  type="button"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <div className="mail-compose__actions">
          {error ? <p className="form-error mail-compose__error">{error}</p> : null}
          {success ? <p className="form-success">{success}</p> : null}
          <button className="secondary-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="primary-button mail-compose__send" disabled={sending} type="submit">
            <Send size={16} />
            {sending ? "Sending..." : "Send"}
          </button>
        </div>
      </div>
    </form>
  );
}
