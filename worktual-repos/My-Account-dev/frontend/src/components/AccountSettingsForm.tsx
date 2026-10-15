// @ts-nocheck
import { useEffect, useState } from "react";
import { Lock } from "lucide-react";

import { getSession, ROLES } from "../lib/auth.js";
import {
  fetchCurrentUserProfile,
  formatUserUpdatedAt,
  getRoleLabel,
  syncSessionProfile,
  updateCurrentUserProfile,
} from "../lib/users.js";
import { PasswordStrengthBar } from "./PasswordStrengthBar.tsx";
import { validatePasswordPolicy } from "../lib/passwordPolicy.js";
import { isAccountSettingsFormDirty } from "../lib/sideOverlayFormDraft.js";

function RequiredMark() {
  return (
    <span aria-hidden="true" className="account-settings-field__required">
      *
    </span>
  );
}

function Field({
  className = "account-settings-field",
  error = "",
  hint = "",
  label,
  onChange,
  readOnly = false,
  required = false,
  type = "text",
  value,
}) {
  return (
    <label
      className={`${className}${error ? " is-invalid" : ""}${
        readOnly ? " account-settings-field--readonly" : ""
      }`}
    >
      <span>
        {label}
        {required ? <RequiredMark /> : null}
      </span>
      <input
        aria-invalid={Boolean(error)}
        onChange={(event) => onChange(event.target.value)}
        readOnly={readOnly}
        type={type}
        value={value ?? ""}
      />
      {error ? <span className="account-settings-field__error">{error}</span> : null}
      {!error && hint ? <span className="account-settings-field__hint">{hint}</span> : null}
    </label>
  );
}

/**
 * Shared my-account / profile form body (page or side overlay).
 */
export function AccountSettingsForm({
  fieldClassName = "account-settings-field",
  onSaved,
  onStatusChange,
  showSubmitButton = true,
  variant = "page",
}) {
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
  const [fieldErrors, setFieldErrors] = useState({});
  const [managedProfile, setManagedProfile] = useState(false);
  const [formBaseline, setFormBaseline] = useState(null);

  const isDirty = isAccountSettingsFormDirty(form, formBaseline);

  useEffect(() => {
    onStatusChange?.({ isDirty, loading, managedProfile, saving });
  }, [isDirty, loading, managedProfile, onStatusChange, saving]);

  useEffect(() => {
    if (!success || variant !== "overlay") {
      return undefined;
    }
    const timer = window.setTimeout(() => setSuccess(""), 2000);
    return () => window.clearTimeout(timer);
  }, [success, variant]);

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
        const nextForm = {
          displayName: user.displayName || "",
          email: user.email || session?.email || "",
          phone: user.phone || "",
          department: user.department || "",
          currentPassword: "",
          password: "",
        };
        setForm(nextForm);
        setFormBaseline(nextForm);
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

    void loadProfile();
    return () => {
      active = false;
    };
  }, [session?.email]);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setError("");
    setSuccess("");
    setFieldErrors((current) => {
      if (!current[field]) {
        return current;
      }
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    setFieldErrors({});

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
        try {
          validatePasswordPolicy(form.password);
        } catch (passwordError) {
          setFieldErrors({
            password:
              passwordError instanceof Error ? passwordError.message : "Invalid password.",
          });
          return;
        }
        if (!form.currentPassword.trim()) {
          setFieldErrors({ currentPassword: "Current password is required to set a new one." });
          return;
        }
        payload.currentPassword = form.currentPassword;
        payload.password = form.password;
      }

      const data = await updateCurrentUserProfile(payload);
      setProfile(data.user);
      syncSessionProfile(data.user);
      const nextForm = {
        displayName: data.user.displayName || "",
        email: data.user.email || "",
        phone: data.user.phone || "",
        department: data.user.department || "",
        currentPassword: "",
        password: "",
      };
      setForm(nextForm);
      setFormBaseline(nextForm);
      const message = "Your profile was saved.";
      setSuccess(message);
      onSaved?.(message);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not save profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`account-settings-form-root${variant === "overlay" ? " is-overlay" : ""}`}>
      {loading ? (
        <p className="account-settings-loading" role="status">
          Loading profile…
        </p>
      ) : null}
      {error ? (
        <p className="admin-users-form__inline-error" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="account-settings-success" role="status">
          {success}
        </p>
      ) : null}

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
              <dt>Role</dt>
              <dd>{getRoleLabel(profile?.role || session?.role)}</dd>
            </div>
            <div>
              <dt>Last updated</dt>
              <dd>{formatUserUpdatedAt(profile?.updatedAt)}</dd>
            </div>
            {variant === "page" ? (
              <div>
                <dt>Updated by</dt>
                <dd>{profile?.updatedBy || "—"}</dd>
              </div>
            ) : null}
          </dl>

          <form
            className="account-settings-form"
            id="account-settings-form"
            noValidate
            onSubmit={handleSubmit}
          >
            <div className="account-settings-form__grid">
              <Field
                className={fieldClassName}
                label="Display name"
                onChange={(value) => updateField("displayName", value)}
                value={form.displayName}
              />
              {isRestrictedManagedAccount ? (
                <Field
                  className={fieldClassName}
                  hint="Managed by admin — contact them to change email."
                  label="Work email"
                  onChange={() => {}}
                  readOnly
                  type="email"
                  value={form.email}
                />
              ) : (
                <Field
                  className={fieldClassName}
                  label="Work email"
                  onChange={(value) => updateField("email", value)}
                  readOnly={isAdminAccount}
                  required={!isAdminAccount}
                  type="email"
                  value={form.email}
                />
              )}
              <Field
                className={fieldClassName}
                label="Phone"
                onChange={(value) => updateField("phone", value)}
                readOnly={isAdminAccount}
                value={form.phone}
              />
              <Field
                className={fieldClassName}
                label="Department"
                onChange={(value) => updateField("department", value)}
                readOnly={isAdminAccount}
                value={form.department}
              />
            </div>

            <div className="account-settings-password">
              <h2>
                <Lock size={16} strokeWidth={1.75} />
                Change password
              </h2>
              <p>Leave blank to keep your current password.</p>
              <div className="account-settings-form__grid">
                <Field
                  className={fieldClassName}
                  error={fieldErrors.currentPassword}
                  label="Current password"
                  onChange={(value) => updateField("currentPassword", value)}
                  type="password"
                  value={form.currentPassword}
                />
                <Field
                  className={fieldClassName}
                  error={fieldErrors.password}
                  label="New password"
                  onChange={(value) => updateField("password", value)}
                  type="password"
                  value={form.password}
                />
              </div>
              {form.password ? <PasswordStrengthBar password={form.password} /> : null}
            </div>

            {showSubmitButton ? (
              <button
                className="primary-button account-settings-submit"
                disabled={saving}
                type="submit"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            ) : null}
          </form>
        </section>
      ) : null}
    </div>
  );
}
