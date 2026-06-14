//! SAP/1 canonical event object and its closed-world schema (03-protocol-SAP1.md §4).
//!
//! The wire structs here are the ENTIRE protocol surface. There is no open map,
//! no `extra: HashMap`, no `serde_json::Value` passthrough. `deny_unknown_fields`
//! is set on the deserialize side so a batch with an unrecognized key is rejected
//! wholesale. This is the mechanical backbone of the content firewall (invariant 2):
//! work product cannot ride along because there is no free-form field.

use serde::{Deserialize, Serialize};

/// The genesis sentinel used as `prev` for a device's first event (§4.4).
pub const GENESIS_PREV: &str =
    "b3:0000000000000000000000000000000000000000000000000000000000000000";

/// Generate a fresh ULID for an event `id` (26-char Crockford base32, §4.2).
///
/// ULIDs are time-sortable: the high 48 bits are the millisecond timestamp, so
/// ids minted in ascending time order sort ascending lexicographically. This is
/// the idempotency key the server dedups on (stage 4, §7). Generated client-side
/// at event creation.
///
/// (Additive helper beyond the scaffolded re-exports; it adds no field to the
/// wire and changes no existing signature.)
pub fn new_id() -> String {
    ulid::Ulid::new().to_string()
}

/// The closed `type` enum (03-protocol-SAP1.md §4.3).
///
/// Adding a variant is an additive, backward-compatible change and does NOT bump
/// the major version; adding a *field* is always breaking (§1.2, closed-world §4.6).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EventType {
    /// The only revenue-bearing event: `n` impressions of `creative`.
    #[serde(rename = "imp")]
    Imp,
    /// UX-only local guess that a click happened. NEVER pays out (§8).
    #[serde(rename = "click_hint")]
    ClickHint,
    /// Rotation point; binds `session -> creative` on the server's view.
    #[serde(rename = "session_start")]
    SessionStart,
    /// Closes a session; triggers a queue flush.
    #[serde(rename = "session_end")]
    SessionEnd,
    /// Periodic roll-up of render-heartbeat counts; coarse liveness, not accrual.
    #[serde(rename = "heartbeat_summary")]
    HeartbeatSummary,
    /// Queue-integrity marker inserted on overflow (§9.2). No economic value.
    #[serde(rename = "gap")]
    Gap,
}

/// A single SAP/1 event — exactly these keys, no more, no fewer (§4.1/§4.2).
///
/// `creative`/`n` are conditional per `type`; an absent value is OMITTED on the
/// canonical wire, not `null`-emitted (§5), except where the spec specifies an
/// explicit `null`. Sender and receiver MUST agree on omit-vs-null per type or
/// the recomputed canonical bytes (and thus signature and `prev`) diverge.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Event {
    /// Protocol major version. Currently `1`.
    pub v: u8,
    /// Idempotency key (ULID, 26 chars, Crockford base32). Time-sortable.
    pub id: String,
    /// Per-device strictly-increasing monotonic counter; never reused.
    pub ctr: u64,
    /// `b3:` + hex BLAKE3 of the previous event's canonical bytes (§5).
    pub prev: String,
    /// Daemon-stamped wall-clock (unix seconds). Advisory only; never ordering truth.
    pub t: i64,
    /// One of the closed `type` set (§4.3).
    #[serde(rename = "type")]
    pub ty: EventType,
    /// `s:` + salted hash of the session id. Stable within a session, unlinkable
    /// across the salt boundary. Raw session id NEVER leaves the machine (§4.4).
    pub session: String,
    /// Creative id this event is attributed to. Required for `imp`/`click_hint`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub creative: Option<String>,
    /// For `imp`: impressions accrued this window. For `heartbeat_summary`: count
    /// of render heartbeats summarized. Absent for other types.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub n: Option<u32>,
}
