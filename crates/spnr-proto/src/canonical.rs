//! RFC 8785 JSON Canonicalization Scheme (JCS) encoding for signing (§5).
//!
//! Signatures are computed over CANONICAL bytes, not arbitrary pretty-printed
//! JSON: UTF-8, keys sorted by code point, no insignificant whitespace, canonical
//! number formatting. This is a SEPARATE code path from the settings.json
//! round-trip (which uses `serde_json` `preserve_order`). The two serializers
//! never share a code path (09 §4, two-serializer rule).
//!
//! Determinism is load-bearing: the server recomputes `canonical_bytes(event)` to
//! verify the signature AND to recompute the digest the next event's `prev` must
//! match. Any encoder nondeterminism breaks chain continuity for the whole device.

use crate::event::Event;

/// Produce the RFC 8785 canonical bytes of an event for signing and chaining (§5).
///
/// Uses `serde_jcs` (JSON Canonicalization Scheme): UTF-8, object keys sorted by
/// code point, no insignificant whitespace, canonical number formatting. This is
/// the ONLY serializer used for the signing/chaining path — it does NOT depend on
/// `serde_json`'s in-memory key order (which the workspace builds with
/// `preserve_order`), so the bytes are deterministic regardless of struct field
/// declaration order (09 §4, two-serializer rule).
///
/// `serde_jcs::to_vec` only fails if the value cannot be represented as JSON. The
/// closed-world [`Event`] struct is always representable (all fields are JSON
/// scalars/strings), so serialization cannot fail in practice; we surface any
/// theoretical failure as an empty `Vec` rather than panicking, honoring the
/// never-panic-on-the-hot-path invariant (#1). An empty canonical buffer would
/// produce a signature that simply fails verification server-side — fail quiet,
/// fail stock (#6), never crash the host.
pub fn canonical_bytes(event: &Event) -> Vec<u8> {
    serde_jcs::to_vec(event).unwrap_or_default()
}
