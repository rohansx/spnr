//! SQLite durability for spnr-server.
//!
//! The SQLite database is the DURABLE store; [`crate::AppState`] is an in-memory
//! materialized view rebuilt from it on startup. All mutations are written through
//! to SQLite inside the same `Mutex` lock that guards the in-memory state, so a
//! restart never loses data and the in-memory view never diverges from disk.
//!
//! `rusqlite` is synchronous; that is fine here because every write happens while
//! the single `AppState` mutex is already held (the server never does I/O-bound
//! work concurrently against the same connection).
//!
//! The ledger table is append-only (insert-only, `seq` autoincrement). Because we
//! only ever append balanced double-entry pairs/transfers, a rebuilt ledger still
//! satisfies `ledger_sums_to_zero()`.

use std::collections::{HashMap, HashSet};

use rusqlite::{params, Connection};
use spnr_proto::VerifyingKey;

use crate::{Creative, DeviceRec, LedgerEntry, Redemption};

/// Open (or create) the SQLite database at `path`. The special value `":memory:"`
/// yields a private in-memory database. Creates the schema if absent.
pub fn open(path: &str) -> rusqlite::Result<Connection> {
    let conn = if path == ":memory:" {
        Connection::open_in_memory()?
    } else {
        Connection::open(path)?
    };
    init_schema(&conn)?;
    Ok(conn)
}

/// Create every table if it does not already exist. Idempotent.
fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS devices (
            device_id  TEXT PRIMARY KEY,
            pubkey_hex TEXT NOT NULL,
            account_id TEXT NOT NULL,
            chain_head TEXT NOT NULL,
            ctr_head   INTEGER
        );
        CREATE TABLE IF NOT EXISTS ledger (
            seq           INTEGER PRIMARY KEY AUTOINCREMENT,
            debit         TEXT    NOT NULL,
            credit        TEXT    NOT NULL,
            amount_micros INTEGER NOT NULL,
            kind          TEXT    NOT NULL,
            reference     TEXT    NOT NULL
        );
        CREATE TABLE IF NOT EXISTS redemptions (
            id            TEXT PRIMARY KEY,
            amount_micros INTEGER NOT NULL,
            rail          TEXT    NOT NULL
        );
        CREATE TABLE IF NOT EXISTS seen_events (
            event_id TEXT PRIMARY KEY
        );
        CREATE TABLE IF NOT EXISTS balances (
            account TEXT PRIMARY KEY,
            micros  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS impressions (
            account TEXT PRIMARY KEY,
            n       INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS kv (
            k TEXT PRIMARY KEY,
            v INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS accounts (
            account_id   TEXT PRIMARY KEY,
            email        TEXT NOT NULL UNIQUE,
            password_phc TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token        TEXT PRIMARY KEY,
            account_id   TEXT NOT NULL,
            created_unix INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS creatives (
            id            TEXT PRIMARY KEY,
            text          TEXT    NOT NULL,
            url           TEXT    NOT NULL,
            short_code    TEXT    NOT NULL,
            advertiser    TEXT    NOT NULL,
            campaign_name TEXT    NOT NULL,
            active        INTEGER NOT NULL,
            created_unix  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS device_meta (
            device_id  TEXT PRIMARY KEY,
            ip         TEXT,
            os         TEXT,
            arch       TEXT,
            hostname   TEXT,
            version    TEXT,
            email      TEXT,
            first_seen INTEGER NOT NULL,
            last_seen  INTEGER NOT NULL
        );
        "#,
    )
}

/// A persisted auth account: id, email, and the argon2 PHC password hash.
pub struct Account {
    pub account_id: String,
    pub email: String,
    pub password_phc: String,
}

/// Insert a new account. Returns `Err` if the email (or id) already exists
/// (the UNIQUE constraint fires); callers map that to the 409 path.
pub fn insert_account(
    conn: &Connection,
    account_id: &str,
    email: &str,
    password_phc: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO accounts (account_id, email, password_phc) VALUES (?1, ?2, ?3)",
        params![account_id, email, password_phc],
    )
    .map(|_| ())
}

/// Look up an account by email. `Ok(None)` when no such email exists.
pub fn find_account_by_email(conn: &Connection, email: &str) -> rusqlite::Result<Option<Account>> {
    conn.query_row(
        "SELECT account_id, email, password_phc FROM accounts WHERE email = ?1",
        params![email],
        |row| {
            Ok(Account {
                account_id: row.get(0)?,
                email: row.get(1)?,
                password_phc: row.get(2)?,
            })
        },
    )
    .map(Some)
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(other),
    })
}

/// Look up an account by its id. `Ok(None)` when absent.
pub fn find_account_by_id(conn: &Connection, account_id: &str) -> rusqlite::Result<Option<Account>> {
    conn.query_row(
        "SELECT account_id, email, password_phc FROM accounts WHERE account_id = ?1",
        params![account_id],
        |row| {
            Ok(Account {
                account_id: row.get(0)?,
                email: row.get(1)?,
                password_phc: row.get(2)?,
            })
        },
    )
    .map(Some)
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(other),
    })
}

/// Insert a session (an opaque token -> account binding).
pub fn insert_session(
    conn: &Connection,
    token: &str,
    account_id: &str,
    created_unix: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO sessions (token, account_id, created_unix) VALUES (?1, ?2, ?3)",
        params![token, account_id, created_unix],
    )
    .map(|_| ())
}

/// Resolve a session token to its account id. `Ok(None)` when the token is
/// unknown or was invalidated (logged out).
pub fn find_session(conn: &Connection, token: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT account_id FROM sessions WHERE token = ?1",
        params![token],
        |row| row.get::<_, String>(0),
    )
    .map(Some)
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(other),
    })
}

/// Invalidate a session (logout). Idempotent: deleting an absent token is fine.
pub fn delete_session(conn: &Connection, token: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM sessions WHERE token = ?1", params![token])
        .map(|_| ())
}

/// The in-memory fields rebuilt from a SQLite database. Returned by [`load`] and
/// spread into `AppState` by [`crate::AppState::open`].
pub struct Loaded {
    pub devices: HashMap<String, DeviceRec>,
    pub seen_event_ids: HashSet<String>,
    pub ledger: Vec<LedgerEntry>,
    pub balances: HashMap<String, i64>,
    pub impressions: HashMap<String, u64>,
    pub clicks: u64,
    pub accepted: u64,
    pub rejected: u64,
    pub redemptions: Vec<Redemption>,
    /// Highest numeric redemption id seen + 1 (so the next id never collides).
    pub next_redemption_id: u64,
}

/// Rebuild the in-memory materialized view from the durable SQLite store.
pub fn load(conn: &Connection) -> rusqlite::Result<Loaded> {
    // devices
    let mut devices = HashMap::new();
    {
        let mut stmt =
            conn.prepare("SELECT device_id, pubkey_hex, account_id, chain_head, ctr_head FROM devices")?;
        let rows = stmt.query_map([], |row| {
            let device_id: String = row.get(0)?;
            let pubkey_hex: String = row.get(1)?;
            let account_id: String = row.get(2)?;
            let chain_head: String = row.get(3)?;
            let ctr_head: Option<i64> = row.get(4)?;
            Ok((device_id, pubkey_hex, account_id, chain_head, ctr_head))
        })?;
        for row in rows {
            let (device_id, pubkey_hex, account_id, chain_head, ctr_head) = row?;
            // A device only ever reaches the DB after register() decoded its pubkey,
            // so this decode is expected to succeed; skip any unparsable row rather
            // than poisoning startup.
            if let Some(pubkey) = decode_pubkey(&pubkey_hex) {
                devices.insert(
                    device_id,
                    DeviceRec {
                        pubkey,
                        account_id,
                        chain_head,
                        ctr_head: ctr_head.map(|c| c as u64),
                    },
                );
            }
        }
    }

    // seen_events
    let mut seen_event_ids = HashSet::new();
    {
        let mut stmt = conn.prepare("SELECT event_id FROM seen_events")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        for r in rows {
            seen_event_ids.insert(r?);
        }
    }

    // ledger (ordered by append seq so the rebuilt log matches insertion order)
    let mut ledger = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT debit, credit, amount_micros, kind, reference FROM ledger ORDER BY seq")?;
        let rows = stmt.query_map([], |row| {
            Ok(LedgerEntry {
                debit: row.get(0)?,
                credit: row.get(1)?,
                amount_micros: row.get(2)?,
                kind: row.get(3)?,
                reference: row.get(4)?,
            })
        })?;
        for r in rows {
            ledger.push(r?);
        }
    }

    // balances
    let mut balances = HashMap::new();
    {
        let mut stmt = conn.prepare("SELECT account, micros FROM balances")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?;
        for r in rows {
            let (account, micros) = r?;
            balances.insert(account, micros);
        }
    }

    // impressions
    let mut impressions = HashMap::new();
    {
        let mut stmt = conn.prepare("SELECT account, n FROM impressions")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?;
        for r in rows {
            let (account, n) = r?;
            impressions.insert(account, n as u64);
        }
    }

    // redemptions (ordered by numeric id so rdm_2 follows rdm_1)
    let mut redemptions = Vec::new();
    let mut max_redemption_id = 0u64;
    {
        let mut stmt = conn.prepare("SELECT id, amount_micros, rail FROM redemptions")?;
        let rows = stmt.query_map([], |row| {
            Ok(Redemption {
                id: row.get(0)?,
                amount_micros: row.get(1)?,
                rail: row.get(2)?,
            })
        })?;
        for r in rows {
            let red = r?;
            if let Some(n) = red.id.strip_prefix("rdm_").and_then(|s| s.parse::<u64>().ok()) {
                max_redemption_id = max_redemption_id.max(n);
            }
            redemptions.push(red);
        }
        redemptions.sort_by_key(|r| {
            r.id.strip_prefix("rdm_")
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(u64::MAX)
        });
    }

    let clicks = kv_get(conn, "clicks")? as u64;
    let accepted = kv_get(conn, "accepted")? as u64;
    let rejected = kv_get(conn, "rejected")? as u64;

    Ok(Loaded {
        devices,
        seen_event_ids,
        ledger,
        balances,
        impressions,
        clicks,
        accepted,
        rejected,
        redemptions,
        next_redemption_id: max_redemption_id + 1,
    })
}

// --------------------------------------------------------------------------
// Write-through helpers. Each is a no-op caller's responsibility: callers in
// main.rs guard with `if let Some(db) = ...`. Failures are logged, not panicked,
// so a transient DB error never takes down a request.
// --------------------------------------------------------------------------

fn kv_get(conn: &Connection, key: &str) -> rusqlite::Result<i64> {
    conn.query_row("SELECT v FROM kv WHERE k = ?1", params![key], |row| row.get(0))
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(0),
            other => Err(other),
        })
}

/// Set a counter in the kv table to an absolute value (upsert).
pub fn kv_set(conn: &Connection, key: &str, value: i64) {
    log_err(
        conn.execute(
            "INSERT INTO kv (k, v) VALUES (?1, ?2)
             ON CONFLICT(k) DO UPDATE SET v = excluded.v",
            params![key, value],
        ),
        "kv_set",
    );
}

/// Upsert a device row.
pub fn upsert_device(conn: &Connection, device_id: &str, dev: &DeviceRec) {
    let pubkey_hex = data_encoding::HEXLOWER.encode(dev.pubkey.as_bytes());
    let ctr_head = dev.ctr_head.map(|c| c as i64);
    log_err(
        conn.execute(
            "INSERT INTO devices (device_id, pubkey_hex, account_id, chain_head, ctr_head)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(device_id) DO UPDATE SET
               pubkey_hex = excluded.pubkey_hex,
               account_id = excluded.account_id,
               chain_head = excluded.chain_head,
               ctr_head   = excluded.ctr_head",
            params![device_id, pubkey_hex, dev.account_id, dev.chain_head, ctr_head],
        ),
        "upsert_device",
    );
}

/// Persist only the rolling chain/counter head of a device (after an accept).
pub fn update_device_head(conn: &Connection, device_id: &str, chain_head: &str, ctr_head: Option<u64>) {
    log_err(
        conn.execute(
            "UPDATE devices SET chain_head = ?2, ctr_head = ?3 WHERE device_id = ?1",
            params![device_id, chain_head, ctr_head.map(|c| c as i64)],
        ),
        "update_device_head",
    );
}

/// Ensure a balances row exists (defaults to 0). No-op if already present.
pub fn ensure_balance(conn: &Connection, account: &str) {
    log_err(
        conn.execute(
            "INSERT INTO balances (account, micros) VALUES (?1, 0)
             ON CONFLICT(account) DO NOTHING",
            params![account],
        ),
        "ensure_balance",
    );
}

/// Ensure an impressions row exists (defaults to 0). No-op if already present.
pub fn ensure_impressions(conn: &Connection, account: &str) {
    log_err(
        conn.execute(
            "INSERT INTO impressions (account, n) VALUES (?1, 0)
             ON CONFLICT(account) DO NOTHING",
            params![account],
        ),
        "ensure_impressions",
    );
}

/// Set the absolute balance for an account (upsert) — mirrors the in-memory map.
pub fn set_balance(conn: &Connection, account: &str, micros: i64) {
    log_err(
        conn.execute(
            "INSERT INTO balances (account, micros) VALUES (?1, ?2)
             ON CONFLICT(account) DO UPDATE SET micros = excluded.micros",
            params![account, micros],
        ),
        "set_balance",
    );
}

/// Set the absolute impression count for an account (upsert).
pub fn set_impressions(conn: &Connection, account: &str, n: u64) {
    log_err(
        conn.execute(
            "INSERT INTO impressions (account, n) VALUES (?1, ?2)
             ON CONFLICT(account) DO UPDATE SET n = excluded.n",
            params![account, n as i64],
        ),
        "set_impressions",
    );
}

/// Append one ledger entry. The table is insert-only.
pub fn insert_ledger(conn: &Connection, e: &LedgerEntry) {
    log_err(
        conn.execute(
            "INSERT INTO ledger (debit, credit, amount_micros, kind, reference)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![e.debit, e.credit, e.amount_micros, e.kind, e.reference],
        ),
        "insert_ledger",
    );
}

/// Record a seen event id (idempotent).
pub fn insert_seen_event(conn: &Connection, event_id: &str) {
    log_err(
        conn.execute(
            "INSERT INTO seen_events (event_id) VALUES (?1) ON CONFLICT(event_id) DO NOTHING",
            params![event_id],
        ),
        "insert_seen_event",
    );
}

/// Insert a redemption record.
pub fn insert_redemption(conn: &Connection, r: &Redemption) {
    log_err(
        conn.execute(
            "INSERT INTO redemptions (id, amount_micros, rail) VALUES (?1, ?2, ?3)",
            params![r.id, r.amount_micros, r.rail],
        ),
        "insert_redemption",
    );
}

// --------------------------------------------------------------------------
// Creatives (the durable serving pool). The in-memory `AppState::creatives`
// holds only the ACTIVE rows for serving; this table is the source of truth and
// retains inactive (deleted) rows for the admin "all creatives" view.
// --------------------------------------------------------------------------

/// Insert one creative row. The table is the durable serving pool.
pub fn insert_creative(conn: &Connection, c: &Creative, active: bool, created_unix: i64) {
    log_err(
        conn.execute(
            "INSERT INTO creatives
                (id, text, url, short_code, advertiser, campaign_name, active, created_unix)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
               text          = excluded.text,
               url           = excluded.url,
               short_code    = excluded.short_code,
               advertiser    = excluded.advertiser,
               campaign_name = excluded.campaign_name,
               active        = excluded.active",
            params![
                c.id,
                c.text,
                c.url,
                c.short_code,
                c.advertiser,
                c.campaign_name,
                active as i64,
                created_unix
            ],
        ),
        "insert_creative",
    );
}

/// Soft-delete a creative: mark it inactive so it leaves the serving pool but is
/// still listed in the admin "all creatives" view. Returns rows affected (0 if
/// the id is absent -> the handler maps that to 404).
pub fn delete_creative(conn: &Connection, id: &str) -> usize {
    match conn.execute(
        "UPDATE creatives SET active = 0 WHERE id = ?1 AND active = 1",
        params![id],
    ) {
        Ok(n) => n,
        Err(e) => {
            eprintln!("spnr-server: sqlite delete_creative failed: {e}");
            0
        }
    }
}

/// A loaded creative row plus its `active` flag (the in-memory pool drops the
/// flag; the admin view keeps it).
pub struct LoadedCreative {
    pub creative: Creative,
    pub active: bool,
}

/// Load ALL creatives (active and inactive), ordered by insertion time so the
/// admin view and the serving rotation are stable.
pub fn load_creatives(conn: &Connection) -> rusqlite::Result<Vec<LoadedCreative>> {
    let mut out = Vec::new();
    let mut stmt = conn.prepare(
        "SELECT id, text, url, short_code, advertiser, campaign_name, active
         FROM creatives ORDER BY created_unix, id",
    )?;
    let rows = stmt.query_map([], |row| {
        let active: i64 = row.get(6)?;
        Ok(LoadedCreative {
            creative: Creative {
                id: row.get(0)?,
                text: row.get(1)?,
                url: row.get(2)?,
                short_code: row.get(3)?,
                advertiser: row.get(4)?,
                campaign_name: row.get(5)?,
            },
            active: active != 0,
        })
    })?;
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

// --------------------------------------------------------------------------
// Device telemetry metadata (connection/device facts the daemon reports at
// /v1/register: ip, os, arch, hostname, version, email). NEVER work product.
// --------------------------------------------------------------------------

/// One device_meta row for the admin "Connected sessions" view. `impressions`
/// is NOT stored here — the handler joins it from the balances/impressions maps
/// (account_id = "acct:" + device_id).
pub struct DeviceMetaRow {
    pub device_id: String,
    pub ip: Option<String>,
    pub os: Option<String>,
    pub arch: Option<String>,
    pub hostname: Option<String>,
    pub version: Option<String>,
    pub email: Option<String>,
    pub first_seen: i64,
    pub last_seen: i64,
}

/// Upsert a device_meta row keyed by device_id. `first_seen` is set ONCE (the
/// existing value is preserved on conflict); `last_seen` always advances. Any
/// provided field overwrites; an absent field (None) keeps the prior value.
#[allow(clippy::too_many_arguments)]
pub fn upsert_device_meta(
    conn: &Connection,
    device_id: &str,
    ip: Option<&str>,
    os: Option<&str>,
    arch: Option<&str>,
    hostname: Option<&str>,
    version: Option<&str>,
    email: Option<&str>,
    now: i64,
) {
    log_err(
        conn.execute(
            "INSERT INTO device_meta
                (device_id, ip, os, arch, hostname, version, email, first_seen, last_seen)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
             ON CONFLICT(device_id) DO UPDATE SET
               ip        = COALESCE(excluded.ip, device_meta.ip),
               os        = COALESCE(excluded.os, device_meta.os),
               arch      = COALESCE(excluded.arch, device_meta.arch),
               hostname  = COALESCE(excluded.hostname, device_meta.hostname),
               version   = COALESCE(excluded.version, device_meta.version),
               email     = COALESCE(excluded.email, device_meta.email),
               last_seen = excluded.last_seen",
            params![device_id, ip, os, arch, hostname, version, email, now],
        ),
        "upsert_device_meta",
    );
}

/// List all device_meta rows for the admin "Connected sessions" view, most
/// recently seen first.
pub fn list_device_meta(conn: &Connection) -> rusqlite::Result<Vec<DeviceMetaRow>> {
    let mut out = Vec::new();
    let mut stmt = conn.prepare(
        "SELECT device_id, ip, os, arch, hostname, version, email, first_seen, last_seen
         FROM device_meta ORDER BY last_seen DESC, device_id",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(DeviceMetaRow {
            device_id: row.get(0)?,
            ip: row.get(1)?,
            os: row.get(2)?,
            arch: row.get(3)?,
            hostname: row.get(4)?,
            version: row.get(5)?,
            email: row.get(6)?,
            first_seen: row.get(7)?,
            last_seen: row.get(8)?,
        })
    })?;
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Decode an Ed25519 verifying key from lowercase hex (32 bytes).
fn decode_pubkey(hex: &str) -> Option<VerifyingKey> {
    let bytes = data_encoding::HEXLOWER.decode(hex.as_bytes()).ok()?;
    let arr: [u8; 32] = bytes.try_into().ok()?;
    VerifyingKey::from_bytes(&arr).ok()
}

/// Log a write-through failure without crashing the request path.
fn log_err(res: rusqlite::Result<usize>, what: &str) {
    if let Err(e) = res {
        eprintln!("spnr-server: sqlite {what} failed: {e}");
    }
}
