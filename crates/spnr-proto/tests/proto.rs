//! SAP/1 protocol conformance tests for `spnr-proto`.
//!
//! Covers the load-bearing guarantees from 03-protocol-SAP1.md / 05-fraud-attestation.md:
//! canonical-byte determinism (signatures and the hash chain depend on it),
//! sign→verify roundtrip + tamper detection, BLAKE3 chain continuity,
//! ULID monotonic-ish time-sortability, SocketMsg codec roundtrip, and the
//! content-firewall negative tests (invariant 2: no content field on the wire).

use spnr_proto::{
    canonical_bytes, chain_next, new_id, DeviceKey, Event, EventType, SocketCmd, SocketMsg,
    GENESIS_PREV,
};

/// A representative `imp` event (the only revenue-bearing type).
fn sample_imp(ctr: u64, prev: &str) -> Event {
    Event {
        v: 1,
        id: "01J9Z3K8Q0000000000000000A".to_string(),
        ctr,
        prev: prev.to_string(),
        t: 1_781_234_567,
        ty: EventType::Imp,
        session: "s:7c1f9a00".to_string(),
        creative: Some("cr_9k2".to_string()),
        n: Some(12),
    }
}

// --------------------------------------------------------------------------
// Canonical encoding (RFC 8785) — determinism is load-bearing (§5).
// --------------------------------------------------------------------------

#[test]
fn canonical_is_deterministic_same_event_same_bytes() {
    let e = sample_imp(48211, GENESIS_PREV);
    let a = canonical_bytes(&e);
    let b = canonical_bytes(&e.clone());
    assert_eq!(a, b, "same event must canonicalize to identical bytes");
    assert!(!a.is_empty(), "canonical bytes must be non-empty");
}

#[test]
fn canonical_keys_are_code_point_sorted() {
    // JCS sorts keys by code point. The §5 worked example states the on-wire
    // order is: creative, ctr, id, n, prev, session, t, type, v.
    let e = sample_imp(48211, GENESIS_PREV);
    let s = String::from_utf8(canonical_bytes(&e)).unwrap();
    let order = [
        "\"creative\"",
        "\"ctr\"",
        "\"id\"",
        "\"n\"",
        "\"prev\"",
        "\"session\"",
        "\"t\"",
        "\"type\"",
        "\"v\"",
    ];
    let mut last = 0usize;
    for key in order {
        let pos = s.find(key).unwrap_or_else(|| panic!("missing key {key} in {s}"));
        assert!(pos >= last, "key {key} out of code-point order in {s}");
        last = pos;
    }
    // No insignificant whitespace.
    assert!(!s.contains(": "), "JCS must not emit space after colon: {s}");
    assert!(!s.contains(", "), "JCS must not emit space after comma: {s}");
    assert!(!s.contains('\n'), "JCS must not emit newlines: {s}");
}

#[test]
fn canonical_is_independent_of_struct_field_order() {
    // The workspace builds serde_json with `preserve_order`, so a value built
    // from a string with shuffled keys could carry that order in memory. The JCS
    // path must IGNORE it and re-sort. We assert two logically-equal events with
    // different in-memory provenance yield byte-identical canonical output.
    let e1 = sample_imp(7, GENESIS_PREV);
    // Construct the "same" event again independently (different allocation path).
    let e2 = Event {
        creative: Some("cr_9k2".to_string()),
        n: Some(12),
        session: "s:7c1f9a00".to_string(),
        ty: EventType::Imp,
        t: 1_781_234_567,
        prev: GENESIS_PREV.to_string(),
        ctr: 7,
        id: "01J9Z3K8Q0000000000000000A".to_string(),
        v: 1,
    };
    assert_eq!(canonical_bytes(&e1), canonical_bytes(&e2));
}

#[test]
fn canonical_omits_absent_optional_fields() {
    // session_start carries neither creative nor n; they must be OMITTED, not
    // null-emitted (§5). Omit-vs-null disagreement diverges the signature.
    let e = Event {
        v: 1,
        id: new_id(),
        ctr: 1,
        prev: GENESIS_PREV.to_string(),
        t: 1_781_234_567,
        ty: EventType::SessionStart,
        session: "s:abcd".to_string(),
        creative: None,
        n: None,
    };
    let s = String::from_utf8(canonical_bytes(&e)).unwrap();
    assert!(!s.contains("creative"), "absent creative must be omitted: {s}");
    assert!(!s.contains("\"n\""), "absent n must be omitted: {s}");
    assert!(!s.contains("null"), "no null should appear: {s}");
}

// --------------------------------------------------------------------------
// Device key: generation, device_id, sign→verify, tamper detection.
// --------------------------------------------------------------------------

#[test]
fn device_id_is_16_lowercase_base32_chars() {
    let k = DeviceKey::generate();
    let id = k.device_id();
    assert_eq!(id.len(), 16, "10 bytes base32 → 16 chars, got {id}");
    assert!(
        id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()),
        "device_id must be lowercase base32 no-pad: {id}"
    );
    assert!(!id.contains('='), "no padding allowed: {id}");
}

#[test]
fn device_id_is_stable_for_a_key() {
    let k = DeviceKey::generate();
    assert_eq!(k.device_id(), k.device_id());
}

#[test]
fn sign_then_verify_roundtrip() {
    let k = DeviceKey::generate();
    let e = sample_imp(100, GENESIS_PREV);
    let sig = k.sign(&e);
    assert_eq!(sig.len(), 64, "Ed25519 signature is 64 bytes");
    assert!(
        DeviceKey::verify(&e, &sig, &k.verifying_key()),
        "valid signature must verify"
    );
}

#[test]
fn verify_rejects_tampered_event() {
    let k = DeviceKey::generate();
    let e = sample_imp(100, GENESIS_PREV);
    let sig = k.sign(&e);

    // Tamper with n (the billable count). Signature must no longer verify.
    let mut tampered = e.clone();
    tampered.n = Some(9999);
    assert!(
        !DeviceKey::verify(&tampered, &sig, &k.verifying_key()),
        "tampered n must fail verification"
    );

    // Tamper with the chain pointer.
    let mut forked = e.clone();
    forked.prev = chain_next(b"different");
    assert!(
        !DeviceKey::verify(&forked, &sig, &k.verifying_key()),
        "tampered prev must fail verification"
    );
}

#[test]
fn verify_rejects_wrong_key() {
    let signer = DeviceKey::generate();
    let other = DeviceKey::generate();
    let e = sample_imp(100, GENESIS_PREV);
    let sig = signer.sign(&e);
    assert!(
        !DeviceKey::verify(&e, &sig, &other.verifying_key()),
        "signature must not verify under a different device key"
    );
}

#[test]
fn verify_rejects_malformed_signature_without_panic() {
    let k = DeviceKey::generate();
    let e = sample_imp(1, GENESIS_PREV);
    // Wrong length, empty, and garbage — all must return false, never panic.
    assert!(!DeviceKey::verify(&e, &[], &k.verifying_key()));
    assert!(!DeviceKey::verify(&e, &[0u8; 10], &k.verifying_key()));
    assert!(!DeviceKey::verify(&e, &[0xFF; 64], &k.verifying_key()));
}

#[test]
fn key_seed_roundtrip_preserves_identity() {
    let k = DeviceKey::generate();
    let seed = k.to_seed();
    let restored = DeviceKey::from_seed(&seed);
    assert_eq!(k.device_id(), restored.device_id());
    // A signature from the restored key verifies under the original's vk.
    let e = sample_imp(5, GENESIS_PREV);
    let sig = restored.sign(&e);
    assert!(DeviceKey::verify(&e, &sig, &k.verifying_key()));
}

// --------------------------------------------------------------------------
// Hash chain (§4.4 / §5): "b3:" + hex(blake3(prev canonical)).
// --------------------------------------------------------------------------

#[test]
fn chain_next_format_and_width() {
    let d = chain_next(b"hello");
    assert!(d.starts_with("b3:"), "must be b3-prefixed: {d}");
    assert_eq!(d.len(), GENESIS_PREV.len(), "must match genesis width");
    assert_eq!(d.len(), 3 + 64, "b3: + 64 hex chars");
    assert!(
        d[3..].chars().all(|c| c.is_ascii_hexdigit() && !c.is_uppercase()),
        "digest must be lowercase hex: {d}"
    );
}

#[test]
fn chain_next_is_deterministic_and_input_sensitive() {
    assert_eq!(chain_next(b"abc"), chain_next(b"abc"));
    assert_ne!(chain_next(b"abc"), chain_next(b"abd"));
}

#[test]
fn chain_continuity_across_three_events() {
    // event[0] uses GENESIS; event[k].prev == chain_next(canonical(event[k-1])).
    let e0 = sample_imp(1, GENESIS_PREV);
    let prev1 = chain_next(&canonical_bytes(&e0));
    let e1 = sample_imp(2, &prev1);
    let prev2 = chain_next(&canonical_bytes(&e1));
    let e2 = sample_imp(3, &prev2);

    // Each event's prev is the digest of the actual previous canonical bytes.
    assert_eq!(e1.prev, chain_next(&canonical_bytes(&e0)));
    assert_eq!(e2.prev, chain_next(&canonical_bytes(&e1)));
    // A fork (editing event[1]) breaks event[2]'s expected prev.
    let mut edited1 = e1.clone();
    edited1.n = Some(1);
    assert_ne!(
        e2.prev,
        chain_next(&canonical_bytes(&edited1)),
        "editing a chained event must break continuity"
    );
}

// --------------------------------------------------------------------------
// ULID ids (§4.2): 26 chars, time-sortable (monotonic-ish).
// --------------------------------------------------------------------------

#[test]
fn new_id_is_26_char_crockford() {
    let id = new_id();
    assert_eq!(id.len(), 26, "ULID is 26 chars, got {id}");
    // Crockford base32 excludes I, L, O, U.
    assert!(
        id.chars().all(|c| {
            c.is_ascii_digit() || (c.is_ascii_uppercase() && !"ILOU".contains(c))
        }),
        "ULID must be Crockford base32 uppercase: {id}"
    );
}

#[test]
fn new_id_is_time_sortable_monotonic_ish() {
    // ULIDs minted in time order sort ascending lexicographically (the high bits
    // are the ms timestamp). Across a small sleep the later id must not sort
    // before the earlier one.
    let a = new_id();
    std::thread::sleep(std::time::Duration::from_millis(2));
    let b = new_id();
    assert!(a <= b, "later ULID must sort >= earlier: {a} vs {b}");
    // Uniqueness within the same ms (random low bits differ).
    let many: std::collections::HashSet<String> = (0..1000).map(|_| new_id()).collect();
    assert_eq!(many.len(), 1000, "ULIDs must be unique");
}

// --------------------------------------------------------------------------
// SocketMsg codec: roundtrip + robustness (invariant 1: never panic on input).
// --------------------------------------------------------------------------

#[test]
fn socket_roundtrip_all_variants() {
    let cases = vec![
        SocketMsg::Hook {
            event_name: "UserPromptSubmit".to_string(),
            session_id: "abc-123-session".to_string(),
        },
        SocketMsg::Hook {
            event_name: "Stop".to_string(),
            session_id: String::new(), // empty session id still roundtrips
        },
        SocketMsg::Heartbeat {
            session_id: "sess-xyz".to_string(),
        },
        SocketMsg::Cmd(SocketCmd::Ping),
        SocketMsg::Cmd(SocketCmd::Pause),
        SocketMsg::Cmd(SocketCmd::Resume),
    ];
    for msg in cases {
        let bytes = msg.encode();
        let back = SocketMsg::decode(&bytes).expect("must decode what we encoded");
        assert_eq!(msg, back, "roundtrip mismatch for {msg:?}");
    }
}

#[test]
fn socket_roundtrip_handles_unicode_session_id() {
    let msg = SocketMsg::Heartbeat {
        session_id: "séssion-🦀-id".to_string(),
    };
    assert_eq!(SocketMsg::decode(&msg.encode()), Some(msg));
}

#[test]
fn socket_decode_rejects_malformed_without_panic() {
    // Empty, unknown tag, truncated length prefix, truncated body, bad cmd,
    // and trailing garbage all return None — never a panic (invariant 1).
    assert_eq!(SocketMsg::decode(&[]), None);
    assert_eq!(SocketMsg::decode(&[0xFF]), None); // unknown tag
    assert_eq!(SocketMsg::decode(&[0x01, 0x00]), None); // hook, truncated len prefix
    assert_eq!(SocketMsg::decode(&[0x01, 0x00, 0x05, b'a']), None); // len 5, body short
    assert_eq!(SocketMsg::decode(&[0x03, 0x09]), None); // cmd, unknown subcode
    assert_eq!(SocketMsg::decode(&[0x03]), None); // cmd, missing subcode

    // Trailing bytes after a valid Cmd(Ping) are rejected (strict framing).
    let mut ping = SocketMsg::Cmd(SocketCmd::Ping).encode();
    ping.push(0x00);
    assert_eq!(SocketMsg::decode(&ping), None, "trailing bytes must be rejected");

    // Fuzz-ish: a sweep of random-length garbage never panics.
    for len in 0..64usize {
        let buf: Vec<u8> = (0..len).map(|i| (i as u8).wrapping_mul(31)).collect();
        let _ = SocketMsg::decode(&buf); // just must not panic
    }
}

// --------------------------------------------------------------------------
// CONTENT FIREWALL (invariant 2): the wire types cannot carry work product.
// --------------------------------------------------------------------------

#[test]
fn event_rejects_unknown_content_fields() {
    // `deny_unknown_fields` means any JSON carrying a prompt/content/message/text
    // field fails to deserialize into Event — work product cannot ride along.
    for forbidden in ["prompt", "content", "message", "text", "transcript", "cwd"] {
        let json = format!(
            r#"{{"v":1,"id":"01J9Z3K8Q0000000000000000A","ctr":1,"prev":"{GENESIS_PREV}","t":1,"type":"imp","session":"s:x","creative":"cr_1","n":1,"{forbidden}":"SECRET WORK PRODUCT"}}"#
        );
        let parsed: Result<Event, _> = serde_json::from_str(&json);
        assert!(
            parsed.is_err(),
            "Event must reject an unknown `{forbidden}` field (content firewall)"
        );
    }
}

#[test]
fn event_accepts_only_the_closed_schema() {
    // The exact closed schema parses; this anchors the deny_unknown_fields test
    // (proves rejection is due to the extra key, not a malformed base object).
    let json = format!(
        r#"{{"v":1,"id":"01J9Z3K8Q0000000000000000A","ctr":1,"prev":"{GENESIS_PREV}","t":1,"type":"imp","session":"s:x","creative":"cr_1","n":1}}"#
    );
    let parsed: Result<Event, _> = serde_json::from_str(&json);
    assert!(parsed.is_ok(), "the closed schema must parse: {parsed:?}");
}

#[test]
fn socket_codec_has_no_content_carrying_path() {
    // Structural proof: a SocketMsg::Hook carries ONLY event_name + session_id.
    // No combination of bytes can decode into a struct with a content field,
    // because the grammar has only the three closed variants. We assert that a
    // payload whose "extra" looks like content is either rejected (strict
    // framing) or, if it decodes, the decoded Hook exposes no content — its
    // fields are exactly the two firewall-safe keys.
    let hook = SocketMsg::Hook {
        event_name: "Stop".to_string(),
        session_id: "s1".to_string(),
    };
    let mut bytes = hook.encode();
    // Append bytes that an attacker might hope are treated as a content field.
    bytes.extend_from_slice(b"\x00\x07prompt!");
    // Strict framing rejects the smuggled tail outright.
    assert_eq!(
        SocketMsg::decode(&bytes),
        None,
        "smuggled trailing content must be rejected, not absorbed"
    );
    // And the legitimate message exposes exactly two string fields, no content.
    match SocketMsg::decode(&hook.encode()).unwrap() {
        SocketMsg::Hook {
            event_name,
            session_id,
        } => {
            assert_eq!(event_name, "Stop");
            assert_eq!(session_id, "s1");
        }
        other => panic!("expected Hook, got {other:?}"),
    }
}
