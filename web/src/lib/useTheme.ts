import { useCallback, useEffect, useState } from 'react';

// Light/dark theme controller. The palette lives in CSS variables (theme.css);
// this just flips <html data-theme> and remembers the choice. Light is the default
// (the brutalist paper canvas); dark is the inverted ink variant.

const KEY = 'spnr-theme';

function read(): 'light' | 'dark' {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function apply(mode: 'light' | 'dark'): void {
  try {
    document.documentElement.dataset.theme = mode;
  } catch {
    /* SSR / no document — no-op */
  }
}

/** Returns the current theme + a toggle. Applies the choice to <html> on mount. */
export function useTheme(): { dark: boolean; toggle: () => void } {
  const [mode, setMode] = useState<'light' | 'dark'>(read);

  useEffect(() => {
    apply(mode);
  }, [mode]);

  const toggle = useCallback(() => {
    setMode((m) => {
      const next = m === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return { dark: mode === 'dark', toggle };
}
