import {
  BarChartOutlined,
  CustomerServiceOutlined,
  InfoCircleOutlined,
  LockOutlined,
  MailOutlined,
  SafetyOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { useState } from "react";
import { useNavigate } from "react-router";

import { WorktualMark } from "@/components/brand/WorktualMark";
import { getHomePath } from "@/config/navigation";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

export default function LoginPage() {
  const { login, logout, isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionConflict, setSessionConflict] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function completeLogin(force = false) {
    setError(null);
    setSessionConflict(false);
    setSubmitting(true);
    const result = await login(email, password, force ? { force: true } : undefined);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      setSessionConflict(result.alreadySignedIn);
      return;
    }
    navigate(result.homePath, { replace: true });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await completeLogin(sessionConflict);
  }

  async function onLocalSignOut() {
    setSubmitting(true);
    await logout();
    setSubmitting(false);
    setError(null);
    setSessionConflict(false);
  }

  function onContinueAsCurrentUser() {
    if (!user) return;
    navigate(getHomePath(user.role), { replace: true });
  }

  function clearSessionConflict() {
    setSessionConflict(false);
    setError(null);
  }

  const showLocalSessionPanel = isAuthenticated && user;

  return (
    <div className="flex min-h-svh flex-col bg-[#eceef2] text-neutral-900">
      <header className="flex h-14 items-center justify-between bg-black px-4 sm:px-6">
        <WorktualMark className="h-7" />
        <a
          href="mailto:support@worktual.com"
          className="!rounded-lg !border-0 !bg-[#7423d7] !px-3.5 !py-1.5 !text-sm !text-[#ffffff] !no-underline transition hover:!brightness-110 hover:!text-[#ffffff]"
          style={{ backgroundColor: "#7423d7", color: "#ffffff" }}
        >
          Contact Us
        </a>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-8 sm:px-6 sm:py-12">
        <div className="grid w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-[0_20px_60px_rgba(15,23,42,0.12)] lg:grid-cols-2">
          <aside className="relative hidden overflow-hidden bg-[#0b0618] px-8 py-10 text-white lg:flex lg:flex-col lg:justify-between">
            <div className="relative">
              <WorktualMark className="mb-10 h-8" />
              <h1 className="text-4xl font-semibold leading-tight tracking-tight xl:text-[2.6rem]">
                <span className="text-[#c18fff]">AI-native</span>
                <br />
                Contact Center
                <br />
                for Enterprise Teams
              </h1>
              <p className="mt-4 max-w-md text-sm leading-relaxed text-white/70">
                Streamline conversations, automate workflows, and deliver exceptional customer
                experiences from a single unified platform.
              </p>
            </div>

            <ul className="relative mt-10 space-y-4">
              {[
                {
                  icon: <ThunderboltOutlined />,
                  title: "Intelligence Automation",
                  body: "Smart responses and automation for faster resolutions.",
                },
                {
                  icon: <CustomerServiceOutlined />,
                  title: "Unified Communications",
                  body: "Manage all customer interactions in one place.",
                },
                {
                  icon: <BarChartOutlined />,
                  title: "Real-time Insights",
                  body: "Data-driven insights for better decisions.",
                },
              ].map((item) => (
                <li key={item.title} className="flex gap-3">
                  <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-[#c18fff]">
                    {item.icon}
                  </span>
                  <div>
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="text-sm leading-relaxed text-white/55">{item.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </aside>

          <section className="flex flex-col justify-center px-6 py-10 sm:px-10 sm:py-12">
            {showLocalSessionPanel ? (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">
                    You&apos;re already signed in
                  </h2>
                  <p className="mt-2 text-sm text-neutral-600">
                    Signed in as <span className="font-medium text-neutral-800">{user.email}</span>
                  </p>
                </div>

                <div className="space-y-3">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={onContinueAsCurrentUser}
                    className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-black text-sm font-medium text-white transition hover:bg-neutral-800 disabled:opacity-60"
                  >
                    Continue to app
                    <span aria-hidden>→</span>
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => void onLocalSignOut()}
                    className="flex h-11 w-full items-center justify-center rounded-xl border-[0.6px] border-[#bfbfbf] bg-white text-sm font-medium text-neutral-800 transition hover:bg-neutral-50 disabled:opacity-60"
                  >
                    Sign out
                  </button>
                </div>

                <p className="text-xs text-neutral-600">
                  Sign out to use a different account on this device.
                </p>
              </div>
            ) : (
              <>
                <h2 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">
                  Welcome back
                </h2>
                <p className="mt-2 text-sm text-[#5e5e69]">
                  Sign in with your Contact Center admin or support agent credentials
                </p>

                <form className="mt-8 space-y-5" onSubmit={onSubmit} noValidate>
                  <div className="flex flex-col gap-2">
                    <label htmlFor="email" className="block text-sm font-medium text-neutral-800">
                      Email
                    </label>
                    <div className="relative">
                      <MailOutlined className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-900" />
                      <input
                        id="email"
                        type="email"
                        autoComplete="email"
                        placeholder="you@company.com"
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          if (sessionConflict) clearSessionConflict();
                        }}
                        className="h-11 w-full rounded-xl border-[0.6px] border-[#bfbfbf] bg-white pr-3 pl-10 text-sm outline-none transition placeholder:text-neutral-600 focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <label htmlFor="password" className="block text-sm font-medium text-neutral-800">
                      Password
                    </label>
                    <div className="relative">
                      <LockOutlined className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                      <input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        placeholder="Enter your password"
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          if (sessionConflict) clearSessionConflict();
                        }}
                        className="h-11 w-full rounded-xl border-[0.6px] border-[#bfbfbf] bg-white pr-10 pl-10 text-sm outline-none transition placeholder:text-neutral-600 focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute top-1/2 right-3 -translate-y-1/2 text-xs text-neutral-800 hover:text-neutral-950"
                      >
                        {showPassword ? "Hide" : "Show"}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 text-sm">
                    <label className="flex cursor-pointer items-center gap-2 text-neutral-600">
                      <input
                        type="checkbox"
                        checked={remember}
                        onChange={(e) => setRemember(e.target.checked)}
                        className="size-4 rounded border-neutral-300"
                      />
                      Remember me
                    </label>
                    <button
                      type="button"
                      className="text-blue-600 underline underline-offset-2 transition hover:text-blue-800"
                    >
                      Forgot password?
                    </button>
                  </div>

                  {sessionConflict ? (
                    <div
                      className="flex items-start gap-2.5 rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50 px-3 py-2.5"
                      role="alert"
                    >
                      <InfoCircleOutlined className="mt-0.5 shrink-0 text-sm text-neutral-400" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-neutral-800">Session already active</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-[#5e5e69]">
                          This account is signed in elsewhere. Signing in here will end the other
                          session.
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={clearSessionConflict}
                        className="shrink-0 text-xs text-neutral-800 transition hover:text-neutral-950"
                      >
                        Dismiss
                      </button>
                    </div>
                  ) : error ? (
                    <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">
                      {error}
                    </p>
                  ) : null}

                  <button
                    type="submit"
                    disabled={submitting}
                    className={cn(
                      "flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-black text-sm font-medium text-white transition hover:bg-neutral-800 disabled:opacity-60",
                    )}
                  >
                    {submitting
                      ? "Signing in…"
                      : sessionConflict
                        ? "Replace session & sign in"
                        : "Sign in"}
                    <span aria-hidden>→</span>
                  </button>
                </form>
              </>
            )}
          </section>
        </div>
      </main>

      <footer className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 px-4 pb-8 text-xs text-neutral-600">
        <span className="inline-flex items-center gap-1.5">
          <SafetyOutlined /> Secure Login
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ThunderboltOutlined /> Real-time AI Operations
        </span>
        <span className="inline-flex items-center gap-1.5">
          <LockOutlined /> Enterprise-grade Security
        </span>
      </footer>
    </div>
  );
}
