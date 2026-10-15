import { useState } from "react";
import { Save } from "lucide-react";

import { getCustomerSession } from "../../lib/customerAuth.js";
import { PasswordStrengthBar } from "../../components/PasswordStrengthBar.jsx";
import { validatePasswordPolicy } from "../../lib/passwordPolicy.js";
import { changeCustomerPassword } from "../../lib/customerPortal.js";

function Field({ label, onChange, required = false, type = "text", value }) {
  return (
    <label className="account-settings-field">
      <span>
        {label}
        {required ? " *" : ""}
      </span>
      <input onChange={(event) => onChange(event.target.value)} type={type} value={value ?? ""} />
    </label>
  );
}

export function CustomerAccountPage() {
  const session = getCustomerSession();
  const [form, setForm] = useState({
    currentPassword: "",
    password: "",
    confirmPassword: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

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
      setSuccess("Your password was updated. Use it the next time you sign in.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not update password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="account-settings-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Account</p>
          <h1>Change password</h1>
          <p className="page-header__copy">
            Update your customer portal password. The new password is saved immediately and used on
            your next sign in.
          </p>
        </div>
      </header>

      <div className="account-settings-modal">
        {error ? <p className="form-error">{error}</p> : null}
        {success ? <p className="account-settings-success">{success}</p> : null}

        <section className="account-settings-panel">
          <dl className="account-settings-meta">
            <div>
              <dt>Signed in as</dt>
              <dd>{session?.email || "—"}</dd>
            </div>
            <div>
              <dt>Portal role</dt>
              <dd>
                {session?.locationId
                  ? `Branch user${session.locationLabel ? ` · ${session.locationLabel}` : ""}`
                  : "Company admin (all branches)"}
              </dd>
            </div>
          </dl>

          <form className="account-settings-form" onSubmit={handleSubmit}>
            <div className="account-settings-form__grid">
              <Field
                label="Current password"
                onChange={(value) => setForm((current) => ({ ...current, currentPassword: value }))}
                required
                type="password"
                value={form.currentPassword}
              />
              <Field
                label="New password"
                onChange={(value) => setForm((current) => ({ ...current, password: value }))}
                required
                type="password"
                value={form.password}
              />
              {form.password ? <PasswordStrengthBar password={form.password} /> : null}
              <Field
                label="Confirm new password"
                onChange={(value) => setForm((current) => ({ ...current, confirmPassword: value }))}
                required
                type="password"
                value={form.confirmPassword}
              />
            </div>

            <div className="account-settings-form__actions">
              <button className="primary-button" disabled={saving} type="submit">
                <Save size={16} />
                {saving ? "Saving..." : "Update password"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </section>
  );
}
