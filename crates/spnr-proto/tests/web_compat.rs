//! Cross-language compatibility with the browser extension (extension/).
//!
//! The Chrome extension re-implements SAP/1 canonical encoding + the BLAKE3 chain in
//! TypeScript (extension/src/worker/sap1.ts). The browser and this crate MUST agree
//! byte-for-byte, or browser-signed impressions fail `accept_event` server-side.
//!
//! These tests pin the SAME fixture event, canonical bytes, and chain digest that the
//! JS test asserts (extension/test/sap1.test.mjs). Both suites equal the identical
//! literals ⇒ the two serializers agree without needing a live cross-process handshake.
//! If you change either side, update both fixtures together.

use spnr_proto::{canonical_bytes, chain_next, Event, EventType, GENESIS_PREV};

/// The shared fixture — field-for-field identical to FIXTURE_EVENT in the JS test.
fn fixture() -> Event {
    Event {
        v: 1,
        id: "01HZXK8B7T0000000000000001".to_string(),
        ctr: 0,
        prev: GENESIS_PREV.to_string(),
        t: 1_781_234_567,
        ty: EventType::Imp,
        session: "s:deadbeef".to_string(),
        creative: Some("cr_house_1".to_string()),
        n: Some(1),
    }
}

/// The exact RFC 8785 canonical form both serializers must produce.
const EXPECTED_CANONICAL: &str = concat!(
    r#"{"creative":"cr_house_1","ctr":0,"id":"01HZXK8B7T0000000000000001","n":1,"#,
    r#""prev":"b3:0000000000000000000000000000000000000000000000000000000000000000","#,
    r#""session":"s:deadbeef","t":1781234567,"type":"imp","v":1}"#
);

/// The chain digest of the fixture, captured from the passing JS test run.
const EXPECTED_DIGEST: &str = "b3:7e58eafdc5fae926d1260a33378108d4cecde98521faf65fd0b810078ec30e74";

#[test]
fn canonical_bytes_match_the_browser_fixture() {
    let bytes = canonical_bytes(&fixture());
    let s = String::from_utf8(bytes).expect("canonical bytes are UTF-8");
    assert_eq!(
        s, EXPECTED_CANONICAL,
        "Rust serde_jcs must byte-match the extension's JCS encoder"
    );
}

#[test]
fn chain_digest_matches_the_browser_fixture() {
    let digest = chain_next(&canonical_bytes(&fixture()));
    assert_eq!(
        digest, EXPECTED_DIGEST,
        "Rust BLAKE3 chain must match the extension's hash-wasm BLAKE3"
    );
}
