//! # spnr-settings — `~/.claude/settings.json` round-trip + state machine
//!
//! This is serializer #1 of the two-serializer rule (09 §4): `serde_json` with
//! `preserve_order`. We re-merge ONLY spnr-owned keys (`spinnerVerbs`, optional
//! `statusLine`); every other key must round-trip semantically unchanged with its
//! order preserved (invariant 1, never degrade the host). Writes are atomic: temp
//! in the SAME dir + fsync + `rename(2)` (07 §1, T2) — never a partial write.
//!
//! This crate MUST NOT import `serde_jcs` / the canonical signing path — the two
//! serializers never share a code path (a CI grep gate enforces this).

#![forbid(unsafe_code)]

use std::fs;
use std::io::Write as _;
use std::path::Path;

use serde_json::{json, Map, Value};

/// Errors from the settings round-trip. User settings are sacred: on any error
/// the caller restores from the snapshot and parks the state machine in `Paused`.
#[derive(Debug, thiserror::Error)]
pub enum SettingsError {
    #[error("settings I/O error: {0}")]
    Io(String),
    #[error("settings JSON parse error: {0}")]
    Parse(String),
    #[error("settings snapshot missing or unreadable: {0}")]
    SnapshotMissing(String),
    #[error("host settings schema changed unexpectedly: {0}")]
    SchemaDrift(String),
}

/// The settings-merge state machine (02-technical-spec.md §2.3).
///
/// ```text
/// Idle ─snapshot─► Snapshot ─inject─► Injected ─(fs change)─► ReMerge ─► Injected
///                                        │                                 │
///                                        └────────── pause ──► Paused ◄────┘
///                                                              │
///                                        Restored ◄─ restore ──┘
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SettingsState {
    /// No spnr keys present; nothing snapshotted yet.
    Idle,
    /// Pre-injection backup written to `~/.spnr/backup.json`.
    Snapshot,
    /// spnr-owned keys merged into the live settings.
    Injected,
    /// A foreign writer touched settings.json; re-merge spnr keys only.
    ReMerge,
    /// Parked (user pause, schema drift, or headless/no-keychain). Stock config.
    Paused,
    /// spnr keys removed; original settings restored from snapshot.
    Restored,
}

/// The keys spnr owns. Anything outside this set must round-trip untouched.
pub const SPNR_OWNED_KEYS: &[&str] = &["spinnerVerbs", "statusLine"];

/// The Claude Code hook events spnr wires to its hook binary. `UserPromptSubmit`
/// opens a billable wait-window and `Stop` closes it (the impression engine's
/// minimum viable set — 04-impression-engine.md); `SessionEnd` evicts the session.
/// We deliberately do NOT wire `PreToolUse`/`PostToolUse`: the daemon only uses them
/// for coarse timing, and those arrays commonly hold a user's own tool hooks (e.g. a
/// command rewriter) — appending there is needless risk. Each event uses the empty
/// matcher (these are non-tool events; Claude Code ignores `matcher` for them).
///
/// Unlike [`SPNR_OWNED_KEYS`], `hooks` is NOT a spnr-owned key — we never take over
/// the whole `hooks` object, only APPEND our own groups via [`inject_hooks`] and
/// remove exactly those via [`remove_hooks`]. A user's existing hooks are sacred.
pub const SPNR_HOOK_EVENTS: &[&str] = &["UserPromptSubmit", "Stop", "SessionEnd"];

// ---------------------------------------------------------------------------
// Atomic write: temp in the SAME directory -> fsync -> rename(2). This is the
// editor-safety primitive — a crash at any point leaves the ORIGINAL intact,
// because `settings.json` is only ever replaced by an atomic rename of a fully
// written, fsync'd temp file (07 §1, T2; invariant 1).
// ---------------------------------------------------------------------------
fn atomic_write(target: &Path, bytes: &[u8]) -> Result<(), SettingsError> {
    let dir = target.parent().unwrap_or_else(|| Path::new("."));
    let mut tmp = tempfile::Builder::new()
        .prefix(".spnr-settings-")
        .suffix(".tmp")
        .tempfile_in(dir)
        .map_err(|e| SettingsError::Io(format!("tempfile in {}: {e}", dir.display())))?;
    tmp.write_all(bytes)
        .map_err(|e| SettingsError::Io(format!("write temp: {e}")))?;
    tmp.as_file()
        .sync_all()
        .map_err(|e| SettingsError::Io(format!("fsync temp: {e}")))?;
    // `persist` performs an atomic rename onto `target` on the same filesystem.
    tmp.persist(target)
        .map_err(|e| SettingsError::Io(format!("rename onto {}: {}", target.display(), e.error)))?;
    Ok(())
}

/// Read `settings.json` into a JSON object, preserving key order. A missing file
/// is treated as an empty object (`{}`) — first-run is not an error. A present
/// file that is not a JSON object is `SchemaDrift` (we refuse to clobber it).
fn read_object(path: &Path) -> Result<Map<String, Value>, SettingsError> {
    match fs::read(path) {
        Ok(bytes) => {
            let value: Value = serde_json::from_slice(&bytes)
                .map_err(|e| SettingsError::Parse(format!("{}: {e}", path.display())))?;
            match value {
                Value::Object(map) => Ok(map),
                other => Err(SettingsError::SchemaDrift(format!(
                    "{} is a JSON {}, expected an object",
                    path.display(),
                    type_name(&other)
                ))),
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Map::new()),
        Err(e) => Err(SettingsError::Io(format!("read {}: {e}", path.display()))),
    }
}

fn type_name(v: &Value) -> &'static str {
    match v {
        Value::Null => "null",
        Value::Bool(_) => "bool",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

/// Serialize an object pretty (2-space) with a trailing newline — matches how
/// Claude Code writes the file and keeps diffs small for users who inspect it.
fn serialize(map: &Map<String, Value>) -> Result<Vec<u8>, SettingsError> {
    let mut bytes = serde_json::to_vec_pretty(&Value::Object(map.clone()))
        .map_err(|e| SettingsError::Io(format!("serialize settings: {e}")))?;
    bytes.push(b'\n');
    Ok(bytes)
}

/// Snapshot the current `settings.json` to `backup_path` before any injection.
///
/// Idempotent and **pristine-preserving**: if a backup already exists it is kept
/// (we never overwrite the original snapshot with an already-sponsored file). The
/// snapshot captures the exact pre-injection JSON object (a missing settings file
/// snapshots as `{}`).
pub fn snapshot(settings_path: &Path, backup_path: &Path) -> Result<(), SettingsError> {
    if backup_path.exists() {
        return Ok(()); // keep the first (pristine) snapshot
    }
    let original = read_object(settings_path)?;
    atomic_write(backup_path, &serialize(&original)?)
}

/// Merge spnr-owned keys into `settings.json`, preserving every other key's order
/// and value. Atomic temp + fsync + `rename(2)`.
///
/// - `spinnerVerbs` = `{ "mode": "replace", "verbs": [...] }` (S1, 15-spike-results.md)
/// - `statusLine`   = `{ "type": "command", "command": <cmd>, "refreshInterval": 1 }`
///   when `statusline` is `Some` (S3 — the ~1 Hz liveness tick).
///
/// The caller decides *whether* to pass `statusline` (the daemon does not clobber a
/// user's existing custom statusLine — 02 §2.2); this function is mechanical.
pub fn inject(
    settings_path: &Path,
    verbs: &[String],
    statusline: Option<&str>,
) -> Result<(), SettingsError> {
    let mut map = read_object(settings_path)?;

    map.insert(
        "spinnerVerbs".to_string(),
        json!({ "mode": "replace", "verbs": verbs }),
    );
    if let Some(cmd) = statusline {
        map.insert(
            "statusLine".to_string(),
            json!({ "type": "command", "command": cmd, "refreshInterval": 1 }),
        );
    }

    atomic_write(settings_path, &serialize(&map)?)
}

/// Restore the original settings from `backup_path` (idempotent). ANY spnr binary
/// may call this to return the host to stock (T2, invariant 6: fail quiet, fail
/// stock). The backup is written back verbatim; spnr-owned keys vanish with it.
pub fn restore(settings_path: &Path, backup_path: &Path) -> Result<(), SettingsError> {
    let snap = match fs::read(backup_path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // No snapshot: best-effort fallback — strip only spnr-owned keys so we
            // never leave the host in a sponsored state, but never invent content.
            let mut map = read_object(settings_path)?;
            // Remove EVERY spnr-owned key (no short-circuit), tracking whether any existed.
            let mut had_any = false;
            for k in SPNR_OWNED_KEYS {
                if map.remove(*k).is_some() {
                    had_any = true;
                }
            }
            if had_any {
                atomic_write(settings_path, &serialize(&map)?)?;
            }
            return Err(SettingsError::SnapshotMissing(format!(
                "{} (stripped spnr keys as a fallback)",
                backup_path.display()
            )));
        }
        Err(e) => return Err(SettingsError::Io(format!("read backup: {e}"))),
    };
    // Validate the snapshot parses before writing it back (don't restore garbage).
    let _: Value = serde_json::from_slice(&snap)
        .map_err(|e| SettingsError::SnapshotMissing(format!("backup unparseable: {e}")))?;
    atomic_write(settings_path, &snap)
}

// ---------------------------------------------------------------------------
// Hook wiring. `hooks` is NOT a spnr-owned key, so these helpers are strictly
// APPEND-and-remove: they add/remove only spnr's own matcher-groups and never
// mutate, reorder, or drop a foreign hook. The installer snapshots the pristine
// file BEFORE calling inject_hooks, so a snapshot restore also removes them; this
// gives a precise inverse for the snapshot-less path too.
// ---------------------------------------------------------------------------

/// True if a hook matcher-group contains a command-hook whose command is `command`.
fn group_has_exact_command(group: &Value, command: &str) -> bool {
    group
        .get("hooks")
        .and_then(Value::as_array)
        .is_some_and(|hooks| {
            hooks
                .iter()
                .any(|h| h.get("command").and_then(Value::as_str) == Some(command))
        })
}

/// True if `command` invokes the spnr-hook binary (bare name or any absolute path
/// ending in `/spnr-hook`). Used by [`remove_hooks`] so it cleans up regardless of
/// whether the entry was written with a bare or absolute command.
fn is_spnr_hook_command(command: &str) -> bool {
    command == "spnr-hook" || command.ends_with("/spnr-hook")
}

/// True if a matcher-group references the spnr-hook binary in any of its hooks.
fn group_is_spnr_hook(group: &Value) -> bool {
    group
        .get("hooks")
        .and_then(Value::as_array)
        .is_some_and(|hooks| {
            hooks.iter().any(|h| {
                h.get("command")
                    .and_then(Value::as_str)
                    .is_some_and(is_spnr_hook_command)
            })
        })
}

/// Append spnr's hook entries to `settings.json` WITHOUT disturbing existing hooks.
///
/// For each event in [`SPNR_HOOK_EVENTS`] we append one fresh matcher-group
/// `{ "matcher": "", "hooks": [{ "type": "command", "command": <command> }] }` to
/// that event's array (creating the array / the top-level `hooks` object as needed).
/// Existing groups are never mutated or reordered. Idempotent: if a group with this
/// exact command already exists for an event, it is left as-is (no duplicate).
///
/// `command` should be the absolute path to the `spnr-hook` binary so it resolves
/// regardless of PATH. A pre-existing non-object `hooks`, or a non-array event, is
/// refused as [`SettingsError::SchemaDrift`] (we never clobber an odd host shape).
pub fn inject_hooks(settings_path: &Path, command: &str) -> Result<(), SettingsError> {
    let mut map = read_object(settings_path)?;

    let hooks = match map
        .entry("hooks".to_string())
        .or_insert_with(|| Value::Object(Map::new()))
    {
        Value::Object(o) => o,
        other => {
            return Err(SettingsError::SchemaDrift(format!(
                "hooks is a JSON {}, expected an object",
                type_name(other)
            )))
        }
    };

    for event in SPNR_HOOK_EVENTS {
        let arr = match hooks
            .entry((*event).to_string())
            .or_insert_with(|| Value::Array(Vec::new()))
        {
            Value::Array(a) => a,
            other => {
                return Err(SettingsError::SchemaDrift(format!(
                    "hooks.{event} is a JSON {}, expected an array",
                    type_name(other)
                )))
            }
        };
        if !arr.iter().any(|g| group_has_exact_command(g, command)) {
            arr.push(json!({
                "matcher": "",
                "hooks": [{ "type": "command", "command": command }],
            }));
        }
    }

    atomic_write(settings_path, &serialize(&map)?)
}

/// Remove every spnr-hook matcher-group from each [`SPNR_HOOK_EVENTS`] array, then
/// prune any event array we emptied and the top-level `hooks` object if it became
/// empty. The precise inverse of [`inject_hooks`]; a user's own hooks (and any other
/// event) are never touched. Idempotent — a no-op when no spnr hooks are present.
pub fn remove_hooks(settings_path: &Path) -> Result<(), SettingsError> {
    let mut map = read_object(settings_path)?;

    let hooks_now_empty = {
        let Some(Value::Object(hooks)) = map.get_mut("hooks") else {
            return Ok(()); // no (object) hooks block — nothing to remove
        };
        for event in SPNR_HOOK_EVENTS {
            if let Some(Value::Array(arr)) = hooks.get_mut(*event) {
                arr.retain(|g| !group_is_spnr_hook(g));
            }
        }
        // Prune only the spnr event arrays we may have emptied (leave foreign ones).
        for event in SPNR_HOOK_EVENTS {
            if matches!(hooks.get(*event), Some(Value::Array(a)) if a.is_empty()) {
                hooks.remove(*event);
            }
        }
        hooks.is_empty()
    };
    if hooks_now_empty {
        map.remove("hooks");
    }

    atomic_write(settings_path, &serialize(&map)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn paths(dir: &Path) -> (std::path::PathBuf, std::path::PathBuf) {
        (dir.join("settings.json"), dir.join("backup.json"))
    }

    fn write(path: &Path, v: &Value) {
        fs::write(path, serde_json::to_vec_pretty(v).unwrap()).unwrap();
    }

    fn read(path: &Path) -> Value {
        serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
    }

    /// A spread of realistic settings shapes for table-driven property testing.
    fn corpus() -> Vec<Value> {
        vec![
            json!({}),
            json!({ "model": "claude-opus-4-8", "theme": "dark" }),
            json!({
                "model": "x",
                "permissions": { "allow": ["Bash(git*)"], "deny": [] },
                "hooks": { "Stop": [{ "matcher": "", "hooks": [] }] },
                "statusLine": { "type": "command", "command": "~/mine.sh" },
                "spinnerVerbs": { "mode": "append", "verbs": ["Yak-shaving"] },
                "nested": { "a": { "b": [1, 2, { "c": true }] } }
            }),
            json!({ "env": { "FOO": "bar" }, "z_last": 1, "a_first": 2 }),
        ]
    }

    #[test]
    fn inject_preserves_every_unknown_key_and_order() {
        let dir = tempfile::tempdir().unwrap();
        let (settings, _backup) = paths(dir.path());
        let original = json!({
            "model": "m", "permissions": { "allow": [] }, "theme": "dark", "z": 9
        });
        write(&settings, &original);

        inject(&settings, &["Sponsored ↗".to_string()], None).unwrap();
        let after = read(&settings);

        // Our key landed, correctly shaped.
        assert_eq!(after["spinnerVerbs"]["mode"], json!("replace"));
        assert_eq!(after["spinnerVerbs"]["verbs"], json!(["Sponsored ↗"]));
        // Every original key is byte-for-byte equivalent.
        for k in ["model", "permissions", "theme", "z"] {
            assert_eq!(after[k], original[k], "key {k} changed");
        }
        // Original keys keep their relative order; spnr key is appended last.
        let keys: Vec<&str> = after.as_object().unwrap().keys().map(|s| s.as_str()).collect();
        assert_eq!(&keys[..4], &["model", "permissions", "theme", "z"]);
        assert_eq!(keys.last(), Some(&"spinnerVerbs"));
    }

    #[test]
    fn snapshot_then_inject_then_restore_is_identity() {
        for original in corpus() {
            let dir = tempfile::tempdir().unwrap();
            let (settings, backup) = paths(dir.path());
            write(&settings, &original);

            snapshot(&settings, &backup).unwrap();
            inject(&settings, &["A ↗".into(), "B ↗".into()], Some("spnr-status")).unwrap();
            restore(&settings, &backup).unwrap();

            assert_eq!(read(&settings), original, "round-trip changed {original}");
        }
    }

    #[test]
    fn snapshot_is_idempotent_and_pristine_preserving() {
        let dir = tempfile::tempdir().unwrap();
        let (settings, backup) = paths(dir.path());
        let original = json!({ "model": "m" });
        write(&settings, &original);

        snapshot(&settings, &backup).unwrap();
        // Inject, then snapshot again: the backup must still hold the PRISTINE file,
        // not the sponsored one (else restore would re-sponsor).
        inject(&settings, &["Ad ↗".into()], None).unwrap();
        snapshot(&settings, &backup).unwrap();
        assert_eq!(read(&backup), original, "second snapshot clobbered the pristine backup");
    }

    #[test]
    fn restore_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let (settings, backup) = paths(dir.path());
        let original = json!({ "model": "m", "theme": "light" });
        write(&settings, &original);
        snapshot(&settings, &backup).unwrap();
        inject(&settings, &["Ad ↗".into()], None).unwrap();

        restore(&settings, &backup).unwrap();
        let once = read(&settings);
        restore(&settings, &backup).unwrap();
        let twice = read(&settings);
        assert_eq!(once, original);
        assert_eq!(once, twice);
    }

    #[test]
    fn inject_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let (settings, _b) = paths(dir.path());
        write(&settings, &json!({ "model": "m" }));
        inject(&settings, &["Ad ↗".into()], None).unwrap();
        let once = read(&settings);
        inject(&settings, &["Ad ↗".into()], None).unwrap();
        let twice = read(&settings);
        assert_eq!(once, twice);
    }

    #[test]
    fn missing_settings_file_is_first_run_not_error() {
        let dir = tempfile::tempdir().unwrap();
        let (settings, backup) = paths(dir.path());
        // No settings.json on disk.
        snapshot(&settings, &backup).unwrap();
        inject(&settings, &["Ad ↗".into()], None).unwrap();
        assert_eq!(read(&settings)["spinnerVerbs"]["mode"], json!("replace"));
        // Restoring returns to the empty object we snapshotted.
        restore(&settings, &backup).unwrap();
        assert_eq!(read(&settings), json!({}));
    }

    #[test]
    fn refuses_to_clobber_a_non_object_settings_file() {
        let dir = tempfile::tempdir().unwrap();
        let (settings, _b) = paths(dir.path());
        fs::write(&settings, b"[1,2,3]").unwrap();
        let err = inject(&settings, &["Ad ↗".into()], None).unwrap_err();
        assert!(matches!(err, SettingsError::SchemaDrift(_)));
        // The hostile/odd file is left exactly as it was.
        assert_eq!(fs::read(&settings).unwrap(), b"[1,2,3]");
    }

    #[test]
    fn atomic_write_replaces_whole_file_or_nothing() {
        // The original is only ever replaced by a complete, fsync'd temp via rename.
        // We assert the post-write file is always complete + valid (never partial).
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("settings.json");
        write(&target, &json!({ "original": true }));
        atomic_write(&target, b"{\"replaced\":true}\n").unwrap();
        assert_eq!(read(&target), json!({ "replaced": true }));
        // No stray temp files left behind in the dir.
        let leftovers: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".spnr-settings-"))
            .collect();
        assert!(leftovers.is_empty(), "temp file leaked: {leftovers:?}");
    }

    #[test]
    fn statusline_injected_with_refresh_interval_1() {
        let dir = tempfile::tempdir().unwrap();
        let (settings, _b) = paths(dir.path());
        write(&settings, &json!({}));
        inject(&settings, &["Ad ↗".into()], Some("spnr-status")).unwrap();
        let s = read(&settings);
        assert_eq!(s["statusLine"]["type"], json!("command"));
        assert_eq!(s["statusLine"]["command"], json!("spnr-status"));
        assert_eq!(s["statusLine"]["refreshInterval"], json!(1));
    }

    // ---- hook wiring ----

    /// A realistic host hooks block mirroring the kind a power user already has:
    /// an existing `Stop` hook plus a `PreToolUse` array carrying TWO foreign tool
    /// hooks. inject_hooks MUST preserve every one of these untouched.
    fn host_with_hooks() -> Value {
        json!({
            "model": "opus",
            "hooks": {
                "PreToolUse": [
                    { "matcher": "Bash", "hooks": [{ "type": "command", "command": "/h/rtk-rewrite.sh" }] },
                    { "matcher": "Grep|Glob|Bash", "hooks": [{ "type": "command", "command": "node gitnexus.cjs" }] }
                ],
                "Stop": [
                    { "matcher": "", "hooks": [{ "type": "command", "command": "/h/session-end.sh" }] }
                ]
            }
        })
    }

    #[test]
    fn inject_hooks_appends_without_clobbering_existing_hooks() {
        let dir = tempfile::tempdir().unwrap();
        let (settings, _b) = paths(dir.path());
        write(&settings, &host_with_hooks());

        inject_hooks(&settings, "/bin/spnr-hook").unwrap();
        let after = read(&settings);
        let hooks = &after["hooks"];

        // Every foreign hook survives, in place.
        assert_eq!(hooks["PreToolUse"], host_with_hooks()["hooks"]["PreToolUse"],
            "PreToolUse (RTK + gitnexus) must be untouched");
        // The user's existing Stop hook is still the FIRST group.
        assert_eq!(hooks["Stop"][0]["hooks"][0]["command"], json!("/h/session-end.sh"));
        // spnr appended a SECOND Stop group (not replacing the user's).
        assert_eq!(hooks["Stop"].as_array().unwrap().len(), 2);
        assert_eq!(hooks["Stop"][1]["hooks"][0]["command"], json!("/bin/spnr-hook"));
        assert_eq!(hooks["Stop"][1]["matcher"], json!(""));
        // New event arrays created for the events the user didn't have.
        assert_eq!(hooks["UserPromptSubmit"][0]["hooks"][0]["command"], json!("/bin/spnr-hook"));
        assert_eq!(hooks["SessionEnd"][0]["hooks"][0]["command"], json!("/bin/spnr-hook"));
        // PreToolUse / PostToolUse are NOT spnr events — we never created PostToolUse.
        assert!(hooks.get("PostToolUse").is_none());
        // The non-hooks host key is preserved.
        assert_eq!(after["model"], json!("opus"));
    }

    #[test]
    fn inject_hooks_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let (settings, _b) = paths(dir.path());
        write(&settings, &host_with_hooks());
        inject_hooks(&settings, "/bin/spnr-hook").unwrap();
        let once = read(&settings);
        inject_hooks(&settings, "/bin/spnr-hook").unwrap();
        let twice = read(&settings);
        assert_eq!(once, twice, "re-running inject_hooks duplicated entries");
        // Still exactly two Stop groups (no third).
        assert_eq!(twice["hooks"]["Stop"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn remove_hooks_is_the_precise_inverse_leaving_foreign_hooks() {
        let dir = tempfile::tempdir().unwrap();
        let (settings, _b) = paths(dir.path());
        let original = host_with_hooks();
        write(&settings, &original);

        inject_hooks(&settings, "/bin/spnr-hook").unwrap();
        remove_hooks(&settings).unwrap();
        let after = read(&settings);

        // Back to exactly the original — spnr's Stop group removed, the empty
        // UserPromptSubmit/SessionEnd arrays pruned, foreign hooks intact.
        assert_eq!(after, original, "remove_hooks was not an exact inverse");
    }

    #[test]
    fn remove_hooks_matches_bare_and_absolute_commands() {
        let dir = tempfile::tempdir().unwrap();
        let (settings, _b) = paths(dir.path());
        // A bare-name spnr hook (as an older install might have written it).
        write(&settings, &json!({
            "hooks": { "Stop": [{ "matcher": "", "hooks": [{ "type": "command", "command": "spnr-hook" }] }] }
        }));
        remove_hooks(&settings).unwrap();
        // The Stop array emptied and pruned, the empty hooks object removed.
        assert_eq!(read(&settings), json!({}));
    }

    #[test]
    fn snapshot_then_inject_hooks_then_restore_is_identity() {
        // The uninstall path: snapshot pristine, wire hooks, restore from snapshot.
        let dir = tempfile::tempdir().unwrap();
        let (settings, backup) = paths(dir.path());
        let original = host_with_hooks();
        write(&settings, &original);

        snapshot(&settings, &backup).unwrap();
        inject_hooks(&settings, "/bin/spnr-hook").unwrap();
        // ...and the daemon's spinner inject on top, to mirror a real install.
        inject(&settings, &["Ad ↗".into()], Some("spnr-status")).unwrap();
        restore(&settings, &backup).unwrap();

        assert_eq!(read(&settings), original, "snapshot restore did not undo hooks+inject");
    }

    #[test]
    fn inject_hooks_creates_hooks_block_when_absent() {
        let dir = tempfile::tempdir().unwrap();
        let (settings, _b) = paths(dir.path());
        write(&settings, &json!({ "model": "m" }));
        inject_hooks(&settings, "/bin/spnr-hook").unwrap();
        let after = read(&settings);
        assert_eq!(after["model"], json!("m"));
        for ev in SPNR_HOOK_EVENTS {
            assert_eq!(after["hooks"][ev][0]["hooks"][0]["command"], json!("/bin/spnr-hook"),
                "event {ev} not wired");
        }
    }

    #[test]
    fn inject_hooks_refuses_a_non_object_hooks_value() {
        let dir = tempfile::tempdir().unwrap();
        let (settings, _b) = paths(dir.path());
        write(&settings, &json!({ "hooks": "nonsense" }));
        let err = inject_hooks(&settings, "/bin/spnr-hook").unwrap_err();
        assert!(matches!(err, SettingsError::SchemaDrift(_)));
        // The odd host file is left exactly as it was.
        assert_eq!(read(&settings), json!({ "hooks": "nonsense" }));
    }
}
