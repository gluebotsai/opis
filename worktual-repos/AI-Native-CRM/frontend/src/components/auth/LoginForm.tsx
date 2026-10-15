import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Eye,
  EyeOff,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import { WorktualLogo } from "@/components/brand/WorktualLogo";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { preloadSignedInShell, signedInHomePath } from "@/App";
import { loginRequest, type AuthUser } from "@/services/auth";
import { setUser, useAppDispatch, useAppSelector } from "@/store";
import {
  primeAudioFromUserGesture,
  startBriefingDelayClock,
} from "@/lib/unlock-audio";
import { startDailyBriefingClock } from "@/components/home/DailyBriefingPlayer";

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function pathAfterLogin(role: string | undefined, nextParam: string | null): string {
  const next = nextParam && nextParam.startsWith("/") ? nextParam : "/";
  if (next === "/") return signedInHomePath(role);
  return next;
}

const FEATURES = [
  {
    icon: Sparkles,
    title: "Agent-Native Workflows",
    body: "Autonomous, confirmed, or human-in-the-loop actions based on each scenario.",
  },
  {
    icon: Users,
    title: "Unified Customer 360",
    body: "Contacts, companies, and journeys for B2B, B2C, and B2B2C in one CRM.",
  },
  {
    icon: BarChart3,
    title: "Revenue Intelligence",
    body: "Pipeline, commerce, and service insights that guide the next best action.",
  },
] as const;

/** Pixel-parity port of src/components/auth/LoginForm.tsx (API login instead of Server Action). */
export function LoginForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const dispatch = useAppDispatch();
  const { user, bootstrapped } = useAppSelector((s) => s.auth);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionElsewhere, setSessionElsewhere] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const signedInElsewhere =
    searchParams.get("reason") === "signed-in-elsewhere";

  const completeLogin = (user: AuthUser) => {
    dispatch(setUser(user));
    startBriefingDelayClock();
    startDailyBriefingClock();
    navigate(pathAfterLogin(user.role, searchParams.get("next")), {
      replace: true,
    });
  };

  const clearSessionElsewherePrompt = () => {
    setSessionElsewhere(false);
    setError(null);
  };

  const attemptLogin = async (force: boolean) => {
    if (!force) {
      setSessionElsewhere(false);
    }

    setError(null);
    setSubmitting(true);
    const shellReady = preloadSignedInShell();
    try {
      const result = await loginRequest({
        email: email.trim(),
        password,
        remember,
        force,
      });
      if (!result.ok) {
        if (result.code === "session_active_elsewhere") {
          setSessionElsewhere(true);
          setError(null);
        } else {
          setSessionElsewhere(false);
          setError(result.error);
        }
        setSubmitting(false);
        return;
      }
      await shellReady.catch(() => undefined);
      completeLogin(result.user);
    } catch {
      setSessionElsewhere(false);
      setError(
        "Unable to reach the CRM API. Start the backend on port 4000, then try again.",
      );
      setSubmitting(false);
    }
  };

  useEffect(() => {
    void preloadSignedInShell();
  }, []);

  useEffect(() => {
    if (bootstrapped && user && !submitting) {
      navigate(pathAfterLogin(user.role, searchParams.get("next")), {
        replace: true,
      });
    }
  }, [bootstrapped, user, submitting, navigate, searchParams]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    primeAudioFromUserGesture();
    setError(null);
    setSessionElsewhere(false);

    if (!isValidEmail(email)) {
      setError("Enter a valid work email address.");
      return;
    }
    if (password.trim().length < 4) {
      setError("Password must be at least 4 characters.");
      return;
    }

    void attemptLogin(false);
  };

  if (!bootstrapped || (user && !submitting)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-subtle text-text-secondary">
        {user ? "Redirecting…" : "Loading…"}
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-[#eceef2]">
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

      <header className="relative z-10 flex h-14 w-full shrink-0 items-center justify-between bg-black px-5 sm:px-8">
        <WorktualLogo inverted markClassName="size-7" />
        <Button
          variant="ghost"
          size="md"
          className="h-9 rounded-lg border border-text-on-dark/50 px-4 text-sm text-text-on-dark hover:border-text-on-dark hover:bg-white/5"
        >
          Contact Us
        </Button>
      </header>

      <main className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-4 py-4 sm:px-6">
        <div className="w-full max-w-[980px]">
          <div className="overflow-hidden rounded-2xl border-[0.6px] border-[#bfbfbf] bg-surface shadow-[0_20px_60px_rgba(11,11,16,0.10)]">
            <div className="grid lg:grid-cols-2">
            <section className="relative flex flex-col justify-between overflow-hidden bg-[#0b0618] p-8 text-text-on-dark lg:p-10">
              <div
                className="pointer-events-none absolute -right-16 -bottom-20 size-[320px] rounded-full opacity-80 blur-3xl"
                style={{
                  background:
                    "radial-gradient(circle, var(--color-violet-700) 0%, var(--color-violet-900) 45%, transparent 70%)",
                }}
              />

              <div className="relative">
                <WorktualLogo inverted markClassName="size-7" />
                <h1 className="mt-8 max-w-[22ch] text-[32px] leading-[1.15] font-semibold tracking-tight">
                  <span className="text-[color:var(--color-violet-400)]">
                    AI-Native
                  </span>{" "}
                  <span className="text-text-on-dark">CRM</span>
                </h1>
                <p className="mt-4 max-w-md text-sm leading-6 text-text-on-dark-muted">
                  Manage relationships, pipeline, commerce, and service from one
                  agent-native platform—built to work across every customer
                  model.
                </p>
              </div>

              <ul className="relative mt-8 flex flex-col gap-5">
                {FEATURES.map((item) => (
                  <li key={item.title} className="flex gap-3.5">
                    <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/10 text-text-on-dark">
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
                  Sign in with your sales, marketing, finance, or admin
                  credentials.
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
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (sessionElsewhere) clearSessionElsewherePrompt();
                  }}
                  leftIcon={<Mail className="size-4" strokeWidth={1.75} />}
                  className="h-11 rounded-xl bg-white"
                  required
                />

                <Input
                  label="Password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (sessionElsewhere) clearSessionElsewherePrompt();
                  }}
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
                  className="h-11 rounded-xl bg-white"
                  required
                />

                <div className="flex items-center justify-between gap-3">
                  <Checkbox
                    label="Remember me"
                    name="remember"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                  />
                  <Link
                    to="/forgot-password"
                    className="text-sm font-medium text-[#2563eb] underline-offset-2 hover:text-[#1e40af] hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>

                {signedInElsewhere && !sessionElsewhere ? (
                  <p className="text-sm text-text-caption" role="status">
                    You were signed out because CRM was opened in another
                    browser.
                  </p>
                ) : null}

                {sessionElsewhere ? (
                  <div
                    className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
                    role="alert"
                  >
                    <div className="flex gap-2">
                      <AlertTriangle
                        className="mt-0.5 size-4 shrink-0 text-amber-700"
                        strokeWidth={1.75}
                        aria-hidden
                      />
                      <div className="space-y-1">
                        <p className="font-medium">
                          Already signed in to CRM elsewhere
                        </p>
                        <p className="leading-5 text-amber-900/90">
                          This account is already signed in on another browser
                          or device. You can stay on that session, or log it out
                          and sign in here.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}

                {error ? (
                  <p className="text-sm text-text-danger" role="alert">
                    {error}
                  </p>
                ) : null}

                {sessionElsewhere ? (
                  <div className="flex flex-col gap-3">
                    <Button
                      type="button"
                      variant="primary"
                      size="lg"
                      className="w-full rounded-xl"
                      disabled={submitting}
                      onClick={() => void attemptLogin(true)}
                    >
                      Log out other session and sign in
                      <ArrowRight className="size-4" strokeWidth={2} />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="md"
                      className="w-full rounded-xl"
                      disabled={submitting}
                      onClick={clearSessionElsewherePrompt}
                    >
                      Keep other session — go back
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="submit"
                    variant="primary"
                    size="lg"
                    className="mt-1 w-full rounded-xl"
                    disabled={submitting}
                    onPointerDown={primeAudioFromUserGesture}
                  >
                    Sign in
                    <ArrowRight className="size-4" strokeWidth={2} />
                  </Button>
                )}
              </form>
            </section>
          </div>
        </div>

        <footer className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-3 text-sm text-text-caption">
          <span className="inline-flex items-center gap-2">
            <ShieldCheck className="size-4" strokeWidth={1.75} />
            Secure Login
          </span>
          <span className="inline-flex items-center gap-2">
            <Zap className="size-4" strokeWidth={1.75} />
            Real-time AI Operations
          </span>
          <span className="inline-flex items-center gap-2">
            <Lock className="size-4" strokeWidth={1.75} />
            Enterprise-grade Security
          </span>
        </footer>
        </div>
      </main>
    </div>
  );
}
