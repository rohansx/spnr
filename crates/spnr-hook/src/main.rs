//! spnr-hook — HOT-PATH hook forwarder.
//!
//! Reads a host hook payload on stdin, skims EXACTLY two firewall-safe keys
//! (`hook_event_name`, `session_id`) with a hand-rolled extractor (no general
//! JSON deserializer, 07 §2.1), sends a [`spnr_proto::SocketMsg::Hook`] datagram
//! to the daemon socket, and exits.
//!
//! HARD INVARIANTS:
//! - (1) Never degrade the host: this binary MUST NEVER panic and MUST exit 0 on
//!   ANY error. A missing/failed hook is a no-op to the host. `run()` therefore
//!   returns a `Result` and `main` swallows it into a clean exit.
//! - (2) Content firewall: it only ever extracts `hook_event_name`/`session_id`;
//!   the `SocketMsg::Hook` it builds has nowhere to put work product, so a prompt
//!   or tool output on stdin cannot be forwarded even in principle.
//! - Budget: exit <= 50 ms hard (~10 ms typical), < 1 MB stripped (09 §5).
#![forbid(unsafe_code)]

use std::io::Read as _;
use std::os::unix::net::UnixDatagram;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use spnr_proto::SocketMsg;

/// The two — and only two — keys this binary will read off stdin.
const KEY_EVENT: &str = "hook_event_name";
const KEY_SESSION: &str = "session_id";

/// Resolve the daemon datagram socket. `SPNR_SOCK` overrides for tests/sandboxes.
fn sock_path() -> PathBuf {
    if let Ok(p) = std::env::var("SPNR_SOCK") {
        return PathBuf::from(p);
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    Path::new(&home).join(".spnr").join("spnrd.sock")
}

/// Skim a single string value for `key` from a JSON blob, without a JSON parser.
///
/// A match only counts at an object-key position (preceded by `{`/`,`/ws, followed
/// by `:`), so the key name appearing inside some other field's string value does
/// not match. Returns the UNQUOTED string value (basic `\"`/`\\` unescaping). This
/// function can only ever return the value of the EXACT key requested — and the
/// caller only ever requests the two firewall-safe keys.
fn skim_string(blob: &str, key: &str) -> Option<String> {
    let bytes = blob.as_bytes();
    let needle = format!("\"{key}\"");
    let mut from = 0usize;
    while let Some(rel) = blob[from..].find(&needle) {
        let start = from + rel;
        let end = start + needle.len();
        from = end;

        let prev_ok = blob[..start]
            .trim_end()
            .chars()
            .last()
            .map(|c| c == '{' || c == ',')
            .unwrap_or(true);
        if !prev_ok {
            continue;
        }
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
        if i >= bytes.len() || bytes[i] != b'"' {
            return None; // we only accept a string value for these keys
        }
        // Read the quoted string with minimal unescaping.
        let mut out = String::new();
        let mut j = i + 1;
        while j < bytes.len() {
            match bytes[j] {
                b'\\' if j + 1 < bytes.len() => {
                    let c = bytes[j + 1];
                    out.push(match c {
                        b'n' => '\n',
                        b't' => '\t',
                        b'r' => '\r',
                        other => other as char,
                    });
                    j += 2;
                }
                b'"' => return Some(out),
                c => {
                    out.push(c as char);
                    j += 1;
                }
            }
        }
        return None; // unterminated string
    }
    None
}

/// Extract the firewall-safe `(event_name, session_id)` pair, or `None`.
fn extract(blob: &str) -> Option<(String, String)> {
    let event = skim_string(blob, KEY_EVENT)?;
    let session = skim_string(blob, KEY_SESSION)?;
    if event.is_empty() || session.is_empty() {
        return None;
    }
    Some((event, session))
}

/// Best-effort datagram send to the daemon. Errors (no daemon, full buffer) are
/// non-fatal; the caller exits 0 regardless.
fn send(msg: &SocketMsg, sock: &Path) -> std::io::Result<()> {
    let dg = UnixDatagram::unbound()?;
    dg.set_nonblocking(true)?;
    dg.send_to(&msg.encode(), sock)?;
    Ok(())
}

fn run() -> Result<(), ()> {
    let mut buf = Vec::with_capacity(4096);
    std::io::stdin().read_to_end(&mut buf).map_err(|_| ())?;
    let blob = std::str::from_utf8(&buf).map_err(|_| ())?;
    let (event_name, session_id) = extract(blob).ok_or(())?;
    let msg = SocketMsg::Hook {
        event_name,
        session_id,
    };
    send(&msg, &sock_path()).map_err(|_| ())
}

fn main() -> ExitCode {
    // Invariant 1: ALWAYS exit 0. Even if `run()` fails, the host sees a no-op.
    // (panic="abort" in profile.release-hot makes any accidental panic a fast,
    //  non-fatal-to-host abort; the host treats missing hook output as a no-op.)
    let _ = run();
    ExitCode::SUCCESS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_the_two_keys_from_a_realistic_hook_payload() {
        let stdin = r#"{
            "session_id": "abc123",
            "hook_event_name": "UserPromptSubmit",
            "transcript_path": "/home/u/.claude/projects/x/t.jsonl",
            "cwd": "/home/u/secret-project",
            "permission_mode": "default",
            "prompt": "please refactor the auth module"
        }"#;
        assert_eq!(
            extract(stdin),
            Some(("UserPromptSubmit".to_string(), "abc123".to_string()))
        );
    }

    /// THE EGRESS CANARY (07 §2.1): a prompt / cwd / transcript path on stdin must
    /// never appear in the datagram we would send.
    #[test]
    fn canary_fields_never_reach_the_datagram() {
        const CANARY: &str = "TOPSECRET_prompt_and_path_deadbeef";
        let stdin = format!(
            r#"{{"session_id":"s1","hook_event_name":"Stop","cwd":"/home/{CANARY}","prompt":"{CANARY}","transcript_path":"/x/{CANARY}.jsonl"}}"#
        );
        let (event_name, session_id) = extract(&stdin).unwrap();
        assert_eq!(event_name, "Stop");
        assert_eq!(session_id, "s1");
        let bytes = SocketMsg::Hook { event_name, session_id }.encode();
        let s = String::from_utf8_lossy(&bytes);
        assert!(!s.contains("deadbeef"), "canary leaked into datagram: {s}");
        assert!(!s.contains(CANARY));
    }

    #[test]
    fn key_name_inside_a_value_is_not_matched() {
        // A content field literally containing `"hook_event_name":"x"` must not fool us.
        let stdin = r#"{"prompt":"\"hook_event_name\":\"INJECTED\"","session_id":"real","hook_event_name":"Stop"}"#;
        assert_eq!(extract(stdin), Some(("Stop".into(), "real".into())));
    }

    #[test]
    fn missing_keys_yield_none() {
        assert_eq!(extract(r#"{"session_id":"s"}"#), None);
        assert_eq!(extract(r#"{"hook_event_name":"Stop"}"#), None);
        assert_eq!(extract("not json at all"), None);
    }

    #[test]
    fn send_to_missing_socket_errors_without_panicking() {
        let msg = SocketMsg::Heartbeat { session_id: "s".into() };
        let res = send(&msg, Path::new("/no/such/spnr/sock"));
        assert!(res.is_err()); // Err, not panic — main() turns this into exit 0
    }
}
