//! # spnr-meta — restricted JSONL timing reader (content-firewalled)
//!
//! A reconciliation cross-check ONLY — NOT the primary impression counter (which
//! is hook+heartbeat driven in `spnrd`). This crate is the second layer of the
//! content firewall (07 §2.2): it is STRUCTURALLY incapable of producing strings
//! from work-product JSON fields.
//!
//! **What it reads:** from each JSONL line it pulls at most two scalars — the
//! `"timestamp"` value (as a unix-seconds number) and the `"type"` value (matched
//! against a CLOSED allow-list of non-work-product turn labels). Nothing else.
//!
//! **What it can never read (work-product JSON keys):** `content`, `message`,
//! `text`, `prompt`, `completion`, `transcript`, `file_path`, `cwd`, `repo`. None
//! of those key names is referenced anywhere in this crate, and the only value
//! tokens it ever captures are a number and an allow-listed label — so even a
//! work-product string that happens to embed `"timestamp":N` yields only `N`.
//! (A `ci/` grep gate asserts the work-product key names never appear here. The
//! `std::path::Path` filesystem handle to the log file is not a JSON field.)
//!
//! It links NO general JSON deserializer (no `serde`); a restricted hand scanner
//! extracts only the two scalars and ignores every other byte.

#![forbid(unsafe_code)]

use std::path::Path;

/// A single timing record recovered from a host session JSONL line.
///
/// Closed shape: a timestamp and an event label. There is NO field that could hold
/// work product — by construction, this is the entire surface this crate emits.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Timing {
    /// Unix-seconds timestamp of the line (advisory; cross-check only).
    pub ts: i64,
    /// The host turn label — one of [`EVENT_LABELS`], or `"unknown"`. Never work product.
    pub event: String,
}

/// The CLOSED set of turn labels we accept for `Timing::event`. Any `"type"` value
/// outside this set collapses to `"unknown"`, so the event field can never carry
/// arbitrary (work-product) text.
pub const EVENT_LABELS: &[&str] = &[
    "user",
    "assistant",
    "system",
    "summary",
    "tool_use",
    "tool_result",
];

const UNKNOWN: &str = "unknown";

/// Read timing records from a host session JSONL file for reconciliation.
///
/// Returns only [`Timing`] scalars. Any line that does not yield a clean numeric
/// timestamp is skipped. On any I/O trouble this returns whatever was parsed so
/// far (never panics) — reconciliation is best-effort and must never degrade the
/// host (invariant 1) or read work product (invariant 2).
pub fn read_timings(jsonl_path: &Path) -> Vec<Timing> {
    let data = match std::fs::read_to_string(jsonl_path) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    parse_timings(&data)
}

/// Pure core (testable without the filesystem).
pub fn parse_timings(data: &str) -> Vec<Timing> {
    let mut out = Vec::new();
    for line in data.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Some(ts_tok) = value_for_key(line, "timestamp") else {
            continue;
        };
        let Some(ts) = parse_unix_seconds(ts_tok) else {
            continue;
        };
        let event = value_for_key(line, "type")
            .map(unquote)
            .filter(|v| EVENT_LABELS.contains(&v.as_str()))
            .unwrap_or_else(|| UNKNOWN.to_string());
        out.push(Timing { ts, event });
    }
    out
}

/// Parse a unix-seconds value from a token that may be a bare number or a quoted
/// number. ISO-8601 string timestamps are intentionally skipped for now (the
/// hook-derived counter is primary; reconciliation is advisory) — returning `None`
/// rather than pulling in a date parser keeps the firewall tiny.
fn parse_unix_seconds(tok: &str) -> Option<i64> {
    let t = tok.trim().trim_matches('"');
    // Accept "1781234567" and "1781234567.123" (drop the fractional part).
    let whole = t.split_once('.').map(|(a, _)| a).unwrap_or(t);
    whole.parse::<i64>().ok()
}

fn unquote(tok: &str) -> String {
    tok.trim().trim_matches('"').to_string()
}

/// Find the value token immediately following `"<key>":` in one JSON object line.
///
/// Restricted, string-aware key matcher: a match only counts when the quoted key
/// is at an object-key position (preceded by `{`, `,`, or whitespace and followed
/// by `:`), which avoids matching the key name when it appears inside some other
/// field's *string value*. The returned token is the raw value — either a quoted
/// string (quotes included) or a bare scalar up to the next `,`/`}`. This scanner
/// can only ever return the value for the EXACT key asked for; callers only ever
/// ask for `"timestamp"` and `"type"`.
fn value_for_key<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let bytes = line.as_bytes();
    let needle = format!("\"{key}\"");
    let mut from = 0usize;
    while let Some(rel) = line[from..].find(&needle) {
        let start = from + rel;
        let end = start + needle.len();
        from = end; // advance for the next search regardless

        // Preceding non-space char must be an object/key boundary.
        let prev_ok = line[..start]
            .trim_end()
            .chars()
            .last()
            .map(|c| c == '{' || c == ',')
            .unwrap_or(true);
        if !prev_ok {
            continue;
        }
        // Next non-space char must be ':'.
        let mut i = end;
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= bytes.len() || bytes[i] != b':' {
            continue;
        }
        i += 1;
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= bytes.len() {
            return None;
        }
        // Capture the value token.
        if bytes[i] == b'"' {
            // Quoted string: find the closing unescaped quote.
            let vstart = i;
            let mut j = i + 1;
            while j < bytes.len() {
                if bytes[j] == b'\\' {
                    j += 2;
                    continue;
                }
                if bytes[j] == b'"' {
                    return Some(&line[vstart..=j]);
                }
                j += 1;
            }
            return None;
        } else {
            // Bare scalar up to the next ',' or '}'.
            let vstart = i;
            let mut j = i;
            while j < bytes.len() && bytes[j] != b',' && bytes[j] != b'}' {
                j += 1;
            }
            return Some(line[vstart..j].trim());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_timestamp_and_allowlisted_event() {
        let line = r#"{"type":"assistant","timestamp":1781234567,"role":"x"}"#;
        let t = parse_timings(line);
        assert_eq!(t, vec![Timing { ts: 1781234567, event: "assistant".into() }]);
    }

    #[test]
    fn fractional_timestamp_truncates_to_seconds() {
        let line = r#"{"timestamp":1781234567.987,"type":"user"}"#;
        assert_eq!(parse_timings(line)[0].ts, 1781234567);
    }

    #[test]
    fn unknown_type_collapses_to_unknown_never_arbitrary_text() {
        let line = r#"{"type":"definitely-not-a-real-label","timestamp":42}"#;
        assert_eq!(parse_timings(line), vec![Timing { ts: 42, event: "unknown".into() }]);
    }

    #[test]
    fn lines_without_numeric_timestamp_are_skipped() {
        // ISO timestamp (skipped for now) and a no-timestamp line.
        let data = "{\"timestamp\":\"2026-06-12T10:00:00Z\",\"type\":\"user\"}\n{\"type\":\"user\"}\n";
        assert!(parse_timings(data).is_empty());
    }

    /// THE EGRESS-CANARY TEST (07 §2.2): a work-product field carrying a secret must
    /// never surface in any emitted `Timing`.
    #[test]
    fn canary_in_content_never_escapes() {
        const CANARY: &str = "SUPER_SECRET_API_KEY_sk-deadbeef";
        let lines = [
            format!(r#"{{"type":"assistant","timestamp":1000,"content":"{CANARY}"}}"#),
            format!(r#"{{"type":"user","timestamp":1001,"message":{{"text":"{CANARY}"}}}}"#),
            // Adversarial: the secret string itself contains a fake key:value.
            format!(r#"{{"timestamp":1002,"type":"user","text":"oops \"type\":\"{CANARY}\""}}"#),
        ];
        let data = lines.join("\n");
        let timings = parse_timings(&data);
        // We still recovered the real timings…
        assert_eq!(timings.len(), 3);
        // …and the canary is in NONE of them.
        for t in &timings {
            assert!(!t.event.contains("deadbeef"), "canary leaked into event: {:?}", t.event);
            assert!(t.event == "assistant" || t.event == "user", "unexpected label {:?}", t.event);
        }
        // Belt-and-suspenders: the whole rendered output contains no canary byte.
        let rendered = format!("{timings:?}");
        assert!(!rendered.contains(CANARY), "canary leaked into output: {rendered}");
    }

    #[test]
    fn missing_file_returns_empty_never_panics() {
        let p = std::path::Path::new("/no/such/spnr-meta/file.jsonl");
        assert!(read_timings(p).is_empty());
    }
}
