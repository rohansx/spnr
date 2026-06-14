import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

// Email/password auth client for the Rust backend (v1 wire contract). The /v1
// proxy in vite.config.ts points these calls at the Rust backend (8787); in prod
// the backend serves this build and /v1 is same-origin. The opaque token lives in
// localStorage under TOKEN_KEY; on mount we GET /v1/me to hydrate the session and
// clear a stale/invalid token. Nothing here throws — failures resolve to
// { ok: false, error } so the Login page can render an error line.

/** localStorage key holding the opaque bearer token (SHARED CONTRACT). */
export const TOKEN_KEY = 'spnr_token';

/** The authenticated account, as returned by /v1/me, /v1/login, /v1/signup. */
export interface Account {
  account_id: string;
  email: string;
}

/** Result of a login/signup attempt: ok, plus a server error string on failure. */
export interface AuthResult {
  ok: boolean;
  error?: string;
}

/** Auth state + actions exposed through the AuthProvider context. */
export interface AuthState {
  account: Account | null;
  token: string | null;
  /** True until the initial GET /v1/me hydration completes. */
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthResult>;
  signup: (email: string, password: string) => Promise<AuthResult>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* storage unavailable (private mode) — session is in-memory only */
  }
}

function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/** Parse a server error string from a non-OK JSON body, with a status fallback. */
async function errorFrom(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  return typeof data?.error === 'string' ? data.error : fallback;
}

/**
 * POST /v1/login or /v1/signup. On success stores the token + returns { ok }.
 * On failure returns { ok: false, error } (server message or a status fallback).
 */
async function authPost(
  path: '/v1/login' | '/v1/signup',
  email: string,
  password: string,
  onSuccess: (account: Account, token: string) => void,
): Promise<AuthResult> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      return { ok: false, error: await errorFrom(res, `request failed (${res.status})`) };
    }
    const data = (await res.json().catch(() => null)) as
      | (Account & { token?: string })
      | null;
    if (!data || typeof data.token !== 'string' || typeof data.email !== 'string') {
      return { ok: false, error: 'malformed server response' };
    }
    onSuccess({ account_id: data.account_id, email: data.email }, data.token);
    return { ok: true };
  } catch {
    return { ok: false, error: 'network error' };
  }
}

/**
 * AuthProvider — owns the token + account, hydrates from /v1/me on mount, and
 * exposes login/signup/logout. Wrap the app tree in this (inside BrowserRouter).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => readToken());
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);

  // On mount (and whenever the token changes via login/signup), validate it with
  // GET /v1/me. A 401 (or any failure) clears the stale token so guards redirect.
  useEffect(() => {
    let alive = true;
    const current = readToken();
    if (!current) {
      setAccount(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch('/v1/me', { headers: { Authorization: `Bearer ${current}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: Account) => {
        if (!alive) return;
        setAccount({ account_id: data.account_id, email: data.email });
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        clearToken();
        setToken(null);
        setAccount(null);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token]);

  const onSuccess = useCallback((acct: Account, tok: string) => {
    writeToken(tok);
    setAccount(acct);
    setToken(tok);
    setLoading(false);
  }, []);

  const login = useCallback(
    (email: string, password: string) => authPost('/v1/login', email, password, onSuccess),
    [onSuccess],
  );

  const signup = useCallback(
    (email: string, password: string) => authPost('/v1/signup', email, password, onSuccess),
    [onSuccess],
  );

  const logout = useCallback(async () => {
    const current = readToken();
    if (current) {
      // Best-effort session invalidation; we drop local state regardless.
      await fetch('/v1/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${current}` },
      }).catch(() => {});
    }
    clearToken();
    setToken(null);
    setAccount(null);
    setLoading(false);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ account, token, loading, login, signup, logout }),
    [account, token, loading, login, signup, logout],
  );

  return createElement(AuthContext.Provider, { value }, children);
}

/** Access the auth state. Must be called within an <AuthProvider>. */
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
