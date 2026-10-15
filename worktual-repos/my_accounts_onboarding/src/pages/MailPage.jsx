import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Download,
  Eye,
  Inbox,
  Mail,
  Paperclip,
  PenSquare,
  RefreshCw,
  Reply,
  Send,
  X,
} from "lucide-react";

import {
  buildReplyDraft,
  disconnectMailOAuth,
  fetchMailAttachment,
  fetchMailConfigStatus,
  fetchMailMessage,
  fetchMailMessages,
  fetchMailOAuthConnectUrl,
  fetchMailWorkspace,
  queueMailSend,
} from "../lib/email.js";
import { getSession, ROLES } from "../lib/auth.js";
import { getCustomerSession } from "../lib/customerAuth.js";
import {
  readMailDetailCache,
  readMailListCache,
  writeMailDetailCache,
  writeMailListCache,
} from "../lib/mailListCache.js";
import { subscribeToAppEvents } from "../lib/eventStream.js";

const MAIL_FOLDERS = [
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "sent", label: "Sent", icon: Send },
  { id: "spam", label: "Spam", icon: AlertTriangle },
];

function formatMailDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  const now = new Date();
  const sameDay =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  if (sameDay) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatMailDateLong(value) {
  if (!value) {
    return "—";
  }

  return new Date(value).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getFolderLabel(folderId) {
  return MAIL_FOLDERS.find((folder) => folder.id === folderId)?.label || "Mail";
}

function parseDisplayName(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "Unknown";
  }

  const quoted = raw.match(/^"([^"]+)"/);
  if (quoted) {
    return quoted[1];
  }

  const named = raw.match(/^(.+?)\s*<[^>]+>$/);
  if (named) {
    return named[1].trim();
  }

  if (raw.includes("@")) {
    return raw.split("@")[0];
  }

  return raw;
}

function getInitials(value) {
  const name = parseDisplayName(value);
  const parts = name.split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
  }

  return name.slice(0, 2).toUpperCase();
}

function getListLabel(message, folder) {
  if (folder === "sent") {
    return parseDisplayName(message.to || message.from);
  }

  return parseDisplayName(message.from);
}

function buildReplyTarget(message, folder) {
  if (folder === "sent") {
    return {
      ...message,
      fromEmail: message.to?.match(/[\w.+-]+@[\w.-]+\.\w+/)?.[0] || message.to,
      from: message.to,
    };
  }

  return message;
}

function splitEmails(value) {
  return String(value || "")
    .split(/[,;]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

export function MailPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const mailboxProfile = useMemo(() => {
    if (getCustomerSession()?.email) {
      return "sales";
    }

    const role = getSession()?.role;
    if (role === ROLES.SALES_ADMIN) {
      return "sales_admin";
    }
    if (role === ROLES.SALES) {
      return "sales";
    }
    if (role === ROLES.ADMIN) {
      // Admin mail uses finance mailbox credentials (no dedicated ADMIN_* mail env).
      return "finance";
    }

    return "finance";
  }, []);

  const [mailConfig, setMailConfig] = useState(null);
  const [activeFolder, setActiveFolder] = useState("inbox");
  const [messages, setMessages] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [listLoading, setListLoading] = useState(true);
  const [listRefreshing, setListRefreshing] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [showReply, setShowReply] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [replyForm, setReplyForm] = useState({ to: "", subject: "", body: "" });
  const [composeForm, setComposeForm] = useState({ to: "", cc: "", bcc: "", subject: "", body: "" });
  const [showComposeCc, setShowComposeCc] = useState(false);
  const [showComposeBcc, setShowComposeBcc] = useState(false);
  const [composeAttachments, setComposeAttachments] = useState([]);
  const composeAttachmentInputRef = useRef(null);
  const [replySending, setReplySending] = useState(false);
  const [composeSending, setComposeSending] = useState(false);
  const [replyError, setReplyError] = useState("");
  const [composeError, setComposeError] = useState("");
  const [replySuccess, setReplySuccess] = useState("");
  const [composeSuccess, setComposeSuccess] = useState("");
  const [attachmentPreview, setAttachmentPreview] = useState(null);
  const [attachmentLoadingId, setAttachmentLoadingId] = useState("");
  const [oauthNotice, setOauthNotice] = useState("");
  const [oauthConnecting, setOauthConnecting] = useState(false);
  const [oauthDisconnecting, setOauthDisconnecting] = useState(false);

  const selectedSummary = useMemo(
    () => messages.find((message) => message.id === selectedId) || null,
    [messages, selectedId],
  );

  const unreadCount = useMemo(
    () => messages.filter((message) => !message.isRead).length,
    [messages],
  );

  async function loadMessages(folder = activeFolder, { forceRefresh = false } = {}) {
    if (!forceRefresh) {
      const cached = readMailListCache(mailboxProfile, folder);
      if (cached?.length) {
        setMessages(cached);
        setListLoading(false);
      }
    } else {
      setListLoading(true);
    }

    setListRefreshing(true);
    setListError("");

    try {
      const data = await fetchMailMessages(folder, 30, mailboxProfile, { forceRefresh });
      const nextMessages = data.messages || [];
      setMessages(nextMessages);
      writeMailListCache(mailboxProfile, folder, nextMessages);
    } catch (error) {
      if (!messages.length) {
        setListError(error instanceof Error ? error.message : "Could not load messages.");
      }
    } finally {
      setListLoading(false);
      setListRefreshing(false);
    }
  }

  async function loadWorkspace(folder = activeFolder, { forceRefresh = false } = {}) {
    if (!forceRefresh) {
      const cached = readMailListCache(mailboxProfile, folder);
      if (cached?.length) {
        setMessages(cached);
        setListLoading(false);
      }
    } else {
      setListLoading(true);
    }

    setListRefreshing(true);
    setListError("");

    try {
      const data = await fetchMailWorkspace(folder, 30, mailboxProfile, { forceRefresh });
      const { messages: nextMessages, folder: _folder, cached: _cached, source: _source, mailError, ...config } =
        data;
      setMailConfig(config);
      const resolvedMessages = nextMessages || [];
      setMessages(resolvedMessages);
      writeMailListCache(mailboxProfile, folder, resolvedMessages);
      if (mailError) {
        setListError(mailError);
        setOauthNotice(mailError);
      }
    } catch (error) {
      try {
        const status = await fetchMailConfigStatus(mailboxProfile);
        setMailConfig(status);
      } catch {
        setMailConfig((current) => current || { imapConfigured: false, profile: mailboxProfile });
      }
      if (!messages.length) {
        setListError(error instanceof Error ? error.message : "Could not load messages.");
      }
    } finally {
      setListLoading(false);
      setListRefreshing(false);
    }
  }

  async function openMessage(messageId, folder = activeFolder) {
    setSelectedId(messageId);
    setDetailError("");
    setShowReply(false);
    setReplyError("");
    setReplySuccess("");

    const cachedDetail = readMailDetailCache(mailboxProfile, folder, messageId);
    if (cachedDetail) {
      setSelectedMessage(cachedDetail);
      setDetailLoading(false);
    } else {
      setSelectedMessage(null);
      setDetailLoading(true);
    }

    setMessages((current) =>
      current.map((message) =>
        message.id === messageId ? { ...message, isRead: true } : message,
      ),
    );

    try {
      const data = await fetchMailMessage(messageId, folder, mailboxProfile);
      setSelectedMessage(data.message);
      writeMailDetailCache(mailboxProfile, folder, messageId, data.message);
    } catch (error) {
      if (!cachedDetail) {
        setDetailError(error instanceof Error ? error.message : "Could not open message.");
      }
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const oauthResult = params.get("oauth");
    const oauthMessage = params.get("message");
    const oauthEmail = params.get("email");

    if (oauthResult === "admin_consent_success") {
      setOauthNotice(
        "Admin consent granted. Now click Sign in with Microsoft to connect your Outlook mailbox.",
      );
      params.delete("oauth");
      navigate(
        {
          pathname: location.pathname,
          search: params.toString() ? `?${params.toString()}` : "",
        },
        { replace: true },
      );
      return;
    }

    if (oauthResult === "success") {
      setOauthNotice(
        oauthEmail
          ? `Outlook connected as ${decodeURIComponent(oauthEmail)}.`
          : "Outlook connected successfully.",
      );
      params.delete("oauth");
      params.delete("message");
      params.delete("email");
      navigate(
        {
          pathname: location.pathname,
          search: params.toString() ? `?${params.toString()}` : "",
        },
        { replace: true },
      );
      loadWorkspace(activeFolder, { forceRefresh: true });
      return;
    }

    if (oauthResult === "error") {
      let resolvedMessage = oauthMessage || "Could not connect Outlook.";
      try {
        resolvedMessage = decodeURIComponent(resolvedMessage);
      } catch {
        // Keep raw message when it is not URI-encoded.
      }
      setOauthNotice(resolvedMessage);
      params.delete("oauth");
      params.delete("message");
      params.delete("email");
      navigate(
        {
          pathname: location.pathname,
          search: params.toString() ? `?${params.toString()}` : "",
        },
        { replace: true },
      );
    }
  }, [location.pathname, location.search]);

  async function handleConnectOutlook() {
    setOauthConnecting(true);
    setOauthNotice("");

    try {
      const data = await fetchMailOAuthConnectUrl(location.pathname);
      if (data?.url) {
        window.location.href = data.url;
        return;
      }

      setOauthNotice("Could not start Outlook sign-in.");
    } catch (error) {
      setOauthNotice(error instanceof Error ? error.message : "Could not start Outlook sign-in.");
    } finally {
      setOauthConnecting(false);
    }
  }

  async function handleDisconnectOutlook() {
    setOauthDisconnecting(true);
    setOauthNotice("");

    try {
      await disconnectMailOAuth();
      setOauthNotice("Outlook disconnected.");
      setMessages([]);
      setSelectedId("");
      setSelectedMessage(null);
      await loadWorkspace(activeFolder, { forceRefresh: true });
    } catch (error) {
      setOauthNotice(error instanceof Error ? error.message : "Could not disconnect Outlook.");
    } finally {
      setOauthDisconnecting(false);
    }
  }

  useEffect(() => {
    const cached = readMailListCache(mailboxProfile, activeFolder);
    if (cached?.length) {
      setMessages(cached);
      setListLoading(false);
    } else {
      setListLoading(true);
    }

    setSelectedId("");
    setSelectedMessage(null);
    setShowReply(false);
    setShowCompose(false);
    loadWorkspace(activeFolder);
  }, [activeFolder, mailboxProfile]);

  useEffect(() => {
    return subscribeToAppEvents({
      channels: ["mail"],
      mailboxProfile,
      onEvent: (payload) => {
        if (payload.event !== "mail.updated") {
          return;
        }

        if (payload.mailboxProfile && payload.mailboxProfile !== mailboxProfile) {
          return;
        }

        void loadMessages(activeFolder, { forceRefresh: true });
      },
    });
  }, [activeFolder, mailboxProfile]);

  function handleFolderChange(folderId) {
    setActiveFolder(folderId);
    setSelectedId("");
    setSelectedMessage(null);
    setDetailError("");
    setShowReply(false);
    setShowCompose(false);
    setAttachmentPreview(null);
  }

  function openCompose() {
    setComposeForm({ to: "", cc: "", bcc: "", subject: "", body: "" });
    setShowComposeCc(false);
    setShowComposeBcc(false);
    setComposeAttachments([]);
    setComposeError("");
    setComposeSuccess("");
    setShowCompose(true);
    setShowReply(false);
    setSelectedId("");
    setSelectedMessage(null);
  }

  async function handleComposeAttachmentsSelected(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";

    if (!files.length) {
      return;
    }

    setComposeError("");

    try {
      const nextAttachments = await Promise.all(
        files.map(async (file) => ({
          id: `${file.name}-${file.size}-${file.lastModified}`,
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
          contentBase64: await readFileAsBase64(file),
        })),
      );

      setComposeAttachments((current) => {
        const seen = new Set(current.map((entry) => entry.id));
        return [...current, ...nextAttachments.filter((entry) => !seen.has(entry.id))];
      });
    } catch (error) {
      setComposeError(error instanceof Error ? error.message : "Could not attach file.");
    }
  }

  function removeComposeAttachment(attachmentId) {
    setComposeAttachments((current) => current.filter((entry) => entry.id !== attachmentId));
  }

  function openReplyComposer() {
    if (!selectedMessage) {
      return;
    }

    const draft = buildReplyDraft(buildReplyTarget(selectedMessage, activeFolder));
    setReplyForm(draft);
    setReplyError("");
    setReplySuccess("");
    setShowCompose(false);
    setShowReply(true);
  }

  async function handleSendCompose(event) {
    event.preventDefault();
    setComposeError("");
    setComposeSuccess("");

    if (!composeForm.subject.trim()) {
      setComposeError("Subject is required.");
      return;
    }

    const to = splitEmails(composeForm.to);
    if (!to.length) {
      setComposeError("Please enter at least one recipient in To.");
      return;
    }

    setComposeSending(true);

    try {
      queueMailSend(
        {
          to,
          cc: splitEmails(composeForm.cc),
          bcc: splitEmails(composeForm.bcc),
          subject: composeForm.subject,
          body: composeForm.body,
          attachments: composeAttachments.map((attachment) => ({
            fileName: attachment.fileName,
            contentType: attachment.contentType,
            contentBase64: attachment.contentBase64,
          })),
        },
        mailboxProfile,
      );

      setComposeSuccess("Message is being sent.");
      setShowCompose(false);
      setComposeForm({ to: "", cc: "", bcc: "", subject: "", body: "" });
      setShowComposeCc(false);
      setShowComposeBcc(false);
      setComposeAttachments([]);
    } catch (error) {
      setComposeError(error instanceof Error ? error.message : "Could not send message.");
    } finally {
      setComposeSending(false);
    }
  }

  async function handleSendReply(event) {
    event.preventDefault();
    setReplyError("");
    setReplySuccess("");

    if (!replyForm.to.trim()) {
      setReplyError("Recipient is required.");
      return;
    }

    setReplySending(true);

    queueMailSend(
      {
        to: [replyForm.to.trim()],
        subject: replyForm.subject,
        body: replyForm.body,
      },
      mailboxProfile,
    );

    setReplySuccess("Reply is being sent.");
    setShowReply(false);
    setReplySending(false);
  }

  async function handleAttachmentAction(attachment, mode) {
    if (!selectedId) {
      return;
    }

    setAttachmentLoadingId(attachment.id);
    setDetailError("");

    try {
      const data = await fetchMailAttachment(selectedId, attachment.id, activeFolder, mailboxProfile);
      const file = data.attachment;
      const dataUrl = `data:${file.contentType};base64,${file.contentBase64}`;

      if (mode === "view" && attachment.isPreviewable) {
        setAttachmentPreview({
          fileName: file.fileName,
          contentType: file.contentType,
          dataUrl,
        });
        return;
      }

      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = file.fileName;
      link.click();
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Could not open attachment.");
    } finally {
      setAttachmentLoadingId("");
    }
  }

  const adminConsentHref = `/api/mail/oauth/admin-consent?returnTo=${encodeURIComponent(location.pathname)}`;
  const adminConsentComplete = /admin consent granted/i.test(oauthNotice);

  const oauthNoticeIsError =
    oauthNotice &&
    /not have an outlook|expired|invalid|denied|failed|error|not supported|reconnect|mail\.read|admin consent|not granted/i.test(
      oauthNotice,
    );

  return (
    <section className="mail-page">
      {oauthNotice ? (
        <p
          className={`mail-page__notice ${oauthNoticeIsError ? "" : "mail-page__notice--info"}`}
        >
          {oauthNotice}
          {oauthNoticeIsError && (mailConfig?.adminConsentUrl || adminConsentHref) ? (
            <>
              {" "}
              <a href={mailConfig?.adminConsentUrl || adminConsentHref} rel="noreferrer">
                Grant admin consent in Azure
              </a>
            </>
          ) : null}
        </p>
      ) : null}

      {mailConfig?.needsOutlookConnect && !mailConfig?.outlookConnected ? (
        <div className="mail-page__outlook-connect">
          <div>
            <strong>Connect your Outlook mailbox</strong>
            {adminConsentComplete ? (
              <p className="mail-page__connect-hint mail-page__connect-hint--success">
                Admin consent is complete. Click <strong>Sign in with Microsoft</strong> to link your
                mailbox.
              </p>
            ) : (
              <>
                <p>
                  Sign in with a <strong>Microsoft 365</strong> or <strong>Outlook.com</strong> account
                  that has an Outlook mailbox. Gmail and other external guest accounts are not
                  supported for Graph mail.
                </p>
                <ol className="mail-page__connect-steps">
                  <li>
                    <strong>Grant admin consent</strong> (one-time, M365 admin):{" "}
                    <a href={adminConsentHref}>Open admin consent in Azure</a>
                  </li>
                  <li>
                    <strong>Sign in</strong> with a Microsoft 365 or Outlook.com account that has an
                    Outlook mailbox (not Gmail).
                  </li>
                </ol>
                <p className="mail-page__connect-hint">
                  Already granted admin consent in Azure? Skip step 1 and click Sign in below.
                </p>
              </>
            )}
          </div>
          <button
            className="primary-button"
            disabled={oauthConnecting}
            onClick={handleConnectOutlook}
            type="button"
          >
            {oauthConnecting ? "Redirecting..." : "Sign in with Microsoft"}
          </button>
        </div>
      ) : null}

      {mailConfig?.outlookConnected ? (
        <div className="mail-page__outlook-status">
          <span>
            Outlook connected as <strong>{mailConfig.outlookEmail}</strong>
          </span>
          <button
            className="secondary-button"
            disabled={oauthDisconnecting}
            onClick={handleDisconnectOutlook}
            type="button"
          >
            {oauthDisconnecting ? "Disconnecting..." : "Disconnect"}
          </button>
        </div>
      ) : null}

      {mailConfig && !mailConfig.mailReady && !mailConfig.needsOutlookConnect && !mailConfig.outlookConnected ? (
        <p className="mail-page__notice">
          Mail is not configured. Add Microsoft OAuth values or IMAP/SMTP credentials in the
          project <code>.env</code> file.
        </p>
      ) : null}

      <div className="mail-workspace">
        <aside className="mail-folders" aria-label="Mail folders">
          <div className="mail-folders__title">Folders</div>
          {MAIL_FOLDERS.map((folder) => {
            const Icon = folder.icon;
            const folderUnread =
              folder.id === activeFolder ? unreadCount : folder.id === "inbox" ? unreadCount : 0;

            return (
              <button
                className={`mail-folders__item ${activeFolder === folder.id ? "is-active" : ""}`}
                key={folder.id}
                onClick={() => handleFolderChange(folder.id)}
                type="button"
              >
                <Icon size={17} />
                <span>{folder.label}</span>
                {folder.id === "inbox" && unreadCount > 0 ? (
                  <span className="mail-folders__badge">{unreadCount}</span>
                ) : null}
                {folder.id !== "inbox" && folderUnread > 0 && activeFolder === folder.id ? (
                  <span className="mail-folders__badge">{folderUnread}</span>
                ) : null}
              </button>
            );
          })}
        </aside>

        <div className={`mail-list-pane ${selectedId && !showCompose ? "is-mobile-hidden" : ""}`}>
          <div className="mail-list-pane__header">
            <div>
              <strong>{getFolderLabel(activeFolder)}</strong>
              <span>
                {messages.length} messages
                {unreadCount > 0 ? ` · ${unreadCount} unread` : ""}
              </span>
            </div>
            <button
              aria-label="Refresh messages"
              className={`mail-list-pane__refresh ${listRefreshing ? "is-spinning" : ""}`}
              disabled={listRefreshing || mailConfig?.imapConfigured === false}
              onClick={() => loadMessages(activeFolder, { forceRefresh: true })}
              type="button"
            >
              <RefreshCw size={16} />
            </button>
            <button
              className="mail-list-pane__compose"
              disabled={!mailConfig?.smtpConfigured}
              onClick={openCompose}
              type="button"
            >
              <PenSquare size={16} />
              Compose
            </button>
          </div>

          {listError ? <p className="form-error mail-list-pane__status">{listError}</p> : null}
          {listLoading ? <p className="mail-list-pane__status">Loading messages...</p> : null}
          {!listLoading && listRefreshing ? (
            <p className="mail-list-pane__status mail-list-pane__status--subtle">Updating...</p>
          ) : null}

          {!listLoading && !listError && messages.length === 0 ? (
            <p className="mail-list-pane__status">No messages in this folder.</p>
          ) : null}

          <ul className="mail-list-pane__items">
            {messages.map((message) => {
              const label = getListLabel(message, activeFolder);
              const isUnread = !message.isRead;

              return (
                <li key={message.id}>
                  <button
                    className={`mail-list-item ${selectedId === message.id ? "is-active" : ""} ${isUnread ? "is-unread" : "is-read"}`}
                    onClick={() => openMessage(message.id)}
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className={`mail-list-item__status ${isUnread ? "is-unread" : ""}`}
                    />
                    <span aria-hidden="true" className="mail-list-item__avatar">
                      {getInitials(label)}
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
                      {message.preview ? (
                        <span className="mail-list-item__preview">{message.preview}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className={`mail-read-pane ${selectedId || showCompose ? "is-open" : ""}`}>
          {showCompose ? (
            <form className="mail-compose" onSubmit={handleSendCompose}>
              <div className="mail-compose__chrome">
                <div className="mail-compose__chrome-title">
                  <PenSquare size={16} />
                  New message
                </div>
                <button
                  aria-label="Close compose"
                  className="mail-compose__chrome-close"
                  onClick={() => setShowCompose(false)}
                  type="button"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="mail-compose__header-fields">
                <label className="mail-compose-row mail-compose-row--to">
                  <span className="mail-compose-row__label">To</span>
                  <input
                    className="mail-compose-row__input"
                    onChange={(event) =>
                      setComposeForm((current) => ({ ...current, to: event.target.value }))
                    }
                    placeholder="recipient@company.com"
                    required
                    type="text"
                    value={composeForm.to}
                  />
                  <div className="mail-compose-row__actions">
                    {!showComposeCc ? (
                      <button onClick={() => setShowComposeCc(true)} type="button">
                        Cc
                      </button>
                    ) : null}
                    {!showComposeBcc ? (
                      <button onClick={() => setShowComposeBcc(true)} type="button">
                        Bcc
                      </button>
                    ) : null}
                  </div>
                </label>

                {showComposeCc ? (
                  <label className="mail-compose-row">
                    <span className="mail-compose-row__label">Cc</span>
                    <input
                      className="mail-compose-row__input"
                      onChange={(event) =>
                        setComposeForm((current) => ({ ...current, cc: event.target.value }))
                      }
                      placeholder="Optional Cc recipients"
                      type="text"
                      value={composeForm.cc}
                    />
                  </label>
                ) : null}

                {showComposeBcc ? (
                  <label className="mail-compose-row">
                    <span className="mail-compose-row__label">Bcc</span>
                    <input
                      className="mail-compose-row__input"
                      onChange={(event) =>
                        setComposeForm((current) => ({ ...current, bcc: event.target.value }))
                      }
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
              </div>

              <textarea
                className="mail-compose__body"
                onChange={(event) =>
                  setComposeForm((current) => ({ ...current, body: event.target.value }))
                }
                placeholder="Write your message..."
                rows={12}
                value={composeForm.body}
              />

              <div className="mail-compose__footer">
                <div className="mail-compose__attachments">
                  <span className="mail-compose__attachments-label">Attachments</span>
                  <div className="mail-compose__attachment-chips">
                    {composeAttachments.map((attachment) => (
                      <span className="mail-compose__attachment-chip" key={attachment.id}>
                        <Paperclip size={14} />
                        {attachment.fileName}
                        <button
                          aria-label={`Remove ${attachment.fileName}`}
                          onClick={() => removeComposeAttachment(attachment.id)}
                          type="button"
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                  <button
                    className="secondary-button"
                    onClick={() => composeAttachmentInputRef.current?.click()}
                    type="button"
                  >
                    <Paperclip size={14} />
                    Attach files
                  </button>
                  <input
                    className="sr-only"
                    multiple
                    onChange={handleComposeAttachmentsSelected}
                    ref={composeAttachmentInputRef}
                    type="file"
                  />
                </div>

                <div className="mail-compose__actions">
                  {composeError ? <p className="form-error mail-compose__error">{composeError}</p> : null}
                  {composeSuccess ? <p className="form-success">{composeSuccess}</p> : null}
                  <button
                    className="secondary-button"
                    onClick={() => setShowCompose(false)}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="primary-button mail-compose__send"
                    disabled={composeSending}
                    type="submit"
                  >
                    <Send size={16} />
                    {composeSending ? "Sending..." : "Send"}
                  </button>
                </div>
              </div>
            </form>
          ) : !selectedId ? (
            <div className="mail-read-pane__empty">
              <Mail size={32} />
              <strong>Select a message to read</strong>
              <p>Choose an email from {getFolderLabel(activeFolder).toLowerCase()}.</p>
            </div>
          ) : detailLoading && !selectedMessage ? (
            <div className="mail-read-pane__empty">
              <RefreshCw size={24} />
              <strong>Opening message...</strong>
            </div>
          ) : detailError && !selectedMessage ? (
            <div className="mail-read-pane__empty">
              <p className="form-error">{detailError}</p>
              <button
                className="secondary-button"
                onClick={() => openMessage(selectedId)}
                type="button"
              >
                Retry
              </button>
            </div>
          ) : selectedMessage ? (
            <>
              <header className="mail-read-pane__header">
                <button
                  className="mail-read-pane__back"
                  onClick={() => {
                    setSelectedId("");
                    setSelectedMessage(null);
                    setShowReply(false);
                    setAttachmentPreview(null);
                  }}
                  type="button"
                >
                  <ArrowLeft size={16} />
                  Back
                </button>

                <div className="mail-read-pane__actions">
                  <button
                    className="mail-read-pane__action"
                    disabled={!mailConfig?.smtpConfigured || activeFolder === "spam"}
                    onClick={openReplyComposer}
                    type="button"
                  >
                    <Reply size={16} />
                    Reply
                  </button>
                </div>

                <h2>{selectedMessage.subject || "(No subject)"}</h2>
                <div className="mail-read-pane__sender">
                  <span aria-hidden="true" className="mail-read-pane__avatar">
                    {getInitials(
                      activeFolder === "sent"
                        ? selectedMessage.to || selectedMessage.from
                        : selectedMessage.from,
                    )}
                  </span>
                  <div className="mail-read-pane__sender-meta">
                    <strong>
                      {activeFolder === "sent"
                        ? parseDisplayName(selectedMessage.to || selectedMessage.from)
                        : parseDisplayName(selectedMessage.from)}
                    </strong>
                    {selectedMessage.to ? (
                      <span className="mail-read-pane__recipients">
                        To: {selectedMessage.to}
                      </span>
                    ) : null}
                  </div>
                  <time dateTime={selectedMessage.date || undefined}>
                    {formatMailDateLong(selectedMessage.date)}
                  </time>
                </div>
              </header>

              {selectedMessage.attachments?.length ? (
                <div className="mail-read-pane__attachments">
                  {selectedMessage.attachments.map((attachment) => (
                    <div className="mail-read-pane__attachment-card" key={attachment.id}>
                      <Paperclip size={14} />
                      <span className="mail-read-pane__attachment-name">{attachment.fileName}</span>
                      <span className="mail-read-pane__attachment-size">
                        {attachment.size ? `${Math.round(attachment.size / 1024)} KB` : ""}
                      </span>
                      <div className="mail-read-pane__attachment-actions">
                        {attachment.isPreviewable ? (
                          <button
                            className="mail-read-pane__attachment-btn"
                            disabled={attachmentLoadingId === attachment.id}
                            onClick={() => handleAttachmentAction(attachment, "view")}
                            type="button"
                          >
                            <Eye size={14} />
                            View
                          </button>
                        ) : null}
                        <button
                          className="mail-read-pane__attachment-btn"
                          disabled={attachmentLoadingId === attachment.id}
                          onClick={() => handleAttachmentAction(attachment, "download")}
                          type="button"
                        >
                          <Download size={14} />
                          Download
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {showReply ? (
                <form className="mail-reply" onSubmit={handleSendReply}>
                  <div className="mail-reply__header">
                    <strong>Reply</strong>
                    <button
                      aria-label="Close reply"
                      className="mail-reply__close"
                      onClick={() => setShowReply(false)}
                      type="button"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <label className="mail-reply__field">
                    <span>To</span>
                    <input
                      onChange={(event) =>
                        setReplyForm((current) => ({ ...current, to: event.target.value }))
                      }
                      required
                      type="email"
                      value={replyForm.to}
                    />
                  </label>
                  <label className="mail-reply__field">
                    <span>Subject</span>
                    <input
                      onChange={(event) =>
                        setReplyForm((current) => ({ ...current, subject: event.target.value }))
                      }
                      required
                      type="text"
                      value={replyForm.subject}
                    />
                  </label>
                  <textarea
                    className="mail-reply__body"
                    onChange={(event) =>
                      setReplyForm((current) => ({ ...current, body: event.target.value }))
                    }
                    rows={8}
                    value={replyForm.body}
                  />
                  {replyError ? <p className="form-error">{replyError}</p> : null}
                  {replySuccess ? <p className="form-success">{replySuccess}</p> : null}
                  <div className="mail-reply__footer">
                    <button
                      className="secondary-button"
                      onClick={() => setShowReply(false)}
                      type="button"
                    >
                      Cancel
                    </button>
                    <button className="primary-button" disabled={replySending} type="submit">
                      <Send size={16} />
                      {replySending ? "Sending..." : "Send reply"}
                    </button>
                  </div>
                </form>
              ) : null}

              {detailError ? <p className="form-error mail-read-pane__inline-error">{detailError}</p> : null}

              <article className="mail-read-pane__body">
                {selectedMessage.body?.split("\n").map((line, index) => (
                  <p key={`${index}-${line.slice(0, 12)}`}>{line || "\u00A0"}</p>
                ))}
              </article>
            </>
          ) : selectedSummary ? (
            <div className="mail-read-pane__empty">
              <strong>{selectedSummary.subject || "(No subject)"}</strong>
              <p>{selectedSummary.preview}</p>
            </div>
          ) : null}
        </div>
      </div>

      {attachmentPreview ? (
        <div className="mail-attachment-modal" role="dialog" aria-modal="true">
          <div
            className="mail-attachment-modal__backdrop"
            onClick={() => setAttachmentPreview(null)}
          />
          <div className="mail-attachment-modal__panel">
            <header className="mail-attachment-modal__header">
              <strong>{attachmentPreview.fileName}</strong>
              <button
                aria-label="Close attachment preview"
                className="mail-attachment-modal__close"
                onClick={() => setAttachmentPreview(null)}
                type="button"
              >
                <X size={18} />
              </button>
            </header>
            <div className="mail-attachment-modal__body">
              {attachmentPreview.contentType.startsWith("image/") ? (
                <img alt={attachmentPreview.fileName} src={attachmentPreview.dataUrl} />
              ) : (
                <iframe
                  className="mail-attachment-modal__pdf"
                  src={attachmentPreview.dataUrl}
                  title={attachmentPreview.fileName}
                />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
