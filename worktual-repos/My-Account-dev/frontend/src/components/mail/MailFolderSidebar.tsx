// @ts-nocheck
import {
  AlertTriangle,
  Archive,
  FileStack,
  FileText,
  Inbox,
  PenLine,
  Send,
} from "lucide-react";

import { MAIL_FOLDER_OPTIONS } from "../../lib/mailUi.js";

const FOLDER_ICONS = {
  inbox: Inbox,
  sent: Send,
  drafts: FileText,
  archive: Archive,
  spam: AlertTriangle,
  signature: PenLine,
  templates: FileStack,
};

const SIDEBAR_FOLDERS = MAIL_FOLDER_OPTIONS.filter(
  (folder) => folder.id !== "signature" && folder.id !== "templates",
);
const SIDEBAR_SETTINGS = MAIL_FOLDER_OPTIONS.filter(
  (folder) => folder.id === "signature" || folder.id === "templates",
);

export function MailFolderSidebar({
  activeFolder,
  unreadCount,
  onFolderChange,
}) {
  return (
    <aside className="mail-sidebar" aria-label="Mail folders">
      <div className="mail-sidebar__section">
        <div className="mail-sidebar__title">Folders</div>
        {SIDEBAR_FOLDERS.map((folder) => {
          const Icon = FOLDER_ICONS[folder.id] || Inbox;
          return (
            <button
              className={`mail-sidebar__item ${activeFolder === folder.id ? "is-active" : ""}`}
              key={folder.id}
              onClick={() => onFolderChange(folder.id)}
              type="button"
            >
              <Icon size={16} />
              <span>{folder.label}</span>
              {folder.id === "inbox" && unreadCount > 0 ? (
                <span className="mail-sidebar__badge">{unreadCount}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="mail-sidebar__section">
        {SIDEBAR_SETTINGS.map((folder) => {
          const Icon = FOLDER_ICONS[folder.id] || PenLine;
          return (
            <button
              className={`mail-sidebar__item ${activeFolder === folder.id ? "is-active" : ""}`}
              key={folder.id}
              onClick={() => onFolderChange(folder.id)}
              type="button"
            >
              <Icon size={16} />
              <span>{folder.label}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
