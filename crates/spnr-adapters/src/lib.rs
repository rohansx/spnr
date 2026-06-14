//! # spnr-adapters — `HostAdapter` implementations (platform-risk firewall)
//!
//! Each host (Claude Code CLI, Codex CLI, VS Code) is wrapped behind the
//! [`HostAdapter`] trait so the platform-risk surface is isolated (ADR-0004).
//! Adapters are deliberately THIN: they read hooks/statusline and write the
//! `spinnerVerbs` display setting via `spnr-settings`. They NEVER patch,
//! repackage, or proxy the host binary; never touch OAuth tokens; never route
//! model requests; never suppress host telemetry (07 §6, hard constraints).

#![forbid(unsafe_code)]

use std::path::PathBuf;

use spnr_settings::SettingsError;

/// Where a host surfaces ad-relevant events.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventSource {
    /// Native host hooks (e.g. Claude Code `UserPromptSubmit`/`Stop`/`SessionStart`).
    Hooks,
    /// No hooks available; reconcile coarse timing from the session JSONL instead.
    JsonlReconcile,
}

/// The platform-risk firewall trait. One impl per supported host.
///
/// `inject`/`restore` are best-effort and **fail-stock** (invariant 6): on any
/// error they leave the host in its stock state rather than a half-sponsored one.
/// Callers that need the outcome (the daemon, tests) use the impl's inherent
/// `try_*` methods, which surface the [`SettingsError`].
pub trait HostAdapter {
    /// Snapshot then inject spnr-owned keys (`spinnerVerbs`, optional `statusLine`)
    /// into the host's settings. Atomic; preserves all other keys (invariant 1).
    fn inject(&self);
    /// Idempotently restore the host's stock config from the snapshot (invariant 6).
    fn restore(&self);
    /// Declare how this host surfaces events (see [`EventSource`]).
    fn event_source(&self) -> EventSource;
}

/// Adapter for the Claude Code CLI host.
///
/// `spinnerVerbs` = `{mode:"replace", verbs:[...]}` (S1, 15-spike-results.md);
/// statusLine with `refreshInterval:1` for the ~1 Hz liveness tick (S3); OSC 8
/// click surface lives in the statusline, not the plain-text spinner (S4).
///
/// > Deviation from the scaffold's unit-struct stub: carries the (settings_path,
/// > backup_path, verbs, statusline) it operates on so paths are injectable for
/// > tests and never hardcode the real `~/.claude/settings.json`.
#[derive(Debug, Clone)]
pub struct ClaudeCodeCli {
    /// Path to the host `settings.json` (global `~/.claude/settings.json` in prod).
    pub settings_path: PathBuf,
    /// Path to spnr's pristine snapshot (`~/.spnr/backup.json` in prod).
    pub backup_path: PathBuf,
    /// The sponsored verb(s) to serve (`mode: "replace"`).
    pub verbs: Vec<String>,
    /// The statusLine command to register, or `None` to leave statusLine untouched
    /// (the daemon passes `None` when the user has a custom statusLine — 02 §2.2).
    pub statusline: Option<String>,
}

impl ClaudeCodeCli {
    pub fn new(
        settings_path: impl Into<PathBuf>,
        backup_path: impl Into<PathBuf>,
        verbs: Vec<String>,
        statusline: Option<String>,
    ) -> Self {
        Self {
            settings_path: settings_path.into(),
            backup_path: backup_path.into(),
            verbs,
            statusline,
        }
    }

    /// Snapshot (pristine-preserving) then inject — surfacing any error.
    pub fn try_inject(&self) -> Result<(), SettingsError> {
        spnr_settings::snapshot(&self.settings_path, &self.backup_path)?;
        spnr_settings::inject(&self.settings_path, &self.verbs, self.statusline.as_deref())
    }

    /// Restore stock config from the snapshot — surfacing any error.
    pub fn try_restore(&self) -> Result<(), SettingsError> {
        spnr_settings::restore(&self.settings_path, &self.backup_path)
    }
}

impl HostAdapter for ClaudeCodeCli {
    fn inject(&self) {
        // Best-effort, fail-stock: an injection error leaves the host stock.
        let _ = self.try_inject();
    }
    fn restore(&self) {
        let _ = self.try_restore();
    }
    fn event_source(&self) -> EventSource {
        EventSource::Hooks
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn adapter(dir: &std::path::Path) -> ClaudeCodeCli {
        ClaudeCodeCli::new(
            dir.join("settings.json"),
            dir.join("backup.json"),
            vec!["Sponsored ↗".to_string()],
            Some("spnr-status".to_string()),
        )
    }

    #[test]
    fn inject_then_restore_roundtrips_the_host_file() {
        let dir = tempfile::tempdir().unwrap();
        let original = "{\n  \"model\": \"m\",\n  \"theme\": \"dark\"\n}\n";
        std::fs::write(dir.path().join("settings.json"), original).unwrap();
        let a = adapter(dir.path());

        a.try_inject().unwrap();
        let injected = std::fs::read_to_string(&a.settings_path).unwrap();
        assert!(injected.contains("spinnerVerbs"), "spinnerVerbs not injected");
        assert!(injected.contains("\"refreshInterval\""), "statusLine refreshInterval missing");
        assert!(injected.contains("\"model\""), "host key lost");

        a.try_restore().unwrap();
        let restored: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&a.settings_path).unwrap()).unwrap();
        let expect: serde_json::Value = serde_json::from_str(original).unwrap();
        assert_eq!(restored, expect, "restore was not an identity");
    }

    #[test]
    fn event_source_is_hooks() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(adapter(dir.path()).event_source(), EventSource::Hooks);
    }

    #[test]
    fn trait_inject_is_fail_stock_on_a_non_object_settings_file() {
        // A corrupt host file must NOT be clobbered, and inject() must not panic.
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("settings.json"), b"[1,2,3]").unwrap();
        let a = adapter(dir.path());
        a.inject(); // swallows the SchemaDrift error
        assert_eq!(
            std::fs::read(&a.settings_path).unwrap(),
            b"[1,2,3]",
            "fail-stock violated: corrupt host file was modified"
        );
    }
}
