// Creative content lint — SAP/1 sponsored-verb rules (tech-spec-v1.0 §2.1).
//
// Hard rules, enforced server-side AND client-side (terminal-injection safety):
//   - <= 48 chars, single line
//   - UTF-8 letters/digits/space and the allow-listed punctuation only
//     (allow-list regex: ^[\p{L}\p{N} —.,:'&+/↗-]{1,48}$)
//     where — is U+2014 EM DASH and ↗ is U+2197 NORTH EAST ARROW
//   - exactly one trailing " ↗" (space + U+2197 NORTH EAST ARROW)
//   - no ANSI/escape bytes ever — client strips, then rejects on mismatch
//
// NOTE: this is the SAME lint the Rust spnr-server runs (ADR-0007). The advertiser
// portal lints here at submission time so an advertiser gets immediate feedback; the
// authoritative re-check still happens server-side in Rust before a creative is signed.

/** U+2197 NORTH EAST ARROW. The single mandated trailing glyph. */
export const ARROW = "↗";

/** Max length of a sponsored verb, in Unicode code points. */
export const MAX_LEN = 48;

/**
 * Allow-list: Unicode letters/digits, space, and the punctuation set
 * ( em-dash . , : apostrophe & + / arrow hyphen ). The \u flag enables
 * \p{...}; anchored to the whole string; 1..=48 code points.
 */
const ALLOW_LIST = /^[\p{L}\p{N} —.,:'&+/↗-]{1,48}$/u;

/**
 * Detects ANSI/C0/C1 escape and other control bytes. A creative must never carry
 * these — they are the terminal-injection vector. We reject (we do not silently strip).
 * Covers C0 controls (\u0000-\u001f, incl. ESC/CR/LF/TAB), DEL (\u007f),
 * and C1 controls (\u0080-\u009f). Written with \u escapes so this
 * source file never holds a raw control byte.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_OR_ESCAPE = /[\u0000-\u001f\u007f\u0080-\u009f]/;

export interface LintResult {
  readonly ok: boolean;
  /** Machine-readable violation codes, empty when ok. */
  readonly violations: readonly string[];
}

const PASS: LintResult = Object.freeze({ ok: true, violations: Object.freeze([]) });

function fail(...violations: string[]): LintResult {
  return Object.freeze({ ok: false, violations: Object.freeze(violations) });
}

/**
 * Lint a creative's display text against the SAP/1 content rules.
 * Pure and immutable — returns a frozen result, never mutates the input.
 */
export function lintCreative(text: unknown): LintResult {
  if (typeof text !== "string") {
    return fail("not_a_string");
  }

  const violations: string[] = [];

  // Control / escape bytes first — highest-severity safety check.
  if (CONTROL_OR_ESCAPE.test(text)) {
    violations.push("control_or_escape_bytes");
  }

  // Single line: no embedded newlines (also caught above, but report distinctly).
  if (/[\r\n]/.test(text)) {
    violations.push("not_single_line");
  }

  // Length in Unicode code points (not UTF-16 units / bytes).
  const codePoints = Array.from(text);
  if (codePoints.length === 0) {
    violations.push("empty");
  }
  if (codePoints.length > MAX_LEN) {
    violations.push("too_long");
  }

  // Exactly one trailing " ↗": must end with space+arrow, and no other arrow.
  if (!text.endsWith(` ${ARROW}`)) {
    violations.push("missing_trailing_arrow");
  }
  const arrowCount = codePoints.filter((c) => c === ARROW).length;
  if (arrowCount !== 1) {
    violations.push("arrow_count_not_one");
  }

  // Allow-list charset (run last so charset noise does not mask structural errors).
  if (!ALLOW_LIST.test(text)) {
    violations.push("charset_not_allowed");
  }

  return violations.length === 0 ? PASS : fail(...violations);
}
