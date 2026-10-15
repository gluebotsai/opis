import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CreditCard, Mail, Paperclip, Send } from "lucide-react";

import { getSession } from "../lib/auth.js";
import { fetchMailConfigStatus, queueMailSend } from "../lib/email.js";
import { getLeadById } from "../lib/leads.js";
import { buildPaymentForwardDraft, fetchLeadPayment } from "../lib/payments.js";

function splitEmails(value) {
  return value
    .split(/[,;]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function ForwardPaymentPage() {
  const { leadId } = useParams();
  const navigate = useNavigate();
  const [lead, setLead] = useState(null);
  const [leadLoading, setLeadLoading] = useState(true);

  const [paymentRecord, setPaymentRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mailConfig, setMailConfig] = useState(null);
  const [sendError, setSendError] = useState("");
  const [sendSuccess, setSendSuccess] = useState("");
  const [sending, setSending] = useState(false);
  const [form, setForm] = useState({
    to: "",
    cc: "",
    bcc: "",
    subject: "",
    body: "",
  });

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
          quotationId: data.quotationId,
        });

        setForm({
          to: draft.to,
          cc: draft.cc,
          bcc: draft.bcc,
          subject: draft.subject,
          body: draft.body,
        });
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
  }

  async function handleSend(event) {
    event.preventDefault();
    setSendError("");
    setSendSuccess("");

    const to = splitEmails(form.to);
    if (!to.length) {
      setSendError("Please enter at least one recipient in To.");
      return;
    }

    setSending(true);

    try {
      queueMailSend(
        {
          to,
          cc: splitEmails(form.cc),
          bcc: splitEmails(form.bcc),
          subject: form.subject,
          body: form.body,
        },
        "sales",
      );

      navigate(`/products/${leadId}`);
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

  if (!loading && !paymentRecord) {
    return (
      <section className="compose-mail-page">
        <header className="compose-mail-page__header">
          <button
            className="compose-mail-page__back"
            onClick={() => navigate(`/products/${leadId}`)}
            type="button"
          >
            <ArrowLeft size={16} />
            Back to account
          </button>
          <h1>Forward payment link</h1>
        </header>
        {sendError ? <p className="form-error">{sendError}</p> : null}
        <p className="payment-forward-empty">
          No approved payment link is available for this customer yet.
        </p>
      </section>
    );
  }

  return (
    <section className="compose-mail-page payment-forward-page">
      <header className="compose-mail-page__header">
        <button
          className="compose-mail-page__back"
          onClick={() => navigate(`/products/${leadId}`)}
          type="button"
        >
          <ArrowLeft size={16} />
          Back to account
        </button>
        <div>
          <p className="eyebrow">Sales follow-up</p>
          <h1>
            <Mail size={22} />
            Forward payment link
          </h1>
          <p className="compose-mail-page__subtitle">
            Resend the approved payment link to {lead.companyName} from the sales mailbox.
          </p>
        </div>
      </header>

      {loading ? <p className="payment-forward-loading">Loading payment details...</p> : null}
      {sendError ? <p className="form-error">{sendError}</p> : null}
      {sendSuccess ? <p className="form-success">{sendSuccess}</p> : null}

      {paymentRecord ? (
        <div className="payment-forward-summary onboarding-card">
          <CreditCard size={18} />
          <div>
            <strong>{paymentRecord.payment?.amountLabel || "Payment due"}</strong>
            <p>{paymentRecord.payment?.paymentLinkUrl}</p>
            <small>
              Provider: {paymentRecord.payment?.provider || "stripe"}
              {paymentRecord.payment?.dryRun ? " · demo mode" : ""}
            </small>
          </div>
        </div>
      ) : null}

      <form className="compose-mail-form onboarding-card" onSubmit={handleSend}>
        <label className="field">
          <span>From</span>
          <input disabled value={mailConfig?.mailboxEmail || getSession()?.email || "Sales mailbox"} />
        </label>

        <label className="field">
          <span>To</span>
          <input onChange={(event) => updateField("to", event.target.value)} value={form.to} />
        </label>

        <label className="field">
          <span>Subject</span>
          <input onChange={(event) => updateField("subject", event.target.value)} value={form.subject} />
        </label>

        <label className="field field--full">
          <span>Message</span>
          <textarea
            onChange={(event) => updateField("body", event.target.value)}
            rows="14"
            value={form.body}
          />
        </label>

        <div className="compose-mail-form__footer">
          <span className="compose-mail-form__attachment">
            <Paperclip size={16} />
            Payment link included in message body
          </span>
          <button className="primary-button" disabled={sending || loading} type="submit">
            <Send size={18} />
            {sending ? "Sending..." : "Send to customer"}
          </button>
        </div>
      </form>
    </section>
  );
}
