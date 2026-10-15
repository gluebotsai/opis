// @ts-nocheck
import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CreditCard, Mail, Paperclip, Send, X } from "lucide-react";

import { getSession } from "../lib/auth.js";
import { fetchMailConfigStatus, queueMailSend } from "../lib/email.js";
import { validateMailRecipients } from "../lib/emailValidation.js";
import { getLeadById } from "../lib/leads.js";
import { buildPaymentForwardDraft, fetchLeadPayment, isMultiBranchPayment } from "../lib/payments.js";
import { isTemporaryLead } from "../lib/workspaceViews.js";

export function ForwardPaymentPage() {
  const { leadId } = useParams();
  const navigate = useNavigate();
  const [lead, setLead] = useState(null);
  const [leadLoading, setLeadLoading] = useState(true);

  const [paymentRecord, setPaymentRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mailConfig, setMailConfig] = useState(null);
  const [sendError, setSendError] = useState("");
  const [sending, setSending] = useState(false);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [form, setForm] = useState({
    to: "",
    cc: "",
    bcc: "",
    subject: "",
    body: "",
  });

  const backPath = `/products/${leadId}`;
  const fromEmail =
    mailConfig?.outlookEmail ||
    mailConfig?.mailboxEmail ||
    getSession()?.email ||
    "Sales mailbox";

  useEffect(() => {
    let cancelled = false;

    getLeadById(leadId).then((loadedLead) => {
      if (!cancelled) {
        setLead(loadedLead);
        setLeadLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [leadId]);

  useEffect(() => {
    fetchMailConfigStatus("sales")
      .then(setMailConfig)
      .catch(() => setMailConfig({ smtpConfigured: false, imapConfigured: false }));
  }, []);

  useEffect(() => {
    let active = true;

    async function loadPayment() {
      setLoading(true);
      setSendError("");

      try {
        const data = await fetchLeadPayment(leadId);
        if (!active) {
          return;
        }

        setPaymentRecord(data);
        const draft = buildPaymentForwardDraft({
          lead,
          payment: data.payment,
          quotation: data.quotation,
          quotationId: data.quotationId,
        });

        setForm({
          to: draft.to,
          cc: draft.cc,
          bcc: draft.bcc,
          subject: draft.subject,
          body: draft.body,
        });
        if (draft.cc) {
          setShowCc(true);
        }
      } catch (error) {
        if (active) {
          setSendError(error instanceof Error ? error.message : "Could not load payment link.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    if (lead) {
      loadPayment();
    }

    return () => {
      active = false;
    };
  }, [lead, leadId]);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setSendError("");
  }

  async function handleSend(event) {
    event.preventDefault();
    setSendError("");

    const recipientCheck = validateMailRecipients({
      to: form.to,
      cc: form.cc,
      bcc: form.bcc,
    });
    if (!recipientCheck.valid) {
      setSendError(recipientCheck.message);
      return;
    }

    if (!String(form.subject || "").trim()) {
      setSendError("Subject is required.");
      return;
    }

    if (!String(form.body || "").trim()) {
      setSendError("Message body is required.");
      return;
    }

    setSending(true);

    try {
      queueMailSend(
        {
          to: recipientCheck.to,
          cc: recipientCheck.cc,
          bcc: recipientCheck.bcc,
          subject: form.subject,
          body: form.body,
        },
        "sales",
      );

      navigate(backPath);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Could not send payment email.");
    } finally {
      setSending(false);
    }
  }

  if (leadLoading) {
    return null;
  }

  if (!lead) {
    return <Navigate replace to="/products" />;
  }

  if (isTemporaryLead(lead)) {
    return (
      <Navigate
        replace
        to={backPath}
        state={{ message: "Temporary leads are finance approval only — payment forward is not available." }}
      />
    );
  }

  if (!loading && !paymentRecord) {
    return (
      <section className="compose-mail-page">
        <button
          className="lead-dashboard-page__back"
          onClick={() => navigate(backPath)}
          type="button"
        >
          <ArrowLeft size={18} />
          Back to account
        </button>
        <header className="compose-mail-page__header">
          <div>
            <p className="eyebrow">Sales follow-up</p>
            <h1>Forward payment link</h1>
            <p className="compose-mail-page__copy">
              No approved payment link is available for this customer yet.
            </p>
          </div>
        </header>
        {sendError ? <p className="form-error">{sendError}</p> : null}
      </section>
    );
  }

  return (
    <section className="compose-mail-page payment-forward-page">
      <button
        className="lead-dashboard-page__back"
        onClick={() => navigate(backPath)}
        type="button"
      >
        <ArrowLeft size={18} />
        Back to account
      </button>

      <header className="compose-mail-page__header">
        <div>
          <p className="eyebrow">Sales follow-up</p>
          <h1>Forward payment link</h1>
          <p className="compose-mail-page__copy">
            Resend the approved payment link to {lead.companyName} from the sales mailbox.
          </p>
        </div>
      </header>

      {loading ? <p className="payment-forward-loading">Loading payment details...</p> : null}

      {paymentRecord ? (
        <div className="payment-forward-summary onboarding-card">
          <CreditCard size={18} aria-hidden="true" />
          <div>
            <strong>{paymentRecord.payment?.amountLabel || "Payment due"}</strong>
            {isMultiBranchPayment(paymentRecord.payment) ? (
              <div className="lead-dashboard-branch-payments">
                {paymentRecord.payment.branchPayments.map((branchPayment) => (
                  <p key={branchPayment.billingBranchId}>
                    <strong>{branchPayment.branchLabel || branchPayment.billingBranchId}:</strong>{" "}
                    {branchPayment.paymentLinkUrl ? (
                      <a href={branchPayment.paymentLinkUrl} rel="noreferrer" target="_blank">
                        {branchPayment.paymentLinkUrl}
                      </a>
                    ) : (
                      "Pending"
                    )}
                  </p>
                ))}
              </div>
            ) : paymentRecord.payment?.paymentLinkUrl ? (
              <a href={paymentRecord.payment.paymentLinkUrl} rel="noreferrer" target="_blank">
                {paymentRecord.payment.paymentLinkUrl}
              </a>
            ) : (
              <p>Payment link pending</p>
            )}
            <small>
              Provider: {paymentRecord.payment?.provider || "stripe"}
              {paymentRecord.payment?.dryRun ? " · demo mode" : ""}
            </small>
          </div>
        </div>
      ) : null}

      {paymentRecord ? (
        <form className="mail-compose" onSubmit={handleSend}>
          <div className="mail-compose__chrome">
            <div className="mail-compose__chrome-title">
              <Mail size={16} />
              <span>New message</span>
            </div>
            <button
              aria-label="Close"
              className="mail-compose__chrome-close"
              onClick={() => navigate(backPath)}
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
                placeholder="customer@company.com"
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
            aria-label="Message"
            className="mail-compose__body"
            onChange={(event) => updateField("body", event.target.value)}
            placeholder="Write your message..."
            rows={14}
            value={form.body}
          />

          <div className="mail-compose__footer">
            <div className="mail-compose__attachment-chips">
              <span className="mail-compose__attachment-chip">
                <Paperclip size={14} />
                Payment link in message body
              </span>
            </div>

            <div className="mail-compose__actions">
              {sendError ? <p className="form-error mail-compose__error">{sendError}</p> : null}
              <button
                className="secondary-button"
                disabled={sending}
                onClick={() => navigate(backPath)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="primary-button mail-compose__send"
                disabled={sending || loading}
                type="submit"
              >
                <Send size={16} />
                {sending ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        </form>
      ) : null}
    </section>
  );
}
