// @ts-nocheck
import { ChevronLeft, ChevronRight, Paperclip } from "lucide-react";

import {
  formatMailDate,
  getListLabel,
  groupMessagesByDate,
} from "../../lib/mailUi.js";
import { getAvatarTone, getProfileInitials } from "../../lib/brandColors.js";

export function MailMessageList({
  activeFolder,
  inboxView,
  onInboxViewChange,
  messages,
  selectedId,
  onSelectMessage,
  listLoading,
  listError,
  folderUnavailable,
  page,
  totalPages,
  totalMessages,
  onPageChange,
  searchQuery = "",
  listFilter = "all",
  isListFiltered = false,
  listDensity = "comfortable",
  showPreview = true,
  needsOutlookConnect = false,
}) {
  const groupedMessages = groupMessagesByDate(messages);

  function getEmptyMessage() {
    if (needsOutlookConnect) {
      return "Connect Outlook to load mail. Use Sign in with Microsoft in the toolbar.";
    }

    if (folderUnavailable) {
      return "This folder is not available for this mailbox.";
    }

    if (isListFiltered) {
      if (searchQuery.trim()) {
        return `No messages match "${searchQuery.trim()}".`;
      }
      if (listFilter === "unread") {
        return "No unread messages in this folder.";
      }
      if (listFilter === "read") {
        return "No read messages in this folder.";
      }
      if (listFilter === "attachments") {
        return "No messages with attachments in this folder.";
      }
      if (listFilter === "flagged") {
        return "No flagged messages in this folder.";
      }
      return "No messages match the current filters.";
    }

    return "No messages in this folder.";
  }

  return (
    <div className={`mail-list-pane mail-list-pane--${listDensity}`}>
      {activeFolder === "inbox" ? (
        <div className="mail-list-tabs">
          <button
            className={`mail-list-tabs__item ${inboxView === "focused" ? "is-active" : ""}`}
            onClick={() => onInboxViewChange("focused")}
            type="button"
          >
            Focused
          </button>
          <button
            className={`mail-list-tabs__item ${inboxView === "other" ? "is-active" : ""}`}
            onClick={() => onInboxViewChange("other")}
            type="button"
          >
            Other
          </button>
        </div>
      ) : null}

      {listLoading ? <p className="mail-list-pane__status">Loading messages...</p> : null}
      {!listLoading && !listError && messages.length === 0 ? (
        <p className="mail-list-pane__status">{getEmptyMessage()}</p>
      ) : null}

      <div className="mail-list-pane__items">
        {groupedMessages.map((group) => (
          <section className="mail-date-group" key={group.label}>
            <h3 className="mail-date-group__title">{group.label}</h3>
            <ul className="mail-list-pane__list">
              {group.messages.map((message) => {
                const label = getListLabel(message, activeFolder);
                const isUnread = !message.isRead;

                return (
                  <li key={message.id}>
                    <button
                      className={`mail-list-item ${selectedId === message.id ? "is-active" : ""} ${isUnread ? "is-unread" : "is-read"}`}
                      onClick={() => onSelectMessage(message.id)}
                      type="button"
                    >
                      <span
                        aria-hidden="true"
                        className={`mail-list-item__status ${isUnread ? "is-unread" : ""}`}
                      />
                      <span
                        aria-hidden="true"
                        className={`mail-list-item__avatar mail-list-item__avatar--${getAvatarTone(label)}`}
                      >
                        {getProfileInitials(label)}
                      </span>
                      <span className="mail-list-item__content">
                        <span className="mail-list-item__row">
                          <strong>{label}</strong>
                          <span className="mail-list-item__meta">
                            {message.hasAttachments ? <Paperclip size={13} /> : null}
                            <time dateTime={message.date || undefined}>
                              {formatMailDate(message.date)}
                            </time>
                          </span>
                        </span>
                        <span className="mail-list-item__subject">
                          {message.subject || "(No subject)"}
                        </span>
                        {showPreview && message.preview ? (
                          <span className="mail-list-item__preview">{message.preview}</span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <footer className="mail-list-footer">
        <span>{totalMessages} messages</span>
        <div className="mail-list-footer__pager">
          <button
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            type="button"
          >
            <ChevronLeft size={16} />
          </button>
          <span>
            {page} of {totalPages}
          </span>
          <button
            aria-label="Next page"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            type="button"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </footer>
    </div>
  );
}
