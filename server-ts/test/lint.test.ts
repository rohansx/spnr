import { describe, it, expect } from "vitest";
import { lintCreative, ARROW, MAX_LEN } from "../src/lint.js";

describe("lintCreative", () => {
  it("accepts a valid creative (brand, allow-listed punctuation, trailing arrow)", () => {
    const result = lintCreative(`CloakPipe — ship privacy-safe LLM apps ${ARROW}`);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("rejects a creative longer than 48 chars", () => {
    // Build a >48 code-point string that still ends with the required " ↗".
    const head = "A".repeat(MAX_LEN); // 48 chars before we even add " ↗"
    const tooLong = `${head} ${ARROW}`; // 50 code points
    expect(Array.from(tooLong).length).toBeGreaterThan(MAX_LEN);

    const result = lintCreative(tooLong);
    expect(result.ok).toBe(false);
    expect(result.violations).toContain("too_long");
  });

  it("rejects a creative without the trailing arrow", () => {
    const result = lintCreative("CloakPipe — ship privacy-safe LLM apps");
    expect(result.ok).toBe(false);
    expect(result.violations).toContain("missing_trailing_arrow");
    expect(result.violations).toContain("arrow_count_not_one");
  });

  it("rejects ANSI/escape bytes (terminal-injection safety)", () => {
    const esc = String.fromCharCode(0x1b); // ESC
    const evil = `${esc}[31mPwn${ARROW}`;
    const result = lintCreative(evil);
    expect(result.ok).toBe(false);
    expect(result.violations).toContain("control_or_escape_bytes");
  });

  it("rejects a disallowed character", () => {
    const result = lintCreative(`Buy now! ${ARROW}`); // '!' is not on the allow-list
    expect(result.ok).toBe(false);
    expect(result.violations).toContain("charset_not_allowed");
  });

  it("rejects two arrows", () => {
    const result = lintCreative(`up ${ARROW} ${ARROW}`);
    expect(result.ok).toBe(false);
    expect(result.violations).toContain("arrow_count_not_one");
  });

  it("rejects non-string input", () => {
    expect(lintCreative(undefined).ok).toBe(false);
    expect(lintCreative(42 as unknown).ok).toBe(false);
  });
});
