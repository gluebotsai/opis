type MailFolderDefinition = {
  id: string;
  label: string;
  graphWellKnown: string;
  graphDisplayNames?: string[];
};

export const MAIL_FOLDER_DEFINITIONS: MailFolderDefinition[] = [
  { id: "inbox", label: "Inbox", graphWellKnown: "inbox" },
  { id: "sent", label: "Sent Items", graphWellKnown: "sentitems" },
  { id: "drafts", label: "Drafts", graphWellKnown: "drafts" },
  { id: "archive", label: "Archive", graphWellKnown: "archive" },
  { id: "spam", label: "Junk Email", graphWellKnown: "junkemail" },
  /** Not shown in sidebar; used for delete / move-to-trash. */
  { id: "deleted", label: "Deleted Items", graphWellKnown: "deleteditems" },
];

export const MAIL_FOLDER_IDS = MAIL_FOLDER_DEFINITIONS.map((folder) => folder.id);

export const PSEUDO_MAIL_FOLDERS = ["signature", "templates"];

export function isValidMailFolder(folderKey: any) {
  return MAIL_FOLDER_IDS.includes(String(folderKey || "").toLowerCase());
}

export function getMailFolderDefinition(folderKey: any) {
  return MAIL_FOLDER_DEFINITIONS.find((folder) => folder.id === folderKey) || null;
}

export function getMailFolderLabel(folderKey: any) {
  return getMailFolderDefinition(folderKey)?.label || "Mail";
}

export function getGraphWellKnownFolderId(folderKey: any) {
  return getMailFolderDefinition(folderKey)?.graphWellKnown || null;
}

export function getGraphDisplayNameHints(folderKey: any) {
  const definition = getMailFolderDefinition(folderKey);
  if (!definition) {
    return [];
  }
  return definition.graphDisplayNames || (definition.label ? [definition.label] : []);
}

export function getImapFolderCandidates(folderKey: any, config = {}) {
  const candidates = {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    inbox: [config.imapInbox, "INBOX"],
    sent: [
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      config.imapSent,
      "[Gmail]/Sent Mail",
      "[Gmail]/Sent",
      "Sent",
      "Sent Items",
      "Sent Messages",
      "INBOX.Sent",
    ],
    drafts: ["Drafts", "[Gmail]/Drafts", "INBOX.Drafts"],
    archive: ["Archive", "[Gmail]/All Mail", "All Mail"],
    spam: [
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      config.imapSpam,
      "[Gmail]/Spam",
      "[Gmail]/Bulk Mail",
      "Spam",
      "Junk",
      "Junk E-mail",
      "Junk Email",
      "Bulk Mail",
    ],
    deleted: ["Trash", "[Gmail]/Trash", "Deleted Items", "Deleted Messages", "INBOX.Trash"],
  };

  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  return [...new Set((candidates[folderKey] || []).filter(Boolean))];
}

export function matchImapFolder(folderKey: any, box: any) {
  const path = box.path || "";
  const name = box.name || "";
  const combined = `${path} ${name}`;

  const patterns = {
    inbox: /(^|\/)INBOX$/i,
    sent: /sent/i,
    drafts: /draft/i,
    archive: /archive|all mail/i,
    spam: /spam|junk|bulk/i,
    deleted: /trash|deleted/i,
  };

  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const pattern = patterns[folderKey];
  if (!pattern) {
    return false;
  }

  return pattern.test(combined);
}
