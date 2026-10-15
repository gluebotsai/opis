// @ts-nocheck
import { useEffect, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  Eye,
  EyeOff,
  FileText,
  Lock,
  Mail,
  ShieldCheck,
  Users,
  Wallet,
  X,
} from "lucide-react";

import { BrandLogo } from "../components/BrandLogo.tsx";
import { FieldControl } from "../components/FieldControl.tsx";
import { PasswordStrengthBar } from "../components/PasswordStrengthBar.tsx";
import { clearSession, getAuthToken, getSession } from "../lib/auth.js";
import { clearCustomerSession, getCustomerSession, getCustomerToken } from "../lib/customerAuth.js";
import {
  confirmPasswordReset,
  requestPasswordResetOtp,
  verifyPasswordResetOtp,
} from "../lib/passwordReset.js";
import { getPasswordPolicyMessage, validatePasswordPolicy } from "../lib/passwordPolicy.js";
import { validateStoredSession, signInAndStoreSession } from "../lib/signIn.js";

const loginFeatures = [
  {
    icon: Users,
    title: "Lead & customer onboarding",
    description: "Capture company details, branches, and billing contacts in one flow.",
  },
  {
    icon: FileText,
    title: "Quotes, invoices & payments",
    description: "Generate quotations, route finance approval, and track payment status.",
  },
  {
    icon: BarChart3,
    title: "Portfolio oversight",
    description: "Monitor subscriptions, renewals, and sales performance across teams.",
  },
  {
    icon: Wallet,
    title: "Number management",
    description: "Map tenant numbers and review agent/DID usage across customers.",
  },
];

const RESET_STEPS = {
  email: "email",
  otp: "otp",
  password: "password",
  done: "done",
};

function resetHelperForStep(step, email) {
  if (step === RESET_STEPS.email) {
    return "A 6-digit code is emailed from the platform admin mailbox. Platform admin accounts cannot use this reset.";
  }
  if (step === RESET_STEPS.otp) {
    return email
      ? `Enter the 6-digit code sent to ${email}.`
      : "Enter the 6-digit code sent to your email.";
  }
  if (step === RESET_STEPS.password) {
    return "Choose a new password that meets the strength requirements.";
  }
  return "";
}

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [showForgotPassword, setShowForgotPassword] = useState(false);

  const [resetStep, setResetStep] = useState(RESET_STEPS.email);
  const [resetEmail, setResetEmail] = useState("");
  const [resetOtp, setResetOtp] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirmPassword, setResetConfirmPassword] = useState("");
  const [resetPasswordVisible, setResetPasswordVisible] = useState(false);
  const [resetConfirmVisible, setResetConfirmVisible] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState("");
  const [resetSuccessMessage, setResetSuccessMessage] = useState("");
  const [resetFieldErrors, setResetFieldErrors] = useState({});

  useEffect(() => {
    let active = true;

    async function bootstrapLoginPage() {
      const params = new URLSearchParams(window.location.search);
      if (params.get("reason") === "session-expired") {
        params.delete("reason");
        const nextQuery = params.toString();
        const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`;
        window.history.replaceState({}, "", nextUrl);
      }

      const homePath = await validateStoredSession();
      if (!active) {
        return;
      }

      if (homePath) {
        window.location.replace(homePath);
        return;
      }

      if (getSession() && !getAuthToken()) {
        clearSession();
      }
      if (getCustomerSession() && !getCustomerToken()) {
        clearCustomerSession();
      }
    }

    bootstrapLoginPage();

    return () => {
      active = false;
    };
  }, []);

  function clearResetFieldError(key) {
    setResetFieldErrors((current) => {
      if (!current[key]) {
        return current;
      }
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function openForgotPassword() {
    setShowForgotPassword(true);
    setResetStep(RESET_STEPS.email);
    setResetEmail(email.trim());
    setResetOtp("");
    setResetToken("");
    setResetPassword("");
    setResetConfirmPassword("");
    setResetPasswordVisible(false);
    setResetConfirmVisible(false);
    setResetBusy(false);
    setResetError("");
    setResetSuccessMessage("");
    setResetFieldErrors({});
  }

  function closeForgotPassword() {
    setShowForgotPassword(false);
    setResetBusy(false);
    setResetError("");
    setResetSuccessMessage("");
    setResetFieldErrors({});
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    const normalizedEmail = email.trim();

    if (!normalizedEmail) {
      setError("Enter your email.");
      return;
    }

    if (!password) {
      setError("Enter your password.");
      return;
    }

    setIsSubmitting(true);

    try {
      // Do not open a blank Microsoft tab here. Offline tokens mean most logins
      // skip Outlook connect — a speculative tab would flash open/close.
      // When connect is needed, signIn opens OAuth (popup or same-tab fallback).
      await signInAndStoreSession(normalizedEmail, password, { rememberMe });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Login failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function requestOtp() {
    setResetError("");
    setResetFieldErrors({});

    const normalizedEmail = resetEmail.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      setResetFieldErrors({ email: "Enter a valid email address." });
      return;
    }

    setResetBusy(true);
    try {
      await requestPasswordResetOtp(normalizedEmail);
      setResetEmail(normalizedEmail);
      setResetStep(RESET_STEPS.otp);
      setResetOtp("");
    } catch (requestError) {
      setResetError(
        requestError instanceof Error ? requestError.message : "Could not send reset code.",
      );
    } finally {
      setResetBusy(false);
    }
  }

  async function handleRequestOtp(event) {
    event.preventDefault();
    await requestOtp();
  }

  async function handleVerifyOtp(event) {
    event.preventDefault();
    setResetError("");
    setResetFieldErrors({});

    const otp = resetOtp.trim();
    if (!/^\d{6}$/.test(otp)) {
      setResetFieldErrors({ otp: "Enter the 6-digit code from your email." });
      return;
    }

    setResetBusy(true);
    try {
      const result = await verifyPasswordResetOtp(resetEmail, otp);
      setResetToken(result.resetToken || "");
      setResetStep(RESET_STEPS.password);
      setResetPassword("");
      setResetConfirmPassword("");
    } catch (verifyError) {
      setResetError(verifyError instanceof Error ? verifyError.message : "Could not verify code.");
    } finally {
      setResetBusy(false);
    }
  }

  async function handleConfirmReset(event) {
    event.preventDefault();
    setResetError("");
    setResetFieldErrors({});

    const fieldErrors = {};
    if (!resetPassword.trim()) {
      fieldErrors.password = "Enter a new password.";
    } else {
      try {
        validatePasswordPolicy(resetPassword);
      } catch (policyError) {
        fieldErrors.password =
          policyError instanceof Error ? policyError.message : getPasswordPolicyMessage();
      }
    }
    if (!resetConfirmPassword.trim()) {
      fieldErrors.confirm = "Confirm your new password.";
    } else if (resetPassword !== resetConfirmPassword) {
      fieldErrors.confirm = "New password and confirmation do not match.";
    }

    if (Object.keys(fieldErrors).length > 0) {
      setResetFieldErrors(fieldErrors);
      return;
    }

    setResetBusy(true);
    try {
      const result = await confirmPasswordReset({
        email: resetEmail,
        resetToken,
        password: resetPassword,
      });
      setResetStep(RESET_STEPS.done);
      setResetSuccessMessage(result.message || "Password updated. Sign in with your new password.");
      setEmail(resetEmail);
      setPassword("");
    } catch (confirmError) {
      setResetError(
        confirmError instanceof Error ? confirmError.message : "Could not update password.",
      );
    } finally {
      setResetBusy(false);
    }
  }

  const resetHelper = resetHelperForStep(resetStep, resetEmail);
  const primaryCtaLabel =
    resetStep === RESET_STEPS.email
      ? resetBusy
        ? "Sending…"
        : "Send code"
      : resetStep === RESET_STEPS.otp
        ? resetBusy
          ? "Verifying…"
          : "Verify code"
        : resetStep === RESET_STEPS.password
          ? resetBusy
            ? "Saving…"
            : "Update password"
          : "Back to sign in";

  return (
    <main className="login-screen">
      <header className="login-header">
        <BrandLogo />
        <a
          className="login-header__button"
          href="https://worktual.in/contact/"
          rel="noopener noreferrer"
          target="_blank"
        >
          Contact Us
        </a>
      </header>

      <section className="login-stage">
        <div className="login-card">
          <aside className="login-card__story">
            <div className="login-card__story-content">
              <BrandLogo className="login-card__logo" />
              <h1>
                <span>Accounts</span>
                &amp; onboarding hub
                <small>for revenue and customer operations</small>
              </h1>
              <p>
                Manage leads, quotations, finance approvals, subscriptions, and customer portal
                access from one secure workspace.
              </p>

              <div className="login-feature-list">
                {loginFeatures.map((feature) => (
                  <div className="login-feature" key={feature.title}>
                    <span className="login-feature__icon">
                      <feature.icon size={22} strokeWidth={1.75} />
                    </span>
                    <span>
                      <strong>{feature.title}</strong>
                      <small>{feature.description}</small>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </aside>

          <section className="login-card__form-panel">
            <div className="login-form-wrap">
              <h2>Welcome back</h2>
              <p>Use the work email and password issued for your role. You will be routed to the right portal automatically.</p>

              <form className="login-form" onSubmit={handleSubmit}>
                <label className="field">
                  <span>Email</span>
                  <FieldControl icon={Mail}>
                    <input
                      autoComplete="email"
                      name="email"
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@company.com"
                      type="email"
                      value={email}
                    />
                  </FieldControl>
                </label>

                <label className="field">
                  <span>Password</span>
                  <FieldControl icon={Lock}>
                    <input
                      autoComplete="current-password"
                      name="password"
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Enter your password"
                      type={isPasswordVisible ? "text" : "password"}
                      value={password}
                    />
                    <button
                      aria-label={isPasswordVisible ? "Hide password" : "Show password"}
                      className="icon-button"
                      onClick={() => setIsPasswordVisible((current) => !current)}
                      type="button"
                    >
                      {isPasswordVisible ? <EyeOff size={18} strokeWidth={1.75} /> : <Eye size={18} strokeWidth={1.75} />}
                    </button>
                  </FieldControl>
                </label>

                <div className="login-form__row">
                  <label className="checkbox-field">
                    <input
                      checked={rememberMe}
                      onChange={(event) => setRememberMe(event.target.checked)}
                      type="checkbox"
                    />
                    <span>Remember me</span>
                  </label>
                  <button
                    className="text-button"
                    onClick={openForgotPassword}
                    type="button"
                  >
                    Forgot password?
                  </button>
                </div>

                {error ? <p className="form-error">{error}</p> : null}

                <button className="primary-button" disabled={isSubmitting} type="submit">
                  <span>{isSubmitting ? "Signing in..." : "Sign in"}</span>
                  <ArrowRight size={20} />
                </button>
              </form>
            </div>
          </section>
        </div>

        <div className="login-trust">
          <span>
            <ShieldCheck size={21} /> Secure sign-in
          </span>
          <span>
            <Wallet size={21} /> Finance-ready billing flows
          </span>
          <span>
            <Lock size={21} /> Role-based access
          </span>
        </div>
      </section>

      {showForgotPassword ? (
        <div
          className="login-forgot-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="login-forgot-dialog-title"
        >
          <button
            aria-label="Close password reset"
            className="login-forgot-dialog__backdrop"
            onClick={resetBusy ? undefined : closeForgotPassword}
            type="button"
          />
          <div className="login-forgot-dialog__card">
            <header className="login-forgot-dialog__header">
              <button
                aria-label="Close"
                className="icon-button login-forgot-dialog__close"
                disabled={resetBusy}
                onClick={closeForgotPassword}
                type="button"
              >
                <X size={18} />
              </button>
              <h3 id="login-forgot-dialog-title">Reset your password</h3>
              {resetHelper ? (
                <p className="login-forgot-dialog__helper">{resetHelper}</p>
              ) : null}
            </header>

            {resetStep === RESET_STEPS.done ? (
              <>
                <div className="login-forgot-dialog__body">
                  <p className="login-forgot-dialog__alert is-success" role="status">
                    {resetSuccessMessage || "Password updated. Sign in with your new password."}
                  </p>
                </div>
                <div className="login-forgot-dialog__footer">
                  <button
                    className="primary-button login-forgot-dialog__cta"
                    onClick={closeForgotPassword}
                    type="button"
                  >
                    Back to sign in
                  </button>
                </div>
              </>
            ) : null}

            {resetStep === RESET_STEPS.email ? (
              <form className="login-forgot-dialog__form" onSubmit={handleRequestOtp}>
                <div className="login-forgot-dialog__body">
                  {resetError ? (
                    <p className="login-forgot-dialog__alert is-error" role="alert">
                      {resetError}
                    </p>
                  ) : null}
                  <label className={`field${resetFieldErrors.email ? " field--invalid" : ""}`}>
                    <span>Registered email</span>
                    <input
                      autoComplete="email"
                      disabled={resetBusy}
                      onChange={(event) => {
                        setResetEmail(event.target.value);
                        clearResetFieldError("email");
                        setResetError("");
                      }}
                      placeholder="you@company.com"
                      type="email"
                      value={resetEmail}
                    />
                    {resetFieldErrors.email ? (
                      <span className="field__error">{resetFieldErrors.email}</span>
                    ) : null}
                  </label>
                </div>
                <div className="login-forgot-dialog__footer">
                  <button
                    className="primary-button login-forgot-dialog__cta"
                    disabled={resetBusy}
                    type="submit"
                  >
                    {primaryCtaLabel}
                  </button>
                </div>
              </form>
            ) : null}

            {resetStep === RESET_STEPS.otp ? (
              <form className="login-forgot-dialog__form" onSubmit={handleVerifyOtp}>
                <div className="login-forgot-dialog__body">
                  {resetError ? (
                    <p className="login-forgot-dialog__alert is-error" role="alert">
                      {resetError}
                    </p>
                  ) : null}
                  <label className={`field${resetFieldErrors.otp ? " field--invalid" : ""}`}>
                    <span>6-digit code</span>
                    <input
                      autoComplete="one-time-code"
                      disabled={resetBusy}
                      inputMode="numeric"
                      maxLength={6}
                      onChange={(event) => {
                        setResetOtp(event.target.value.replace(/\D/g, "").slice(0, 6));
                        clearResetFieldError("otp");
                        setResetError("");
                      }}
                      placeholder="123456"
                      type="text"
                      value={resetOtp}
                    />
                    {resetFieldErrors.otp ? (
                      <span className="field__error">{resetFieldErrors.otp}</span>
                    ) : null}
                  </label>
                  <div className="login-form__row">
                    <button
                      className="text-button"
                      disabled={resetBusy}
                      onClick={() => {
                        setResetStep(RESET_STEPS.email);
                        setResetError("");
                        setResetFieldErrors({});
                      }}
                      type="button"
                    >
                      Change email
                    </button>
                    <button
                      className="text-button"
                      disabled={resetBusy}
                      onClick={() => void requestOtp()}
                      type="button"
                    >
                      Resend code
                    </button>
                  </div>
                </div>
                <div className="login-forgot-dialog__footer">
                  <button
                    className="primary-button login-forgot-dialog__cta"
                    disabled={resetBusy}
                    type="submit"
                  >
                    {primaryCtaLabel}
                  </button>
                </div>
              </form>
            ) : null}

            {resetStep === RESET_STEPS.password ? (
              <form className="login-forgot-dialog__form" onSubmit={handleConfirmReset}>
                <div className="login-forgot-dialog__body">
                  {resetError ? (
                    <p className="login-forgot-dialog__alert is-error" role="alert">
                      {resetError}
                    </p>
                  ) : null}
                  <label className={`field${resetFieldErrors.password ? " field--invalid" : ""}`}>
                    <span>New password</span>
                    <div className="login-reset-password-field">
                      <input
                        autoComplete="new-password"
                        disabled={resetBusy}
                        onChange={(event) => {
                          setResetPassword(event.target.value);
                          clearResetFieldError("password");
                          setResetError("");
                        }}
                        type={resetPasswordVisible ? "text" : "password"}
                        value={resetPassword}
                      />
                      <button
                        aria-label={resetPasswordVisible ? "Hide password" : "Show password"}
                        className="icon-button"
                        disabled={resetBusy}
                        onClick={() => setResetPasswordVisible((current) => !current)}
                        type="button"
                      >
                        {resetPasswordVisible ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                    {resetFieldErrors.password ? (
                      <span className="field__error">{resetFieldErrors.password}</span>
                    ) : null}
                  </label>
                  <PasswordStrengthBar password={resetPassword} />
                  <label className={`field${resetFieldErrors.confirm ? " field--invalid" : ""}`}>
                    <span>Confirm new password</span>
                    <div className="login-reset-password-field">
                      <input
                        autoComplete="new-password"
                        disabled={resetBusy}
                        onChange={(event) => {
                          setResetConfirmPassword(event.target.value);
                          clearResetFieldError("confirm");
                          setResetError("");
                        }}
                        type={resetConfirmVisible ? "text" : "password"}
                        value={resetConfirmPassword}
                      />
                      <button
                        aria-label={resetConfirmVisible ? "Hide password" : "Show password"}
                        className="icon-button"
                        disabled={resetBusy}
                        onClick={() => setResetConfirmVisible((current) => !current)}
                        type="button"
                      >
                        {resetConfirmVisible ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                    {resetFieldErrors.confirm ? (
                      <span className="field__error">{resetFieldErrors.confirm}</span>
                    ) : null}
                  </label>
                </div>
                <div className="login-forgot-dialog__footer">
                  <button
                    className="primary-button login-forgot-dialog__cta"
                    disabled={resetBusy}
                    type="submit"
                  >
                    {primaryCtaLabel}
                  </button>
                </div>
              </form>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}
