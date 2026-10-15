// @ts-nocheck
import { useEffect, useState } from "react";

import { AdminPageToast } from "../../components/admin/AdminPageToast.tsx";
import {
  fetchAdminInvoiceSettings,
  updateAdminInvoiceSettings,
} from "../../lib/invoiceSettings.js";
import "../../styles/admin-users-light.css";
import "../../styles/partner-bank.css";

function Field({
  error,
  inputMode,
  label,
  min,
  onChange,
  readOnly = false,
  required = false,
  type = "text",
  value,
}) {
  return (
    <label className={`admin-users-field${error ? " is-invalid" : ""}`}>
      <span>
        {label}
        {required ? (
          <span aria-hidden="true" className="admin-users-field__required">
            {" "}
            *
          </span>
        ) : null}
      </span>
      <input
        aria-invalid={Boolean(error)}
        inputMode={inputMode}
        min={min}
        onChange={(event) => onChange?.(event.target.value)}
        readOnly={readOnly}
        type={type}
        value={value}
      />
      {error ? <span className="admin-users-field__error">{error}</span> : null}
    </label>
  );
}

const EMPTY_FORM = {
  invoicePrefix: "WIPL",
  seriesYear: "",
  nextSequence: "",
  purchaseCutoffDay: "20",
  accountName: "",
  bankName: "",
  accountNumber: "",
  ifsc: "",
  branch: "",
};

function formFromSettings(settings) {
  if (!settings) {
    return { ...EMPTY_FORM };
  }
  return {
    invoicePrefix: settings.invoicePrefix || "WIPL",
    seriesYear: settings.seriesYear == null ? "" : String(settings.seriesYear),
    nextSequence: settings.nextSequence == null ? "" : String(settings.nextSequence),
    purchaseCutoffDay:
      settings.purchaseCutoffDay == null ? "20" : String(settings.purchaseCutoffDay),
    accountName: settings.accountName || "",
    bankName: settings.bankName || "",
    accountNumber: settings.accountNumber || "",
    ifsc: settings.ifsc || "",
    branch: settings.branch || "",
  };
}

export function AdminInvoiceSettingsPage() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  useEffect(() => {
    let cancelled = false;
    fetchAdminInvoiceSettings()
      .then((settings) => {
        if (!cancelled) {
          setForm(formFromSettings(settings));
          setError("");
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : "Could not load invoice settings.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      if (!current[field]) {
        return current;
      }
      const next = { ...current };
      delete next[field];
      return next;
    });
    setError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const prefix = String(form.invoicePrefix || "")
      .trim()
      .toUpperCase();
    const nextErrors = {};
    if (!prefix) {
      nextErrors.invoicePrefix = "Invoice prefix is required.";
    } else if (!/^[A-Z0-9]{2,16}$/.test(prefix)) {
      nextErrors.invoicePrefix = "Use 2–16 letters or digits.";
    }
    const nextSequence = Number(String(form.nextSequence || "").trim());
    if (!Number.isInteger(nextSequence) || nextSequence < 1) {
      nextErrors.nextSequence = "Next sequence must be a positive whole number.";
    }
    const purchaseCutoffDay = Number(String(form.purchaseCutoffDay || "").trim());
    if (!Number.isInteger(purchaseCutoffDay) || purchaseCutoffDay < 1 || purchaseCutoffDay > 28) {
      nextErrors.purchaseCutoffDay = "Cut-off day must be a whole number from 1 to 28.";
    }
    if (Object.keys(nextErrors).length) {
      setFieldErrors(nextErrors);
      setMessage("");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    setFieldErrors({});
    try {
      const saved = await updateAdminInvoiceSettings({
        invoicePrefix: prefix,
        nextSequence,
        purchaseCutoffDay,
        accountName: form.accountName,
        bankName: form.bankName,
        accountNumber: form.accountNumber,
        ifsc: form.ifsc,
        branch: form.branch,
      });
      setForm(formFromSettings(saved));
      setMessage("Invoice settings saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save invoice settings.");
    } finally {
      setSaving(false);
    }
  }

  const draftPreview = `${(form.invoicePrefix || "WIPL").trim().toUpperCase() || "WIPL"}-${form.seriesYear || new Date().getFullYear()}-DRAFT`;
  const nextPreview = `${(form.invoicePrefix || "WIPL").trim().toUpperCase() || "WIPL"}-${form.seriesYear || new Date().getFullYear()}-${form.nextSequence || 1}`;

  return (
    <section className="admin-users-page partner-bank-page">
      <header className="page-header admin-users-page__header partner-bank-page__header">
        <div>
          <h1>Invoice settings</h1>
          <p className="page-header__copy admin-users-page__subtitle">
            Configure the WIPL invoice series prefix, go-live renewal cut-off day, and company bank
            details shown on quotations.
          </p>
        </div>
      </header>

      <AdminPageToast
        error={error}
        onDismiss={() => {
          setError("");
          setMessage("");
        }}
        success={message}
      />

      <section aria-busy={loading} className="admin-users-panel partner-bank-form-panel">
        <header className="admin-users-panel__section-header">
          <div>
            <h2>Series, cut-off &amp; bank</h2>
            <p>
              Next issued number: <strong>{nextPreview}</strong>
              {" · "}
              Preview draft: {draftPreview}
            </p>
          </div>
        </header>

        {loading ? (
          <div className="admin-users-panel__body">
            <p className="admin-users-panel__loading" role="status">
              Loading invoice settings…
            </p>
          </div>
        ) : (
          <form className="partner-bank-form" onSubmit={handleSubmit}>
            <div className="admin-users-panel__body partner-bank-form__body">
              <div className="partner-bank-form__grid">
                <Field
                  error={fieldErrors.invoicePrefix}
                  label="Invoice prefix"
                  onChange={(value) => updateField("invoicePrefix", value.toUpperCase())}
                  required
                  value={form.invoicePrefix}
                />
                <Field
                  error={fieldErrors.nextSequence}
                  inputMode="numeric"
                  label="Next sequence"
                  min={1}
                  onChange={(value) => updateField("nextSequence", value.replace(/[^\d]/g, ""))}
                  required
                  type="number"
                  value={form.nextSequence}
                />
                <Field label="Series year" readOnly value={form.seriesYear} />
                <Field
                  error={fieldErrors.purchaseCutoffDay}
                  inputMode="numeric"
                  label="Renewal invoice cut-off day"
                  min={1}
                  onChange={(value) =>
                    updateField("purchaseCutoffDay", value.replace(/[^\d]/g, ""))
                  }
                  required
                  type="number"
                  value={form.purchaseCutoffDay}
                />
                <Field
                  label="Account name"
                  onChange={(value) => updateField("accountName", value)}
                  value={form.accountName}
                />
                <Field
                  label="Bank name"
                  onChange={(value) => updateField("bankName", value)}
                  value={form.bankName}
                />
                <Field
                  label="Account number"
                  onChange={(value) => updateField("accountNumber", value)}
                  value={form.accountNumber}
                />
                <Field
                  label="IFSC"
                  onChange={(value) => updateField("ifsc", value)}
                  value={form.ifsc}
                />
                <div className="partner-bank-form__field--full">
                  <Field
                    label="Branch"
                    onChange={(value) => updateField("branch", value)}
                    value={form.branch}
                  />
                </div>
              </div>
            </div>
            <footer className="admin-users-panel__footer partner-bank-form__footer">
              <button
                className="primary-button partner-bank-form__save"
                disabled={saving}
                type="submit"
              >
                {saving ? "Saving…" : "Save invoice settings"}
              </button>
            </footer>
          </form>
        )}
      </section>
    </section>
  );
}
