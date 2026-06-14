import { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FONT_DISPLAY, FONT_MONO, RULE, T } from '../theme';
import { useTheme } from '../lib/useTheme';

// The framed page shell: a 1240px paper column ruled left + right by a hard 2px
// line, a top nav bar (logo + a per-page nav slot + a light/dark toggle), then the
// page's full-bleed bordered sections as children. Used by every screen so the
// brutalist grid frame is identical app-wide.

interface ShellProps {
  children: ReactNode;
  /** Right-aligned nav content (links / CTAs) for this page. */
  nav?: ReactNode;
  maxWidth?: number;
}

/** The wordmark + ember square, linking home. */
export function Wordmark({ size = 24 }: { size?: number }) {
  return (
    <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 11, color: T.text }}>
      <span
        style={{
          fontFamily: FONT_DISPLAY,
          fontWeight: 900,
          fontSize: size,
          letterSpacing: '-0.04em',
          textTransform: 'uppercase',
        }}
      >
        spnr
      </span>
      <span style={{ width: size * 0.42, height: size * 0.42, background: T.ember, display: 'inline-block' }} />
    </Link>
  );
}

/** Light/dark toggle, styled as a square ruled button. */
export function ThemeToggle() {
  const { dark, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      aria-label="Toggle dark mode"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 34,
        height: 34,
        border: RULE,
        background: 'transparent',
        color: T.text,
        cursor: 'pointer',
        fontFamily: FONT_MONO,
        fontSize: 10,
        letterSpacing: '0.04em',
      }}
    >
      {dark ? 'SUN' : 'MOON'}
    </button>
  );
}

export function Shell({ children, nav, maxWidth = 1240 }: ShellProps) {
  const outer: CSSProperties = {
    minHeight: '100vh',
    background: T.bg,
    color: T.text,
    fontFamily: FONT_DISPLAY,
    fontSize: 17,
    lineHeight: 1.45,
  };
  const frame: CSSProperties = {
    maxWidth,
    margin: '0 auto',
    background: T.bg,
    borderLeft: RULE,
    borderRight: RULE,
    minHeight: '100vh',
  };
  return (
    <div style={outer}>
      <div style={frame}>
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 24,
            padding: '22px 32px',
            borderBottom: RULE,
          }}
        >
          <Wordmark />
          <nav
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 24,
              fontFamily: FONT_MONO,
              fontSize: 11,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
            }}
          >
            {nav}
            <ThemeToggle />
          </nav>
        </header>
        {children}
      </div>
    </div>
  );
}
