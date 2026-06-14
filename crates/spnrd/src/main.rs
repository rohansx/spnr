//! spnrd — the long-running user daemon.
//!
//! Owns everything heavy (isolated here so the hot path stays < 1 MB, 09 §5):
//! the impression engine (hook-derived WAITING intervals gated by the statusline
//! heartbeat, 04-impression-engine.md), event signing/queue (SAP/1, 03), the
//! Unix-socket API the hot-path binaries and the CLI talk to, and — when
//! `SPNR_SERVER` is set — the network loop that registers the device, fetches a
//! creative, injects the spinner, and flushes signed events to the backend.
//!
//! On daemon receipt it stamps `t` (no trustworthy hook timestamp exists;
//! 15-spike-results S2). It treats all socket input as untrusted and never panics
//! on it (invariant 1).
#![forbid(unsafe_code)]

mod engine;
mod queue;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use spnr_proto::{
    canonical_bytes, chain_next, DeviceKey, Event, EventType, SocketCmd, SocketMsg, GENESIS_PREV,
};
use tokio::sync::mpsc;

use engine::Session;

/// Resolve the spnr state dir (`~/.spnr`, or `$SPNR_HOME`).
fn spnr_home() -> PathBuf {
    if let Ok(p) = std::env::var("SPNR_HOME") {
        return PathBuf::from(p);
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    Path::new(&home).join(".spnr")
}

/// Resolve the host settings file the spinner is injected into.
fn settings_path() -> PathBuf {
    if let Ok(p) = std::env::var("SPNR_SETTINGS") {
        return PathBuf::from(p);
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    Path::new(&home).join(".claude").join("settings.json")
}

/// The statusLine command to inject. We prefer the ABSOLUTE path to the sibling
/// `spnr-status` binary (next to this daemon) so the command resolves regardless of
/// the PATH Claude Code spawns the statusLine under; we fall back to the bare name
/// (PATH lookup) only if the current executable can't be located.
fn status_command() -> String {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("spnr-status")))
        .filter(|p| p.exists())
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| "spnr-status".to_string())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// The daemon's mutable state. `handle` is a pure, synchronous, fully-tested
/// dispatch; the async socket loop is a thin shell around it.
struct Daemon {
    sessions: HashMap<String, Session>,
    paused: bool,
    key: DeviceKey,
    /// 16-byte device-local salt for session fingerprints (raw session ids never
    /// leave the machine). Derived from the device pubkey for v0.1; a persisted
    /// random salt is a follow-up.
    salt: [u8; 16],
    /// Per-device monotonic event counter (never reused).
    ctr: u64,
    /// Hash-chain head: BLAKE3 of the previous event's canonical bytes.
    prev: String,
    queue_path: PathBuf,
    status_cache: PathBuf,
    /// Cumulative impressions this run (drives the placeholder earnings ticker).
    impressions_total: u64,
    /// The creative attributed to this session's impressions (set from /v1/serve).
    current_creative: Option<String>,
    /// Backend base URL (for building clickable /c/{code} statusline links). Empty
    /// off the networked path.
    server: String,
    /// The served rotation pool as `(short_code, text)` — the statusline cycles its
    /// CLICKABLE link (text + /c/{code} target) through these (the spinner cycles the
    /// verbs natively).
    ads: Vec<(String, String)>,
    /// Rotating index into `ads` for the featured (clickable) statusline ad.
    featured: usize,
    /// Outbound flush channel (set only on the networked path).
    tx: Option<mpsc::UnboundedSender<String>>,
}

impl Daemon {
    fn new(home: &Path) -> Self {
        let key = DeviceKey::generate();
        let mut salt = [0u8; 16];
        salt.copy_from_slice(&key.verifying_key().to_bytes()[..16]);
        Self {
            sessions: HashMap::new(),
            paused: false,
            key,
            salt,
            ctr: 0,
            prev: GENESIS_PREV.to_string(),
            queue_path: home.join("queue.log"),
            status_cache: home.join("status.cache"),
            impressions_total: 0,
            current_creative: None,
            server: String::new(),
            ads: Vec::new(),
            featured: 0,
            tx: None,
        }
    }

    /// Salted, truncated BLAKE3 of the raw session id — what actually goes on the
    /// wire (the raw id never does).
    fn fingerprint(&self, session_id: &str) -> String {
        let mut input = Vec::with_capacity(16 + session_id.len());
        input.extend_from_slice(&self.salt);
        input.extend_from_slice(session_id.as_bytes());
        let hex = blake3::hash(&input).to_hex();
        format!("s:{}", &hex.as_str()[..12])
    }

    /// Dispatch one decoded, receipt-stamped datagram. Never panics; never blocks.
    fn handle(&mut self, msg: SocketMsg, recv_ms: u64) {
        match msg {
            SocketMsg::Hook {
                event_name,
                session_id,
            } => {
                let paused = self.paused;
                let sess = self.sessions.entry(session_id.clone()).or_default();
                sess.set_paused(paused);
                match event_name.as_str() {
                    "UserPromptSubmit" => sess.on_prompt_submit(recv_ms),
                    "PreToolUse" => sess.on_pre_tool(recv_ms),
                    "PostToolUse" => sess.on_post_tool(recv_ms),
                    "Stop" => {
                        let impressions = sess.on_stop(recv_ms);
                        if impressions > 0 {
                            self.emit_impressions(&session_id, impressions, recv_ms);
                        }
                    }
                    "SessionEnd" => {
                        self.sessions.remove(&session_id);
                    }
                    // SessionStart / Notification / unknown: no counting effect.
                    _ => {}
                }
            }
            SocketMsg::Heartbeat { session_id } => {
                if let Some(sess) = self.sessions.get_mut(&session_id) {
                    sess.on_heartbeat(recv_ms);
                }
                // The ~1 Hz statusline tick: rotate the featured (clickable) ad so the
                // status line cycles its link target alongside the spinner's verbs.
                let _ = self.write_status_cache();
            }
            SocketMsg::Cmd(SocketCmd::Pause) => {
                self.paused = true;
                for s in self.sessions.values_mut() {
                    s.set_paused(true);
                }
            }
            SocketMsg::Cmd(SocketCmd::Resume) => {
                self.paused = false;
                for s in self.sessions.values_mut() {
                    s.set_paused(false);
                }
            }
            SocketMsg::Cmd(SocketCmd::Ping) => { /* liveness only */ }
        }
    }

    /// Build, sign, chain, queue, and (if networked) flush an impression event.
    fn emit_impressions(&mut self, session_id: &str, n: u64, recv_ms: u64) {
        let event = Event {
            v: 1,
            id: spnr_proto::new_id(),
            ctr: self.ctr,
            prev: self.prev.clone(),
            t: (recv_ms / 1000) as i64,
            ty: EventType::Imp,
            session: self.fingerprint(session_id),
            creative: self.current_creative.clone(),
            n: Some(n as u32),
        };
        let canonical = canonical_bytes(&event);
        let sig = self.key.sign(&event);
        // Advance the chain + counter, then persist. Append/flush are best-effort:
        // a write/network failure must never crash the daemon (invariant 1).
        self.prev = chain_next(&canonical);
        self.ctr += 1;
        self.impressions_total += n;

        // Outbound envelope: the event's canonical JSON + the hex signature. Built
        // by string assembly (canonical bytes are already valid JSON) so no second
        // serializer touches the signed bytes.
        let sig_hex = data_encoding::HEXLOWER.encode(&sig);
        let canonical_str = String::from_utf8_lossy(&canonical);
        let envelope = format!(r#"{{"e":{canonical_str},"s":"{sig_hex}"}}"#);

        let _ = queue::append(&self.queue_path, envelope.as_bytes());
        if let Some(tx) = &self.tx {
            let _ = tx.send(envelope);
        }
        let _ = self.write_status_cache();
    }

    /// Refresh the cached statusline string read by `spnr-status`. The line is the
    /// currently-featured ad's text wrapped as a CLICKABLE OSC 8 hyperlink to that
    /// ad's `/c/{code}` redirector, with a compact earnings marker. The featured ad
    /// rotates each call (~1 Hz via the heartbeat), so the status line is a live,
    /// clickable, rotating ad. Terminals without OSC 8 render just the visible text.
    fn write_status_cache(&mut self) -> std::io::Result<()> {
        let line = match self.featured_ad() {
            Some((url, text)) => {
                let label = if self.impressions_total > 0 {
                    format!("spnr ▲{} · {}", self.impressions_total, text)
                } else {
                    format!("spnr · {text}")
                };
                osc8(&url, &label)
            }
            // Off the networked path: plain earnings ticker, no link.
            None => format!("spnr ▲ {} impressions today", self.impressions_total),
        };
        std::fs::write(&self.status_cache, line)
    }

    /// The currently-featured ad as `(clickable /c/{code} url, ad text)`, advancing
    /// the rotation by one. `None` off the networked path or with no served ads.
    fn featured_ad(&mut self) -> Option<(String, String)> {
        if self.server.is_empty() || self.ads.is_empty() {
            return None;
        }
        let (code, text) = self.ads[self.featured % self.ads.len()].clone();
        self.featured = self.featured.wrapping_add(1);
        let url = format!("{}/c/{}", self.server.trim_end_matches('/'), code);
        Some((url, text))
    }
}

/// Build a terminal OSC 8 hyperlink: clickable `text` pointing at `url`. Terminals
/// without OSC 8 render just `text`. Uses the BEL (`\x07`) terminator — the form
/// Claude Code's statusLine docs use and the most widely supported (the ST form
/// rendered as non-clickable plain text). Mirrors `spnr_status::osc8`.
fn osc8(url: &str, text: &str) -> String {
    format!("\x1b]8;;{url}\x07{text}\x1b]8;;\x07")
}

// ---------------------------------------------------------------------------
// Network (only when SPNR_SERVER is set). Blocking ureq calls; the flush runs on
// a dedicated task and pushes each POST onto spawn_blocking so the async socket
// loop is never stalled.
// ---------------------------------------------------------------------------
fn register(server: &str, device_id: &str, pubkey_hex: &str) {
    // Device/connection metadata sent ONLY here (never on the hot path). serde_json
    // is the dep that escapes user/system-controlled values (email, hostname) safely.
    let hostname = std::env::var("HOSTNAME")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| {
            std::fs::read_to_string("/etc/hostname")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        })
        .unwrap_or_else(|| "unknown".to_string());

    let mut body = serde_json::json!({
        "device_id": device_id,
        "pubkey": pubkey_hex,
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "version": env!("CARGO_PKG_VERSION"),
        "hostname": hostname,
    });
    // email is optional: include the field ONLY when SPNR_EMAIL is set and non-empty.
    if let Ok(email) = std::env::var("SPNR_EMAIL") {
        if !email.is_empty() {
            body["email"] = serde_json::Value::String(email);
        }
    }
    let _ = ureq::post(&format!("{server}/v1/register"))
        .set("Content-Type", "application/json")
        .send_string(&body.to_string());
}

/// Fetch the served rotation pool as `(id, text, url, short_code)` tuples. Reads the
/// `creatives` array, falling back to the single `creative` object for older servers.
/// Returns an empty vec on any network/parse error (fail-stock — no injection).
fn serve_creatives(server: &str) -> Vec<(String, String, String, String)> {
    let parse = |c: &serde_json::Value| -> Option<(String, String, String, String)> {
        Some((
            c.get("id")?.as_str()?.to_string(),
            c.get("text")?.as_str()?.to_string(),
            c.get("url")?.as_str()?.to_string(),
            c.get("short_code")?.as_str()?.to_string(),
        ))
    };
    let Some(resp) = ureq::get(&format!("{server}/v1/serve")).call().ok() else {
        return Vec::new();
    };
    let Some(body) = resp.into_string().ok() else {
        return Vec::new();
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&body) else {
        return Vec::new();
    };
    if let Some(arr) = v.get("creatives").and_then(|c| c.as_array()) {
        let pool: Vec<_> = arr.iter().filter_map(parse).collect();
        if !pool.is_empty() {
            return pool;
        }
    }
    v.get("creative").and_then(parse).into_iter().collect()
}

fn post_ingest(server: &str, device_id: &str, batch: &[String]) {
    let body = format!(
        r#"{{"device_id":"{device_id}","events":[{}]}}"#,
        batch.join(",")
    );
    let _ = ureq::post(&format!("{server}/v1/ingest"))
        .set("Content-Type", "application/json")
        .send_string(&body);
}

/// Drain signed-event envelopes and POST them to `/v1/ingest`, batching whatever
/// is immediately available.
async fn flush_loop(mut rx: mpsc::UnboundedReceiver<String>, server: String, device_id: String) {
    while let Some(first) = rx.recv().await {
        let mut batch = vec![first];
        while let Ok(e) = rx.try_recv() {
            batch.push(e);
        }
        let server = server.clone();
        let device_id = device_id.clone();
        let _ = tokio::task::spawn_blocking(move || post_ingest(&server, &device_id, &batch)).await;
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let home = spnr_home();
    std::fs::create_dir_all(&home)?;
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&home, std::fs::Permissions::from_mode(0o700));
    }

    let sock = home.join("spnrd.sock");
    let _ = std::fs::remove_file(&sock); // clear a stale socket from a prior run
    let listener = tokio::net::UnixDatagram::bind(&sock)?;

    let mut daemon = Daemon::new(&home);
    let device_id = daemon.key.device_id();
    let pubkey_hex = data_encoding::HEXLOWER.encode(&daemon.key.verifying_key().to_bytes());
    println!("spnrd device_id={device_id}");

    // Networked path: register, fetch the rotation pool, inject ALL verbs (the
    // spinner cycles through them) + a clickable rotating statusline, start flush.
    if let Ok(server) = std::env::var("SPNR_SERVER") {
        register(&server, &device_id, &pubkey_hex);
        let pool = serve_creatives(&server);
        if !pool.is_empty() {
            daemon.current_creative = Some(pool[0].0.clone());
            daemon.server = server.clone();
            // (short_code, text) per ad — drives the rotating clickable status line.
            daemon.ads = pool.iter().map(|c| (c.3.clone(), c.1.clone())).collect();
            let verbs: Vec<String> = pool.iter().map(|c| c.1.clone()).collect();
            let adapter = spnr_adapters::ClaudeCodeCli::new(
                settings_path(),
                home.join("backup.json"),
                verbs,
                Some(status_command()),
            );
            // Inject the sponsored spinner pool (best-effort, fail-stock).
            let _ = adapter.try_inject();
            let _ = daemon.write_status_cache();
            println!(
                "spnrd injected {} creative(s) + registered with {server}",
                pool.len()
            );
        }
        let (tx, rx) = mpsc::unbounded_channel::<String>();
        daemon.tx = Some(tx);
        tokio::spawn(flush_loop(rx, server, device_id.clone()));
    }

    let mut buf = vec![0u8; 64 * 1024];
    loop {
        match listener.recv_from(&mut buf).await {
            Ok((n, _addr)) => {
                if let Some(msg) = SocketMsg::decode(&buf[..n]) {
                    daemon.handle(msg, now_ms());
                }
                // Undecodable / oversized datagrams are dropped silently.
            }
            Err(_) => continue, // a recv error must not kill the daemon
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hb(s: &str) -> SocketMsg {
        SocketMsg::Heartbeat {
            session_id: s.to_string(),
        }
    }
    fn hook(name: &str, s: &str) -> SocketMsg {
        SocketMsg::Hook {
            event_name: name.to_string(),
            session_id: s.to_string(),
        }
    }

    #[test]
    fn a_full_attested_turn_emits_one_chained_impression_record() {
        let dir = tempfile::tempdir().unwrap();
        let mut d = Daemon::new(dir.path());
        d.handle(hook("UserPromptSubmit", "s1"), 0);
        for k in 0..=30 {
            d.handle(hb("s1"), k * 1000);
        }
        d.handle(hook("Stop", "s1"), 30_000);

        let recs = queue::read_all(&d.queue_path);
        assert_eq!(recs.len(), 1, "expected exactly one impression event");
        let json = String::from_utf8(recs[0].clone()).unwrap();
        // 30 countable seconds -> 6 impressions; type "imp"; chained from genesis.
        assert!(json.contains("\"type\":\"imp\""), "not an imp event: {json}");
        assert!(json.contains("\"n\":6"), "wrong impression count: {json}");
        assert!(json.contains(GENESIS_PREV), "first event should chain from genesis: {json}");
        // The raw session id must NEVER appear; only the salted fingerprint.
        assert!(!json.contains("\"s1\""), "raw session id leaked: {json}");
        assert!(json.contains("\"s:"), "missing session fingerprint: {json}");
        // The envelope carries a hex signature.
        assert!(json.contains("\"s\":\""), "missing signature: {json}");
        // Chain + counter advanced.
        assert_eq!(d.ctr, 1);
        assert_ne!(d.prev, GENESIS_PREV);
    }

    #[test]
    fn headless_turn_with_no_heartbeats_emits_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let mut d = Daemon::new(dir.path());
        d.handle(hook("UserPromptSubmit", "s1"), 0);
        d.handle(hook("Stop", "s1"), 60_000);
        assert!(queue::read_all(&d.queue_path).is_empty());
        assert_eq!(d.ctr, 0);
    }

    #[test]
    fn pause_zeroes_accrual_then_resume_restores_it() {
        let dir = tempfile::tempdir().unwrap();
        let mut d = Daemon::new(dir.path());
        d.handle(SocketMsg::Cmd(SocketCmd::Pause), 0);
        d.handle(hook("UserPromptSubmit", "s1"), 0);
        for k in 0..=30 {
            d.handle(hb("s1"), k * 1000);
        }
        d.handle(hook("Stop", "s1"), 30_000);
        assert!(queue::read_all(&d.queue_path).is_empty(), "paused session must not earn");

        d.handle(SocketMsg::Cmd(SocketCmd::Resume), 31_000);
        d.handle(hook("UserPromptSubmit", "s2"), 0);
        for k in 0..=30 {
            d.handle(hb("s2"), k * 1000);
        }
        d.handle(hook("Stop", "s2"), 30_000);
        assert_eq!(queue::read_all(&d.queue_path).len(), 1, "resumed session should earn");
    }

    #[test]
    fn fingerprint_is_stable_per_session_and_hides_the_raw_id() {
        let dir = tempfile::tempdir().unwrap();
        let d = Daemon::new(dir.path());
        let a = d.fingerprint("session-abc");
        let b = d.fingerprint("session-abc");
        let c = d.fingerprint("session-xyz");
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert!(a.starts_with("s:"));
        assert!(!a.contains("session-abc"));
    }

    #[test]
    fn statusline_is_a_clickable_osc8_link_when_networked() {
        let dir = tempfile::tempdir().unwrap();
        let mut d = Daemon::new(dir.path());
        d.server = "http://127.0.0.1:8787".into();
        d.ads = vec![
            ("AbC9".into(), "CloakPipe ↗".into()),
            ("Kp7T".into(), "ctxgraph ↗".into()),
        ];
        d.write_status_cache().unwrap();
        let line = std::fs::read_to_string(&d.status_cache).unwrap();
        // OSC 8 framing with a /c/{code} click target, a BEL terminator, and the ad text.
        assert!(line.starts_with("\x1b]8;;http://127.0.0.1:8787/c/"), "no OSC 8 link: {line:?}");
        assert!(line.ends_with("\x1b]8;;\x07"), "OSC 8 not BEL-terminated: {line:?}");
        assert!(!line.contains("\x1b\\"), "must use BEL not ST: {line:?}");
        assert!(line.contains("CloakPipe"), "missing the featured ad text: {line:?}");
    }

    #[test]
    fn featured_ad_rotates_through_the_whole_pool() {
        let dir = tempfile::tempdir().unwrap();
        let mut d = Daemon::new(dir.path());
        d.server = "http://x".into();
        d.ads = vec![
            ("AbC9".into(), "a ↗".into()),
            ("Kp7T".into(), "b ↗".into()),
            ("Zx2Q".into(), "c ↗".into()),
        ];
        let seen: Vec<(String, String)> = (0..3).filter_map(|_| d.featured_ad()).collect();
        assert_eq!(
            seen,
            vec![
                ("http://x/c/AbC9".into(), "a ↗".into()),
                ("http://x/c/Kp7T".into(), "b ↗".into()),
                ("http://x/c/Zx2Q".into(), "c ↗".into()),
            ]
        );
        // Wraps back around to the first ad.
        assert_eq!(d.featured_ad().map(|(u, _)| u).as_deref(), Some("http://x/c/AbC9"));
    }

    #[test]
    fn statusline_degrades_to_plain_text_off_the_networked_path() {
        let dir = tempfile::tempdir().unwrap();
        let mut d = Daemon::new(dir.path());
        // No server / no ad codes -> no link, just the visible ticker (no ESC bytes).
        d.write_status_cache().unwrap();
        let line = std::fs::read_to_string(&d.status_cache).unwrap();
        assert!(!line.contains('\x1b'), "should be plain text, got: {line:?}");
        assert!(line.contains("spnr ▲"), "missing ticker: {line:?}");
    }

    #[test]
    fn undecodable_datagrams_are_ignored_by_decode() {
        assert!(SocketMsg::decode(&[0xff, 0xff, 0xff]).is_none());
        assert!(SocketMsg::decode(&[]).is_none());
    }
}
