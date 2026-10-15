import React, { useState } from 'react';
import {
  Lock,
  Mail,
  AlertTriangle,
  Eye,
  EyeOff,
  ArrowRight,
  Ticket,
  BookOpen,
  Shield,
  Headphones,
  Users,
} from 'lucide-react';
import { setEmbedJwt } from '../config/embedAuth';

interface LoginViewProps {
  onLoginSuccess: (user: {
    id: string;
    name: string;
    email: string;
    initials: string;
    role: 'admin' | 'agent' | 'resolver' | 'customer' | 'viewer';
    organizationId: string;
  }) => void;
}

const features = [
  {
    icon: Ticket,
    title: 'AI-Powered Automation',
    description: 'Triage, route, and resolve tickets faster with co-worker assistance on every screen.',
  },
  {
    icon: Headphones,
    title: 'Unified ticketing',
    description: 'Email, chat, phone, and web in one queue — with SLA-aware assignment.',
  },
  {
    icon: BookOpen,
    title: 'Real-time Insights',
    description: 'Workload, overdue risk, and resolution trends at a glance from Dashboard and Analytics.',
  },
];

export default function LoginView({ onLoginSuccess }: LoginViewProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState('');
  const [portalPath, setPortalPath] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Login failed');
        setPortalPath(String(data.supportPortalPath || ''));
        return;
      }
      // Persist JWT so LAN http://IP sessions work even if Secure cookies are dropped.
      const token = String(data.token || '').trim();
      if (token) setEmbedJwt(token);
      onLoginSuccess(data.user);
    } catch {
      setError('Unable to reach the server.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh flex flex-col overflow-x-hidden bg-[#f3f4f6] font-sans">
      <header className="h-14 shrink-0 bg-black border-b border-neutral-900 flex items-center justify-between gap-3 px-5 sm:px-8">
        <div className="flex items-center gap-2.5 min-w-0 text-white">
          <img
            src="/brand/worktual-logo.png"
            alt="Worktual"
            className="h-10 w-auto max-w-[200px] object-contain object-left brightness-0 invert"
          />
        </div>
        <a
          href="mailto:support@worktual.com"
          className="text-xs font-medium border border-white/20 hover:border-white/40 px-3.5 sm:px-4 py-1.5 rounded-xl text-white/80 hover:text-white transition-colors shrink-0"
        >
          Contact Us
        </a>
      </header>

      <main className="@container flex-1 flex flex-col justify-center w-full px-3 sm:px-6 py-5 sm:py-8">
        <div className="w-full max-w-[960px] mx-auto bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden grid grid-cols-1 @[560px]:grid-cols-2">
          <aside className="relative bg-[#0b0618] text-white p-6 @[560px]:p-8 @[720px]:p-10 flex flex-col justify-center">
            <div
              className="pointer-events-none absolute inset-0 opacity-50"
              style={{
                background:
                  'radial-gradient(ellipse 80% 50% at 20% 10%, rgba(167,139,250,0.35), transparent 55%), radial-gradient(ellipse 60% 40% at 90% 80%, rgba(196,181,253,0.2), transparent 50%)',
              }}
            />
            <div className="relative z-10 flex flex-col gap-6 @[560px]:gap-7 @[720px]:gap-8">
              <div className="flex items-center gap-2 text-white/90">
                <img
                  src="/brand/worktual-logo.png"
                  alt=""
                  className="h-12 w-auto max-w-[200px] object-contain object-left brightness-0 invert"
                />
              </div>

              <div className="space-y-2.5">
                <h1 className="text-xl @[560px]:text-2xl @[720px]:text-[2rem] font-semibold leading-snug tracking-tight">
                  <span className="text-[#a78bfa]">AI-Powered</span>{' '}
                  <span className="text-white">ticketing for enterprise support teams.</span>
                </h1>
                <p className="text-xs @[560px]:text-sm text-neutral-400 leading-relaxed">
                  Streamline queues, protect SLAs, and deliver exceptional customer experiences from a single unified platform.
                </p>
              </div>

              <ul className="space-y-3.5 @[560px]:space-y-4 @[720px]:space-y-5">
                {features.map(({ icon: Icon, title, description }) => (
                  <li key={title} className="flex items-start gap-3">
                    <div className="h-9 w-9 @[560px]:h-10 @[560px]:w-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                      <Icon className="h-4 w-4 text-[#c4b5fd]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-white">{title}</h3>
                      <p className="text-xs text-neutral-400 mt-0.5 leading-relaxed">{description}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </aside>

          <section className="p-6 @[560px]:p-8 @[720px]:p-10 flex flex-col justify-center bg-white">
            <div className="w-full max-w-[320px] mx-auto space-y-5">
              <div className="space-y-1.5">
                <h2 className="text-2xl font-semibold text-neutral-950 tracking-tight">Welcome back</h2>
                <p className="text-sm text-neutral-500 leading-relaxed">
                  Sign in with your Ticketing admin or support agent credentials
                </p>
              </div>

              {error && (
                <div className="border border-red-200 bg-red-50 text-red-800 text-xs px-3 py-2.5 rounded-xl flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    {error}
                    {portalPath ? (
                      <>
                        {' '}
                        <a href={portalPath} className="underline font-semibold">
                          Open support portal
                        </a>
                      </>
                    ) : null}
                  </span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-neutral-800">Email</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
                    <input
                      type="email"
                      required
                      autoComplete="email"
                      placeholder="you@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full h-10 border border-neutral-200 rounded-xl py-2.5 pl-10 pr-3 text-sm text-neutral-900 placeholder-neutral-400 transition-colors"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-neutral-800">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full h-10 border border-neutral-200 rounded-xl py-2.5 pl-10 pr-10 text-sm text-neutral-900 placeholder-neutral-400 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700 cursor-pointer"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs">
                  <label className="inline-flex items-center gap-2 cursor-pointer text-neutral-600 select-none">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-neutral-300 text-black focus:ring-0 cursor-pointer"
                    />
                    <span>Remember me</span>
                  </label>
                  <button
                    type="button"
                    className="text-neutral-700 font-medium hover:text-neutral-950 hover:underline cursor-pointer"
                    onClick={() =>
                      setError('Password reset is managed by your organization admin.')
                    }
                  >
                    Forgot password?
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-10 bg-black hover:bg-neutral-800 text-white rounded-xl text-sm font-semibold transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <span>{loading ? 'Signing in…' : 'Sign in'}</span>
                  {!loading && <ArrowRight className="h-4 w-4" />}
                </button>
              </form>

              <p className="text-[11px] text-neutral-400 text-center leading-relaxed">
                Use your Worktual account email and password.
              </p>
            </div>
          </section>
        </div>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-neutral-500 px-2">
          <div className="flex items-center gap-2 text-xs">
            <Shield className="h-4 w-4 text-neutral-400 shrink-0" />
            <span>Secure agent sign-in</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Headphones className="h-4 w-4 text-neutral-400 shrink-0" />
            <span>Multi-channel ticket intake</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Users className="h-4 w-4 text-neutral-400 shrink-0" />
            <span>Role-based access</span>
          </div>
        </div>
      </main>
    </div>
  );
}
