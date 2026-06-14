//! BLAKE3 per-device hash chain (§4.4 / §5).
//!
//! `prev` (event k) = "b3:" + hex( BLAKE3( canonical_bytes(event k-1) ) ).
//! The first event uses the genesis sentinel [`crate::event::GENESIS_PREV`].

/// Compute the `prev` value for the NEXT event from the previous event's
/// canonical bytes: `"b3:" + hex(blake3(prev_canonical))`.
///
/// `blake3::hash` returns a 32-byte digest; hex-lowercase-encoded that is 64
/// chars, matching the genesis sentinel width
/// ([`crate::event::GENESIS_PREV`]). Pure, total, allocation-only — never panics.
pub fn chain_next(prev_canonical: &[u8]) -> String {
    let digest = blake3::hash(prev_canonical);
    let mut out = String::with_capacity(3 + 64);
    out.push_str("b3:");
    out.push_str(&data_encoding::HEXLOWER.encode(digest.as_bytes()));
    out
}
