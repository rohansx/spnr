//! # spnr-proto — SAP/1 wire types, canonical encoding, signing, chaining, socket schema
//!
//! This crate owns the SAP/1 protocol surface (03-protocol-SAP1.md) plus the
//! daemon socket datagram schema. It is shared by client and server.
//!
//! ## Frozen public API
//!
//! Phase 2/3 fill the `unimplemented!()` bodies WITHOUT changing these signatures:
//!
//! - [`Event`], [`EventType`], [`GENESIS_PREV`]
//! - [`canonical_bytes`] — RFC 8785 canonical bytes for signing
//! - [`chain_next`] — `"b3:"` + hex BLAKE3 of the previous canonical bytes
//! - [`DeviceKey`] — `generate`, `sign`, `verify`, `device_id`, `verifying_key`
//! - [`SocketMsg`] / [`SocketCmd`] — tiny daemon datagram codec (`encode`/`decode`),
//!   structurally free of any content field (content firewall, invariant 2)
//!
//! ## Two-serializer rule (09 §4)
//!
//! Canonicalization uses `serde_jcs` (RFC 8785) on a code path SEPARATE from the
//! `settings.json` round-trip (`serde_json` `preserve_order`, in `spnr-settings`).
//! `spnr-proto` MUST NOT rely on `serde_json` key ordering for canonicalization
//! even though feature unification makes `serde_json` `preserve_order` everywhere.

#![forbid(unsafe_code)]

mod canonical;
mod chain;
mod event;
mod key;
mod socket;

pub use canonical::canonical_bytes;
pub use chain::chain_next;
pub use event::{new_id, Event, EventType, GENESIS_PREV};
pub use key::DeviceKey;
pub use socket::{SocketCmd, SocketMsg};

// Re-export the verifying key type so callers can hold/verify without depending
// on ed25519-dalek directly (keeps the SAP/1 surface self-contained).
pub use ed25519_dalek::VerifyingKey;
