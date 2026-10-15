import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { exchangeOnboardingCode } from '../api';
import { LOGO_URL } from '../brand';

export default function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { login: authLogin } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get('code')?.trim();
    if (!code) {
      setError('Missing sign-in link. Use the link from My Accounts after setting your password.');
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const { data } = await exchangeOnboardingCode(code);
        if (cancelled) return;
        authLogin(data);
        navigate('/', { replace: true });
      } catch (err: unknown) {
        if (cancelled) return;
        const detail =
          (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          'This sign-in link expired or was already used.';
        setError(detail);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [searchParams, authLogin, navigate]);

  return (
    <div className="wt-auth-page">
      <div className="wt-auth-card" style={{ maxWidth: 420, margin: '4rem auto', textAlign: 'center' }}>
        <img src={LOGO_URL} alt="Worktual" className="wt-auth-logo" width={140} height={36} />
        {error ? (
          <>
            <h1 className="wt-auth-title" style={{ marginTop: '1.5rem' }}>
              Sign-in link invalid
            </h1>
            <p className="wt-auth-subtitle">{error}</p>
            <p style={{ marginTop: '1.5rem' }}>
              <a href="/login">Go to login</a>
            </p>
          </>
        ) : (
          <>
            <h1 className="wt-auth-title" style={{ marginTop: '1.5rem' }}>
              Signing you in…
            </h1>
            <p className="wt-auth-subtitle">Opening your Web Tracking dashboard.</p>
          </>
        )}
      </div>
    </div>
  );
}
