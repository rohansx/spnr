import { CSSProperties, FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Crt } from '../components/Crt';
import { C, FONT_DISPLAY, FONT_MONO, GREEN_GLOW } from '../theme';
import { useAuth } from '../lib/useAuth';

// CRT-styled login / signup page for the developer console. Toggles between two
// modes against the same form; on success navigates to /dashboard. Already-authed
// visitors are bounced straight to the dashboard. Shares the C tokens + Crt shell
// so it sits inside the same green-glow scanline world as the rest of the app.

type Mode = 'login' | 'signup';

const fieldLabel: CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.12em',
  color: C.dim,
  marginBottom: 8,
  display: 'block',
};

const input: CSSProperties = {
  width: '100%',
  fontFamily: FONT_MONO,
  fontSize: 14,
  letterSpacing: '0.02em',
  padding: '12px 14px',
  background: C.bg,
  border: `1px solid ${C.border}`,
  color: C.bright,
  outline: 'none',
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
      ? 'SIGN IN →'
      : 'CREATE ACCOUNT →';
  const toggleText = isLogin ? "No account? CREATE ONE" : 'Have an account? SIGN IN';

  return (
    <Crt maxWidth={460}>
      {/* ===== header ===== */}
      <header style={{ paddingTop: 72, textAlign: 'center' }}>
        <Link
          to="/"
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 700,
            fontSize: 30,
            letterSpacing: '0.08em',
            color: C.green,
            textShadow: GREEN_GLOW,
          }}
        >
          SPNR<span style={{ animation: 'spnr-blink 1.1s step-end infinite' }}>_</span>
        </Link>
        <div style={{ marginTop: 10, fontSize: 12, color: C.dimmer, letterSpacing: '0.1em' }}>
          CONSOLE · spnr.co
        </div>
      </header>

      {/* ===== form card ===== */}
      <form
        onSubmit={onSubmit}
        style={{
          marginTop: 40,
          border: `1px solid ${C.border}`,
          background: C.panel,
          padding: '32px 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
        }}
      >
        <div style={{ fontSize: 13, letterSpacing: '0.14em', color: C.dim }}>{title}</div>

        <div>
          <label htmlFor="auth-email" style={fieldLabel}>
            EMAIL
          </label>
          <input
            id="auth-email"
            data-testid="auth-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@machine.dev"
            style={input}
          />
        </div>

        <div>
          <label htmlFor="auth-password" style={fieldLabel}>
            PASSWORD
          </label>
          <input
            id="auth-password"
            data-testid="auth-password"
            type="password"
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isLogin ? '••••••••' : 'min. 8 characters'}
            style={input}
          />
        </div>

        {error && (
          <div
            data-testid="auth-error"
            style={{
              border: `1px solid ${C.red}`,
              background: C.bg,
              padding: '10px 14px',
              fontSize: 12.5,
              color: C.red,
            }}
          >
            ✗ {error}
          </div>
        )}

        <button
          type="submit"
          className="spnr-primary"
          data-testid="auth-submit"
          disabled={busy}
          style={{
            fontFamily: FONT_MONO,
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: '0.08em',
            padding: '14px 20px',
            background: C.green,
            color: C.bg,
            border: 'none',
            cursor: busy ? 'wait' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
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
            fontSize: 12,
            letterSpacing: '0.04em',
            background: 'transparent',
            border: 'none',
            color: C.dim,
            cursor: 'pointer',
            padding: 0,
            textAlign: 'center',
          }}
        >
          {toggleText}
        </button>
      </form>

      <div style={{ marginTop: 22, textAlign: 'center', fontSize: 11, color: C.dimmer }}>
        password is argon2-hashed · never stored in plaintext
      </div>
    </Crt>
  );
}
