//! `spnr` — the user CLI. A thin client of the daemon socket.
//!
//! Subcommands (02-technical-spec.md, 07-security-privacy.md anti-phishing §5):
//! `login` and `redeem` open the EXACT canonical URL from the CLI so the user
//! never types/pastes an auth URL. `audit` dumps the raw outbound queue so the
//! user can verify the closed collected-list against real traffic (07 §3).
#![forbid(unsafe_code)]

use std::os::unix::net::UnixDatagram;
use std::path::{Path, PathBuf};

use clap::{Parser, Subcommand};
use spnr_proto::{SocketCmd, SocketMsg};

/// Canonical hosts — the CLI only ever opens these (07 §5 anti-phishing).
const LOGIN_URL: &str = "https://spnr.sh/login";
const REDEEM_URL: &str = "https://spnr.co/redeem";

/// spnr — sponsored spinner ad network client.
#[derive(Debug, Parser)]
#[command(name = "spnr", version, about, long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Wire spnr into Claude Code: snapshot the pristine settings, append the spnr
    /// hooks (existing hooks untouched), and link the binaries onto ~/.local/bin.
    Install {
        /// Ad backend the daemon should register with (shown in the start hint).
        #[arg(long, default_value = "http://127.0.0.1:8787")]
        server: String,
    },
    /// Bind this device to your account (GitHub device flow or email magic link).
    Login,
    /// Show daemon status, accrued impressions, and current spinner state.
    Status,
    /// Redeem accrued balance (opens the exact canonical redemption URL).
    Redeem,
    /// Pause spnr: restore stock config, stop accruing.
    Pause,
    /// Resume spnr after a pause.
    Resume,
    /// Dump the raw outbound queue human-readably (privacy self-verification).
    Audit,
    /// Remove spnr entirely: stop accruing, restore settings from snapshot.
    Uninstall,
}

fn spnr_home() -> PathBuf {
    if let Ok(p) = std::env::var("SPNR_HOME") {
        return PathBuf::from(p);
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    Path::new(&home).join(".spnr")
}

fn settings_path() -> PathBuf {
    if let Ok(p) = std::env::var("SPNR_SETTINGS") {
        return PathBuf::from(p);
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    Path::new(&home).join(".claude").join("settings.json")
}

fn sock_path(home: &Path) -> PathBuf {
    if let Ok(p) = std::env::var("SPNR_SOCK") {
        return PathBuf::from(p);
    }
    home.join("spnrd.sock")
}

/// Best-effort fire-and-forget control command to the daemon.
fn send_cmd(cmd: SocketCmd, sock: &Path) -> std::io::Result<()> {
    let dg = UnixDatagram::unbound()?;
    dg.send_to(&SocketMsg::Cmd(cmd).encode(), sock)?;
    Ok(())
}

// --- Local queue reader (same framing as spnrd::queue; inlined to keep the CLI
//     independent of the daemon binary). ---
fn read_queue(path: &Path) -> Vec<Vec<u8>> {
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(_) => return Vec::new(),
    };
    let mut out = Vec::new();
    let mut i = 0usize;
    while i + 4 <= bytes.len() {
        let len = u32::from_be_bytes([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]]) as usize;
        let start = i + 4;
        let Some(end) = start.checked_add(len) else { break };
        if end > bytes.len() {
            break;
        }
        out.push(bytes[start..end].to_vec());
        i = end;
    }
    out
}

/// Decode the queue to human-readable lines (the canonical event JSON per record).
fn audit_records(home: &Path) -> Vec<String> {
    read_queue(&home.join("queue.log"))
        .into_iter()
        .map(|r| String::from_utf8_lossy(&r).into_owned())
        .collect()
}

/// A one-line local status summary (no daemon round-trip needed in v0.1).
fn status_summary(home: &Path, settings: &Path) -> String {
    let events = read_queue(&home.join("queue.log")).len();
    let injected = std::fs::read_to_string(settings)
        .map(|s| s.contains("\"spinnerVerbs\""))
        .unwrap_or(false);
    format!(
        "spnr: {events} queued event(s); spinner {}",
        if injected { "injected" } else { "stock" }
    )
}

/// The directory holding the spnr binaries (the dir of THIS `spnr` executable; its
/// siblings are `spnrd`, `spnr-hook`, `spnr-status`).
fn bin_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
}

/// `~/.local/bin` — where we symlink the binaries for convenience.
fn local_bin() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    Path::new(&home).join(".local").join("bin")
}

/// Symlink the four spnr binaries into `~/.local/bin` (best-effort). Returns the
/// names actually linked. Replaces a stale link of the same name.
fn symlink_binaries(bindir: &Path) -> Vec<String> {
    let dst_dir = local_bin();
    if std::fs::create_dir_all(&dst_dir).is_err() {
        return Vec::new();
    }
    let mut linked = Vec::new();
    for name in ["spnr", "spnrd", "spnr-hook", "spnr-status"] {
        let src = bindir.join(name);
        if !src.exists() {
            continue;
        }
        let dst = dst_dir.join(name);
        let _ = std::fs::remove_file(&dst); // replace a stale link/file
        if std::os::unix::fs::symlink(&src, &dst).is_ok() {
            linked.push(name.to_string());
        }
    }
    linked
}

/// Remove the spnr symlinks we created in `~/.local/bin` — but ONLY entries that are
/// symlinks pointing at a spnr build (never a real file the user put there).
fn remove_symlinks() {
    let dst_dir = local_bin();
    for name in ["spnr", "spnrd", "spnr-hook", "spnr-status"] {
        let p = dst_dir.join(name);
        let Ok(meta) = std::fs::symlink_metadata(&p) else {
            continue;
        };
        if meta.file_type().is_symlink()
            && std::fs::read_link(&p)
                .map(|t| t.to_string_lossy().contains("spnr"))
                .unwrap_or(false)
        {
            let _ = std::fs::remove_file(&p);
        }
    }
}

/// Wire spnr into the host Claude Code. Reversible via `spnr uninstall`.
///
/// Order matters: we snapshot the PRISTINE settings BEFORE appending hooks, so the
/// backup (and thus `uninstall`) restores to exactly the pre-spnr file. The daemon
/// (started afterward, with `SPNR_SERVER` set) injects the spinnerVerbs + statusLine.
fn do_install(settings: &Path, home: &Path, server: &str) -> anyhow::Result<()> {
    let bindir = bin_dir().ok_or_else(|| anyhow::anyhow!("cannot resolve the spnr binary dir"))?;
    let hook_bin = bindir.join("spnr-hook");
    if !hook_bin.exists() {
        anyhow::bail!(
            "spnr-hook not found next to this binary ({}). Build with `cargo build --release`.",
            hook_bin.display()
        );
    }
    let hook_cmd = hook_bin.to_string_lossy().into_owned();

    // 1. snapshot pristine settings BEFORE any change (the uninstall anchor).
    std::fs::create_dir_all(home).ok();
    let backup = home.join("backup.json");
    spnr_settings::snapshot(settings, &backup)
        .map_err(|e| anyhow::anyhow!("snapshot settings ({}): {e}", settings.display()))?;

    // 2. append spnr hooks (append-not-clobber, idempotent).
    spnr_settings::inject_hooks(settings, &hook_cmd)
        .map_err(|e| anyhow::anyhow!("wire hooks into {}: {e}", settings.display()))?;

    // 3. link binaries onto ~/.local/bin (convenience; the hook command above and
    //    the daemon's statusLine command both use absolute paths regardless).
    let linked = symlink_binaries(&bindir);

    println!("spnr installed into {}:", settings.display());
    println!(
        "  hooks wired   → {} ({})",
        hook_cmd,
        spnr_settings::SPNR_HOOK_EVENTS.join(", ")
    );
    println!("  existing hooks left untouched · pristine settings backed up → {}", backup.display());
    if !linked.is_empty() {
        println!("  binaries linked → ~/.local/bin/{{{}}}", linked.join(","));
    }
    println!();
    println!("Start the daemon to fetch a creative and inject the spinner:");
    println!("  SPNR_SERVER={server} spnrd &");
    println!("Then run a Claude Code turn — the spinner shows the sponsored verb and");
    println!("the status line shows your live earnings. Reverse anytime with `spnr uninstall`.");
    Ok(())
}

/// Restore stock config and remove spnr's state dir. Best-effort & idempotent.
fn do_uninstall(settings: &Path, home: &Path) -> anyhow::Result<()> {
    let backup = home.join("backup.json");
    // Returning the host to stock is the important part; ignore "already stock".
    // restore() rewinds the snapshot (removing spinnerVerbs/statusLine AND the hooks,
    // since the snapshot predates them); remove_hooks() is the belt-and-suspenders
    // for the snapshot-less path (it strips only spnr-hook groups, leaving foreign
    // hooks intact).
    let _ = spnr_settings::restore(settings, &backup);
    let _ = spnr_settings::remove_hooks(settings);
    remove_symlinks();
    let _ = std::fs::remove_dir_all(home);
    Ok(())
}

fn run(cli: Cli) -> anyhow::Result<()> {
    let home = spnr_home();
    let settings = settings_path();
    match cli.command {
        Command::Install { server } => {
            do_install(&settings, &home, &server)?;
        }
        Command::Login => {
            println!("spnr login is not available yet — the auth backend lands in the next slice.");
            println!("When live, this opens exactly: {LOGIN_URL}");
        }
        Command::Status => {
            println!("{}", status_summary(&home, &settings));
        }
        Command::Redeem => {
            println!("spnr redeem is not available yet — the settlement backend lands in the next slice.");
            println!("When live, this opens exactly: {REDEEM_URL}");
        }
        Command::Pause => {
            // Restore stock immediately (don't depend on the daemon being up), then
            // tell the daemon to stop accruing.
            let backup = home.join("backup.json");
            let _ = spnr_settings::restore(&settings, &backup);
            let _ = send_cmd(SocketCmd::Pause, &sock_path(&home));
            println!("spnr paused — stock spinner restored.");
        }
        Command::Resume => {
            let _ = send_cmd(SocketCmd::Resume, &sock_path(&home));
            println!("spnr resumed.");
        }
        Command::Audit => {
            let records = audit_records(&home);
            if records.is_empty() {
                println!("(no queued events)");
            } else {
                for r in records {
                    println!("{r}");
                }
            }
        }
        Command::Uninstall => {
            do_uninstall(&settings, &home)?;
            println!("spnr uninstalled — settings restored from snapshot, state removed.");
        }
    }
    Ok(())
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    run(cli)
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    #[test]
    fn all_subcommands_parse() {
        for (args, ok) in [
            (vec!["spnr", "install"], true),
            (vec!["spnr", "install", "--server", "http://x:1"], true),
            (vec!["spnr", "login"], true),
            (vec!["spnr", "status"], true),
            (vec!["spnr", "redeem"], true),
            (vec!["spnr", "pause"], true),
            (vec!["spnr", "resume"], true),
            (vec!["spnr", "audit"], true),
            (vec!["spnr", "uninstall"], true),
            (vec!["spnr", "bogus"], false),
            (vec!["spnr"], false),
        ] {
            assert_eq!(Cli::try_parse_from(&args).is_ok(), ok, "args {args:?}");
        }
    }

    // do_install/do_uninstall resolve the binary dir from current_exe() and link
    // into ~/.local/bin, so they're exercised hermetically against the REAL built
    // binary (HOME overridden) in e2e/install.sh — not here, where current_exe()
    // is the test runner and ~/.local/bin is the user's real dir. The load-bearing
    // append-not-clobber + snapshot-restore-identity logic is unit-tested in
    // spnr-settings (inject_hooks/remove_hooks/snapshot_then_inject_hooks_*).

    #[test]
    fn audit_reads_framed_queue_records() {
        let dir = tempfile::tempdir().unwrap();
        let qp = dir.path().join("queue.log");
        let mut bytes = Vec::new();
        for rec in [b"{\"type\":\"imp\"}".as_slice(), b"{\"type\":\"gap\"}".as_slice()] {
            bytes.extend_from_slice(&(rec.len() as u32).to_be_bytes());
            bytes.extend_from_slice(rec);
        }
        std::fs::write(&qp, &bytes).unwrap();
        let recs = audit_records(dir.path());
        assert_eq!(recs, vec!["{\"type\":\"imp\"}", "{\"type\":\"gap\"}"]);
    }

    #[test]
    fn status_reports_injected_vs_stock() {
        let dir = tempfile::tempdir().unwrap();
        let settings = dir.path().join("settings.json");
        std::fs::write(&settings, "{}").unwrap();
        assert!(status_summary(dir.path(), &settings).contains("stock"));
        std::fs::write(&settings, "{\"spinnerVerbs\":{\"mode\":\"replace\",\"verbs\":[]}}").unwrap();
        assert!(status_summary(dir.path(), &settings).contains("injected"));
    }

    #[test]
    fn uninstall_restores_settings_and_removes_state() {
        let dir = tempfile::tempdir().unwrap();
        let settings = dir.path().join("settings.json");
        let home = dir.path().join("spnr-home");
        std::fs::create_dir_all(&home).unwrap();
        let original = "{\n  \"model\": \"m\"\n}\n";
        // Pristine snapshot, then a sponsored settings file.
        std::fs::write(home.join("backup.json"), original).unwrap();
        std::fs::write(&settings, "{\"model\":\"m\",\"spinnerVerbs\":{\"mode\":\"replace\",\"verbs\":[\"Ad ↗\"]}}").unwrap();

        do_uninstall(&settings, &home).unwrap();

        let restored: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&settings).unwrap()).unwrap();
        assert_eq!(restored, serde_json::json!({ "model": "m" }));
        assert!(!home.exists(), "state dir should be removed");
    }
}
