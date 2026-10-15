import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  Eye,
  EyeOff,
  Lock,
  Mail,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";

import { BrandLogo } from "../components/BrandLogo.jsx";
import { FieldControl } from "../components/FieldControl.jsx";
import { clearSession, getAuthToken, getSession } from "../lib/auth.js";
import { clearCustomerSession, getCustomerSession, getCustomerToken } from "../lib/customerAuth.js";
import { resolveSignedInHomePath, signInAndStoreSession } from "../lib/signIn.js";

const loginFeatures = [
  {
    icon: Sparkles,
    title: "AI-Powered Automation",
    description: "Smart responses and automation for faster resolutions.",
  },
  {
    icon: MessageCircle,
    title: "Unified Communications",
    description: "Manage all customer interactions in one place.",
  },
  {
    icon: BarChart3,
    title: "Real-time Insights",
    description: "Data-driven insights for better decisions.",
  },
];

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("reason") === "session-expired") {
      setError("Your session expired. Please sign in again.");
    }

    const homePath = resolveSignedInHomePath();
    if (homePath) {
      navigate(homePath, { replace: true });
      return;
    }

    if (getSession() && !getAuthToken()) {
      clearSession();
    }
    if (getCustomerSession() && !getCustomerToken()) {
      clearCustomerSession();
    }
  }, [navigate]);

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
      const { path } = await signInAndStoreSession(normalizedEmail, password, { rememberMe });
      navigate(path, { replace: true });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Login failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

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
                <span>AI-Powered</span>
                Contact Center
                <small>for Enterprise Teams</small>
              </h1>
              <p>
                Streamline conversations, automate workflows, and deliver exceptional customer
                experiences from a single unified platform.
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
              <p>Sign in with your sales, finance, admin, or customer portal credentials</p>

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
                  <button className="text-button" type="button" disabled>
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
            <ShieldCheck size={21} /> Secure Login
          </span>
          <span>
            <Zap size={21} /> Real-time AI Operations
          </span>
          <span>
            <Lock size={21} /> Enterprise-grade Security
          </span>
        </div>
      </section>
    </main>
  );
}
