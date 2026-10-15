// @ts-nocheck
import {
  ArrowLeft,
  Download,
  Eye,
  Flag,
  FolderInput,
  Forward,
  MoreHorizontal,
  Reply,
  ReplyAll,
  Trash2,
} from "lucide-react";

import { hasHtmlMailBody, MailMessageBody } from "../MailMessageBody.tsx";
import {
  formatMailDateLong,
  getListLabel,
  MAIL_MOVE_FOLDER_OPTIONS,
  parseDisplayName,
} from "../../lib/mailUi.js";
import { getAvatarTone, getProfileInitials } from "../../lib/brandColors.js";

export function MailReadPane({
  activeFolder,
  selectedMessage,
  detailLoading,
  detailError,
  mailConfig,
  attachmentLoadingId,
  moveMenuOpen,
  onBack,
  onMoveMenuToggle,
  onReply,
  onReplyAll,
  onForward,
  onDelete,
  onMove,
  onFlag,
  onAttachmentAction,
  onDownloadAllAttachments,
}) {
  const paneOpenClass =
    selectedMessage || detailLoading ? "mail-read-pane is-open" : "mail-read-pane";

  const backButton =
    typeof onBack === "function" ? (
      <button className="mail-read-pane__back" onClick={onBack} type="button">
        <ArrowLeft size={16} />
        Back
      </button>
    ) : null;

  if (!selectedMessage && detailLoading) {
    return (
      <div className={paneOpenClass}>
        {backButton}
        <div className="mail-read-pane__empty">
          <strong>Opening message...</strong>
        </div>
      </div>
    );
  }

  if (!selectedMessage) {
    return (
      <div className={paneOpenClass}>
        <div className="mail-read-pane__empty">
          <strong>Select a message to read</strong>
          <p>Choose an email from your folder list.</p>
        </div>
      </div>
    );
  }

  const visibleAttachments =
    selectedMessage.attachments?.filter((attachment) => !attachment.isInline) || [];
  const senderLabel =
    activeFolder === "sent"
      ? parseDisplayName(selectedMessage.to || selectedMessage.from)
      : parseDisplayName(selectedMessage.from);

  return (
    <div className={paneOpenClass}>
      {backButton}
      <div className="mail-read-actions">
        <div className="mail-read-actions__primary">
          <button
            className="secondary-button"
            disabled={!mailConfig?.smtpConfigured || activeFolder === "spam"}
            onClick={onReply}
            type="button"
          >
            <Reply size={15} />
            Reply
          </button>
          <button
            className="secondary-button"
            disabled={!mailConfig?.smtpConfigured || activeFolder === "spam"}
            onClick={onReplyAll}
            type="button"
          >
            <ReplyAll size={15} />
            Reply all
          </button>
          <button
            className="secondary-button"
            disabled={!mailConfig?.smtpConfigured}
            onClick={onForward}
            type="button"
          >
            <Forward size={15} />
            Forward
          </button>
        </div>
        <div className="mail-read-actions__secondary">
          <button
            aria-label="Flag message"
            className={`icon-button ${selectedMessage.isFlagged ? "is-active" : ""}`}
            onClick={() => onFlag(!selectedMessage.isFlagged)}
            type="button"
          >
            <Flag size={16} />
          </button>
          <button aria-label="Delete message" className="icon-button" onClick={onDelete} type="button">
            <Trash2 size={16} />
          </button>
          <div className="mail-read-actions__move">
            <button
              aria-label="Move message"
              className="icon-button"
              onClick={onMoveMenuToggle}
              type="button"
            >
              <FolderInput size={16} />
            </button>
            {moveMenuOpen ? (
              <div className="mail-read-actions__move-menu">
                {MAIL_MOVE_FOLDER_OPTIONS.filter((folder) => folder.id !== activeFolder).map((folder) => (
                  <button key={folder.id} onClick={() => onMove(folder.id)} type="button">
                    {folder.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button aria-label="More actions" className="icon-button" type="button">
            <MoreHorizontal size={16} />
          </button>
        </div>
      </div>

      <header className="mail-read-pane__header">
        <h2>{selectedMessage.subject || "(No subject)"}</h2>
        <div className="mail-read-pane__sender">
          <span
            aria-hidden="true"
            className={`mail-read-pane__avatar mail-read-pane__avatar--${getAvatarTone(
              getListLabel(selectedMessage, activeFolder),
            )}`}
          >
            {getProfileInitials(getListLabel(selectedMessage, activeFolder))}
          </span>
          <div className="mail-read-pane__sender-meta">
            <strong>{senderLabel}</strong>
            {selectedMessage.to ? (
              <span className="mail-read-pane__recipients">To: {selectedMessage.to}</span>
            ) : null}
          </div>
          <time dateTime={selectedMessage.date || undefined}>
            {formatMailDateLong(selectedMessage.date)}
          </time>
        </div>
      </header>

      {visibleAttachments.length ? (
        <div className="mail-read-pane__attachments">
          <div className="mail-attachment-grid">
            {visibleAttachments.map((attachment) => (
              <article className="mail-attachment-card" key={attachment.id}>
                <PaperclipIcon />
                <div className="mail-attachment-card__meta">
                  <strong>{attachment.fileName}</strong>
                  <span>{attachment.size ? `${Math.round(attachment.size / 1024)} KB` : ""}</span>
                </div>
                <div className="mail-attachment-card__actions">
                  {attachment.isPreviewable ? (
                    <button
                      disabled={attachmentLoadingId === attachment.id}
                      onClick={() => onAttachmentAction(attachment, "view")}
                      type="button"
                    >
                      <Eye size={14} />
                    </button>
                  ) : null}
                  <button
                    disabled={attachmentLoadingId === attachment.id}
                    onClick={() => onAttachmentAction(attachment, "download")}
                    type="button"
                  >
                    <Download size={14} />
                  </button>
                </div>
              </article>
            ))}
          </div>
          <button className="text-button" onClick={onDownloadAllAttachments} type="button">
            Download all
          </button>
        </div>
      ) : null}

      {detailError ? <p className="form-error mail-read-pane__inline-error">{detailError}</p> : null}

      <article
        className={`mail-read-pane__body${
          hasHtmlMailBody(selectedMessage.htmlBody) ? " mail-read-pane__body--html" : ""
        }`}
      >
        <MailMessageBody htmlBody={selectedMessage.htmlBody} textBody={selectedMessage.body} />
      </article>
    </div>
  );
}

function PaperclipIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16">
      <path
        d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}
