import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { C, FONT_MONO } from '../theme';
import { useAuth } from '../lib/useAuth';

// Route guard for authenticated pages. While the initial GET /v1/me hydration is
// in flight we render a minimal CRT spinner (avoids a flash-redirect before the
// stored token is validated). Once settled: an account means render the page; no
// account (no token / me() failed) means redirect to /login.

/** Minimal full-screen CRT placeholder shown while the session is validating. */
function AuthCheckingScreen() {
  return (
    <div
      data-testid="auth-checking"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: C.bg,
        color: C.dim,
        fontFamily: FONT_MONO,
        fontSize: 12.5,
        letterSpacing: '0.1em',
      }}
    >
      <span style={{ color: C.green }}>● </span>&nbsp;AUTHENTICATING…
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
