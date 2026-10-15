"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Eye,
  EyeOff,
  Lock,
  Mail,
  Megaphone,
  Radar,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { WorktualLogo } from "@/components/brand/WorktualLogo";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { loginAction } from "@/server/auth/login-action";

const FEATURES = [
  {
    icon: Megaphone,
    title: "Campaign creation",
    body: "Plan and launch campaigns with schedules, status, and branch scoping.",
  },
  {
    icon: Radar,
    title: "Live monitoring",
    body: "Track live, scheduled, and past campaigns in one monitoring view.",
  },
  {
    icon: Sparkles,
    title: "Shared identity",
    body: "Sign in with the same Worktual account used across CRM products.",
  },
] as const;

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!isValidEmail(email)) {
      setError("Enter a valid work email address.");
      return;
    }
    if (password.trim().length < 4) {
      setError("Password must be at least 4 characters.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await loginAction({
        email: email.trim(),
        password,
        remember,
      });
      if (!result.ok) {
        setError(result.error);
        setSubmitting(false);
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("Unable to sign in. Check database connection.");
      setSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-subtle">
      <div
        className="pointer-events-none absolute -top-28 -right-20 size-[480px] rounded-full opacity-70 blur-3xl"
        style={{
          background:
            "radial-gradient(circle, var(--color-violet-100) 0%, transparent 68%)",
        }}
      />
      <div
        className="pointer-events-none absolute -bottom-36 -left-28 size-[420px] rounded-full opacity-60 blur-3xl"
        style={{
          background:
            "radial-gradient(circle, var(--color-violet-0) 0%, transparent 70%)",
        }}
      />

      <header className="relative z-10 flex h-14 items-center justify-between bg-canvas-inverse px-5 sm:px-8">
        <WorktualLogo inverted markClassName="size-7" />
        <Button
          variant="ghost"
          size="md"
          className="h-9 rounded-lg border border-text-on-dark/50 px-4 text-sm text-text-on-dark hover:border-text-on-dark hover:bg-white/5"
        >
          Contact Us
        </Button>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-[980px] flex-col px-4 py-10 sm:px-6 lg:py-12">
        <div className="overflow-hidden rounded-2xl border border-border-default/80 bg-surface shadow-[0_20px_60px_rgba(11,11,16,0.10)]">
          <div className="grid min-h-[580px] lg:grid-cols-2">
            <section className="relative flex flex-col justify-between overflow-hidden bg-canvas-inverse p-8 text-text-on-dark lg:p-10">
              <div
                className="pointer-events-none absolute -right-16 -bottom-20 size-[320px] rounded-full opacity-80 blur-3xl"
                style={{
                  background:
                    "radial-gradient(circle, var(--color-violet-700) 0%, var(--color-violet-900) 45%, transparent 70%)",
                }}
              />

              <div className="relative">
                <WorktualLogo inverted markClassName="size-7" />
                <h1 className="mt-12 max-w-[22ch] text-[32px] leading-[1.15] font-semibold tracking-tight">
                  <span className="text-[color:var(--color-violet-400)]">
                    Campaign
                  </span>{" "}
                  <span className="text-text-on-dark">
                    Management for Marketing Teams
                  </span>
                </h1>
                <p className="mt-4 max-w-md text-sm leading-6 text-text-on-dark-muted">
                  Create, schedule, and monitor campaigns in a standalone
                  product—powered by the same Worktual identity as CRM.
                </p>
              </div>

              <ul className="relative mt-12 flex flex-col gap-5">
                {FEATURES.map((item) => (
                  <li key={item.title} className="flex gap-3.5">
                    <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand text-text-on-dark">
                      <item.icon className="size-5" strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0 pt-0.5">
                      <p className="text-sm font-semibold text-text-on-dark">
                        {item.title}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-text-on-dark-muted">
                        {item.body}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="flex flex-col justify-center bg-surface p-8 lg:p-12">
              <div>
                <h2 className="text-[28px] leading-8 font-semibold tracking-tight text-text-primary">
                  Welcome back
                </h2>
                <p className="mt-2 text-sm leading-5 text-text-caption">
                  Sign in with your Worktual account. Campaign product
                  entitlement is required.
                </p>
              </div>

              <form
                onSubmit={handleSubmit}
                className="mt-8 flex flex-col gap-5"
              >
                <Input
                  label="Email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  leftIcon={<Mail className="size-4" strokeWidth={1.75} />}
                  required
                />

                <Input
                  label="Password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  leftIcon={<Lock className="size-4" strokeWidth={1.75} />}
                  rightIcon={
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="text-icon-on-light hover:text-text-primary"
                      aria-label={
                        showPassword ? "Hide password" : "Show password"
                      }
                    >
                      {showPassword ? (
                        <EyeOff className="size-4" strokeWidth={1.75} />
                      ) : (
                        <Eye className="size-4" strokeWidth={1.75} />
                      )}
                    </button>
                  }
                  required
                />

                <div className="flex items-center justify-between gap-3">
                  <Checkbox
                    label="Remember me"
                    name="remember"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                  />
                </div>

                {error ? (
                  <p className="text-sm text-text-danger" role="alert">
                    {error}
                  </p>
                ) : null}

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  className="mt-1 w-full rounded-xl"
                  disabled={submitting}
                >
                  {submitting ? "Signing in…" : "Sign in"}
                  <ArrowRight className="size-4" strokeWidth={2} />
                </Button>
              </form>
            </section>
          </div>
        </div>

        <footer className="mt-8 flex flex-wrap items-center justify-center gap-x-10 gap-y-3 text-sm text-text-caption">
          <span className="inline-flex items-center gap-2">
            <ShieldCheck className="size-4" strokeWidth={1.75} />
            Secure Login
          </span>
          <span className="inline-flex items-center gap-2">
            <Zap className="size-4" strokeWidth={1.75} />
            Shared Account Identity
          </span>
          <span className="inline-flex items-center gap-2">
            <Lock className="size-4" strokeWidth={1.75} />
            Enterprise-grade Security
          </span>
        </footer>
      </main>
    </div>
  );
}
