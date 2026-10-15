import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Eye, EyeOff, Loader2 } from "lucide-react";

import { fetchJson } from "../lib/http.js";
import {
  getPasswordPolicyMessage,
  getPasswordStrength,
  isStrongPassword,
} from "../lib/passwordPolicy.js";

export function SetupUserSetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";

  const [loading, setLoading] = useState(Boolean(token));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [invite, setInvite] = useState(null);
  const [done, setDone] = useState(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const strength = useMemo(() => getPasswordStrength(password), [password]);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setLoading(false);
      setError("This invite link is missing a token.");
      return undefined;
    }

    (async () => {
      try {
        setLoading(true);
        const data = await fetchJson(
          `/api/v1/invite/setup-user?token=${encodeURIComponent(token)}`,
        );
        if (!cancelled) {
          setInvite(data.invite);
          setError("");
        }
      } catch (err) {
        if (!cancelled) {
          setInvite(null);
          setError(err.message || "This invite link is invalid or expired.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    if (!isStrongPassword(password)) {
      setError(getPasswordPolicyMessage());
      return;
    }
    if (password !== confirmPassword) {
      setError("Password and confirmation do not match.");
      return;
    }
    try {
      setSubmitting(true);
      const result = await fetchJson("/api/v1/invite/setup-user/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, confirmPassword }),
      });
      setDone(result);
    } catch (err) {
      setError(err.message || "Could not set password.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="invite-set-password-page">
      <div className="invite-set-password-card">
        <p className="eyebrow">Worktual</p>
        <h1>Set your password</h1>

        {loading ? (
          <p className="muted-copy">
            <Loader2 className="spin" size={16} /> Checking invite…
          </p>
        ) : null}

        {!loading && error && !done ? <p className="form-error-banner">{error}</p> : null}

        {!loading && invite && !done ? (
          <>
            <p className="invite-set-password-lead">
              Hi {invite.firstName || "there"}
              {invite.orgName ? (
                <>
                  {" "}
                  — <strong>{invite.orgName}</strong> invited you to access:
                </>
              ) : (
                " — you were invited to access:"
              )}
            </p>
            <ul className="invite-product-list">
              {(invite.products || []).map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
            <p className="muted-copy">
              Account: <strong>{invite.email}</strong>
            </p>

            <form className="invite-set-password-form" onSubmit={handleSubmit}>
              <label>
                <span>New password</span>
                <div className="invite-password-field">
                  <input
                    autoComplete="new-password"
                    onChange={(event) => setPassword(event.target.value)}
                    type={showPassword ? "text" : "password"}
                    value={password}
                  />
                  <button
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="invite-password-toggle"
                    onClick={() => setShowPassword((current) => !current)}
                    type="button"
                  >
                    {showPassword ? (
                      <EyeOff size={18} strokeWidth={1.75} />
                    ) : (
                      <Eye size={18} strokeWidth={1.75} />
                    )}
                  </button>
                </div>
              </label>
              <label>
                <span>Confirm password</span>
                <div className="invite-password-field">
                  <input
                    autoComplete="new-password"
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                  />
                  <button
                    aria-label={
                      showConfirmPassword ? "Hide confirm password" : "Show confirm password"
                    }
                    className="invite-password-toggle"
                    onClick={() => setShowConfirmPassword((current) => !current)}
                    type="button"
                  >
                    {showConfirmPassword ? (
                      <EyeOff size={18} strokeWidth={1.75} />
                    ) : (
                      <Eye size={18} strokeWidth={1.75} />
                    )}
                  </button>
                </div>
              </label>
              {password ? (
                <p className={`invite-password-strength is-${strength.tone}`}>
                  Strength: {strength.label || "—"}
                </p>
              ) : null}
              <p className="muted-copy">{getPasswordPolicyMessage()}</p>
              {error ? <p className="setup-field-error">{error}</p> : null}
              <button className="primary-button" disabled={submitting} type="submit">
                {submitting ? <Loader2 className="spin" size={16} /> : null}
                Set password
              </button>
            </form>
          </>
        ) : null}

        {done ? (
          <div className="invite-set-password-success">
            <h2>Password set</h2>
            <p>
              You can sign in to the following product
              {(done.products || []).length === 1 ? "" : "s"} when they become available:
            </p>
            <ul className="invite-product-list">
              {(done.products || []).map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
            <p className="muted-copy">
              This is not a My Account admin login. Product sign-in links will be provided when each
              product goes live.
            </p>
          </div>
        ) : null}
      </div>
    </main>
  );
}
