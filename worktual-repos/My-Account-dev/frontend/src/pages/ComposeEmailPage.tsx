// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Mail, Paperclip, Send, X } from "lucide-react";

import { MailMessageBody } from "../components/MailMessageBody.tsx";
import { clearProductDraft, getLeadById } from "../lib/leads.js";
import { getSession } from "../lib/auth.js";
import {
  buildMailAttachmentPayload,
  getQuoteSessionAttachments,
} from "../lib/quoteAttachments.js";
import {
  buildDefaultEmailDraft,
  fetchMailConfigStatus,
  loadWorktualBrandLogoAttachment,
  mailConfigNeedsOutlookConnect,
  notifyMailOAuthOpener,
  queueMailSend,
  resolveCidPreviewHtml,
  startMailOAuthConnect,
  subscribeMailOAuthResult,
  clearMailOAuthPopupPending,
  isMailOAuthPopupWindow,
  isMailOAuthPopupPending,
} from "../lib/email.js";
import { resolveQuoteSessionPaymentTotals } from "../lib/paymentAmount.js";
import { submitQuotation } from "../lib/quotations.js";
import { getQuoteSession } from "../lib/quoteSession.js";
import { humanizeMailError } from "../lib/mailErrors.js";
import { validateMailRecipients } from "../lib/emailValidation.js";

function buildSendAttachmentPayload(pdfAttachments, brandLogoAttachment) {
  const entries = [
    ...pdfAttachments.map((entry) => ({
      fileName: entry.fileName,
      contentBase64: entry.contentBase64,
      contentType: "application/pdf",
    })),
  ];

  if (brandLogoAttachment?.contentBase64) {
    entries.push(brandLogoAttachment);
  }

  return buildMailAttachmentPayload(entries);
}

export function ComposeEmailPage() {
  const { leadId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [lead, setLead] = useState(null);
  const [quoteSession, setQuoteSession] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [mailConfig, setMailConfig] = useState(null);
  const [sendError, setSendError] = useState("");
  const [sending, setSending] = useState(false);
  const [quotationSubmitted, setQuotationSubmitted] = useState(false);
  const [connectingOutlook, setConnectingOutlook] = useState(false);
  const [brandLogoAttachment, setBrandLogoAttachment] = useState(null);
  const [oauthNotice, setOauthNotice] = useState("");
  const autoOutlookConnectAttempted = useRef(false);

  const composeReturnPath = `/products/${leadId}/compose`;

  const [form, setForm] = useState({
    to: "",
    cc: "",
    bcc: "",
    subject: "",
    body: "",
    htmlBody: "",
  });

  const fromEmail =
    mailConfig?.outlookEmail ||
    mailConfig?.mailboxEmail ||
    getSession()?.email ||
    "Outlook mailbox";

  const previewHtml = useMemo(
    () =>
      resolveCidPreviewHtml(
        form.htmlBody,
        brandLogoAttachment ? [brandLogoAttachment] : [],
      ),
    [brandLogoAttachment, form.htmlBody],
  );

  const workflowPath = `/products/${leadId}/workflow`;

  async function refreshMailConfig() {
    const config = await fetchMailConfigStatus("sales");
    setMailConfig(config);
    return config;
  }

  async function handleConnectOutlook() {
    clearMailOAuthPopupPending();
    autoOutlookConnectAttempted.current = true;
    setConnectingOutlook(true);
    setSendError("");
    setOauthNotice("Opening Microsoft sign-in in a new tab…");

    try {
      const result = await startMailOAuthConnect(composeReturnPath);
      if (result?.fallbackUsed || result?.redirected) {
        return;
      }
      if (!result?.opened) {
        setSendError("Could not start Microsoft Outlook sign-in.");
        setOauthNotice("");
        setConnectingOutlook(false);
      }
    } catch (error) {
      setSendError(
        humanizeMailError(
          error instanceof Error
            ? error.message
            : "Microsoft Outlook sign-in is required before sending mail.",
        ),
      );
      setOauthNotice("");
      setConnectingOutlook(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    setSessionLoading(true);
    setLoadError("");

    Promise.all([getLeadById(leadId), getQuoteSession(leadId)])
      .then(([loadedLead, session]) => {
        if (cancelled) {
          return;
        }

        const resolvedLead = loadedLead || session?.lead || null;
        const hasPdf = Boolean(session?.pdfBase64 || session?.invoices?.some((entry) => entry?.pdfBase64));

        setLead(resolvedLead);
        setQuoteSession(session);

        if (!resolvedLead) {
          setLoadError("Could not load this lead for finance submission.");
        } else if (!session || !hasPdf) {
          setLoadError(
            "Quote session is missing. Go back to the invoice review and click Proceed to finance review again.",
          );
        }
        setSessionLoading(false);
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Could not load the finance email draft.",
          );
          setSessionLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [leadId]);

  useEffect(() => {
    let cancelled = false;

    loadWorktualBrandLogoAttachment()
      .then((attachment) => {
        if (!cancelled) {
          setBrandLogoAttachment(attachment);
        }
      })
      .catch((error) => {
        console.error("Failed to load brand logo for finance email:", error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!quoteSession || !lead || !mailConfig) {
      return;
    }

    const draft = buildDefaultEmailDraft(
      lead,
      quoteSession.fileName,
      mailConfig.financeTeamEmails || mailConfig.financeTeamEmail || "",
      quoteSession,
    );

    setForm({
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      subject: draft.subject,
      body: draft.body,
      htmlBody: draft.htmlBody,
    });
  }, [lead, mailConfig, quoteSession]);

  useEffect(() => {
    let cancelled = false;

    fetchMailConfigStatus("sales")
      .then(async (config) => {
        if (cancelled) {
          return;
        }
        setMailConfig(config);

        const oauthResult = new URLSearchParams(location.search).get("oauth");
        if (oauthResult === "error") {
          autoOutlookConnectAttempted.current = true;
          return;
        }
        if (oauthResult === "success") {
          return;
        }

        if (!mailConfigNeedsOutlookConnect(config) || autoOutlookConnectAttempted.current) {
          return;
        }

        if (isMailOAuthPopupPending()) {
          autoOutlookConnectAttempted.current = true;
          setConnectingOutlook(true);
          setOauthNotice("Waiting for Microsoft sign-in in the other tab…");
          return;
        }

        autoOutlookConnectAttempted.current = true;
        setConnectingOutlook(true);
        setOauthNotice("Opening Microsoft sign-in in a new tab…");
        try {
          const result = await startMailOAuthConnect(composeReturnPath);
          if (cancelled) {
            return;
          }
          if (result?.opened) {
            return;
          }
          if (result?.fallbackUsed || result?.redirected) {
            return;
          }
          setSendError("Could not start Microsoft Outlook sign-in.");
          setOauthNotice("");
          setConnectingOutlook(false);
          autoOutlookConnectAttempted.current = false;
        } catch (error) {
          if (!cancelled) {
            setSendError(
              humanizeMailError(
                error instanceof Error
                  ? error.message
                  : "Could not start Microsoft Outlook sign-in.",
              ),
            );
            setOauthNotice("");
            setConnectingOutlook(false);
            autoOutlookConnectAttempted.current = false;
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMailConfig({
            smtpConfigured: false,
            imapConfigured: false,
            microsoftConfigured: false,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [composeReturnPath, leadId, location.search]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const oauthResult = params.get("oauth");
    const oauthMessage = params.get("message");
    const oauthEmail = params.get("email");

    if (!oauthResult) {
      return;
    }

    if (isMailOAuthPopupWindow()) {
      if (oauthResult === "success") {
        notifyMailOAuthOpener({
          status: "success",
          email: oauthEmail ? decodeURIComponent(oauthEmail) : "",
        });
        return;
      }
      if (oauthResult === "error") {
        let resolvedMessage = humanizeMailError(oauthMessage || "Could not connect Outlook.");
        try {
          resolvedMessage = decodeURIComponent(resolvedMessage);
        } catch {
          // Keep raw message.
        }
        notifyMailOAuthOpener({ status: "error", message: resolvedMessage });
        return;
      }
    }

    if (oauthResult === "success") {
      setOauthNotice(
        oauthEmail
          ? `Outlook connected as ${decodeURIComponent(oauthEmail)}.`
          : "Outlook connected successfully.",
      );
      setConnectingOutlook(false);
      params.delete("oauth");
      params.delete("message");
      params.delete("email");
      navigate(
        { pathname: location.pathname, search: params.toString() ? `?${params.toString()}` : "" },
        { replace: true },
      );
      void refreshMailConfig().catch(() => {});
      return;
    }

    if (oauthResult === "error") {
      let resolvedMessage = humanizeMailError(oauthMessage || "Could not connect Outlook.");
      try {
        resolvedMessage = decodeURIComponent(resolvedMessage);
      } catch {
        // Keep raw message.
      }
      autoOutlookConnectAttempted.current = true;
      clearMailOAuthPopupPending();
      setSendError(resolvedMessage);
      setOauthNotice("");
      setConnectingOutlook(false);
      params.delete("oauth");
      params.delete("message");
      params.delete("email");
      navigate(
        { pathname: location.pathname, search: params.toString() ? `?${params.toString()}` : "" },
        { replace: true },
      );
    }
  }, [leadId, location.pathname, location.search, navigate]);

  useEffect(() => {
    return subscribeMailOAuthResult((result) => {
      clearMailOAuthPopupPending();
      window.focus?.();
      setConnectingOutlook(false);
      if (result.status === "success") {
        setOauthNotice(
          result.email
            ? `Outlook connected as ${result.email}.`
            : "Outlook connected successfully.",
        );
        setSendError("");
        void refreshMailConfig().catch(() => {});
        return;
      }
      if (result.status === "error") {
        autoOutlookConnectAttempted.current = true;
        setSendError(
          humanizeMailError(
            result.message || "Sign-in cancelled. Use Sign in with Microsoft to try again.",
          ),
        );
        setOauthNotice("");
      }
    });
  }, []);

  useEffect(() => {
    if (!connectingOutlook) {
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
        clearMailOAuthPopupPending();
        setConnectingOutlook(false);
        setSendError(
          "Sign-in timed out. Use Sign in with Microsoft below to try again.",
        );
        setOauthNotice("");
        return;
      }
      try {
        const status = await refreshMailConfig();
        if (cancelled) {
          return;
        }
        if (status?.outlookConnected && !status.needsOutlookConnect && !status.needsReauth) {
          setConnectingOutlook(false);
          setOauthNotice(
            status.outlookEmail
              ? `Outlook connected as ${status.outlookEmail}.`
              : "Outlook connected successfully.",
          );
          setSendError("");
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
  }, [connectingOutlook]);

  useEffect(() => {
    if (form.cc) {
      setShowCc(true);
    }
    if (form.bcc) {
      setShowBcc(true);
    }
  }, [form.bcc, form.cc]);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSend(event) {
    event.preventDefault();
    setSendError("");

    if (mailConfig?.microsoftConfigured && (mailConfig.needsOutlookConnect || mailConfig.needsReauth)) {
      await handleConnectOutlook();
      return;
    }

    const attachments = getQuoteSessionAttachments(quoteSession);
    const primaryAttachment = attachments[0];
    if (!primaryAttachment?.contentBase64 || !primaryAttachment?.fileName) {
      setSendError("Invoice attachment is missing. Go back and regenerate the invoice.");
      return;
    }

    const recipientCheck = validateMailRecipients({
      to: form.to,
      cc: form.cc,
      bcc: form.bcc,
    });
    if (!recipientCheck.valid) {
      setSendError(recipientCheck.message);
      return;
    }

    setSending(true);

    try {
      if (!quotationSubmitted) {
        const paymentTotals = resolveQuoteSessionPaymentTotals(quoteSession);

        const result = await submitQuotation({
          leadId,
          lead,
          fileName: primaryAttachment.fileName,
          pdfBase64: primaryAttachment.contentBase64,
          productSummary: quoteSession.productSummary || [],
          assignments: quoteSession.assignments || [],
          invoiceMode: quoteSession.invoiceMode || "consolidated",
          branchSummary: quoteSession.branchSummary || null,
          invoices: quoteSession.invoices || [],
          submittedBy: getSession()?.email || "Sales team",
          sourceProductRequestId: quoteSession.sourceProductRequestId || null,
          billingPhase:
            quoteSession.billingPhase || paymentTotals.billingPhase || "standard",
          temporaryInvoiceContents: quoteSession.temporaryInvoiceContents || null,
          skipPaymentLink:
            quoteSession.skipPaymentLink === true ||
            String(lead?.leadKind || "").toLowerCase() === "temporary",
          leadKind:
            String(lead?.leadKind || quoteSession.lead?.leadKind || "").toLowerCase() ===
            "temporary"
              ? "temporary"
              : "standard",
          ...paymentTotals,
        });
        await clearProductDraft(leadId);
        setQuotationSubmitted(true);

        const submittedCount = result.quotations?.length || 1;
        const branchLabels = (result.quotations || [])
          .map(
            (entry) =>
              entry.branchSummary?.branchLabel ||
              entry.invoices?.[0]?.branchLabel ||
              null,
          )
          .filter(Boolean);

        queueMailSend(
          {
            to: recipientCheck.to,
            cc: recipientCheck.cc,
            bcc: recipientCheck.bcc,
            subject: form.subject,
            body: form.body,
            htmlBody: form.htmlBody,
            ...buildSendAttachmentPayload(attachments, brandLogoAttachment),
          },
          "sales",
        );

        navigate(`/products/${leadId}`, {
          state: {
            financeSubmittedCount: submittedCount,
            financeSubmittedBranches: branchLabels,
            message:
              submittedCount > 1
                ? `Submitted ${submittedCount} finance approvals (${branchLabels.join(", ") || "per branch"}).`
                : "Invoice submitted for finance approval.",
          },
        });
        return;
      }

      queueMailSend(
        {
          to: recipientCheck.to,
          cc: recipientCheck.cc,
          bcc: recipientCheck.bcc,
          subject: form.subject,
          body: form.body,
          htmlBody: form.htmlBody,
          ...buildSendAttachmentPayload(attachments, brandLogoAttachment),
        },
        "sales",
      );

      navigate(`/products/${leadId}`);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Could not submit invoice.");
    } finally {
      setSending(false);
    }
  }

  if (sessionLoading || connectingOutlook) {
    return (
      <section className="compose-mail-page">
        <p className="compose-mail-page__copy">
          {connectingOutlook
            ? "Complete Microsoft sign-in in the other tab so you can send from your Outlook mailbox…"
            : "Loading finance email…"}
        </p>
        {connectingOutlook ? (
          <div className="form-actions" style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <button
              className="primary-button"
              onClick={() => {
                void handleConnectOutlook();
              }}
              type="button"
            >
              Sign in with Microsoft
            </button>
            <button
              className="secondary-button"
              onClick={() => {
                clearMailOAuthPopupPending();
                setConnectingOutlook(false);
                setOauthNotice("");
                setSendError(
                  "Sign-in cancelled. Use Sign in with Microsoft to connect Outlook before sending.",
                );
              }}
              type="button"
            >
              Cancel
            </button>
          </div>
        ) : null}
      </section>
    );
  }

  if (loadError || !lead || !quoteSession) {
    return (
      <section className="compose-mail-page">
        <button
          className="lead-dashboard-page__back"
          onClick={() => navigate(workflowPath)}
          type="button"
        >
          <ArrowLeft size={18} />
          Back to quote
        </button>
        <header className="compose-mail-page__header">
          <div>
            <p className="eyebrow">Submit to finance</p>
            <h1>Finance email unavailable</h1>
            <p className="compose-mail-page__copy">
              {loadError ||
                "Quote session is missing. Return to invoice review and proceed again."}
            </p>
          </div>
        </header>
        <div className="form-actions" style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          <button className="primary-button" onClick={() => navigate(workflowPath)} type="button">
            Back to quote workflow
          </button>
          <Link className="secondary-button" to={`/products/${leadId}`}>
            Open lead products
          </Link>
        </div>
      </section>
    );
  }

  const needsOutlookConnect = mailConfigNeedsOutlookConnect(mailConfig);

  const mailWarnings = [
    ...(mailConfig?.warnings || []),
    ...(oauthNotice ? [oauthNotice] : []),
    ...(mailConfig?.dryRun
      ? ["Mail dry-run is on — sends are simulated and no real email leaves this machine."]
      : []),
  ];

  return (
    <section className="compose-mail-page">
      <button
        className="lead-dashboard-page__back"
        onClick={() => navigate(workflowPath)}
        type="button"
      >
        <ArrowLeft size={18} />
        Back
      </button>

      <header className="compose-mail-page__header">
        <div>
          <p className="eyebrow">Submit to finance</p>
          <h1>Send invoice for finance review</h1>
          <p className="compose-mail-page__copy">
            Review the email below, then send it to finance with the invoice attached.
          </p>
        </div>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
          {needsOutlookConnect ? (
            <button
              className="primary-button"
              onClick={() => {
                void handleConnectOutlook();
              }}
              type="button"
            >
              Sign in with Microsoft
            </button>
          ) : null}
          <button
            className="secondary-button compose-mail-page__mail-link"
            onClick={() => navigate("/mail")}
            type="button"
          >
            <Mail size={16} />
            Open mail
          </button>
        </div>
      </header>

      {mailWarnings.length ? (
        <div className="compose-mail-page__notices">
          {mailWarnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}

      <form className="mail-compose" onSubmit={handleSend}>
        <div className="mail-compose__chrome">
          <div className="mail-compose__chrome-title">
            <Mail size={16} />
            <span>New message</span>
          </div>
          <button
            className="mail-compose__chrome-close"
            onClick={() => navigate(workflowPath)}
            type="button"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mail-compose__header-fields">
          <label className="mail-compose-row">
            <span className="mail-compose-row__label">From</span>
            <input className="mail-compose-row__input" disabled readOnly value={fromEmail} />
          </label>

          <label className="mail-compose-row mail-compose-row--to">
            <span className="mail-compose-row__label">To</span>
            <input
              className="mail-compose-row__input"
              onChange={(event) => updateField("to", event.target.value)}
              placeholder="finance@worktual.com, finance2@worktual.com"
              required
              type="text"
              value={form.to}
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
                onChange={(event) => updateField("cc", event.target.value)}
                placeholder="Optional Cc recipients"
                type="text"
                value={form.cc}
              />
            </label>
          ) : null}

          {showBcc ? (
            <label className="mail-compose-row">
              <span className="mail-compose-row__label">Bcc</span>
              <input
                className="mail-compose-row__input"
                onChange={(event) => updateField("bcc", event.target.value)}
                placeholder="Optional Bcc recipients"
                type="text"
                value={form.bcc}
              />
            </label>
          ) : null}

          <label className="mail-compose-row">
            <span className="mail-compose-row__label">Subject</span>
            <input
              className="mail-compose-row__input"
              onChange={(event) => updateField("subject", event.target.value)}
              required
              type="text"
              value={form.subject}
            />
          </label>
        </div>

        <div className="mail-compose__body mail-compose__body--html-preview">
          <MailMessageBody htmlBody={previewHtml} textBody={form.body} />
        </div>

        <div className="mail-compose__footer">
          <div className="mail-compose__attachments">
            <span className="mail-compose__attachments-label">Attachments</span>
            <div className="mail-compose__attachment-chips">
              {quoteSession.invoices?.length > 1 ? (
                quoteSession.invoices.map((invoice) => (
                  <span className="mail-compose__attachment-chip" key={invoice.fileName}>
                    <Paperclip size={14} />
                    {invoice.fileName}
                  </span>
                ))
              ) : (
                <span className="mail-compose__attachment-chip">
                  <Paperclip size={14} />
                  {quoteSession.fileName}
                </span>
              )}
            </div>
            <small>
              {quoteSession.invoices?.length > 1
                ? "All branch invoice PDFs are attached when you send."
                : "Primary invoice PDF is attached automatically when you send."}
            </small>
          </div>

          <div className="mail-compose__actions">
            {sendError ? <p className="form-error mail-compose__error">{sendError}</p> : null}
            <button className="primary-button mail-compose__send" disabled={sending} type="submit">
              <Send size={16} />
              {sending ? "Submitting..." : "Send"}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
