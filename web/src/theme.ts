// spnr CRT design tokens — extracted verbatim from the design export so every
// React component shares one palette/typography source (no inline hex drift).
export const C = {
  bg: '#060807',
  panel: '#080B09',
  panelActive: '#0C1410',
  border: '#1C2A21',
  borderFaint: '#111813',
  green: '#3DFF7E',
  text: '#C9D8CD',
  dim: '#74867B',
  dimmer: '#4A584F',
  mid: '#9FB1A4',
  bright: '#E6F0E8',
  amber: '#FFB02E',
  red: '#FF5C5C',
} as const;

export const FONT_DISPLAY = "'Chakra Petch', sans-serif";
export const FONT_MONO = "'IBM Plex Mono', ui-monospace, monospace";

export const GREEN_GLOW = '0 0 22px rgba(61,255,126,0.35)';
