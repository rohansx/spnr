//! spnr-status — HOT-PATH statusline renderer + render-liveness heartbeat.
//!
//! Invoked by the host `statusLine` (with `refreshInterval:1` -> ~1 Hz tick,
//! S3 in 15-spike-results.md). It prints the cached statusline string from a
//! tmpfs cache and fires ONE [`spnr_proto::SocketMsg::Heartbeat`] datagram to the
//! daemon (coalesced to <=1/sec) so `spnrd` can gate countable seconds.
//!
//! HARD INVARIANTS:
//! - (1) Never degrade the host: MUST NEVER panic and MUST exit 0 on ANY error.
//!   On failure it prints nothing (or stock) and the host shows an empty/stock
//!   statusline — a no-op, never a crash.
//! - (2) Content firewall: it reads ONLY `session_id` off the statusLine stdin.
//! - Budget: exit <= 10 ms hard; in-flight scripts are cancelled by the host, so
//!   speed is load-bearing. < 1 MB stripped (09 §5).
#![forbid(unsafe_code)]

use std::io::Read as _;
use std::os::unix::net::UnixDatagram;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use spnr_proto::SocketMsg;

const KEY_SESSION: &str = "session_id";

fn cache_path() -> PathBuf {
    if let Ok(p) = std::env::var("SPNR_STATUS_CACHE") {
        return PathBuf::from(p);
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    Path::new(&home).join(".spnr").join("status.cache")
}

fn sock_path() -> PathBuf {
    if let Ok(p) = std::env::var("SPNR_SOCK") {
        return PathBuf::from(p);
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    Path::new(&home).join(".spnr").join("spnrd.sock")
}

/// Build a terminal OSC 8 hyperlink: clickable `text` pointing at `url`. Terminals
/// without OSC 8 support render just `text` (graceful degradation, S4). The closing
/// `OSC 8 ;; BEL` is always emitted so following output is not turned into a link.
///
/// The terminator is BEL (`\x07`), NOT ST (`ESC \`): BEL is the form Claude Code's
/// statusLine documentation uses and is the most widely + reliably supported across
/// terminals (ghostty, kitty, wezterm, iTerm2, vte). The ST form rendered as plain
/// (non-clickable) text in practice.
pub fn osc8(url: &str, text: &str) -> String {
    format!("\x1b]8;;{url}\x07{text}\x1b]8;;\x07")
}

/// Read the pre-rendered statusline line from the tmpfs cache. Missing cache ->
/// `None` (host shows an empty statusline — a no-op, never an error).
fn read_cache(path: &Path) -> Option<String> {
    std::fs::read_to_string(path).ok()
}

/// Skim ONLY `session_id` from the statusLine JSON on stdin (no JSON parser; same
/// key-position discipline as spnr-hook). Everything else on stdin is ignored.
fn skim_session(blob: &str) -> Option<String> {
    let bytes = blob.as_bytes();
    let needle = format!("\"{KEY_SESSION}\"");
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
            return None;
        }
        let vstart = i + 1;
        let mut j = vstart;
        while j < bytes.len() {
            if bytes[j] == b'\\' {
                j += 2;
                continue;
            }
            if bytes[j] == b'"' {
                return Some(blob[vstart..j].to_string());
            }
            j += 1;
        }
        return None;
    }
    None
}

fn send_heartbeat(session_id: String, sock: &Path) -> std::io::Result<()> {
    let dg = UnixDatagram::unbound()?;
    dg.set_nonblocking(true)?;
    dg.send_to(&SocketMsg::Heartbeat { session_id }.encode(), sock)?;
    Ok(())
}

fn run() -> Result<(), ()> {
    // 1. Print whatever the daemon last cached (the visible statusline). This is
    //    the load-bearing, must-be-instant part; do it first.
    if let Some(line) = read_cache(&cache_path()) {
        print!("{line}");
    }
    // 2. Fire a liveness heartbeat (best-effort). Read stdin only to recover the
    //    session id; never block on it.
    let mut buf = Vec::with_capacity(2048);
    if std::io::stdin().read_to_end(&mut buf).is_ok() {
        if let Ok(blob) = std::str::from_utf8(&buf) {
            if let Some(session_id) = skim_session(blob) {
                let _ = send_heartbeat(session_id, &sock_path());
            }
        }
    }
    Ok(())
}

fn main() -> ExitCode {
    // Invariant 1: ALWAYS exit 0. A failed status render is a no-op to the host.
    let _ = run();
    ExitCode::SUCCESS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn osc8_is_well_formed_with_a_bel_terminator_and_degrades_to_text() {
        let link = osc8("https://spnr.sh/c/AbC9", "spnr ▲ $4.43 ↗");
        // OSC 8 open, URL, BEL, text, OSC 8 close, BEL (BEL = \x07, the clickable form).
        assert!(link.starts_with("\x1b]8;;https://spnr.sh/c/AbC9\x07"));
        assert!(link.ends_with("\x1b]8;;\x07"));
        assert!(!link.contains("\x1b\\"), "must use BEL, not the ST terminator");
        assert!(link.contains("spnr ▲ $4.43 ↗")); // the visible text survives stripping
    }

    #[test]
    fn skims_only_session_id() {
        let stdin = r#"{"model":{"id":"x"},"session_id":"sess-7c1f","cost":{"total_duration_ms":1234},"workspace":{"cwd":"/secret"}}"#;
        assert_eq!(skim_session(stdin), Some("sess-7c1f".to_string()));
    }

    #[test]
    fn reads_cache_contents() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("status.cache");
        std::fs::write(&p, "spnr ▲ $4.43 today").unwrap();
        assert_eq!(read_cache(&p).as_deref(), Some("spnr ▲ $4.43 today"));
    }

    #[test]
    fn missing_cache_is_none_not_panic() {
        assert_eq!(read_cache(Path::new("/no/such/spnr/status.cache")), None);
    }

    #[test]
    fn heartbeat_to_missing_socket_errors_without_panicking() {
        assert!(send_heartbeat("s".into(), Path::new("/no/such/sock")).is_err());
    }
}
