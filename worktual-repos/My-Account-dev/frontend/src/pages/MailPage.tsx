// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { X } from "lucide-react";

import { AdminPageToast } from "../components/admin/AdminPageToast.tsx";
import { MailComposePanel } from "../components/mail/MailComposePanel.tsx";
import { MailFolderSidebar } from "../components/mail/MailFolderSidebar.tsx";
import { MailMessageList } from "../components/mail/MailMessageList.tsx";
import { MailReadPane } from "../components/mail/MailReadPane.tsx";
import { MailTopBar } from "../components/mail/MailTopBar.tsx";
import { MailSignaturePanel } from "../components/MailSignaturePanel.tsx";
import { MailTemplatesPanel } from "../components/MailTemplatesPanel.tsx";
import {
  appendSignatureToHtml,
  fetchMailSignature,
  htmlToPlainText,
} from "../lib/mailSignature.js";
import { fetchMailTemplates } from "../lib/numberManagement.js";
import {
  applyMailListPipeline,
  buildForwardDraft,
  buildReplyAllDraft,
  paginateMessages,
  readMailTags,
} from "../lib/mailUi.js";
import {
  buildReplyDraft,
  disconnectMailOAuth,
  fetchMailAttachment,
  fetchMailConfigStatus,
  fetchMailMessage,
  fetchMailMessages,
  fetchMailWorkspace,
  flagMailMessage,
  mailConfigNeedsOutlookConnect,
  moveMailMessage,
  clearMailOAuthPopupPending,
  notifyMailOAuthOpener,
  queueMailSend,
  startMailOAuthConnect,
  subscribeMailOAuthResult,
  isMailOAuthPopupWindow,
  isMailOAuthPopupPending,
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
import { humanizeMailError, isMailErrorRecoverable, shouldSuppressMailListStatusError } from "../lib/mailErrors.js";

const EMPTY_COMPOSE = { to: "", cc: "", bcc: "", subject: "", body: "", htmlBody: "" };
const MAIL_OAUTH_NOTICE_SUCCESS =
  /connected successfully|connected as|disconnected\.|admin consent granted|redirecting to microsoft/i;

function presentMailError(message) {
  return humanizeMailError(message);
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

export function MailPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const session = getSession();

  const mailboxProfile = useMemo(() => {
    if (getCustomerSession()?.email) {
      return "sales";
    }

    const role = session?.role;
    if (role === ROLES.SALES_ADMIN) {
      return "sales_admin";
    }
    if (role === ROLES.SALES) {
      return "sales";
    }
    if (role === ROLES.ADMIN) {
      return "admin";
    }
    if (role === ROLES.NUMBER_MANAGEMENT) {
      return "number_management";
    }

    return "finance";
  }, [session?.role]);

  const [mailConfig, setMailConfig] = useState(null);
  const [activeFolder, setActiveFolder] = useState("inbox");
  const [inboxView, setInboxView] = useState("focused");
  const [searchQuery, setSearchQuery] = useState("");
  const [listFilter, setListFilter] = useState("all");
  const [sortBy, setSortBy] = useState("date-desc");
  const [listDensity, setListDensity] = useState("comfortable");
  const [showPreview, setShowPreview] = useState(true);
  const [activeTag, setActiveTag] = useState("");
  const [listPage, setListPage] = useState(1);
  const [messages, setMessages] = useState([]);
  const [folderUnavailable, setFolderUnavailable] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [listLoading, setListLoading] = useState(true);
  const [listRefreshing, setListRefreshing] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [composeMode, setComposeMode] = useState("");
  const [composeForm, setComposeForm] = useState(EMPTY_COMPOSE);
  const [composeImportance, setComposeImportance] = useState("normal");
  const [composeSensitivity, setComposeSensitivity] = useState("normal");
  const [signatureHtml, setSignatureHtml] = useState("");
  const [mailTemplates, setMailTemplates] = useState([]);
  const [showComposeCc, setShowComposeCc] = useState(false);
  const [showComposeBcc, setShowComposeBcc] = useState(false);
  const [composeAttachments, setComposeAttachments] = useState([]);
  const [composeSending, setComposeSending] = useState(false);
  const [composeError, setComposeError] = useState("");
  const [composeSuccess, setComposeSuccess] = useState("");
  const [attachmentPreview, setAttachmentPreview] = useState(null);
  const [attachmentLoadingId, setAttachmentLoadingId] = useState("");
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  const [oauthNotice, setOauthNotice] = useState("");
  const [oauthConnecting, setOauthConnecting] = useState(false);
  const [oauthDisconnecting, setOauthDisconnecting] = useState(false);
  const [setupBannerDismissed, setSetupBannerDismissed] = useState(() => {
    try {
      return sessionStorage.getItem("worktual.mail.setup-banner-dismissed") === "1";
    } catch {
      return false;
    }
  });
  const autoOutlookConnectAttempted = useRef(false);
  const workspaceFolderKeyRef = useRef(null);

  const tagMap = readMailTags();

  const filteredMessages = useMemo(
    () =>
      applyMailListPipeline(messages, {
        searchQuery,
        tagId: activeTag,
        tagMap,
        listFilter,
        sortBy,
        activeFolder,
      }),
    [messages, searchQuery, activeTag, tagMap, listFilter, sortBy, activeFolder],
  );

  const isListFiltered =
    Boolean(searchQuery.trim()) || listFilter !== "all" || Boolean(activeTag);

  const pagination = useMemo(
    () => paginateMessages(filteredMessages, listPage, 15),
    [filteredMessages, listPage],
  );

  const unreadCount = useMemo(
    () => messages.filter((message) => !message.isRead).length,
    [messages],
  );

  async function loadWorkspace(folder = activeFolder, { forceRefresh = false, view = null } = {}) {
    if (folder === "signature" || folder === "templates") {
      setListLoading(false);
      setListRefreshing(false);
      setMessages([]);
      setFolderUnavailable(false);
      try {
        const status = await fetchMailConfigStatus(mailboxProfile);
        setMailConfig(status);
      } catch {
        setMailConfig((current) => current || { imapConfigured: false, profile: mailboxProfile });
      }
      return;
    }

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
      const data = await fetchMailWorkspace(folder, 30, mailboxProfile, {
        forceRefresh,
        view: folder === "inbox" ? view || inboxView : null,
      });
      const {
        messages: nextMessages,
        folder: _folder,
        cached: _cached,
        source: _source,
        mailError,
        folderUnavailable: unavailable,
        ...config
      } = data;
      setMailConfig(config);
      setMessages(nextMessages || []);
      setFolderUnavailable(Boolean(unavailable));
      writeMailListCache(mailboxProfile, folder, nextMessages || []);
      if (mailError) {
        const friendlyError = presentMailError(mailError);
        if (
          !shouldSuppressMailListStatusError(mailError) &&
          !shouldSuppressMailListStatusError(friendlyError)
        ) {
          setListError(friendlyError);
        }
        if (
          isMailErrorRecoverable(mailError) ||
          isMailErrorRecoverable(friendlyError)
        ) {
          setOauthNotice(friendlyError);
        }
      }
      if (config?.microsoftConfigured && config.needsReauth) {
        setOauthNotice("Your Microsoft sign-in has expired. Redirecting to Microsoft…");
      }
    } catch (error) {
      try {
        const status = await fetchMailConfigStatus(mailboxProfile);
        setMailConfig(status);
        if (status?.microsoftConfigured && status.needsReauth) {
          setOauthNotice("Your Microsoft sign-in has expired. Redirecting to Microsoft…");
        }
      } catch {
        setMailConfig((current) => current || { imapConfigured: false, profile: mailboxProfile });
      }
      if (!messages.length) {
        const raw = error instanceof Error ? error.message : "Could not load messages.";
        if (!shouldSuppressMailListStatusError(raw)) {
          setListError(presentMailError(raw));
        }
      }
    } finally {
      setListLoading(false);
      setListRefreshing(false);
    }
  }

  async function openMessage(messageId, folder = activeFolder) {
    setSelectedId(messageId);
    setDetailError("");
    setComposeMode("");
    setMoveMenuOpen(false);

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
      const mailMessage = data.mailMessage;
      setSelectedMessage(mailMessage);
      writeMailDetailCache(mailboxProfile, folder, messageId, mailMessage);
    } catch (error) {
      if (!cachedDetail) {
        setDetailError(error instanceof Error ? error.message : "Could not open message.");
      }
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadSignature() {
      try {
        const data = await fetchMailSignature(mailboxProfile);
        if (!cancelled) {
          setSignatureHtml(data.signature?.htmlBody || "");
        }
      } catch {
        if (!cancelled) {
          setSignatureHtml("");
        }
      }
    }

    async function loadTemplates() {
      try {
        const data = await fetchMailTemplates();
        if (!cancelled) {
          setMailTemplates(data.templates || []);
        }
      } catch {
        if (!cancelled) {
          setMailTemplates([]);
        }
      }
    }

    void loadSignature();
    void loadTemplates();
    return () => {
      cancelled = true;
    };
  }, [mailboxProfile]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const oauthResult = params.get("oauth");
    const oauthMessage = params.get("message");
    const oauthEmail = params.get("email");

    if (!oauthResult) {
      return;
    }

    // OAuth popup tab after Microsoft redirect: hand result to the opener and close.
    if (isMailOAuthPopupWindow()) {
      if (oauthResult === "success") {
        notifyMailOAuthOpener({
          status: "success",
          email: oauthEmail ? decodeURIComponent(oauthEmail) : "",
        });
        return;
      }
      if (oauthResult === "error") {
        let resolvedMessage = presentMailError(oauthMessage || "Could not connect Outlook.");
        try {
          resolvedMessage = decodeURIComponent(resolvedMessage);
        } catch {
          // Keep raw message.
        }
        notifyMailOAuthOpener({ status: "error", message: resolvedMessage });
        return;
      }
      if (oauthResult === "admin_consent_success") {
        notifyMailOAuthOpener({ status: "admin_consent_success" });
        return;
      }
    }

    if (oauthResult === "admin_consent_success") {
      autoOutlookConnectAttempted.current = false;
      setOauthNotice("Admin consent granted. Redirecting to Microsoft sign-in…");
      params.delete("oauth");
      navigate(
        { pathname: location.pathname, search: params.toString() ? `?${params.toString()}` : "" },
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
        { pathname: location.pathname, search: params.toString() ? `?${params.toString()}` : "" },
        { replace: true },
      );
      void loadWorkspace(activeFolder, { forceRefresh: true });
      return;
    }

    if (oauthResult === "error") {
      let resolvedMessage = presentMailError(oauthMessage || "Could not connect Outlook.");
      try {
        resolvedMessage = decodeURIComponent(resolvedMessage);
      } catch {
        // Keep raw message.
      }
      autoOutlookConnectAttempted.current = true;
      setOauthConnecting(false);
      clearMailOAuthPopupPending();
      setOauthNotice(resolvedMessage);
      params.delete("oauth");
      params.delete("message");
      params.delete("email");
      navigate(
        { pathname: location.pathname, search: params.toString() ? `?${params.toString()}` : "" },
        { replace: true },
      );
    }
  }, [location.pathname, location.search]);

  useEffect(() => {
    return subscribeMailOAuthResult((result) => {
      clearMailOAuthPopupPending();
      window.focus?.();
      setOauthConnecting(false);
      if (result.status === "success") {
        setOauthNotice(
          result.email
            ? `Outlook connected as ${result.email}.`
            : "Outlook connected successfully.",
        );
        void loadWorkspace(activeFolder, {
          forceRefresh: true,
          view: activeFolder === "inbox" ? inboxView : null,
        });
        return;
      }
      if (result.status === "admin_consent_success") {
        autoOutlookConnectAttempted.current = false;
        setOauthNotice("Admin consent granted. Redirecting to Microsoft sign-in…");
        void handleConnectOutlook();
        return;
      }
      if (result.status === "error") {
        autoOutlookConnectAttempted.current = true;
        setOauthNotice(
          presentMailError(
            result.message || "Sign-in cancelled. Use Sign in with Microsoft to try again.",
          ),
        );
      }
    });
  }, [activeFolder, inboxView]);

  // Fallback when the popup cannot postMessage (Microsoft COOP may clear window.opener).
  useEffect(() => {
    if (!oauthConnecting) {
      return undefined;
    }

    let cancelled = false;
    const startedAt = Date.now();
    const maxMs = 5 * 60 * 1000;

    async function poll() {
      if (cancelled) {
        return;
      }
      if (Date.now() - startedAt > maxMs) {
        setOauthConnecting(false);
        clearMailOAuthPopupPending();
        setOauthNotice(
          "Sign-in timed out. Use Sign in with Microsoft in the toolbar to try again.",
        );
        return;
      }
      try {
        const status = await fetchMailConfigStatus(mailboxProfile);
        if (cancelled) {
          return;
        }
        if (status?.outlookConnected && !status.needsOutlookConnect && !status.needsReauth) {
          setOauthConnecting(false);
          setMailConfig(status);
          setOauthNotice(
            status.outlookEmail
              ? `Outlook connected as ${status.outlookEmail}.`
              : "Outlook connected successfully.",
          );
          void loadWorkspace(activeFolder, {
            forceRefresh: true,
            view: activeFolder === "inbox" ? inboxView : null,
          });
          return;
        }
      } catch {
        // Keep polling while the user finishes sign-in.
      }
      window.setTimeout(poll, 2000);
    }

    const timer = window.setTimeout(poll, 2000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [oauthConnecting, mailboxProfile, activeFolder, inboxView]);

  useEffect(() => {
    if (!mailConfigNeedsOutlookConnect(mailConfig)) {
      // Only clear the attempt guard once Outlook is actually connected so a
      // later disconnect can auto-reconnect — not on every transient config.
      if (mailConfig?.outlookConnected) {
        autoOutlookConnectAttempted.current = false;
      }
      return;
    }

    if (oauthConnecting || autoOutlookConnectAttempted.current) {
      return;
    }

    const oauthResult = new URLSearchParams(location.search).get("oauth");
    if (oauthResult === "error") {
      autoOutlookConnectAttempted.current = true;
      return;
    }
    if (oauthResult === "success") {
      return;
    }

    // Stale pending flag from a previous login attempt — clear and start fresh.
    if (isMailOAuthPopupPending()) {
      clearMailOAuthPopupPending();
    }

    autoOutlookConnectAttempted.current = true;
    setOauthConnecting(true);
    setListLoading(false);
    setListRefreshing(false);
    setOauthNotice("Redirecting to Microsoft sign-in…");
    void (async () => {
      try {
        const returnPath = location.pathname || "/mail";
        // Same-tab redirect is reliable outside a user gesture (auto-connect).
        const result = await startMailOAuthConnect(returnPath, { mode: "redirect" });
        if (result?.opened || result?.fallbackUsed || result?.redirected) {
          return;
        }
        setOauthNotice(
          "Could not start Outlook sign-in. Check that mail is configured for this environment.",
        );
        setOauthConnecting(false);
        // Keep attempted=true to avoid a connect/banner retry loop that flickers the UI.
      } catch (error) {
        setOauthNotice(
          presentMailError(error instanceof Error ? error.message : "Could not start Outlook sign-in."),
        );
        setOauthConnecting(false);
        // Keep attempted=true — user can retry via the Connect button.
      }
    })();
  }, [mailConfig, oauthConnecting, location.pathname, location.search]);

  // Single workspace loader — avoids double fetch (folder mount + inbox view)
  // that toggles listLoading and makes the mail layout bounce.
  useEffect(() => {
    if (oauthConnecting) {
      setListLoading(false);
      setListRefreshing(false);
      return;
    }

    const folderKey = `${mailboxProfile}:${activeFolder}`;
    const folderChanged = workspaceFolderKeyRef.current !== folderKey;
    workspaceFolderKeyRef.current = folderKey;

    if (folderChanged) {
      setSelectedId("");
      setSelectedMessage(null);
      setComposeMode("");
      setListPage(1);
      setSearchQuery("");
      setListFilter("all");
      setActiveTag("");
    }

    void loadWorkspace(activeFolder, {
      view: activeFolder === "inbox" ? inboxView : null,
      forceRefresh: !folderChanged && activeFolder === "inbox",
    });
  }, [activeFolder, mailboxProfile, inboxView, oauthConnecting]);

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
        void loadWorkspace(activeFolder, {
          forceRefresh: true,
          view: activeFolder === "inbox" ? inboxView : null,
        });
      },
    });
  }, [activeFolder, inboxView, mailboxProfile]);

  function handleFolderChange(folderId) {
    if (folderId === activeFolder) {
      return;
    }
    setActiveFolder(folderId);
    setSelectedId("");
    setSelectedMessage(null);
    setDetailError("");
    setAttachmentPreview(null);
    setComposeMode("");
    setMoveMenuOpen(false);
    setListPage(1);
    setListError("");
    setFolderUnavailable(false);
    setMessages([]);
    setListLoading(folderId !== "signature" && folderId !== "templates");
  }

  function openCompose(mode = "new", draft = EMPTY_COMPOSE) {
    setComposeForm(draft);
    setComposeMode(mode);
    setShowComposeCc(Boolean(draft.cc));
    setShowComposeBcc(Boolean(draft.bcc));
    setComposeAttachments([]);
    setComposeError("");
    setComposeSuccess("");
    setComposeImportance("normal");
    setComposeSensitivity("normal");
  }

  function closeCompose() {
    setComposeMode("");
    setComposeForm(EMPTY_COMPOSE);
    setComposeError("");
    setComposeSuccess("");
  }

  function insertSignatureIntoCompose() {
    setComposeForm((current) => ({
      ...current,
      htmlBody: appendSignatureToHtml(current.htmlBody, signatureHtml),
      body: htmlToPlainText(appendSignatureToHtml(current.htmlBody, signatureHtml)),
    }));
  }

  async function handleComposeAttachmentsSelected(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) {
      return;
    }

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

  function handleComposeSubmit(_event, result = {}) {
    if (result.error) {
      setComposeError(result.error);
      return;
    }

    setComposeSending(true);
    setComposeError("");
    setComposeSuccess("");

    try {
      const htmlWithSignature = appendSignatureToHtml(result.payload.htmlBody, signatureHtml);
      queueMailSend(
        {
          ...result.payload,
          body: htmlToPlainText(htmlWithSignature),
          htmlBody: htmlWithSignature,
        },
        mailboxProfile,
      );
      setComposeSuccess("Message is being sent.");
      closeCompose();
    } catch (error) {
      setComposeError(error instanceof Error ? error.message : "Could not send message.");
    } finally {
      setComposeSending(false);
    }
  }

  function openReplyComposer(mode = "reply") {
    if (!selectedMessage) {
      return;
    }

    const target = buildReplyTarget(selectedMessage, activeFolder);
    let draft = buildReplyDraft(target);

    if (mode === "reply-all") {
      draft = buildReplyAllDraft(selectedMessage, session?.email || "");
    } else if (mode === "forward") {
      draft = buildForwardDraft(selectedMessage);
    }

    openCompose(mode, {
      ...draft,
      htmlBody:
        draft.htmlBody ||
        (draft.body ? `<p>${draft.body.replace(/\n/g, "<br/>")}</p>` : ""),
      cc: draft.cc || "",
      bcc: "",
    });
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

  async function handleDownloadAllAttachments() {
    const attachments = selectedMessage?.attachments?.filter((entry) => !entry.isInline) || [];
    for (const attachment of attachments) {
      await handleAttachmentAction(attachment, "download");
    }
  }

  async function handleDeleteMessage() {
    if (!selectedId) {
      return;
    }

    try {
      await moveMailMessage(selectedId, activeFolder, "deleted", mailboxProfile);
      setMessages((current) => current.filter((message) => message.id !== selectedId));
      setSelectedId("");
      setSelectedMessage(null);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Could not delete message.");
    }
  }

  async function handleMoveMessage(destinationFolder) {
    if (!selectedId) {
      return;
    }

    try {
      await moveMailMessage(selectedId, activeFolder, destinationFolder, mailboxProfile);
      setMessages((current) => current.filter((message) => message.id !== selectedId));
      setSelectedId("");
      setSelectedMessage(null);
      setMoveMenuOpen(false);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Could not move message.");
    }
  }

  async function handleFlagMessage(flagged) {
    if (!selectedId) {
      return;
    }

    try {
      await flagMailMessage(selectedId, activeFolder, flagged, mailboxProfile);
      setSelectedMessage((current) => (current ? { ...current, isFlagged: flagged } : current));
      setMessages((current) =>
        current.map((message) =>
          message.id === selectedId ? { ...message, isFlagged: flagged } : message,
        ),
      );
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Could not update flag.");
    }
  }

  async function handleConnectOutlook() {
    setOauthConnecting(true);
    setOauthNotice("Redirecting to Microsoft sign-in…");

    try {
      const returnPath = location.pathname || "/mail";
      const result = await startMailOAuthConnect(returnPath, { mode: "redirect" });
      if (result?.opened || result?.fallbackUsed || result?.redirected) {
        return;
      }
      setOauthNotice(
        "Could not start Outlook sign-in. Check that mail is configured for this environment.",
      );
      setOauthConnecting(false);
    } catch (error) {
      setOauthNotice(
        presentMailError(error instanceof Error ? error.message : "Could not start Outlook sign-in."),
      );
      setOauthConnecting(false);
    }
  }

  /** User-initiated retry after skip/cancel — clears pending flags and starts OAuth. */
  function handleRetryConnectOutlook() {
    clearMailOAuthPopupPending();
    // Keep attempt guard true so the auto-connect effect does not double-start.
    autoOutlookConnectAttempted.current = true;
    void handleConnectOutlook();
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

  const showOutlookConnectCard = Boolean(oauthConnecting);
  const needsConnect =
    mailConfigNeedsOutlookConnect(mailConfig) && !oauthConnecting;
  const showOauthNoticeToast = Boolean(oauthNotice) && !showOutlookConnectCard;
  const mailPageToastSuccess =
    showOauthNoticeToast && MAIL_OAUTH_NOTICE_SUCCESS.test(oauthNotice) ? oauthNotice : "";
  const mailPageToastError = (() => {
    if (showOutlookConnectCard || mailPageToastSuccess) {
      return "";
    }
    if (oauthNotice) {
      return oauthNotice;
    }
    return listError || "";
  })();
  const showMailSetupStatus =
    Boolean(mailConfig) &&
    !mailConfig.mailReady &&
    !mailConfig.needsOutlookConnect &&
    !mailConfig.outlookConnected &&
    !setupBannerDismissed;
  const showMailPageBanners = showOutlookConnectCard;

  const mailSetupDetail =
    "This environment still needs mail configuration. Ask your administrator to set up Microsoft OAuth or IMAP/SMTP credentials before using this page.";

  function dismissMailSetupBanner() {
    setSetupBannerDismissed(true);
    try {
      sessionStorage.setItem("worktual.mail.setup-banner-dismissed", "1");
    } catch {
      // sessionStorage unavailable
    }
  }

  return (
    <section className="mail-page">
      <AdminPageToast
        error={mailPageToastError}
        onDismiss={() => {
          setOauthNotice("");
          setListError("");
        }}
        success={mailPageToastSuccess}
        variant="pill"
      />

      {showMailPageBanners ? (
        <div className="mail-page__banners">
          {showOutlookConnectCard ? (
            <div className="mail-page__outlook-connect">
              <div>
                <strong>Connecting Outlook mailbox</strong>
                <p>You are being redirected to Microsoft sign-in to connect this mailbox.</p>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <MailTopBar
        listDensity={listDensity}
        listFilter={listFilter}
        listRefreshing={listRefreshing}
        mailConfig={mailConfig}
        oauthConnecting={oauthConnecting}
        oauthDisconnecting={oauthDisconnecting}
        onConnectOutlook={handleRetryConnectOutlook}
        onDisconnectOutlook={handleDisconnectOutlook}
        onDismissSetupStatus={dismissMailSetupBanner}
        onListDensityChange={setListDensity}
        onListFilterChange={(value) => {
          setListFilter(value);
          setListPage(1);
        }}
        onNewMail={() => openCompose("new")}
        onRefresh={() =>
          loadWorkspace(activeFolder, {
            forceRefresh: true,
            view: activeFolder === "inbox" ? inboxView : null,
          })
        }
        onSearchChange={(value) => {
          setSearchQuery(value);
          setListPage(1);
        }}
        onShowPreviewChange={setShowPreview}
        onSortByChange={(value) => {
          setSortBy(value);
          setListPage(1);
        }}
        searchQuery={searchQuery}
        setupStatusDetail={mailSetupDetail}
        showConnectOutlook={needsConnect}
        showPreview={showPreview}
        showSetupStatus={showMailSetupStatus}
        sortBy={sortBy}
      />

      <div className="mail-workspace">
        <MailFolderSidebar
          activeFolder={activeFolder}
          onFolderChange={handleFolderChange}
          unreadCount={unreadCount}
        />

        {activeFolder === "signature" ? (
          <div className="mail-read-pane is-open mail-read-pane--full">
            <MailSignaturePanel
              mailboxProfile={mailboxProfile}
              onSaved={(htmlBody) => setSignatureHtml(htmlBody)}
            />
          </div>
        ) : activeFolder === "templates" ? (
          <div className="mail-read-pane is-open mail-read-pane--full">
            <MailTemplatesPanel
              onChanged={async () => {
                try {
                  const data = await fetchMailTemplates();
                  setMailTemplates(data.templates || []);
                } catch {
                  setMailTemplates([]);
                }
              }}
            />
          </div>
        ) : (
          <>
            <div className={`mail-list-shell ${selectedId && !composeMode ? "is-mobile-hidden" : ""}`}>
              <MailMessageList
                activeFolder={activeFolder}
                folderUnavailable={folderUnavailable}
                inboxView={inboxView}
                isListFiltered={isListFiltered}
                listDensity={listDensity}
                listError={listError}
                listFilter={listFilter}
                listLoading={listLoading}
                messages={pagination.items}
                needsOutlookConnect={needsConnect}
                onInboxViewChange={setInboxView}
                onPageChange={setListPage}
                onSelectMessage={openMessage}
                page={pagination.page}
                searchQuery={searchQuery}
                selectedId={selectedId}
                showPreview={showPreview}
                totalMessages={pagination.total}
                totalPages={pagination.totalPages}
              />
            </div>

            <div className={`mail-read-shell ${selectedId || composeMode ? "is-open" : ""}`}>
              {composeMode ? (
                <MailComposePanel
                  attachments={composeAttachments}
                  composeForm={composeForm}
                  error={composeError}
                  importance={composeImportance}
                  onApplyTemplate={(template) => {
                    setComposeForm((current) => ({
                      ...current,
                      subject: template.subject || current.subject,
                      htmlBody: template.bodyHtml || "",
                      body: htmlToPlainText(template.bodyHtml || ""),
                    }));
                  }}
                  onAttachmentsSelected={handleComposeAttachmentsSelected}
                  onCheckNames={() => setComposeError("")}
                  onClose={closeCompose}
                  onImportanceChange={setComposeImportance}
                  onInsertSignature={insertSignatureIntoCompose}
                  onRemoveAttachment={(id) =>
                    setComposeAttachments((current) => current.filter((entry) => entry.id !== id))
                  }
                  onSensitivityChange={setComposeSensitivity}
                  onSubmit={handleComposeSubmit}
                  sending={composeSending}
                  sensitivity={composeSensitivity}
                  setComposeForm={setComposeForm}
                  setShowBcc={setShowComposeBcc}
                  setShowCc={setShowComposeCc}
                  showBcc={showComposeBcc}
                  showCc={showComposeCc}
                  signatureHtml={signatureHtml}
                  success={composeSuccess}
                  templates={mailTemplates}
                  title={
                    composeMode === "forward"
                      ? "Forward"
                      : composeMode === "reply-all"
                        ? "Reply all"
                        : composeMode === "reply"
                          ? "Reply"
                          : "New message"
                  }
                />
              ) : (
                <MailReadPane
                  activeFolder={activeFolder}
                  attachmentLoadingId={attachmentLoadingId}
                  detailError={detailError}
                  detailLoading={detailLoading}
                  mailConfig={mailConfig}
                  moveMenuOpen={moveMenuOpen}
                  onAttachmentAction={handleAttachmentAction}
                  onBack={() => {
                    setSelectedId("");
                    setSelectedMessage(null);
                    setDetailError("");
                    setMoveMenuOpen(false);
                  }}
                  onDelete={handleDeleteMessage}
                  onDownloadAllAttachments={handleDownloadAllAttachments}
                  onFlag={handleFlagMessage}
                  onForward={() => openReplyComposer("forward")}
                  onMove={handleMoveMessage}
                  onMoveMenuToggle={() => setMoveMenuOpen((current) => !current)}
                  onReply={() => openReplyComposer("reply")}
                  onReplyAll={() => openReplyComposer("reply-all")}
                  selectedMessage={selectedMessage}
                />
              )}
            </div>
          </>
        )}
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
