import type { ReactNode } from 'react';
import { C, FONT_MONO } from '../theme';

/** Shared CRT shell: green radial glow + scanline overlay + centered column. */
export function Crt({ children, maxWidth = 1160 }: { children: ReactNode; maxWidth?: number }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: C.bg,
        color: C.text,
        fontFamily: FONT_MONO,
        fontSize: 14,
        lineHeight: 1.6,
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          background: 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(61,255,126,0.06), transparent 70%)',
          zIndex: 0,
        }}
      />
      <div
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          background:
            'repeating-linear-gradient(0deg, transparent 0px, transparent 2px, rgba(0,0,0,0.22) 2px, rgba(0,0,0,0.22) 3px)',
          zIndex: 0,
        }}
      />
      <div style={{ position: 'relative', zIndex: 1, maxWidth, margin: '0 auto', padding: '0 32px 72px' }}>
        {children}
      </div>
    </div>
  );
}
