// @ts-nocheck
import { useEffect, useMemo, useState } from "react";

import { AdminPageToast } from "../../components/admin/AdminPageToast.tsx";
import { CommissionSlabsReadonly } from "../../components/CommissionSlabsReadonly.tsx";
import {
  fetchPartnerBankAccountBundle,
  savePartnerBankAccount,
} from "../../lib/commissions.js";
import {
  EMPTY_PARTNER_BANK_FORM,
  bankFormFromAccount,
  mapPartnerBankApiErrorToField,
  partnerBankPayload,
  resolvePartnerBankProfile,
  validatePartnerBankForm,
} from "../../lib/partnerBankFields.js";
import "../../styles/admin-users-light.css";
import "../../styles/partner-bank.css";

function BankField({ error, label, onChange, required = false, value }) {
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
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
      {error ? <span className="admin-users-field__error">{error}</span> : null}
    </label>
  );
}

export function PartnerBankDetailsPage() {
  const [form, setForm] = useState(EMPTY_PARTNER_BANK_FORM);
  const [country, setCountry] = useState("India");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  const bankProfile = useMemo(() => resolvePartnerBankProfile(country), [country]);

  useEffect(() => {
    let cancelled = false;
    fetchPartnerBankAccountBundle()
      .then(({ bankAccount, country: partnerCountry }) => {
        if (cancelled) {
          return;
        }
        setCountry(partnerCountry || "India");
        setForm(bankFormFromAccount(bankAccount));
        setError("");
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load bank details.");
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
    const nextFieldErrors = validatePartnerBankForm(form, country);
    if (Object.keys(nextFieldErrors).length) {
      setFieldErrors(nextFieldErrors);
      setMessage("");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    setFieldErrors({});
    try {
      const saved = await savePartnerBankAccount(partnerBankPayload(form));
      setForm(bankFormFromAccount(saved));
      setMessage("Bank details saved.");
    } catch (saveError) {
      const apiMessage =
        saveError instanceof Error ? saveError.message : "Could not save bank details.";
      const field = mapPartnerBankApiErrorToField(apiMessage);
      if (field) {
        setFieldErrors({ [field]: apiMessage });
      } else {
        setError(apiMessage);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="admin-users-page partner-bank-page">
      <header className="page-header admin-users-page__header partner-bank-page__header">
        <div>
          <h1>Bank details</h1>
          <p className="page-header__copy admin-users-page__subtitle">
            Keep your payout account up to date so finance can transfer accrued commissions.
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
            <h2>Payout account</h2>
            <p>
              Account used for commission transfers
              {country ? ` · ${country}` : ""}.
            </p>
          </div>
        </header>

        {loading ? (
          <div className="admin-users-panel__body">
            <p className="admin-users-panel__loading" role="status">
              Loading bank details…
            </p>
          </div>
        ) : (
          <form className="partner-bank-form" onSubmit={handleSubmit}>
            <div className="admin-users-panel__body partner-bank-form__body">
              <div className="partner-bank-form__grid">
                {bankProfile.fields.map((field) => {
                  const control = (
                    <BankField
                      error={fieldErrors[field.key]}
                      label={field.label}
                      onChange={(value) => updateField(field.key, value)}
                      required={field.required}
                      value={form[field.key] || ""}
                    />
                  );
                  return field.fullWidth ? (
                    <div className="partner-bank-form__field--full" key={field.key}>
                      {control}
                    </div>
                  ) : (
                    <div key={field.key}>{control}</div>
                  );
                })}
              </div>
            </div>
            <footer className="admin-users-panel__footer partner-bank-form__footer">
              <button
                className="primary-button partner-bank-form__save"
                disabled={saving}
                type="submit"
              >
                {saving ? "Saving…" : "Save bank details"}
              </button>
            </footer>
          </form>
        )}
      </section>

      <CommissionSlabsReadonly title="Commission slabs" variant="panel" />
    </section>
  );
}
