import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { useAuth } from '../AuthContext';
import { LOGO_URL } from '../brand';
import { login } from '../services/api';
import {
  DEV_PREVIEW_LOGIN_PAYLOAD,
  DEV_UI_PREVIEW_ENABLED,
} from '../devPreview';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required'),
});

type FormValues = z.infer<typeof schema>;

const HERO_FEATURES = [
  {
    title: 'Real-time visitor insights',
    description: 'Track live sessions, page views, and engagement across your websites.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
        <path d="M3 3v18h18" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M7 14l4-4 3 3 5-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: 'Behavior & heatmaps',
    description: 'Understand scroll depth, clicks, and rage clicks on key pages.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M8 12h8M8 8h5M8 16h3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: 'Forms & conversions',
    description: 'Monitor form submissions, leads, and conversion funnels in one place.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
        <path d="M9 11l3 3L22 4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: 'AI-powered analytics',
    description: 'Ask questions and get insights from your traffic data instantly.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
        <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5 19l1 3M19 19l-1 3" strokeLinecap="round" />
      </svg>
    ),
  },
];

const TRUST_ITEMS = [
  {
    label: 'Secure sign-in',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
        <path d="M12 3l8 4v5c0 5-3.5 9-8 9s-8-4-8-9V7l8-4z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    label: 'Real-time analytics',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    label: 'Role-based access',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V8a4 4 0 118 0v3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

export default function Login() {
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const { login: authLogin } = useAuth();
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  // App shell uses body { overflow: hidden }; unlock document scroll on auth.
  useEffect(() => {
    document.body.classList.add('wt-auth-scroll');
    document.documentElement.classList.add('wt-auth-scroll');
    return () => {
      document.body.classList.remove('wt-auth-scroll');
      document.documentElement.classList.remove('wt-auth-scroll');
    };
  }, []);

  const onSubmit = async (values: FormValues) => {
    setError('');
    try {
      const res = await login(values.email, values.password);
      authLogin(res.data);
      navigate('/');
    } catch (err: unknown) {
      const ax = err as {
        response?: { status?: number; data?: { detail?: string; message?: string } };
        message?: string;
      };
      if (ax.response?.status === 401) {
        setError('Invalid email or password');
      } else if (ax.response?.data?.detail) {
        setError(ax.response.data.detail);
      } else if (ax.response?.data?.message) {
        const msg = ax.response.data.message;
        setError(msg.includes("Can't reach database") ? 'Cannot connect to PostgreSQL — check VPN and DATABASE_URL in .env' : msg.split('\n')[0]);
      } else if (!ax.response) {
        setError('Unable to reach the API — start the backend (cd api-node && yarn dev) or use UI preview below.');
      } else {
        setError('Login failed — check API logs (.local/logs/api.log)');
      }
    }
  };

  const enterUiPreview = () => {
    setError('');
    authLogin(DEV_PREVIEW_LOGIN_PAYLOAD);
    navigate('/');
  };

  return (
    <div className="wt-auth-page">
      <header className="wt-auth-header">
        <a href="/login" className="wt-auth-header-brand" aria-label="Worktual home">
          <img src={LOGO_URL} alt="" />
          <span>Worktual</span>
        </a>
        <a
          href="https://www.worktual.com"
          className="wt-auth-contact-btn"
          target="_blank"
          rel="noopener noreferrer"
        >
          Contact Us
        </a>
      </header>

      <main className="wt-auth-main">
        <div className="wt-auth-card">
          <aside className="wt-auth-hero" aria-label="Product overview">
            <div className="wt-auth-hero-brand">
              <img src={LOGO_URL} alt="" />
              <span>Worktual</span>
            </div>
            <h1 className="wt-auth-hero-title">
              <span className="wt-auth-hero-accent">Web tracking</span>
              {' & analytics hub '}
              <span className="wt-auth-hero-muted">for revenue and customer operations</span>
            </h1>
            <p className="wt-auth-hero-lead">
              Monitor visitors, sessions, behavior, and conversions from one secure analytics workspace.
            </p>
            <ul className="wt-auth-feature-list">
              {HERO_FEATURES.map((feature) => (
                <li key={feature.title} className="wt-auth-feature-item">
                  <span className="wt-auth-feature-icon">{feature.icon}</span>
                  <span>
                    <strong>{feature.title}</strong>
                    <span>{feature.description}</span>
                  </span>
                </li>
              ))}
            </ul>
          </aside>

          <section className="wt-auth-form-panel" aria-labelledby="wt-auth-form-title">
            <h2 id="wt-auth-form-title" className="wt-auth-form-title">Welcome back</h2>
            <p className="wt-auth-form-lead">
              Use the work email and password issued for your role. You will be routed to the right portal automatically.
            </p>

            {error && <p className="wt-auth-error" role="alert">{error}</p>}

            <form className="wt-auth-form" onSubmit={handleSubmit(onSubmit)} noValidate>
              <div className="wt-auth-field">
                <label htmlFor="login-email">Email</label>
                <div className="wt-auth-input-wrap">
                  <span className="wt-auth-input-icon" aria-hidden>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                      <rect x="3" y="5" width="18" height="14" rx="2" />
                      <path d="M3 7l9 6 9-6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <input
                    id="login-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@company.com"
                    {...register('email')}
                    required
                  />
                </div>
              </div>

              <div className="wt-auth-field">
                <label htmlFor="login-password">Password</label>
                <div className="wt-auth-input-wrap">
                  <span className="wt-auth-input-icon" aria-hidden>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                      <rect x="5" y="11" width="14" height="10" rx="2" />
                      <path d="M8 11V8a4 4 0 118 0v3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    {...register('password')}
                    required
                  />
                  <button
                    type="button"
                    className="wt-auth-password-toggle"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
                        <path d="M3 3l18 18" strokeLinecap="round" />
                        <path d="M10.6 10.6a2 2 0 102.8 2.8" />
                        <path d="M9.9 5.1A10.7 10.7 0 0112 5c5 0 9.3 3 11 7-1 2.2-2.8 4-5 5.2M6.1 6.1C3.7 7.6 2 9.8 1 12c1.7 4 6 7 11 7 1.1 0 2.2-.2 3.2-.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
                        <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" strokeLinecap="round" strokeLinejoin="round" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <div className="wt-auth-form-row">
                <label className="wt-auth-remember">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                  />
                  <span>Remember me</span>
                </label>
                <a className="wt-auth-forgot" href="#forgot-password" onClick={(e) => e.preventDefault()}>
                  Forgot password?
                </a>
              </div>

              <button type="submit" className="wt-auth-submit" disabled={isSubmitting}>
                {isSubmitting ? 'Signing in…' : 'Sign in'}
                {!isSubmitting && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            </form>

            {DEV_UI_PREVIEW_ENABLED && (
              <button
                type="button"
                className="wt-auth-preview-btn"
                onClick={enterUiPreview}
              >
                Preview UI locally (no API)
              </button>
            )}
          </section>
        </div>

        <footer className="wt-auth-trust">
          {TRUST_ITEMS.map((item) => (
            <span key={item.label} className="wt-auth-trust-item">
              {item.icon}
              {item.label}
            </span>
          ))}
        </footer>
      </main>
    </div>
  );
}
