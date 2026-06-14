import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { FONT_MONO, T } from '../theme';
import { useAuth } from '../lib/useAuth';

// Route guard for authenticated pages. While the initial GET /v1/me hydration is
// in flight we render a minimal brutalist placeholder (avoids a flash-redirect
// before the stored token is validated). Once settled: an account means render the
// page; no account (no token / me() failed) means redirect to /login.

/** Minimal full-screen v5 placeholder shown while the session is validating. */
function AuthCheckingScreen() {
  return (
    <div
      data-testid="auth-checking"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: T.bg,
        color: T.text2,
        fontFamily: FONT_MONO,
        fontSize: 12,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
        <span
          className="spnr-blink"
          style={{ width: 9, height: 9, background: T.ember, display: 'inline-block' }}
        />
        Authenticating…
      </span>
    </div>
  );
}

/**
 * <RequireAuth> — gates its children behind a valid session. Redirects to /login
 * (replace, so the guarded URL is not left in history) when unauthenticated.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { account, loading } = useAuth();

  if (loading) {
    return <AuthCheckingScreen />;
  }
  if (!account) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}
