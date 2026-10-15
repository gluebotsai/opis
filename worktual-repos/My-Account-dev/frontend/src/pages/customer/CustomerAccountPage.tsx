// @ts-nocheck
import { useEffect, useState } from "react";
import { Eye, EyeOff, Save } from "lucide-react";

import {
  clearCustomerSession,
  customerMustChangePassword,
  getCustomerSession,
} from "../../lib/customerAuth.js";
import { PasswordStrengthBar } from "../../components/PasswordStrengthBar.tsx";
import { validatePasswordPolicy } from "../../lib/passwordPolicy.js";
import { changeCustomerPassword, loadCustomerPortalData } from "../../lib/customerPortal.js";

function PasswordField({ label, onChange, required = false, value, autoComplete }) {
  const [visible, setVisible] = useState(false);

  return (
    <label className="account-settings-field">
      <span>
        {label}
        {required ? " *" : ""}
      </span>
      <div className="login-reset-password-field account-settings-password-field">
        <input
          autoComplete={autoComplete}
          onChange={(event) => onChange(event.target.value)}
          type={visible ? "text" : "password"}
          value={value ?? ""}
        />
        <button
          aria-label={visible ? "Hide password" : "Show password"}
          className="icon-button"
          onClick={() => setVisible((current) => !current)}
          type="button"
        >
          {visible ? <EyeOff size={18} strokeWidth={1.75} /> : <Eye size={18} strokeWidth={1.75} />}
        </button>
      </div>
    </label>
  );
}

export function CustomerAccountPage() {
  const session = getCustomerSession();
  const forcePasswordChange = customerMustChangePassword(session);
  const [form, setForm] = useState({
    currentPassword: "",
    password: "",
    confirmPassword: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [companyName, setCompanyName] = useState("");

  useEffect(() => {
    if (forcePasswordChange) {
      return undefined;
    }
    let cancelled = false;
    loadCustomerPortalData()
      .then((data) => {
        if (cancelled || !data) {
          return;
        }
        setCompanyName(data.lead?.companyName || data.entitlements?.organization?.companyName || "");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [forcePasswordChange]);

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      if (!form.currentPassword.trim()) {
        throw new Error("Current password is required.");
      }
      if (!form.password.trim()) {
        throw new Error("New password is required.");
      }
      if (form.password !== form.confirmPassword) {
        throw new Error("New password and confirmation do not match.");
      }

      validatePasswordPolicy(form.password);
      await changeCustomerPassword({
        currentPassword: form.currentPassword,
        password: form.password,
      });

      setForm({ currentPassword: "", password: "", confirmPassword: "" });
      setSuccess(
        forcePasswordChange
          ? "Password updated. Sign in again with your new password to continue."
          : "Password updated. Sign in again with your new password.",
      );
      clearCustomerSession();
      window.setTimeout(() => {
        window.location.replace("/");
      }, 1200);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not update password.");
      setSaving(false);
    }
  }

  return (
    <section className={`account-settings-page page-stack${forcePasswordChange ? " account-settings-page--forced" : ""}`}>
      <header className="page-header">
        <div>
          <p className="eyebrow">{forcePasswordChange ? "Security" : "Account"}</p>
          <h1>{forcePasswordChange ? "Change your password" : "Account"}</h1>
          <p className="page-header__copy">
            {forcePasswordChange
              ? "For security, you must set a new password before using the customer portal."
              : `Manage your portal password${companyName ? ` for ${companyName}` : ""}.`}
          </p>
        </div>
      </header>

      <div className="account-settings-modal onboarding-card">
        <div className="lead-dashboard-panel__heading">
          <div>
            <h2>{forcePasswordChange ? "Set a new password" : "Change password"}</h2>
            <p>
              {forcePasswordChange
                ? "Enter the temporary password from your welcome email, then choose a new password. You will be signed out so you can log in with the new one."
                : "After saving, only the new password can be used to sign in — you will be signed out so you can log in again."}
            </p>
          </div>
        </div>

        {error ? <p className="form-error">{error}</p> : null}
        {success ? <p className="account-settings-success">{success}</p> : null}

        <form className="account-settings-form" onSubmit={handleSubmit}>
          <p className="account-settings-email">
            Signed in as <strong>{session?.email || "—"}</strong>
          </p>

          <PasswordField
            autoComplete="current-password"
            label={forcePasswordChange ? "Temporary password" : "Current password"}
            onChange={(value) => setForm((current) => ({ ...current, currentPassword: value }))}
            required
            value={form.currentPassword}
          />
          <PasswordField
            autoComplete="new-password"
            label="New password"
            onChange={(value) => setForm((current) => ({ ...current, password: value }))}
            required
            value={form.password}
          />
          <PasswordStrengthBar password={form.password} />
          <PasswordField
            autoComplete="new-password"
            label="Confirm new password"
            onChange={(value) => setForm((current) => ({ ...current, confirmPassword: value }))}
            required
            value={form.confirmPassword}
          />

          <button className="primary-button" disabled={saving} type="submit">
            <Save size={16} />
            {saving ? "Saving…" : forcePasswordChange ? "Set password & continue" : "Update password"}
          </button>
        </form>
      </div>
    </section>
  );
}
