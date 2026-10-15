import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Mail, Paperclip, Send, X } from "lucide-react";

import { clearProductDraft, getLeadById } from "../lib/leads.js";
import { getSession } from "../lib/auth.js";
import {
  buildMailAttachmentPayload,
  getQuoteSessionAttachments,
} from "../lib/quoteAttachments.js";
import {
  buildDefaultEmailDraft,
  fetchMailConfigStatus,
  queueMailSend,
} from "../lib/email.js";
import { resolveQuoteSessionPaymentTotals } from "../lib/paymentAmount.js";
import { submitQuotation } from "../lib/quotations.js";
import { getQuoteSession } from "../lib/quoteSession.js";

function splitEmails(value) {
  return value
    .split(/[,;]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function ComposeEmailPage() {
  const { leadId } = useParams();
  const navigate = useNavigate();
  const [lead, setLead] = useState(null);
  const [quoteSession, setQuoteSession] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [mailConfig, setMailConfig] = useState(null);
  const [sendError, setSendError] = useState("");
  const [sending, setSending] = useState(false);
  const [quotationSubmitted, setQuotationSubmitted] = useState(false);

  const [form, setForm] = useState({
    to: "",
    cc: "",
    bcc: "",
    subject: "",
    body: "",
  });

  const fromEmail = mailConfig?.mailboxEmail || getSession()?.email || "Sales mailbox";

  useEffect(() => {
    let cancelled = false;

    Promise.all([getLeadById(leadId), getQuoteSession(leadId)]).then(([loadedLead, session]) => {
      if (!cancelled) {
        setLead(loadedLead);
        setQuoteSession(session);
        setSessionLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [leadId]);

  useEffect(() => {
    if (!quoteSession || !lead || !mailConfig) {
      return;
    }

    const draft = buildDefaultEmailDraft(
      lead,
      quoteSession.fileName,
      mailConfig.financeTeamEmail || "",
      quoteSession,
    );

    setForm({
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      subject: draft.subject,
      body: draft.body,
    });
  }, [lead, mailConfig, quoteSession]);

  useEffect(() => {
    fetchMailConfigStatus("sales")
      .then(setMailConfig)
      .catch(() => setMailConfig({ smtpConfigured: false, imapConfigured: false }));
  }, []);

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

    const attachments = getQuoteSessionAttachments(quoteSession);
    if (!attachments.length) {
      setSendError("Invoice attachment is missing. Return to the workflow and finish again.");
      return;
    }

    const primaryAttachment = attachments[0];

    const to = splitEmails(form.to);
    if (!to.length) {
      setSendError("Please enter at least one recipient in To.");
      return;
    }

    setSending(true);

    try {
      if (!quotationSubmitted) {
        const paymentTotals = resolveQuoteSessionPaymentTotals(quoteSession);

        await submitQuotation({
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
          ...paymentTotals,
        });
        await clearProductDraft(leadId);
        setQuotationSubmitted(true);
      }

      queueMailSend(
        {
          to,
          cc: splitEmails(form.cc),
          bcc: splitEmails(form.bcc),
          subject: form.subject,
          body: form.body,
          ...buildMailAttachmentPayload(
            attachments.map((entry) => ({
              fileName: entry.fileName,
              contentBase64: entry.contentBase64,
            })),
          ),
        },
        "sales",
      );

      navigate(`/products/${leadId}`);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Could not submit quotation.");
    } finally {
      setSending(false);
    }
  }

  if (sessionLoading) {
    return null;
  }

  if (!lead || !quoteSession) {
    return <Navigate replace to="/products" />;
  }

  const mailWarnings = [
    ...(mailConfig?.warnings || []),
    ...(mailConfig && !mailConfig.smtpConfigured
      ? ["SMTP is not configured. Add credentials in the project .env file."]
      : []),
    ...(mailConfig?.dryRun
      ? ["Mail dry-run is on — sends are simulated and no real email leaves this machine."]
      : []),
    ...(mailConfig?.dryRunFallback
      ? [
          "Mail server is unreachable. Sends will be simulated until you restart with npx pnpm stop:dev && npx pnpm dev:all.",
        ]
      : []),
  ];

  return (
    <section className="compose-mail-page">
      <button
        className="lead-dashboard-page__back"
        onClick={() => navigate(`/products/${leadId}/workflow`)}
        type="button"
      >
        <ArrowLeft size={18} />
        Back
      </button>

      <header className="compose-mail-page__header">
        <div>
          <p className="eyebrow">Submit to finance</p>
          <h1>Send quotation for finance review</h1>
          <p className="compose-mail-page__copy">
            Review the email below, then send it to finance with the quotation invoice attached.
          </p>
        </div>
        <button
          className="secondary-button compose-mail-page__mail-link"
          onClick={() => navigate("/mail")}
          type="button"
        >
          <Mail size={16} />
          Open mail
        </button>
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
            onClick={() => navigate(`/products/${leadId}/workflow`)}
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
              placeholder="finance@company.com"
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

        <textarea
          className="mail-compose__body"
          onChange={(event) => updateField("body", event.target.value)}
          rows={16}
          spellCheck={false}
          value={form.body}
        />

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
