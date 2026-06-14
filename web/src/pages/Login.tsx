import { CSSProperties, FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shell } from '../components/Shell';
import { FONT_DISPLAY, FONT_MONO, RULE, T, shadow } from '../theme';
import { useAuth } from '../lib/useAuth';

// v5 "industrial editorial" login / signup. Toggles between two modes against the
// same form; on success navigates to /dashboard. Already-authed visitors are
// bounced straight to the dashboard. Rendered inside the framed <Shell> as a
// centered ruled card (hard 2px rule + offset block shadow) — paper canvas,
// Martian Mono labels, square ember CTA. Only the visuals changed: all data-testids
// and the useAuth() wiring are preserved verbatim.

type Mode = 'login' | 'signup';

const fieldLabel: CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 10.5,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: T.text3,
  marginBottom: 8,
  display: 'block',
};

export default function Login() {
  const navigate = useNavigate();
  const { account, loading, login, signup } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // If a valid session already exists (e.g. the user hit /login with a live
  // token), skip the form entirely and go to the dashboard.
  useEffect(() => {
    if (!loading && account) {
      navigate('/dashboard', { replace: true });
    }
  }, [loading, account, navigate]);

  const toggleMode = () => {
    setMode((m) => (m === 'login' ? 'signup' : 'login'));
    setError(null);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const action = mode === 'login' ? login : signup;
    const result = await action(email.trim(), password);
    if (result.ok) {
      navigate('/dashboard', { replace: true });
    } else {
      setError(result.error ?? 'authentication failed');
      setBusy(false);
    }
  };

  const isLogin = mode === 'login';
  const title = isLogin ? 'SIGN IN' : 'CREATE ACCOUNT';
  const submitText = busy
    ? isLogin
      ? 'SIGNING IN…'
      : 'CREATING…'
    : isLogin
      ? 'SIGN IN ▸'
      : 'CREATE ACCOUNT ▸';
  const toggleText = isLogin ? 'No account? CREATE ONE' : 'Have an account? SIGN IN';

  return (
    <Shell>
      <section
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '64px 32px',
          minHeight: 'calc(100vh - 80px)',
        }}
      >
        <div style={{ width: '100%', maxWidth: 440 }}>
          {/* ===== header ===== */}
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 11,
              }}
            >
              <span
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontWeight: 900,
                  fontSize: 34,
                  letterSpacing: '-0.04em',
                  textTransform: 'uppercase',
                  color: T.text,
                }}
              >
                spnr
              </span>
              <span
                className="spnr-blink"
                style={{ width: 12, height: 12, background: T.ember, display: 'inline-block' }}
              />
            </div>
            <div
              style={{
                marginTop: 12,
                fontFamily: FONT_MONO,
                fontSize: 11,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: T.text3,
              }}
            >
              Console · spnr.co
            </div>
          </div>

          {/* ===== form card ===== */}
          <form
            onSubmit={onSubmit}
            style={{
              border: RULE,
              background: T.surface,
              boxShadow: shadow(6),
              padding: '32px 28px',
              display: 'flex',
              flexDirection: 'column',
              gap: 22,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                fontFamily: FONT_MONO,
                fontSize: 12,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: T.text2,
              }}
            >
              <span style={{ width: 7, height: 7, background: T.ember, display: 'inline-block' }} />
              {title}
            </div>

            <div>
              <label htmlFor="auth-email" style={fieldLabel}>
                Email
              </label>
              <input
                id="auth-email"
                data-testid="auth-email"
                className="spnr-input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@machine.dev"
              />
            </div>

            <div>
              <label htmlFor="auth-password" style={fieldLabel}>
                Password
              </label>
              <input
                id="auth-password"
                data-testid="auth-password"
                className="spnr-input"
                type="password"
                autoComplete={isLogin ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isLogin ? '••••••••' : 'min. 8 characters'}
              />
            </div>

            {error && (
              <div
                data-testid="auth-error"
                style={{
                  border: '2px solid #C0392B',
                  background: T.surface2,
                  padding: '11px 14px',
                  fontFamily: FONT_MONO,
                  fontSize: 12,
                  letterSpacing: '0.02em',
                  color: '#C0392B',
                  display: 'flex',
                  gap: 10,
                  alignItems: 'flex-start',
                }}
              >
                <span style={{ fontWeight: 700 }}>×</span>
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              className="spnr-btn"
              data-testid="auth-submit"
              disabled={busy}
              style={{ width: '100%' }}
            >
              {submitText}
            </button>

            <button
              type="button"
              className="spnr-link"
              data-testid="auth-toggle"
              onClick={toggleMode}
              style={{
                fontFamily: FONT_MONO,
                fontSize: 11,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                textAlign: 'center',
              }}
            >
              {toggleText}
            </button>
          </form>

          <div
            style={{
              marginTop: 22,
              textAlign: 'center',
              fontFamily: FONT_MONO,
              fontSize: 10.5,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: T.text3,
            }}
          >
            password is argon2-hashed · never stored in plaintext
          </div>
        </div>
      </section>
    </Shell>
  );
}
