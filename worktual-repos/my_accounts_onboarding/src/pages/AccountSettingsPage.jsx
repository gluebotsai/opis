import { useEffect, useState } from "react";
import { Lock, Save } from "lucide-react";

import { getSession, ROLES } from "../lib/auth.js";
import {
  fetchCurrentUserProfile,
  formatUserUpdatedAt,
  getRoleLabel,
  syncSessionProfile,
  updateCurrentUserProfile,
} from "../lib/users.js";
import { PasswordStrengthBar } from "../components/PasswordStrengthBar.jsx";
import { validatePasswordPolicy } from "../lib/passwordPolicy.js";

function Field({ label, onChange, readOnly = false, required = false, type = "text", value }) {
  return (
    <label className={`account-settings-field ${readOnly ? "account-settings-field--readonly" : ""}`}>
      <span>
        {label}
        {required ? " *" : ""}
      </span>
      <input
        onChange={(event) => onChange(event.target.value)}
        readOnly={readOnly}
        type={type}
        value={value ?? ""}
      />
    </label>
  );
}

export function AccountSettingsPage({ title = "My Profile" }) {
  const session = getSession();
  const isAdminAccount = session?.role === ROLES.ADMIN;
  const isRestrictedManagedAccount =
    session?.role === ROLES.SALES || session?.role === ROLES.FINANCE;
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({
    displayName: "",
    email: "",
    phone: "",
    department: "",
    currentPassword: "",
    password: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [managedProfile, setManagedProfile] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      setLoading(true);
      setError("");

      try {
        const data = await fetchCurrentUserProfile();
        if (!active) {
          return;
        }

        const user = data.user || {};
        setProfile(user);
        setManagedProfile(Boolean(user.id));
        setForm({
          displayName: user.displayName || "",
          email: user.email || session?.email || "",
          phone: user.phone || "",
          department: user.department || "",
          currentPassword: "",
          password: "",
        });
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Could not load profile.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadProfile();
    return () => {
      active = false;
    };
  }, [session?.email]);

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const payload = {
        displayName: form.displayName,
      };

      if (!isAdminAccount && !isRestrictedManagedAccount) {
        payload.email = form.email;
        payload.phone = form.phone;
        payload.department = form.department;
      } else if (!isAdminAccount) {
        payload.phone = form.phone;
        payload.department = form.department;
      }

      if (form.password.trim()) {
        validatePasswordPolicy(form.password);
        payload.currentPassword = form.currentPassword;
        payload.password = form.password;
      }

      const data = await updateCurrentUserProfile(payload);
      setProfile(data.user);
      syncSessionProfile(data.user);
      setForm((current) => ({
        ...current,
        displayName: data.user.displayName || "",
        email: data.user.email || "",
        phone: data.user.phone || "",
        department: data.user.department || "",
        currentPassword: "",
        password: "",
      }));
      setSuccess("Your account details were saved. Admin can see the latest values.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not save profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="account-settings-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Account</p>
          <h1>{title}</h1>
          <p className="page-header__copy">
            {isAdminAccount
              ? "Update your display name and password. Contact fields are managed by system configuration."
              : isRestrictedManagedAccount
                ? "Update your display name, contact details, and password. Work email and role are managed by admin."
                : "Update your login email, contact details, and password. Changes sync to the admin view."}
          </p>
        </div>
      </header>

      <div className="account-settings-modal">
        {loading ? <p className="account-settings-loading">Loading profile...</p> : null}
        {error ? <p className="form-error">{error}</p> : null}
        {success ? <p className="account-settings-success">{success}</p> : null}

        {!loading && !managedProfile ? (
          <section className="account-settings-panel">
            <p className="account-settings-note">
              This login is not linked to a managed user record yet. Ask an admin to create credentials
              in <strong>User credentials</strong> so your updates can be stored and viewed centrally.
            </p>
            <dl className="account-settings-meta">
              <div>
                <dt>Signed in as</dt>
                <dd>{session?.email}</dd>
              </div>
              <div>
                <dt>Role</dt>
                <dd>{getRoleLabel(session?.role)}</dd>
              </div>
            </dl>
          </section>
        ) : null}

        {!loading && managedProfile ? (
          <section className="account-settings-panel">
            <dl className="account-settings-meta">
              <div>
                <dt>Work email</dt>
                <dd>{profile?.email || session?.email || "—"}</dd>
              </div>
              <div>
                <dt>Role</dt>
                <dd>{getRoleLabel(profile?.role || session?.role)}</dd>
              </div>
              <div>
                <dt>Last updated</dt>
                <dd>{formatUserUpdatedAt(profile?.updatedAt)}</dd>
              </div>
              <div>
                <dt>Updated by</dt>
                <dd>{profile?.updatedBy || "—"}</dd>
              </div>
            </dl>

            <form className="account-settings-form" onSubmit={handleSubmit}>
              <div className="account-settings-form__grid">
                <Field
                  label="Display name"
                  onChange={(value) => setForm((current) => ({ ...current, displayName: value }))}
                  value={form.displayName}
                />
                {!isRestrictedManagedAccount ? (
                  <Field
                    label="Work email"
                    onChange={(value) => setForm((current) => ({ ...current, email: value }))}
                    readOnly={isAdminAccount}
                    required={!isAdminAccount}
                    type="email"
                    value={form.email}
                  />
                ) : null}
                <Field
                  label="Phone"
                  onChange={(value) => setForm((current) => ({ ...current, phone: value }))}
                  readOnly={isAdminAccount}
                  value={form.phone}
                />
                <Field
                  label="Department"
                  onChange={(value) => setForm((current) => ({ ...current, department: value }))}
                  readOnly={isAdminAccount}
                  value={form.department}
                />
              </div>

              <div className="account-settings-password">
                <h2>
                  <Lock size={18} />
                  Change password
                </h2>
                <p>Leave blank to keep your current password.</p>
                <div className="account-settings-form__grid">
                  <Field
                    label="Current password"
                    onChange={(value) =>
                      setForm((current) => ({ ...current, currentPassword: value }))
                    }
                    type="password"
                    value={form.currentPassword}
                  />
                  <Field
                    label="New password"
                    onChange={(value) =>
                      setForm((current) => ({ ...current, password: value }))
                    }
                    type="password"
                    value={form.password}
                  />
                </div>
                {form.password ? <PasswordStrengthBar password={form.password} /> : null}
              </div>

              <button className="primary-button account-settings-submit" disabled={saving} type="submit">
                <Save size={18} />
                {saving ? "Saving..." : "Save account details"}
              </button>
            </form>
          </section>
        ) : null}
      </div>
    </section>
  );
}
