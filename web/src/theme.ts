// spnr design tokens — "industrial editorial" system (v5).
//
// A brutalist Swiss grid: paper-white canvas framed by hard 2px rules, blur-less
// offset shadows, heavy uppercase Archivo display + Martian Mono labels, and a
// single ember-green accent. Values are CSS variables (see theme.css) so the whole
// app flips between light/dark via <html data-theme>. Use these strings directly in
// inline styles, e.g. `color: T.ember`.

export const FONT_DISPLAY = "'Archivo', system-ui, -apple-system, sans-serif";
export const FONT_MONO = "'Martian Mono', ui-monospace, 'SF Mono', monospace";

/** Themed tokens (resolve to the active light/dark value from theme.css). */
export const T = {
  bg: 'var(--bg)',
  surface: 'var(--surface)',
  surface2: 'var(--surface2)',
  text: 'var(--text)',
  text2: 'var(--text2)',
  text3: 'var(--text3)',
  line: 'var(--line)',
  ember: 'var(--ember)',
  emberText: 'var(--ember-text)',
  green: 'var(--green)',
  bar: 'var(--bar)',
  shadow: 'var(--shadow)',
  /** Inverted block (dark card on light page / light card on dark page). */
  invSurface: 'var(--inv-surface)',
  invSurface2: 'var(--inv-surface2)',
  invText: 'var(--inv-text)',
  invText2: 'var(--inv-text2)',
  invText3: 'var(--inv-text3)',
} as const;

/** The hard 2px rule that frames every cell. */
export const RULE = `2px solid ${T.line}`;

/** Brutalist drop shadow — a hard offset block, never a blur. */
export const shadow = (n = 6): string => `${n}px ${n}px 0 ${T.shadow}`;

/** Raw palette maps (single source of truth; mirrored in theme.css :root rules). */
export const LIGHT = {
  '--bg': '#F2F2F0',
  '--surface': '#FFFFFF',
  '--surface2': '#E9E9E6',
  '--text': '#121212',
  '--text2': '#565654',
  '--text3': '#8E8E8A',
  '--line': '#121212',
  '--ember': '#0B7A4F',
  '--ember-text': '#0A5D3C',
  '--green': '#00955E',
  '--bar': '#D8D8D4',
  '--shadow': '#121212',
  '--inv-surface': '#121212',
  '--inv-surface2': '#1E1E1E',
  '--inv-text': '#FFFFFF',
  '--inv-text2': '#B0B0AE',
  '--inv-text3': '#777775',
} as const;

export const DARK = {
  '--bg': '#0C0C0E',
  '--surface': '#161618',
  '--surface2': '#202023',
  '--text': '#F4F4F2',
  '--text2': '#A6A6A3',
  '--text3': '#6E6E6B',
  '--line': '#3A3A40',
  '--ember': '#2BD389',
  '--ember-text': '#6FE3AC',
  '--green': '#2FD389',
  '--bar': '#2E2E33',
  '--shadow': '#000000',
  '--inv-surface': '#F4F4F2',
  '--inv-surface2': '#E4E4E0',
  '--inv-text': '#121212',
  '--inv-text2': '#565654',
  '--inv-text3': '#8E8E8A',
} as const;
