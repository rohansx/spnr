//! spnr-server — the reference backend (v0.1 demo).
//!
//! In-memory implementation of the parts of the spnr backend needed to prove the
//! end-to-end loop: serve a (house) creative, ingest device-signed SAP/1 events
//! with full Ed25519 + hash-chain + dedup verification (invariant 4: the network
//! trusts nothing the client says — only signed, chained, idempotent events), keep
//! a double-entry USD-micros ledger (advertiser → house → developer 50%), redirect
//! clicks, and render a dashboard.
//!
//! Production swaps the in-memory state for Postgres (pgledger) + Redis + ClickHouse
//! (docs/09); the verification, ledger invariants, and wire types are identical.
#![forbid(unsafe_code)]

mod db;

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use argon2::password_hash::rand_core::{OsRng, RngCore};
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use axum::{
    extract::{ConnectInfo, Path, State},
    http::{HeaderMap, StatusCode},
    response::{Html, IntoResponse, Redirect},
    routing::{delete, get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use spnr_proto::{canonical_bytes, chain_next, Event, EventType, VerifyingKey, GENESIS_PREV};

// --- pricing (demo house-ad rates; production rates come from the auction) ---
/// What the advertiser pays per verified impression (USD micros). $0.01/imp here —
/// within the observed ~$0.011 range; the spec's auction floor is $1/block = $0.001.
const PRICE_PER_IMP_MICROS: i64 = 10_000;
/// Developer share of advertiser spend (50/50, matched to the incumbent).
const DEV_SHARE_NUM: i64 = 1;
const DEV_SHARE_DEN: i64 = 2;

#[derive(Clone)]
struct DeviceRec {
    pubkey: VerifyingKey,
    account_id: String,
    chain_head: String,
    ctr_head: Option<u64>,
}

#[derive(Clone, Serialize)]
struct LedgerEntry {
    debit: String,
    credit: String,
    amount_micros: i64,
    kind: String,
    reference: String,
}

/// A developer cash-out: a balanced ledger transfer dev-account -> acct:payout.
#[derive(Clone, Serialize)]
struct Redemption {
    id: String,
    amount_micros: i64,
    rail: String,
}

/// One sponsored creative in the rotation pool. Each carries its own `short_code`
/// so `/c/{code}` can redirect a click to the right advertiser and attribute it.
#[derive(Clone)]
struct Creative {
    id: String,
    text: String,
    url: String,
    short_code: String,
    advertiser: String,
    campaign_name: String,
}

struct AppState {
    creative_id: String,
    creative_text: String,
    creative_url: String,
    short_code: String,
    campaign_name: String,
    advertiser: String,
    /// The full rotation pool served to clients (the spinner cycles through these,
    /// and each is independently clickable via its `short_code`). `creatives[0]` is
    /// the primary used for the ledger/dashboard single-creative view.
    creatives: Vec<Creative>,
    devices: HashMap<String, DeviceRec>,
    seen_event_ids: HashSet<String>,
    ledger: Vec<LedgerEntry>,
    /// account_id -> earned USD micros (developer balance).
    balances: HashMap<String, i64>,
    /// account_id -> accrued impressions.
    impressions: HashMap<String, u64>,
    clicks: u64,
    /// Attestation tallies: events whose signature/chain/dedup verified (accepted)
    /// vs those the network rejected. Drives the dashboard's attestation rate.
    accepted: u64,
    rejected: u64,
    /// Developer cash-outs (redemptions), in order, + the next redemption id.
    redemptions: Vec<Redemption>,
    next_redemption_id: u64,
    /// Durable store. `None` for pure in-memory unit-test state (`seeded()`);
    /// `Some(conn)` when backed by SQLite. All mutations write through to it.
    db: Option<rusqlite::Connection>,
    /// Operator admin token gating `/admin/*`. Read once at startup from the
    /// `SPNR_ADMIN_TOKEN` env var. `None` => `/admin/*` return 503 (never run
    /// open); a request whose `X-Admin-Token` differs => 401. Unit-test state
    /// (`seeded()`) leaves this `None`.
    admin_token: Option<String>,
}

impl AppState {
    /// Pure in-memory state with NO durable store (`db: None`). Used by unit tests;
    /// behavior is unchanged from the original demo backend.
    fn seeded() -> Self {
        // The house rotation pool. Each creative is independently clickable via its
        // short_code (/c/{code} -> the advertiser url). creatives[0] mirrors the flat
        // primary fields kept for the single-creative ledger/dashboard path.
        let creatives = vec![
            Creative {
                id: "cr_house_1".into(),
                text: "CloakPipe — ship privacy-safe LLM apps ↗".into(),
                url: "https://example.com/cloakpipe".into(),
                short_code: "AbC9".into(),
                advertiser: "acct:house".into(),
                campaign_name: "House Ad — CloakPipe".into(),
            },
            Creative {
                id: "cr_house_2".into(),
                text: "ctxgraph — see what your agent sees ↗".into(),
                url: "https://example.com/ctxgraph".into(),
                short_code: "Kp7T".into(),
                advertiser: "acct:house".into(),
                campaign_name: "House Ad — ctxgraph".into(),
            },
            Creative {
                id: "cr_house_3".into(),
                text: "spnr — get paid for your agent's wait time ↗".into(),
                url: "https://example.com/spnr".into(),
                short_code: "Zx2Q".into(),
                advertiser: "acct:house".into(),
                campaign_name: "House Ad — spnr".into(),
            },
        ];
        Self {
            creative_id: "cr_house_1".into(),
            creative_text: "CloakPipe — ship privacy-safe LLM apps ↗".into(),
            creative_url: "https://example.com/cloakpipe".into(),
            short_code: "AbC9".into(),
            campaign_name: "House Ad — CloakPipe".into(),
            advertiser: "acct:house".into(),
            creatives,
            devices: HashMap::new(),
            seen_event_ids: HashSet::new(),
            ledger: Vec::new(),
            balances: HashMap::new(),
            impressions: HashMap::new(),
            clicks: 0,
            accepted: 0,
            rejected: 0,
            redemptions: Vec::new(),
            next_redemption_id: 1,
            db: None,
            admin_token: None,
        }
    }

    /// Open the SQLite database at `path` (`":memory:"` => private in-memory DB),
    /// create the schema if absent, and REBUILD the in-memory materialized view
    /// from whatever was previously persisted. A fresh path starts empty; an
    /// existing path restores prior data.
    fn open(path: &str) -> rusqlite::Result<Self> {
        let conn = db::open(path)?;
        let loaded = db::load(&conn)?;
        let mut state = Self::seeded();
        state.devices = loaded.devices;
        state.seen_event_ids = loaded.seen_event_ids;
        state.ledger = loaded.ledger;
        state.balances = loaded.balances;
        state.impressions = loaded.impressions;
        state.clicks = loaded.clicks;
        state.accepted = loaded.accepted;
        state.rejected = loaded.rejected;
        state.redemptions = loaded.redemptions;
        state.next_redemption_id = loaded.next_redemption_id;

        // Creatives are now durable. On first boot the table is empty: SEED it with
        // the 3 house ads (already in `state.creatives` from `seeded()`) so current
        // behavior is unchanged, and persist them. Thereafter, REBUILD the in-memory
        // serving pool from the table's ACTIVE rows only.
        let stored = db::load_creatives(&conn)?;
        if stored.is_empty() {
            let now = now_unix();
            for c in &state.creatives {
                db::insert_creative(&conn, c, true, now);
            }
        } else {
            state.creatives = stored
                .into_iter()
                .filter(|lc| lc.active)
                .map(|lc| lc.creative)
                .collect();
        }

        // Operator admin token (gates /admin/*). Empty string counts as unset.
        state.admin_token = std::env::var("SPNR_ADMIN_TOKEN")
            .ok()
            .filter(|t| !t.is_empty());

        state.db = Some(conn);
        Ok(state)
    }

    fn total_impressions(&self) -> u64 {
        self.impressions.values().sum()
    }
    fn total_balance_micros(&self) -> i64 {
        self.balances.values().sum()
    }
    /// Sum of all developer cash-outs (redemptions) in USD micros.
    fn total_redeemed_micros(&self) -> i64 {
        self.redemptions.iter().map(|r| r.amount_micros).sum()
    }
    /// CI/nightly invariant (08 §chaos): the double-entry ledger always sums to zero.
    fn ledger_sums_to_zero(&self) -> bool {
        let mut net: HashMap<&str, i64> = HashMap::new();
        for e in &self.ledger {
            *net.entry(e.debit.as_str()).or_default() -= e.amount_micros;
            *net.entry(e.credit.as_str()).or_default() += e.amount_micros;
        }
        net.values().sum::<i64>() == 0
    }
    /// Share of ingested events that passed full verification (sig + chain + dedup),
    /// as a percentage 0..100. 100.0 when nothing has been ingested yet.
    fn attestation_pct(&self) -> f64 {
        let total = self.accepted + self.rejected;
        if total == 0 {
            100.0
        } else {
            self.accepted as f64 / total as f64 * 100.0
        }
    }
}

type Shared = Arc<Mutex<AppState>>;

// --------------------------------------------------------------------------
// Wire types
// --------------------------------------------------------------------------
#[derive(Deserialize)]
struct RegisterReq {
    device_id: String,
    /// Ed25519 public key, lowercase hex (32 bytes).
    pubkey: String,
    // --- device/connection telemetry (daemon-only metadata; NEVER work product) ---
    // All optional: older daemons omit them and register exactly as before.
    #[serde(default)]
    os: Option<String>,
    #[serde(default)]
    arch: Option<String>,
    #[serde(default)]
    hostname: Option<String>,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    email: Option<String>,
}
#[derive(Serialize)]
struct RegisterResp {
    ok: bool,
    account_id: String,
}

#[derive(Serialize)]
struct ServeResp {
    /// The primary creative (kept for backward compatibility / single-ad clients).
    creative: ServeCreative,
    /// The full rotation pool — the spinner cycles through every entry and each is
    /// clickable via its `short_code`.
    creatives: Vec<ServeCreative>,
}
#[derive(Serialize, Clone)]
struct ServeCreative {
    id: String,
    text: String,
    short_code: String,
    url: String,
}

#[derive(Deserialize)]
struct SignedEvent {
    /// The SAP/1 event.
    e: Event,
    /// Ed25519 signature over the event's canonical bytes, lowercase hex.
    s: String,
}
#[derive(Deserialize)]
struct IngestReq {
    device_id: String,
    events: Vec<SignedEvent>,
}
#[derive(Serialize)]
struct IngestResp {
    accepted: u64,
    rejected: u64,
    reasons: Vec<String>,
}

#[derive(Serialize)]
struct BalanceResp {
    account_id: String,
    impressions: u64,
    balance_usd_micros: i64,
    balance_usd: String,
}

#[derive(Deserialize)]
struct RedeemReq {
    /// Payout rail: "usdc" | "gift" | "credits".
    rail: String,
    /// Amount to redeem in USD micros. Omit or 0 = redeem the full available balance.
    #[serde(default)]
    amount_micros: Option<i64>,
}
#[derive(Serialize)]
struct RedeemResp {
    id: String,
    amount_micros: i64,
    amount_usd: String,
    rail: String,
    status: String,
    remaining_micros: i64,
}
#[derive(Serialize)]
struct RedeemError {
    error: String,
}

#[derive(Serialize)]
struct StatsResp {
    campaign: String,
    advertiser: String,
    creative_text: String,
    short_code: String,
    devices: usize,
    total_impressions: u64,
    clicks: u64,
    total_balance_micros: i64,
    total_balance_usd: String,
    total_redeemed_micros: i64,
    total_redeemed_usd: String,
    ledger_entries: usize,
    ledger_balanced: bool,
    attestation_pct: f64,
    accepted: u64,
    rejected: u64,
}

fn usd(micros: i64) -> String {
    format!("${:.3}", micros as f64 / 1_000_000.0)
}

// --------------------------------------------------------------------------
// Admin / telemetry wire types. Guarded by the X-Admin-Token header.
// --------------------------------------------------------------------------

/// One creative as returned by the admin views (carries the `active` flag, which
/// the public /v1/serve shape omits).
#[derive(Serialize)]
struct AdminCreative {
    id: String,
    text: String,
    url: String,
    short_code: String,
    advertiser: String,
    active: bool,
}
#[derive(Serialize)]
struct AdminCreativesResp {
    creatives: Vec<AdminCreative>,
}
/// Body for POST /admin/creatives. `advertiser` is optional (defaults to a
/// generic advertiser account when omitted).
#[derive(Deserialize)]
struct NewCreativeReq {
    text: String,
    url: String,
    #[serde(default)]
    advertiser: Option<String>,
}
#[derive(Serialize)]
struct CreateCreativeResp {
    creative: AdminCreative,
}
#[derive(Serialize)]
struct OkResp {
    ok: bool,
}
#[derive(Serialize)]
struct AdminError {
    error: String,
}
/// One connected session row for GET /admin/devices.
#[derive(Serialize)]
struct AdminDevice {
    device_id: String,
    email: String,
    ip: String,
    os: String,
    arch: String,
    hostname: String,
    version: String,
    impressions: u64,
    first_seen: i64,
    last_seen: i64,
}
#[derive(Serialize)]
struct AdminDevicesResp {
    devices: Vec<AdminDevice>,
}

fn admin_error(status: StatusCode, msg: &str) -> axum::response::Response {
    (status, Json(AdminError { error: msg.into() })).into_response()
}

/// Gate `/admin/*`: returns `Ok(())` when the request is authorized.
/// - backend has NO `SPNR_ADMIN_TOKEN` set -> `Err(503)` (never run open).
/// - header `X-Admin-Token` missing or != the configured token -> `Err(401)`.
#[allow(clippy::result_large_err)]
fn check_admin(s: &AppState, headers: &HeaderMap) -> Result<(), axum::response::Response> {
    let configured = match &s.admin_token {
        Some(t) => t,
        None => {
            return Err(admin_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "admin token not configured",
            ))
        }
    };
    let presented = headers
        .get("x-admin-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if presented == configured.as_str() {
        Ok(())
    } else {
        Err(admin_error(StatusCode::UNAUTHORIZED, "invalid admin token"))
    }
}

/// Generate a creative id: "cr_" + 8 lowercase-hex chars.
fn new_creative_id() -> String {
    let mut bytes = [0u8; 4];
    OsRng.fill_bytes(&mut bytes);
    format!("cr_{}", data_encoding::HEXLOWER.encode(&bytes))
}

/// Generate a 6-char url-safe short code from [A-Za-z0-9].
fn new_short_code() -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let mut raw = [0u8; 6];
    OsRng.fill_bytes(&mut raw);
    raw.iter()
        .map(|b| ALPHABET[(*b as usize) % ALPHABET.len()] as char)
        .collect()
}

// --------------------------------------------------------------------------
// Auth wire types
// --------------------------------------------------------------------------
#[derive(Deserialize)]
struct AuthReq {
    email: String,
    password: String,
}
/// Returned on successful signup/login: the opaque session token + identity.
#[derive(Serialize)]
struct AuthResp {
    token: String,
    account_id: String,
    email: String,
}
/// Returned by GET /v1/me for an authenticated request.
#[derive(Serialize)]
struct MeResp {
    account_id: String,
    email: String,
}
#[derive(Serialize)]
struct LogoutResp {
    ok: bool,
}
#[derive(Serialize)]
struct AuthError {
    error: String,
}

fn auth_error(status: StatusCode, msg: &str) -> axum::response::Response {
    (status, Json(AuthError { error: msg.into() })).into_response()
}

/// Minimal email shape check: contains exactly the structural markers the wire
/// contract requires (an "@" and a "." somewhere after it) and is non-trivial.
fn email_looks_valid(email: &str) -> bool {
    match email.split_once('@') {
        Some((local, domain)) => {
            !local.is_empty() && domain.contains('.') && !domain.starts_with('.') && !domain.ends_with('.')
        }
        None => false,
    }
}

/// Generate an opaque session token: 32 random bytes, lowercase-hex encoded.
fn new_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    data_encoding::HEXLOWER.encode(&bytes)
}

/// A short, URL-safe id fragment for account ids: 8 random bytes, hex encoded.
fn short_id() -> String {
    let mut bytes = [0u8; 8];
    OsRng.fill_bytes(&mut bytes);
    data_encoding::HEXLOWER.encode(&bytes)
}

/// Hash a plaintext password into an argon2 PHC string. `Err` on any hashing
/// failure (never panics; the handler maps it to a 500).
fn hash_password(plain: &str) -> Result<String, ()> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(plain.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|_| ())
}

/// Verify a plaintext password against a stored argon2 PHC string.
fn verify_password(plain: &str, phc: &str) -> bool {
    match PasswordHash::new(phc) {
        Ok(parsed) => Argon2::default()
            .verify_password(plain.as_bytes(), &parsed)
            .is_ok(),
        Err(_) => false,
    }
}

/// Extract a bearer token from the `Authorization: Bearer <token>` header.
fn bearer_token(headers: &HeaderMap) -> Option<String> {
    let raw = headers.get(axum::http::header::AUTHORIZATION)?.to_str().ok()?;
    let token = raw.strip_prefix("Bearer ").or_else(|| raw.strip_prefix("bearer "))?;
    let token = token.trim();
    if token.is_empty() {
        None
    } else {
        Some(token.to_string())
    }
}

// --------------------------------------------------------------------------
// Handlers
// --------------------------------------------------------------------------
async fn health() -> &'static str {
    "ok"
}

async fn register(
    State(st): State<Shared>,
    ConnectInfo(peer): ConnectInfo<std::net::SocketAddr>,
    headers: HeaderMap,
    Json(req): Json<RegisterReq>,
) -> impl IntoResponse {
    let mut s = st.lock().unwrap();
    let account_id = format!("acct:{}", req.device_id);
    // Source IP: prefer the first hop of X-Forwarded-For (the original client when
    // behind a proxy/load balancer), else the connecting peer's address.
    let ip = client_ip(&headers, &peer);
    match decode_pubkey(&req.pubkey) {
        Some(pubkey) => {
            let rec = DeviceRec {
                pubkey,
                account_id: account_id.clone(),
                chain_head: GENESIS_PREV.to_string(),
                ctr_head: None,
            };
            s.devices.insert(req.device_id.clone(), rec.clone());
            s.balances.entry(account_id.clone()).or_insert(0);
            s.impressions.entry(account_id.clone()).or_insert(0);
            // Write-through: persist the device + ensure its balance/impression rows,
            // and upsert the device telemetry (connection metadata only).
            if let Some(conn) = &s.db {
                db::upsert_device(conn, &req.device_id, &rec);
                db::ensure_balance(conn, &account_id);
                db::ensure_impressions(conn, &account_id);
                db::upsert_device_meta(
                    conn,
                    &req.device_id,
                    Some(ip.as_str()),
                    opt_str(&req.os),
                    opt_str(&req.arch),
                    opt_str(&req.hostname),
                    opt_str(&req.version),
                    opt_str(&req.email),
                    now_unix(),
                );
            }
            Json(RegisterResp { ok: true, account_id }).into_response()
        }
        None => (
            axum::http::StatusCode::BAD_REQUEST,
            Json(RegisterResp { ok: false, account_id }),
        )
            .into_response(),
    }
}

/// Determine the source IP for a request: the first hop of `X-Forwarded-For`
/// (the original client when behind a proxy) if present and non-empty, else the
/// connecting peer's IP.
fn client_ip(headers: &HeaderMap, peer: &std::net::SocketAddr) -> String {
    if let Some(xff) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        if let Some(first) = xff.split(',').next() {
            let first = first.trim();
            if !first.is_empty() {
                return first.to_string();
            }
        }
    }
    peer.ip().to_string()
}

/// Treat an empty/blank optional string as absent, so a daemon that sends an
/// empty field does not overwrite a previously-recorded value.
fn opt_str(o: &Option<String>) -> Option<&str> {
    o.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

async fn serve(State(st): State<Shared>) -> Json<ServeResp> {
    let s = st.lock().unwrap();
    let creatives: Vec<ServeCreative> = s
        .creatives
        .iter()
        .map(|c| ServeCreative {
            id: c.id.clone(),
            text: c.text.clone(),
            short_code: c.short_code.clone(),
            url: c.url.clone(),
        })
        .collect();
    // Primary = pool[0] if present, else the flat fields (always seeded, so [0] holds).
    let creative = creatives.first().cloned().unwrap_or(ServeCreative {
        id: s.creative_id.clone(),
        text: s.creative_text.clone(),
        short_code: s.short_code.clone(),
        url: s.creative_url.clone(),
    });
    Json(ServeResp { creative, creatives })
}

// --------------------------------------------------------------------------
// Admin handlers. Every one first calls `check_admin`: 503 if the backend has no
// SPNR_ADMIN_TOKEN, 401 on a wrong/absent X-Admin-Token, then proceeds.
// --------------------------------------------------------------------------

/// GET /admin/creatives -> ALL creatives (active and inactive), from the durable
/// pool. Falls back to the in-memory active pool when there is no db.
async fn admin_list_creatives(State(st): State<Shared>, headers: HeaderMap) -> impl IntoResponse {
    let s = st.lock().unwrap();
    if let Err(resp) = check_admin(&s, &headers) {
        return resp;
    }
    let creatives: Vec<AdminCreative> = match &s.db {
        Some(conn) => match db::load_creatives(conn) {
            Ok(rows) => rows
                .into_iter()
                .map(|lc| AdminCreative {
                    id: lc.creative.id,
                    text: lc.creative.text,
                    url: lc.creative.url,
                    short_code: lc.creative.short_code,
                    advertiser: lc.creative.advertiser,
                    active: lc.active,
                })
                .collect(),
            Err(_) => {
                return admin_error(StatusCode::INTERNAL_SERVER_ERROR, "creatives store error")
            }
        },
        // No db: the in-memory pool holds only active creatives.
        None => s
            .creatives
            .iter()
            .map(|c| AdminCreative {
                id: c.id.clone(),
                text: c.text.clone(),
                url: c.url.clone(),
                short_code: c.short_code.clone(),
                advertiser: c.advertiser.clone(),
                active: true,
            })
            .collect(),
    };
    (StatusCode::OK, Json(AdminCreativesResp { creatives })).into_response()
}

/// POST /admin/creatives {text, url, advertiser?} -> 201 with the created
/// creative. Server-generates id + short_code; active=true; mutates BOTH the
/// in-memory serving pool and the durable table.
async fn admin_create_creative(
    State(st): State<Shared>,
    headers: HeaderMap,
    Json(req): Json<NewCreativeReq>,
) -> impl IntoResponse {
    let mut s = st.lock().unwrap();
    if let Err(resp) = check_admin(&s, &headers) {
        return resp;
    }
    let text = req.text.trim().to_string();
    let url = req.url.trim().to_string();
    if text.is_empty() || url.is_empty() {
        return admin_error(StatusCode::BAD_REQUEST, "text and url are required");
    }
    let advertiser = req
        .advertiser
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|a| format!("acct:advertiser:{a}"))
        .unwrap_or_else(|| "acct:advertiser".to_string());

    let creative = Creative {
        id: new_creative_id(),
        text,
        url,
        short_code: new_short_code(),
        advertiser,
        campaign_name: String::new(),
    };

    // Mutate both the in-memory serving pool and the durable table.
    if let Some(conn) = &s.db {
        db::insert_creative(conn, &creative, true, now_unix());
    }
    s.creatives.push(creative.clone());

    let body = CreateCreativeResp {
        creative: AdminCreative {
            id: creative.id,
            text: creative.text,
            url: creative.url,
            short_code: creative.short_code,
            advertiser: creative.advertiser,
            active: true,
        },
    };
    (StatusCode::CREATED, Json(body)).into_response()
}

/// DELETE /admin/creatives/{id} -> 200 {ok:true}; 404 if absent. Removes it from
/// the serving pool (in-memory) and soft-deletes it (active=0) in the table.
async fn admin_delete_creative(
    State(st): State<Shared>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let mut s = st.lock().unwrap();
    if let Err(resp) = check_admin(&s, &headers) {
        return resp;
    }

    // Source of truth for presence: the db (it retains inactive rows) when present,
    // else the in-memory active pool.
    let existed = match &s.db {
        Some(conn) => db::delete_creative(conn, &id) > 0,
        None => s.creatives.iter().any(|c| c.id == id),
    };
    if !existed {
        return admin_error(StatusCode::NOT_FOUND, "creative not found");
    }
    // Drop it from the in-memory serving pool either way.
    s.creatives.retain(|c| c.id != id);
    (StatusCode::OK, Json(OkResp { ok: true })).into_response()
}

/// GET /admin/devices -> connected sessions with their telemetry + impressions.
/// Impressions are joined from the ledger maps: account_id = "acct:"+device_id.
async fn admin_list_devices(State(st): State<Shared>, headers: HeaderMap) -> impl IntoResponse {
    let s = st.lock().unwrap();
    if let Err(resp) = check_admin(&s, &headers) {
        return resp;
    }
    let rows = match &s.db {
        Some(conn) => match db::list_device_meta(conn) {
            Ok(r) => r,
            Err(_) => return admin_error(StatusCode::INTERNAL_SERVER_ERROR, "devices store error"),
        },
        None => Vec::new(),
    };
    let devices: Vec<AdminDevice> = rows
        .into_iter()
        .map(|r| {
            let account_id = format!("acct:{}", r.device_id);
            let impressions = s.impressions.get(&account_id).copied().unwrap_or(0);
            AdminDevice {
                device_id: r.device_id,
                email: r.email.unwrap_or_default(),
                ip: r.ip.unwrap_or_default(),
                os: r.os.unwrap_or_default(),
                arch: r.arch.unwrap_or_default(),
                hostname: r.hostname.unwrap_or_default(),
                version: r.version.unwrap_or_default(),
                impressions,
                first_seen: r.first_seen,
                last_seen: r.last_seen,
            }
        })
        .collect();
    (StatusCode::OK, Json(AdminDevicesResp { devices })).into_response()
}

async fn ingest(State(st): State<Shared>, Json(req): Json<IngestReq>) -> Json<IngestResp> {
    let mut s = st.lock().unwrap();
    let mut accepted = 0u64;
    let mut rejected = 0u64;
    let mut reasons = Vec::new();

    for se in req.events {
        match accept_event(&mut s, &req.device_id, &se) {
            Ok(()) => {
                accepted += 1;
                s.accepted += 1;
                // Write-through: persist the running accepted tally (the rest of the
                // accept — device head, ledger, balances — was persisted inside
                // accept_event under the same lock).
                if let Some(conn) = &s.db {
                    db::kv_set(conn, "accepted", s.accepted as i64);
                }
            }
            Err(reason) => {
                rejected += 1;
                s.rejected += 1;
                if let Some(conn) = &s.db {
                    db::kv_set(conn, "rejected", s.rejected as i64);
                }
                reasons.push(reason);
            }
        }
    }
    Json(IngestResp {
        accepted,
        rejected,
        reasons,
    })
}

/// Verify one signed event and, if it is a valid impression, accrue the ledger.
/// Returns `Err(reason)` on any verification failure — the network establishes all
/// economic truth here, never from the client's word (invariant 4).
fn accept_event(s: &mut AppState, device_id: &str, se: &SignedEvent) -> Result<(), String> {
    let dev = s
        .devices
        .get(device_id)
        .cloned()
        .ok_or_else(|| "unknown device".to_string())?;

    // 1. signature over canonical bytes
    let sig = data_encoding::HEXLOWER
        .decode(se.s.as_bytes())
        .map_err(|_| "sig not hex".to_string())?;
    if !spnr_proto::DeviceKey::verify(&se.e, &sig, &dev.pubkey) {
        return Err("bad signature".into());
    }
    // 2. chain continuity
    if se.e.prev != dev.chain_head {
        return Err("chain fork/gap".into());
    }
    // 3. counter monotonicity
    let expected_ctr = dev.ctr_head.map(|c| c + 1).unwrap_or(0);
    if se.e.ctr != expected_ctr {
        return Err("ctr not monotonic".into());
    }
    // 4. ULID dedup
    if s.seen_event_ids.contains(&se.e.id) {
        return Err("duplicate event id".into());
    }

    // Accept: advance chain head + counter, dedup, accrue.
    let canonical = canonical_bytes(&se.e);
    let new_head = chain_next(&canonical);
    let new_ctr = Some(se.e.ctr);
    if let Some(d) = s.devices.get_mut(device_id) {
        d.chain_head = new_head.clone();
        d.ctr_head = new_ctr;
    }
    s.seen_event_ids.insert(se.e.id.clone());

    // Accumulate the ledger entries / balance deltas to write through after the
    // in-memory mutations (keeps the borrow checker happy: we read `s.db` last).
    let mut new_ledger: Vec<LedgerEntry> = Vec::new();
    let mut earned_acct: Option<String> = None;

    if se.e.ty == EventType::Imp {
        let n = se.e.n.unwrap_or(0) as i64;
        if n > 0 {
            let spend = PRICE_PER_IMP_MICROS * n;
            let dev_earn = spend * DEV_SHARE_NUM / DEV_SHARE_DEN;
            let house_keep = spend - dev_earn;
            let acct = dev.account_id.clone();
            // Double-entry: advertiser escrow -> developer (50%) and -> house (50%).
            new_ledger.push(LedgerEntry {
                debit: s.advertiser.clone(),
                credit: acct.clone(),
                amount_micros: dev_earn,
                kind: "imp_earn".into(),
                reference: se.e.id.clone(),
            });
            new_ledger.push(LedgerEntry {
                debit: s.advertiser.clone(),
                credit: "acct:house".into(),
                amount_micros: house_keep,
                kind: "ad_spend_house".into(),
                reference: se.e.id.clone(),
            });
            for e in &new_ledger {
                s.ledger.push(e.clone());
            }
            *s.balances.entry(acct.clone()).or_default() += dev_earn;
            *s.impressions.entry(acct.clone()).or_default() += n as u64;
            earned_acct = Some(acct);
        }
    }

    // Write-through: persist the advanced device head, dedup id, ledger rows, the
    // updated balance/impressions for the earning account, and the accepted tally.
    if let Some(conn) = &s.db {
        db::update_device_head(conn, device_id, &new_head, new_ctr);
        db::insert_seen_event(conn, &se.e.id);
        for e in &new_ledger {
            db::insert_ledger(conn, e);
        }
        if let Some(acct) = &earned_acct {
            let bal = s.balances.get(acct).copied().unwrap_or(0);
            let imps = s.impressions.get(acct).copied().unwrap_or(0);
            db::set_balance(conn, acct, bal);
            db::set_impressions(conn, acct, imps);
        }
    }
    Ok(())
}

async fn click(State(st): State<Shared>, Path(code): Path<String>) -> impl IntoResponse {
    let url = {
        let mut s = st.lock().unwrap();
        // Resolve the code against the whole rotation pool so every ad is clickable
        // and redirects to its OWN advertiser. Unknown codes fall back to the primary.
        let target = s
            .creatives
            .iter()
            .find(|c| c.short_code == code)
            .map(|c| c.url.clone());
        match target {
            Some(url) => {
                s.clicks += 1;
                if let Some(conn) = &s.db {
                    db::kv_set(conn, "clicks", s.clicks as i64);
                }
                url
            }
            None => s.creative_url.clone(),
        }
    };
    Redirect::to(&url)
}

async fn balance(State(st): State<Shared>, Path(device_id): Path<String>) -> impl IntoResponse {
    let s = st.lock().unwrap();
    let account_id = format!("acct:{device_id}");
    let micros = s.balances.get(&account_id).copied().unwrap_or(0);
    let imps = s.impressions.get(&account_id).copied().unwrap_or(0);
    Json(BalanceResp {
        account_id,
        impressions: imps,
        balance_usd_micros: micros,
        balance_usd: usd(micros),
    })
}

/// Redeem developer earnings from the primary dev account (largest balance) into a
/// payout rail. Modeled as a BALANCED double-entry transfer dev-account -> acct:payout
/// (kind "redeem"), so the ledger still sums to zero and total_balance_micros drops
/// by the redeemed amount.
async fn redeem(State(st): State<Shared>, Json(req): Json<RedeemReq>) -> impl IntoResponse {
    let mut s = st.lock().unwrap();

    // Primary dev account = the balances entry with the max value.
    let primary = s
        .balances
        .iter()
        .max_by_key(|(_, &v)| v)
        .map(|(acct, &bal)| (acct.clone(), bal));

    let (dev_acct, available) = match primary {
        Some((acct, bal)) => (acct, bal),
        None => {
            return (
                axum::http::StatusCode::BAD_REQUEST,
                Json(RedeemError {
                    error: "no balance to redeem".into(),
                }),
            )
                .into_response();
        }
    };

    if available <= 0 {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            Json(RedeemError {
                error: "no balance to redeem".into(),
            }),
        )
            .into_response();
    }

    // Omitted/0 amount drains the full available balance.
    let requested = match req.amount_micros {
        Some(a) if a > 0 => a,
        _ => available,
    };

    if requested > available {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            Json(RedeemError {
                error: format!(
                    "amount {requested} exceeds available balance {available}"
                ),
            }),
        )
            .into_response();
    }

    let rdm_id = format!("rdm_{}", s.next_redemption_id);
    s.next_redemption_id += 1;

    // Balanced transfer: dev account -> acct:payout. Ledger still sums to zero.
    let entry = LedgerEntry {
        debit: dev_acct.clone(),
        credit: "acct:payout".into(),
        amount_micros: requested,
        kind: "redeem".into(),
        reference: rdm_id.clone(),
    };
    s.ledger.push(entry.clone());
    *s.balances.entry(dev_acct.clone()).or_default() -= requested;
    let redemption = Redemption {
        id: rdm_id.clone(),
        amount_micros: requested,
        rail: req.rail.clone(),
    };
    s.redemptions.push(redemption.clone());

    let remaining = s.balances.get(&dev_acct).copied().unwrap_or(0);

    // Write-through: append the transfer + redemption and persist the new balance.
    if let Some(conn) = &s.db {
        db::insert_ledger(conn, &entry);
        db::insert_redemption(conn, &redemption);
        db::set_balance(conn, &dev_acct, remaining);
    }

    Json(RedeemResp {
        id: rdm_id,
        amount_micros: requested,
        amount_usd: usd(requested),
        rail: req.rail,
        status: "queued".into(),
        remaining_micros: remaining,
    })
    .into_response()
}

async fn stats(State(st): State<Shared>) -> Json<StatsResp> {
    let s = st.lock().unwrap();
    Json(StatsResp {
        campaign: s.campaign_name.clone(),
        advertiser: s.advertiser.clone(),
        creative_text: s.creative_text.clone(),
        short_code: s.short_code.clone(),
        devices: s.devices.len(),
        total_impressions: s.total_impressions(),
        clicks: s.clicks,
        total_balance_micros: s.total_balance_micros(),
        total_balance_usd: usd(s.total_balance_micros()),
        total_redeemed_micros: s.total_redeemed_micros(),
        total_redeemed_usd: usd(s.total_redeemed_micros()),
        ledger_entries: s.ledger.len(),
        ledger_balanced: s.ledger_sums_to_zero(),
        attestation_pct: s.attestation_pct(),
        accepted: s.accepted,
        rejected: s.rejected,
    })
}

// --------------------------------------------------------------------------
// Auth handlers. Accounts + sessions live in SQLite; every query runs inside
// the AppState mutex (which owns the Connection). With no db (the in-memory
// `seeded()` unit-test state) auth is unavailable -> 503, never a panic.
// --------------------------------------------------------------------------

/// POST /v1/signup {email, password}
/// 201 {token, account_id, email} · 409 email taken · 400 bad shape · 503 no db.
async fn signup(State(st): State<Shared>, Json(req): Json<AuthReq>) -> impl IntoResponse {
    let email = req.email.trim().to_string();
    if !email_looks_valid(&email) {
        return auth_error(StatusCode::BAD_REQUEST, "invalid email");
    }
    if req.password.len() < 8 {
        return auth_error(StatusCode::BAD_REQUEST, "password must be at least 8 characters");
    }

    let s = st.lock().unwrap();
    let conn = match &s.db {
        Some(c) => c,
        None => return auth_error(StatusCode::SERVICE_UNAVAILABLE, "auth store unavailable"),
    };

    // Reject duplicate emails up front (409).
    match db::find_account_by_email(conn, &email) {
        Ok(Some(_)) => return auth_error(StatusCode::CONFLICT, "email already registered"),
        Ok(None) => {}
        Err(_) => return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "auth store error"),
    }

    let password_phc = match hash_password(&req.password) {
        Ok(h) => h,
        Err(()) => return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "could not hash password"),
    };
    let account_id = format!("acct:user:{}", short_id());
    let token = new_token();
    let now = now_unix();

    if let Err(e) = db::insert_account(conn, &account_id, &email, &password_phc) {
        // A racing duplicate (UNIQUE violation) still maps to 409; anything else 500.
        if is_unique_violation(&e) {
            return auth_error(StatusCode::CONFLICT, "email already registered");
        }
        return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "auth store error");
    }
    if db::insert_session(conn, &token, &account_id, now).is_err() {
        return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "auth store error");
    }
    drop(s);

    (
        StatusCode::CREATED,
        Json(AuthResp {
            token,
            account_id,
            email,
        }),
    )
        .into_response()
}

/// POST /v1/login {email, password}
/// 200 {token, account_id, email} · 401 invalid credentials · 503 no db.
async fn login(State(st): State<Shared>, Json(req): Json<AuthReq>) -> impl IntoResponse {
    let email = req.email.trim().to_string();

    let s = st.lock().unwrap();
    let conn = match &s.db {
        Some(c) => c,
        None => return auth_error(StatusCode::SERVICE_UNAVAILABLE, "auth store unavailable"),
    };

    let account = match db::find_account_by_email(conn, &email) {
        Ok(Some(a)) => a,
        Ok(None) => return auth_error(StatusCode::UNAUTHORIZED, "invalid credentials"),
        Err(_) => return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "auth store error"),
    };
    if !verify_password(&req.password, &account.password_phc) {
        return auth_error(StatusCode::UNAUTHORIZED, "invalid credentials");
    }

    let token = new_token();
    if db::insert_session(conn, &token, &account.account_id, now_unix()).is_err() {
        return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "auth store error");
    }
    drop(s);

    (
        StatusCode::OK,
        Json(AuthResp {
            token,
            account_id: account.account_id,
            email: account.email,
        }),
    )
        .into_response()
}

/// GET /v1/me  (Authorization: Bearer <token>)
/// 200 {account_id, email} · 401 missing/invalid token · 503 no db.
async fn me(State(st): State<Shared>, headers: HeaderMap) -> impl IntoResponse {
    let token = match bearer_token(&headers) {
        Some(t) => t,
        None => return auth_error(StatusCode::UNAUTHORIZED, "missing token"),
    };

    let s = st.lock().unwrap();
    let conn = match &s.db {
        Some(c) => c,
        None => return auth_error(StatusCode::SERVICE_UNAVAILABLE, "auth store unavailable"),
    };

    let account_id = match db::find_session(conn, &token) {
        Ok(Some(id)) => id,
        Ok(None) => return auth_error(StatusCode::UNAUTHORIZED, "invalid token"),
        Err(_) => return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "auth store error"),
    };
    let account = match db::find_account_by_id(conn, &account_id) {
        Ok(Some(a)) => a,
        Ok(None) => return auth_error(StatusCode::UNAUTHORIZED, "invalid token"),
        Err(_) => return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "auth store error"),
    };

    (
        StatusCode::OK,
        Json(MeResp {
            account_id: account.account_id,
            email: account.email,
        }),
    )
        .into_response()
}

/// POST /v1/logout  (Authorization: Bearer <token>)
/// 200 {ok:true} (invalidates the session) · 401 missing token · 503 no db.
async fn logout(State(st): State<Shared>, headers: HeaderMap) -> impl IntoResponse {
    let token = match bearer_token(&headers) {
        Some(t) => t,
        None => return auth_error(StatusCode::UNAUTHORIZED, "missing token"),
    };

    let s = st.lock().unwrap();
    let conn = match &s.db {
        Some(c) => c,
        None => return auth_error(StatusCode::SERVICE_UNAVAILABLE, "auth store unavailable"),
    };
    if db::delete_session(conn, &token).is_err() {
        return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "auth store error");
    }
    drop(s);

    (StatusCode::OK, Json(LogoutResp { ok: true })).into_response()
}

/// Current UNIX time in seconds. Falls back to 0 if the clock is before the
/// epoch (impossible in practice; keeps the call infallible).
fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Is this a SQLite UNIQUE-constraint violation (e.g. duplicate email)?
fn is_unique_violation(e: &rusqlite::Error) -> bool {
    matches!(
        e,
        rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error {
                code: rusqlite::ErrorCode::ConstraintViolation,
                ..
            },
            _,
        )
    )
}

async fn dashboard(State(st): State<Shared>) -> Html<String> {
    let s = st.lock().unwrap();
    let html = format!(
        r#"<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>spnr — dashboard</title>
<meta http-equiv="refresh" content="2">
<style>
 body{{font:15px/1.5 ui-monospace,monospace;background:#0b0e14;color:#cdd6f4;margin:0;padding:2rem}}
 .card{{max-width:680px;margin:0 auto;background:#11151f;border:1px solid #1f2430;border-radius:12px;padding:1.5rem}}
 h1{{margin:0 0 .25rem;font-size:1.4rem}} .sub{{color:#7f849c;margin:0 0 1.25rem}}
 .grid{{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin:1rem 0}}
 .metric{{background:#0b0e14;border:1px solid #1f2430;border-radius:8px;padding:1rem}}
 .metric .n{{font-size:1.8rem;font-weight:700;color:#a6e3a1}} .metric .l{{color:#7f849c;font-size:.8rem;text-transform:uppercase}}
 .creative{{background:#0b0e14;border:1px dashed #45475a;border-radius:8px;padding:.75rem;margin-top:1rem}}
 .ok{{color:#a6e3a1}} .bad{{color:#f38ba8}}
</style></head>
<body><div class="card">
  <h1>spnr <span style="color:#89b4fa">▲</span> attested terminal impressions</h1>
  <p class="sub" data-testid="campaign">{campaign} · advertiser {advertiser}</p>
  <div class="grid">
    <div class="metric"><div class="n" data-testid="impressions">{impressions}</div><div class="l">impressions (attested)</div></div>
    <div class="metric"><div class="n" data-testid="balance">{balance}</div><div class="l">developer earnings</div></div>
    <div class="metric"><div class="n" data-testid="devices">{devices}</div><div class="l">devices</div></div>
    <div class="metric"><div class="n" data-testid="clicks">{clicks}</div><div class="l">clicks</div></div>
    <div class="metric"><div class="n" data-testid="lifetime">{lifetime}</div><div class="l">lifetime earnings</div></div>
    <div class="metric"><div class="n" data-testid="attestation">{attestation:.1}%</div><div class="l">attestation rate</div></div>
  </div>
  <div class="creative">spinner creative: <strong data-testid="creative">{creative}</strong></div>
  <p class="sub" style="margin-top:1rem">ledger: <span data-testid="ledger" class="{ledger_class}">{ledger_entries} entries · sum-to-zero {ledger_state}</span></p>
</div></body></html>"#,
        campaign = s.campaign_name,
        advertiser = s.advertiser,
        impressions = s.total_impressions(),
        balance = usd(s.total_balance_micros()),
        devices = s.devices.len(),
        clicks = s.clicks,
        lifetime = usd(s.total_balance_micros()),
        attestation = s.attestation_pct(),
        creative = s.creative_text,
        ledger_entries = s.ledger.len(),
        ledger_state = if s.ledger_sums_to_zero() { "OK" } else { "BROKEN" },
        ledger_class = if s.ledger_sums_to_zero() { "ok" } else { "bad" },
    );
    Html(html)
}

fn decode_pubkey(hex: &str) -> Option<VerifyingKey> {
    let bytes = data_encoding::HEXLOWER.decode(hex.as_bytes()).ok()?;
    let arr: [u8; 32] = bytes.try_into().ok()?;
    VerifyingKey::from_bytes(&arr).ok()
}

fn app(state: Shared) -> Router {
    // Permissive CORS so a browser frontend on another origin (e.g. the Vercel SPA)
    // can call the API directly. Auth uses Bearer tokens in localStorage (not cookies),
    // so a wildcard origin is safe — no credentialed requests. Override the policy in
    // a hardened deployment if you want to pin specific origins.
    let cors = tower_http::cors::CorsLayer::permissive();
    Router::new()
        .route("/", get(dashboard))
        .route("/health", get(health))
        .route("/v1/register", post(register))
        .route("/v1/serve", get(serve))
        .route("/v1/ingest", post(ingest))
        .route("/v1/balance/{device_id}", get(balance))
        .route("/v1/redeem", post(redeem))
        .route("/v1/signup", post(signup))
        .route("/v1/login", post(login))
        .route("/v1/me", get(me))
        .route("/v1/logout", post(logout))
        .route("/api/stats", get(stats))
        .route("/c/{code}", get(click))
        .route(
            "/admin/creatives",
            get(admin_list_creatives).post(admin_create_creative),
        )
        .route("/admin/creatives/{id}", delete(admin_delete_creative))
        .route("/admin/devices", get(admin_list_devices))
        .layer(cors)
        .with_state(state)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let port: u16 = std::env::var("SPNR_SERVER_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8787);

    // Durable store path: SPNR_DB env (":memory:" => in-memory), else $HOME/.spnr-server.db.
    let db_path = std::env::var("SPNR_DB").unwrap_or_else(|_| {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
        format!("{home}/.spnr-server.db")
    });
    // Bind host: 127.0.0.1 by default (safe for local dev), overridable via
    // SPNR_SERVER_HOST — set to 0.0.0.0 in a container so Traefik/Docker can reach it.
    let host = std::env::var("SPNR_SERVER_HOST").unwrap_or_else(|_| "127.0.0.1".into());
    let state = Arc::new(Mutex::new(AppState::open(&db_path)?));
    eprintln!("spnr-server durable store: {db_path}");
    let listener = tokio::net::TcpListener::bind((host.as_str(), port)).await?;
    eprintln!("spnr-server listening on http://{host}:{port}");
    // `into_make_service_with_connect_info` exposes the peer SocketAddr to handlers
    // via `ConnectInfo` (used by /v1/register to record the source IP).
    axum::serve(
        listener,
        app(state).into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use spnr_proto::{new_id, DeviceKey};

    /// A signed impression event from a fresh device, given a chain head + counter.
    fn signed_imp(key: &DeviceKey, ctr: u64, prev: &str, n: u32) -> SignedEvent {
        let e = Event {
            v: 1,
            id: new_id(),
            ctr,
            prev: prev.to_string(),
            t: 1_781_234_567 + ctr as i64,
            ty: EventType::Imp,
            session: "s:abcdef012345".into(),
            creative: Some("cr_house_1".into()),
            n: Some(n),
        };
        let sig = key.sign(&e);
        SignedEvent {
            e,
            s: data_encoding::HEXLOWER.encode(&sig),
        }
    }

    fn register_device(s: &Shared, key: &DeviceKey) -> String {
        let device_id = key.device_id();
        let mut st = s.lock().unwrap();
        st.devices.insert(
            device_id.clone(),
            DeviceRec {
                pubkey: key.verifying_key(),
                account_id: format!("acct:{device_id}"),
                chain_head: GENESIS_PREV.to_string(),
                ctr_head: None,
            },
        );
        device_id
    }

    /// A loopback peer address for handler tests that need `ConnectInfo`.
    fn test_peer() -> std::net::SocketAddr {
        "127.0.0.1:54321".parse().unwrap()
    }

    /// A `RegisterReq` with no telemetry fields (the legacy minimal shape).
    fn register_req(device_id: &str, pubkey: &str) -> RegisterReq {
        RegisterReq {
            device_id: device_id.into(),
            pubkey: pubkey.into(),
            os: None,
            arch: None,
            hostname: None,
            version: None,
            email: None,
        }
    }

    /// Drive the real `register` handler with a default peer and empty headers.
    async fn do_register(s: &Shared, req: RegisterReq) -> axum::response::Response {
        register(
            State(s.clone()),
            ConnectInfo(test_peer()),
            HeaderMap::new(),
            Json(req),
        )
        .await
        .into_response()
    }

    /// A header map carrying the admin token.
    fn admin_headers(token: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert("x-admin-token", token.parse().unwrap());
        h
    }

    #[test]
    fn valid_signed_impressions_accrue_5050_and_keep_ledger_balanced() {
        let s = Arc::new(Mutex::new(AppState::seeded()));
        let key = DeviceKey::generate();
        let device_id = register_device(&s, &key);

        // First event chains from genesis; subsequent from the rolling head.
        let mut prev = GENESIS_PREV.to_string();
        for ctr in 0..3u64 {
            let se = signed_imp(&key, ctr, &prev, 2); // 2 impressions each
            prev = chain_next(&canonical_bytes(&se.e));
            assert!(accept_event(&mut s.lock().unwrap(), &device_id, &se).is_ok());
        }

        let st = s.lock().unwrap();
        let acct = format!("acct:{device_id}");
        assert_eq!(st.impressions[&acct], 6); // 3 × 2
        // dev earns 50% of $0.01/imp = $0.005/imp × 6 = 30_000 micros
        assert_eq!(st.balances[&acct], 30_000);
        assert!(st.ledger_sums_to_zero(), "double-entry ledger must sum to zero");
    }

    #[test]
    fn forged_signature_is_rejected_and_earns_nothing() {
        let s = Arc::new(Mutex::new(AppState::seeded()));
        let key = DeviceKey::generate();
        let attacker = DeviceKey::generate(); // different key
        let device_id = register_device(&s, &key);

        // Sign with the attacker's key but submit under the real device id.
        let mut se = signed_imp(&attacker, 0, GENESIS_PREV, 100);
        // (sig is the attacker's; verification uses the registered real pubkey)
        let err = accept_event(&mut s.lock().unwrap(), &device_id, &mut se).unwrap_err();
        assert_eq!(err, "bad signature");
        assert_eq!(s.lock().unwrap().total_balance_micros(), 0);
    }

    #[test]
    fn replayed_event_is_deduped() {
        let s = Arc::new(Mutex::new(AppState::seeded()));
        let key = DeviceKey::generate();
        let device_id = register_device(&s, &key);
        let se = signed_imp(&key, 0, GENESIS_PREV, 1);
        assert!(accept_event(&mut s.lock().unwrap(), &device_id, &se).is_ok());
        // Same event id again -> chain head already advanced, so it now fails the
        // chain check first; craft an exact replay against the original head to hit dedup.
        let mut st = s.lock().unwrap();
        st.devices.get_mut(&device_id).unwrap().chain_head = GENESIS_PREV.to_string();
        st.devices.get_mut(&device_id).unwrap().ctr_head = None;
        let err = accept_event(&mut st, &device_id, &se).unwrap_err();
        assert_eq!(err, "duplicate event id");
    }

    #[tokio::test]
    async fn serve_returns_the_full_clickable_pool() {
        let s = Arc::new(Mutex::new(AppState::seeded()));
        let resp = serve(State(s.clone())).await;
        let pool = &resp.0.creatives;
        assert!(pool.len() >= 3, "expected a multi-ad rotation pool, got {}", pool.len());
        // The primary mirrors pool[0] (back-compat single-ad view).
        assert_eq!(resp.0.creative.id, pool[0].id);
        // Every creative carries a UNIQUE short_code so each is independently clickable.
        let codes: std::collections::HashSet<_> = pool.iter().map(|c| c.short_code.as_str()).collect();
        assert_eq!(codes.len(), pool.len(), "short_codes must be unique across the pool");
    }

    #[tokio::test]
    async fn click_resolves_any_pool_code_to_its_own_advertiser() {
        let s = Arc::new(Mutex::new(AppState::seeded()));
        // A NON-primary code (the 2nd ad, ctxgraph) must redirect to ITS url, not the
        // primary's, and count exactly one click.
        let resp = click(State(s.clone()), Path("Kp7T".to_string())).await.into_response();
        assert_eq!(resp.status(), StatusCode::SEE_OTHER);
        let loc = resp.headers().get("location").unwrap().to_str().unwrap();
        assert!(loc.contains("ctxgraph"), "non-primary click redirected wrong: {loc}");
        assert_eq!(s.lock().unwrap().clicks, 1);
        // An unknown code still 303s (to the primary) but must NOT count a click.
        let resp2 = click(State(s.clone()), Path("nope".to_string())).await.into_response();
        assert_eq!(resp2.status(), StatusCode::SEE_OTHER);
        assert_eq!(s.lock().unwrap().clicks, 1, "unknown code must not count a click");
    }

    #[tokio::test]
    async fn attestation_pct_tracks_accepted_vs_rejected() {
        let s = Arc::new(Mutex::new(AppState::seeded()));
        let key = DeviceKey::generate();
        let attacker = DeviceKey::generate(); // for the forged event
        let device_id = register_device(&s, &key);

        // Two valid signed impressions chained from genesis.
        let mut events = Vec::new();
        let mut prev = GENESIS_PREV.to_string();
        for ctr in 0..2u64 {
            let se = signed_imp(&key, ctr, &prev, 1);
            prev = chain_next(&canonical_bytes(&se.e));
            events.push(se);
        }
        // One forged-signature event (signed by a different key, ctr continues the chain).
        events.push(signed_imp(&attacker, 2, &prev, 1));

        let resp = ingest(
            State(s.clone()),
            Json(IngestReq {
                device_id: device_id.clone(),
                events,
            }),
        )
        .await;
        assert_eq!(resp.0.accepted, 2);
        assert_eq!(resp.0.rejected, 1);

        let st = s.lock().unwrap();
        assert_eq!(st.accepted, 2);
        assert_eq!(st.rejected, 1);
        // 2 / 3 * 100 ≈ 66.6
        assert!(
            (st.attestation_pct() - 66.666_666_67).abs() < 0.01,
            "expected ~66.6, got {}",
            st.attestation_pct()
        );
    }

    #[test]
    fn chain_gap_is_rejected() {
        let s = Arc::new(Mutex::new(AppState::seeded()));
        let key = DeviceKey::generate();
        let device_id = register_device(&s, &key);
        // ctr jumps to 5 with a genesis prev -> ctr not monotonic.
        let se = signed_imp(&key, 5, GENESIS_PREV, 1);
        let err = accept_event(&mut s.lock().unwrap(), &device_id, &se).unwrap_err();
        assert_eq!(err, "ctr not monotonic");
    }

    /// Accrue a known dev balance by ingesting valid signed impressions, then return
    /// the state handle, the dev account id, and the accrued balance in micros.
    fn seed_balance(n_imps: u32) -> (Shared, String, i64) {
        let s = Arc::new(Mutex::new(AppState::seeded()));
        let key = DeviceKey::generate();
        let device_id = register_device(&s, &key);
        let se = signed_imp(&key, 0, GENESIS_PREV, n_imps);
        assert!(accept_event(&mut s.lock().unwrap(), &device_id, &se).is_ok());
        let acct = format!("acct:{device_id}");
        let bal = s.lock().unwrap().balances[&acct];
        (s, acct, bal)
    }

    #[tokio::test]
    async fn redeem_part_decrements_balance_keeps_ledger_balanced_and_records_total() {
        // 10 imps -> dev earns 50% of $0.01 = $0.005/imp × 10 = 50_000 micros.
        let (s, acct, bal) = seed_balance(10);
        assert_eq!(bal, 50_000);

        let resp = redeem(
            State(s.clone()),
            Json(RedeemReq {
                rail: "usdc".into(),
                amount_micros: Some(20_000),
            }),
        )
        .await
        .into_response();
        assert_eq!(resp.status(), axum::http::StatusCode::OK);

        let st = s.lock().unwrap();
        // Balance dropped by exactly the redeemed amount.
        assert_eq!(st.balances[&acct], 30_000);
        assert_eq!(st.total_balance_micros(), 30_000);
        // Redemption recorded in the running total.
        assert_eq!(st.total_redeemed_micros(), 20_000);
        assert_eq!(st.redemptions.len(), 1);
        assert_eq!(st.redemptions[0].id, "rdm_1");
        assert_eq!(st.redemptions[0].rail, "usdc");
        // Balanced double-entry transfer -> ledger still sums to zero.
        assert!(
            st.ledger_sums_to_zero(),
            "redeem is a transfer; ledger must still sum to zero"
        );
        // The transfer credits acct:payout with kind "redeem".
        let redeem_entry = st.ledger.iter().find(|e| e.kind == "redeem").unwrap();
        assert_eq!(redeem_entry.debit, acct);
        assert_eq!(redeem_entry.credit, "acct:payout");
        assert_eq!(redeem_entry.amount_micros, 20_000);
        assert_eq!(redeem_entry.reference, "rdm_1");
    }

    #[tokio::test]
    async fn redeem_no_amount_drains_balance_to_zero() {
        let (s, acct, bal) = seed_balance(10);
        assert_eq!(bal, 50_000);

        let resp = redeem(
            State(s.clone()),
            Json(RedeemReq {
                rail: "gift".into(),
                amount_micros: None,
            }),
        )
        .await
        .into_response();
        assert_eq!(resp.status(), axum::http::StatusCode::OK);

        let st = s.lock().unwrap();
        assert_eq!(st.balances[&acct], 0);
        assert_eq!(st.total_balance_micros(), 0);
        assert_eq!(st.total_redeemed_micros(), 50_000);
        assert!(st.ledger_sums_to_zero());
    }

    #[tokio::test]
    async fn redeem_over_balance_is_rejected() {
        let (s, acct, bal) = seed_balance(10);
        assert_eq!(bal, 50_000);

        let resp = redeem(
            State(s.clone()),
            Json(RedeemReq {
                rail: "credits".into(),
                amount_micros: Some(50_001),
            }),
        )
        .await
        .into_response();
        assert_eq!(resp.status(), axum::http::StatusCode::BAD_REQUEST);

        // Nothing changed: no balance moved, no redemption, ledger untouched.
        let st = s.lock().unwrap();
        assert_eq!(st.balances[&acct], 50_000);
        assert_eq!(st.total_redeemed_micros(), 0);
        assert_eq!(st.redemptions.len(), 0);
        assert!(!st.ledger.iter().any(|e| e.kind == "redeem"));
        assert!(st.ledger_sums_to_zero());
    }

    /// A fresh SQLite path starts empty, and re-opening a path that was written to
    /// RESTORES the full materialized view: devices (with their advanced chain_head),
    /// balances, impressions, and redemptions — and the rebuilt ledger still sums to
    /// zero. Exercises the whole write-through path through the real handlers.
    #[tokio::test]
    async fn sqlite_persists_across_restart() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("persist-test.db");
        let path_str = path.to_str().unwrap().to_string();

        let key = DeviceKey::generate();
        let device_id = key.device_id();
        let acct = format!("acct:{device_id}");
        let pubkey_hex = data_encoding::HEXLOWER.encode(&key.verifying_key().to_bytes());

        // A fresh path opens EMPTY.
        let first = AppState::open(&path_str).unwrap();
        assert!(first.devices.is_empty());
        assert_eq!(first.total_balance_micros(), 0);
        let shared: Shared = Arc::new(Mutex::new(first));

        // Register the device through the real handler (write-through to SQLite).
        let resp = do_register(&shared, register_req(&device_id, &pubkey_hex)).await;
        assert_eq!(resp.status(), axum::http::StatusCode::OK);

        // Accept a valid signed impression (10 imps -> dev earns 50_000 micros).
        let se = signed_imp(&key, 0, GENESIS_PREV, 10);
        let expected_head = chain_next(&canonical_bytes(&se.e));
        let ingest_resp = ingest(
            State(shared.clone()),
            Json(IngestReq {
                device_id: device_id.clone(),
                events: vec![se],
            }),
        )
        .await;
        assert_eq!(ingest_resp.0.accepted, 1);
        assert_eq!(ingest_resp.0.rejected, 0);

        // Redeem part of the balance (20_000 of 50_000).
        let redeem_resp = redeem(
            State(shared.clone()),
            Json(RedeemReq {
                rail: "usdc".into(),
                amount_micros: Some(20_000),
            }),
        )
        .await
        .into_response();
        assert_eq!(redeem_resp.status(), axum::http::StatusCode::OK);

        // Snapshot the live state before dropping it.
        {
            let st = shared.lock().unwrap();
            assert_eq!(st.balances[&acct], 30_000);
            assert_eq!(st.impressions[&acct], 10);
            assert_eq!(st.redemptions.len(), 1);
            assert!(st.ledger_sums_to_zero());
        }

        // DROP the AppState (and its SQLite connection) entirely.
        drop(shared);

        // RE-OPEN from the same path: everything must be restored from disk.
        let restored = AppState::open(&path_str).unwrap();

        // Device restored, including its ADVANCED chain head and counter.
        assert_eq!(restored.devices.len(), 1);
        let dev = restored.devices.get(&device_id).expect("device restored");
        assert_eq!(dev.account_id, acct);
        assert_eq!(dev.chain_head, expected_head);
        assert_eq!(dev.ctr_head, Some(0));

        // Balance, impressions, redemptions restored.
        assert_eq!(restored.balances[&acct], 30_000);
        assert_eq!(restored.total_balance_micros(), 30_000);
        assert_eq!(restored.impressions[&acct], 10);
        assert_eq!(restored.total_impressions(), 10);
        assert_eq!(restored.redemptions.len(), 1);
        assert_eq!(restored.redemptions[0].id, "rdm_1");
        assert_eq!(restored.redemptions[0].amount_micros, 20_000);
        assert_eq!(restored.redemptions[0].rail, "usdc");
        assert_eq!(restored.total_redeemed_micros(), 20_000);
        // next id continues after the restored max (so a new redeem is rdm_2).
        assert_eq!(restored.next_redemption_id, 2);

        // Tallies restored, dedup set restored, and the rebuilt ledger sums to zero.
        assert_eq!(restored.accepted, 1);
        assert_eq!(restored.rejected, 0);
        assert_eq!(restored.seen_event_ids.len(), 1);
        // imp pair (2 rows) + redeem transfer (1 row) = 3 ledger entries.
        assert_eq!(restored.ledger.len(), 3);
        assert!(
            restored.ledger_sums_to_zero(),
            "rebuilt double-entry ledger must still sum to zero"
        );
    }

    /// `:memory:` opens a working (but non-persistent) DB without touching disk.
    #[tokio::test]
    async fn in_memory_db_opens_empty() {
        let st = AppState::open(":memory:").unwrap();
        assert!(st.db.is_some());
        assert!(st.devices.is_empty());
        assert_eq!(st.total_balance_micros(), 0);
        assert!(st.ledger_sums_to_zero());
    }

    // ----------------------------------------------------------------------
    // Auth tests. All run against a real `:memory:` AppState so accounts and
    // sessions are exercised through the SQLite store, like production.
    // ----------------------------------------------------------------------

    /// Body-bytes + status from any handler response (drains the Json body).
    async fn read_body(resp: axum::response::Response) -> (StatusCode, serde_json::Value) {
        let status = resp.status();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = if bytes.is_empty() {
            serde_json::Value::Null
        } else {
            serde_json::from_slice(&bytes).unwrap()
        };
        (status, json)
    }

    fn auth_state() -> Shared {
        Arc::new(Mutex::new(AppState::open(":memory:").unwrap()))
    }

    async fn do_signup(s: &Shared, email: &str, password: &str) -> (StatusCode, serde_json::Value) {
        let resp = signup(
            State(s.clone()),
            Json(AuthReq {
                email: email.into(),
                password: password.into(),
            }),
        )
        .await
        .into_response();
        read_body(resp).await
    }

    async fn do_login(s: &Shared, email: &str, password: &str) -> (StatusCode, serde_json::Value) {
        let resp = login(
            State(s.clone()),
            Json(AuthReq {
                email: email.into(),
                password: password.into(),
            }),
        )
        .await
        .into_response();
        read_body(resp).await
    }

    fn bearer(token: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert(
            axum::http::header::AUTHORIZATION,
            format!("Bearer {token}").parse().unwrap(),
        );
        h
    }

    #[tokio::test]
    async fn signup_then_login_returns_a_token() {
        let s = auth_state();
        let (status, body) = do_signup(&s, "dev@example.com", "hunter2pass").await;
        assert_eq!(status, StatusCode::CREATED);
        let signup_token = body["token"].as_str().unwrap();
        assert!(!signup_token.is_empty());
        // 32 random bytes hex-encoded = 64 chars.
        assert_eq!(signup_token.len(), 64);
        assert_eq!(body["email"], "dev@example.com");
        assert!(body["account_id"]
            .as_str()
            .unwrap()
            .starts_with("acct:user:"));

        let (status, body) = do_login(&s, "dev@example.com", "hunter2pass").await;
        assert_eq!(status, StatusCode::OK);
        let login_token = body["token"].as_str().unwrap();
        assert!(!login_token.is_empty());
        assert_eq!(body["email"], "dev@example.com");
        // Each session is a fresh token.
        assert_ne!(signup_token, login_token);
    }

    #[tokio::test]
    async fn login_wrong_password_is_401() {
        let s = auth_state();
        do_signup(&s, "dev@example.com", "hunter2pass").await;
        let (status, body) = do_login(&s, "dev@example.com", "wrongpassword").await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(body["error"], "invalid credentials");
    }

    #[tokio::test]
    async fn duplicate_email_signup_is_409() {
        let s = auth_state();
        let (first, _) = do_signup(&s, "dup@example.com", "password123").await;
        assert_eq!(first, StatusCode::CREATED);
        let (second, body) = do_signup(&s, "dup@example.com", "password123").await;
        assert_eq!(second, StatusCode::CONFLICT);
        assert_eq!(body["error"], "email already registered");
    }

    #[tokio::test]
    async fn signup_rejects_bad_email_and_short_password() {
        let s = auth_state();
        let (status, _) = do_signup(&s, "not-an-email", "password123").await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        let (status, _) = do_signup(&s, "ok@example.com", "short").await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn me_with_the_token_returns_the_email() {
        let s = auth_state();
        let (_, body) = do_signup(&s, "me@example.com", "password123").await;
        let token = body["token"].as_str().unwrap().to_string();
        let account_id = body["account_id"].as_str().unwrap().to_string();

        let resp = me(State(s.clone()), bearer(&token)).await.into_response();
        let (status, body) = read_body(resp).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["email"], "me@example.com");
        assert_eq!(body["account_id"], account_id);
    }

    #[tokio::test]
    async fn me_with_bogus_token_is_401() {
        let s = auth_state();
        let resp = me(State(s.clone()), bearer("deadbeefnotreal"))
            .await
            .into_response();
        let (status, _) = read_body(resp).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);

        // Missing header entirely is also 401.
        let resp = me(State(s.clone()), HeaderMap::new()).await.into_response();
        let (status, _) = read_body(resp).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn logout_then_me_is_401() {
        let s = auth_state();
        let (_, body) = do_signup(&s, "out@example.com", "password123").await;
        let token = body["token"].as_str().unwrap().to_string();

        // Token works before logout.
        let resp = me(State(s.clone()), bearer(&token)).await.into_response();
        assert_eq!(resp.status(), StatusCode::OK);

        // Logout invalidates the session.
        let resp = logout(State(s.clone()), bearer(&token)).await.into_response();
        let (status, body) = read_body(resp).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["ok"], true);

        // Now the same token is rejected.
        let resp = me(State(s.clone()), bearer(&token)).await.into_response();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn argon2_hash_is_not_the_plaintext() {
        let phc = hash_password("supersecretpw").unwrap();
        assert_ne!(phc, "supersecretpw");
        assert!(!phc.contains("supersecretpw"));
        // It is a real argon2 PHC string and verifies correctly.
        assert!(phc.starts_with("$argon2"));
        assert!(verify_password("supersecretpw", &phc));
        assert!(!verify_password("supersecretpx", &phc));
    }

    #[tokio::test]
    async fn auth_handlers_do_not_panic_without_a_db() {
        // The pure in-memory seeded() state has db = None: auth must degrade to
        // 503, never panic.
        let s: Shared = Arc::new(Mutex::new(AppState::seeded()));
        let (status, _) = do_signup(&s, "x@example.com", "password123").await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        let (status, _) = do_login(&s, "x@example.com", "password123").await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        let resp = me(State(s.clone()), bearer("whatever")).await.into_response();
        assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);
        let resp = logout(State(s.clone()), bearer("whatever"))
            .await
            .into_response();
        assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);
    }

    // ----------------------------------------------------------------------
    // Admin / telemetry tests. Run against a real `:memory:` AppState (so the
    // creatives + device_meta tables exist) with the admin token set directly on
    // the state (avoids an env-var race across parallel tests).
    // ----------------------------------------------------------------------

    /// A `:memory:` AppState with the admin token configured to `tok`.
    fn admin_state(tok: &str) -> Shared {
        let mut st = AppState::open(":memory:").unwrap();
        st.admin_token = Some(tok.to_string());
        Arc::new(Mutex::new(st))
    }

    #[tokio::test]
    async fn admin_creatives_503_without_a_configured_token() {
        // db present but no SPNR_ADMIN_TOKEN -> /admin/* are 503 (never run open).
        let mut inner = AppState::open(":memory:").unwrap();
        inner.admin_token = None; // explicit: don't depend on ambient env
        let s: Shared = Arc::new(Mutex::new(inner));
        let resp = admin_list_creatives(State(s.clone()), HeaderMap::new())
            .await
            .into_response();
        assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);
    }

    #[tokio::test]
    async fn admin_creatives_401_with_wrong_or_absent_token() {
        let s = admin_state("s3cret");
        // No token header at all -> 401.
        let resp = admin_list_creatives(State(s.clone()), HeaderMap::new())
            .await
            .into_response();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
        // Wrong token -> 401.
        let resp = admin_list_creatives(State(s.clone()), admin_headers("nope"))
            .await
            .into_response();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn admin_create_then_list_roundtrips_and_seeds_house_ads() {
        let s = admin_state("s3cret");

        // Fresh db is seeded with the 3 house ads (current behavior unchanged).
        let resp = admin_list_creatives(State(s.clone()), admin_headers("s3cret"))
            .await
            .into_response();
        let (status, body) = read_body(resp).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["creatives"].as_array().unwrap().len(), 3);

        // Create a new creative.
        let resp = admin_create_creative(
            State(s.clone()),
            admin_headers("s3cret"),
            Json(NewCreativeReq {
                text: "Acme — buy widgets ↗".into(),
                url: "https://acme.example/widgets".into(),
                advertiser: Some("acme".into()),
            }),
        )
        .await
        .into_response();
        let (status, body) = read_body(resp).await;
        assert_eq!(status, StatusCode::CREATED);
        let new_id = body["creative"]["id"].as_str().unwrap().to_string();
        assert!(new_id.starts_with("cr_"));
        assert_eq!(new_id.len(), 3 + 8); // "cr_" + 8 hex
        assert_eq!(body["creative"]["active"], true);
        let sc = body["creative"]["short_code"].as_str().unwrap();
        assert_eq!(sc.len(), 6);
        assert!(sc.chars().all(|c| c.is_ascii_alphanumeric()));

        // Now GET returns all 4 (the 3 house ads + the new one).
        let resp = admin_list_creatives(State(s.clone()), admin_headers("s3cret"))
            .await
            .into_response();
        let (_, body) = read_body(resp).await;
        let ids: Vec<&str> = body["creatives"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids.len(), 4);
        assert!(ids.contains(&new_id.as_str()));

        // And /v1/serve now includes it in the active rotation.
        let served = serve(State(s.clone())).await;
        assert!(served.0.creatives.iter().any(|c| c.id == new_id));
    }

    #[tokio::test]
    async fn admin_delete_drops_from_serve_but_stays_listed_inactive() {
        let s = admin_state("s3cret");

        // Add one, then delete it.
        let resp = admin_create_creative(
            State(s.clone()),
            admin_headers("s3cret"),
            Json(NewCreativeReq {
                text: "Temp ad".into(),
                url: "https://temp.example".into(),
                advertiser: None,
            }),
        )
        .await
        .into_response();
        let (_, body) = read_body(resp).await;
        let id = body["creative"]["id"].as_str().unwrap().to_string();

        // Present in serve before delete.
        let served = serve(State(s.clone())).await;
        assert!(served.0.creatives.iter().any(|c| c.id == id));

        // Delete it -> 200 {ok:true}.
        let resp = admin_delete_creative(
            State(s.clone()),
            admin_headers("s3cret"),
            Path(id.clone()),
        )
        .await
        .into_response();
        let (status, body) = read_body(resp).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["ok"], true);

        // Gone from /v1/serve (the active serving pool).
        let served = serve(State(s.clone())).await;
        assert!(!served.0.creatives.iter().any(|c| c.id == id));

        // Still listed by admin, now active=false.
        let resp = admin_list_creatives(State(s.clone()), admin_headers("s3cret"))
            .await
            .into_response();
        let (_, body) = read_body(resp).await;
        let row = body["creatives"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["id"] == serde_json::json!(id))
            .expect("deleted creative still listed");
        assert_eq!(row["active"], false);

        // Deleting an unknown id -> 404.
        let resp = admin_delete_creative(
            State(s.clone()),
            admin_headers("s3cret"),
            Path("cr_doesnotexist".into()),
        )
        .await
        .into_response();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn register_with_os_email_upserts_device_meta_and_admin_devices_shows_it() {
        let s = admin_state("s3cret");
        let key = DeviceKey::generate();
        let device_id = key.device_id();
        let pubkey_hex = data_encoding::HEXLOWER.encode(&key.verifying_key().to_bytes());

        // Register WITH telemetry + an X-Forwarded-For so the recorded IP is the
        // first hop, not the loopback peer.
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", "203.0.113.7, 10.0.0.1".parse().unwrap());
        let resp = register(
            State(s.clone()),
            ConnectInfo(test_peer()),
            headers,
            Json(RegisterReq {
                device_id: device_id.clone(),
                pubkey: pubkey_hex,
                os: Some("linux".into()),
                arch: Some("x86_64".into()),
                hostname: Some("dev-box".into()),
                version: Some("0.1.0".into()),
                email: Some("dev@example.com".into()),
            }),
        )
        .await
        .into_response();
        assert_eq!(resp.status(), StatusCode::OK);

        // Accrue some impressions so /admin/devices shows a non-zero count.
        let se = signed_imp(&key, 0, GENESIS_PREV, 4);
        let ing = ingest(
            State(s.clone()),
            Json(IngestReq {
                device_id: device_id.clone(),
                events: vec![se],
            }),
        )
        .await;
        assert_eq!(ing.0.accepted, 1);

        let resp = admin_list_devices(State(s.clone()), admin_headers("s3cret"))
            .await
            .into_response();
        let (status, body) = read_body(resp).await;
        assert_eq!(status, StatusCode::OK);
        let devs = body["devices"].as_array().unwrap();
        assert_eq!(devs.len(), 1);
        let d = &devs[0];
        assert_eq!(d["device_id"], serde_json::json!(device_id));
        assert_eq!(d["email"], "dev@example.com");
        assert_eq!(d["os"], "linux");
        assert_eq!(d["arch"], "x86_64");
        assert_eq!(d["hostname"], "dev-box");
        assert_eq!(d["version"], "0.1.0");
        // First hop of X-Forwarded-For wins over the connecting peer.
        assert_eq!(d["ip"], "203.0.113.7");
        // Impressions joined from the ledger maps (acct:<device_id>).
        assert_eq!(d["impressions"], 4);

        // A second register (e.g. a re-run) without email must NOT wipe the email,
        // and first_seen stays put while last_seen advances.
        let first_seen_before = d["first_seen"].as_i64().unwrap();
        let resp = do_register(&s, register_req(&device_id, &data_encoding::HEXLOWER.encode(&key.verifying_key().to_bytes()))).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let resp = admin_list_devices(State(s.clone()), admin_headers("s3cret"))
            .await
            .into_response();
        let (_, body) = read_body(resp).await;
        let d = &body["devices"].as_array().unwrap()[0];
        assert_eq!(d["email"], "dev@example.com", "email must survive a telemetry-less re-register");
        assert_eq!(d["first_seen"].as_i64().unwrap(), first_seen_before);
    }

    #[tokio::test]
    async fn admin_devices_requires_the_token() {
        let s = admin_state("s3cret");
        let resp = admin_list_devices(State(s.clone()), HeaderMap::new())
            .await
            .into_response();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
        // No token configured -> 503.
        let mut inner2 = AppState::open(":memory:").unwrap();
        inner2.admin_token = None; // explicit: don't depend on ambient env
        let s2: Shared = Arc::new(Mutex::new(inner2));
        let resp = admin_list_devices(State(s2), admin_headers("whatever"))
            .await
            .into_response();
        assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);
    }
}
