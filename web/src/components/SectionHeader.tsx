import { CSSProperties } from 'react';
import { FONT_DISPLAY, FONT_MONO, RULE, T } from '../theme';

// The bracketed section header bar: [ NN ] + an uppercase Archivo title, ruled
// underneath. The ember variant (ember fill, white text) marks the advertiser
// band, exactly like the v5 reference.

interface SectionHeaderProps {
  /** Zero-padded index shown in the bracket tag, e.g. "01". Omit to hide the tag. */
  n?: string;
  title: string;
  /** Ember-filled band (white-on-green) for the advertiser/CTA section. */
  ember?: boolean;
}

export function SectionHeader({ n, title, ember = false }: SectionHeaderProps) {
  const bar: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '18px 32px',
    borderBottom: RULE,
    background: ember ? T.ember : 'transparent',
  };
  const tag: CSSProperties = {
    fontFamily: FONT_MONO,
    fontSize: 11,
    border: `2px solid ${ember ? '#fff' : T.line}`,
    padding: '4px 9px',
    color: ember ? '#fff' : T.emberText,
  };
  const label: CSSProperties = {
    fontFamily: FONT_DISPLAY,
    fontWeight: 800,
    fontSize: 15,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: ember ? '#fff' : T.text,
  };
  return (
    <div style={bar}>
      {n && <span style={tag}>[ {n} ]</span>}
      <span style={label}>{title}</span>
    </div>
  );
}
