//! Device identity: Ed25519 keypair, signing, verification, and `device_id` (§3).
//!
//! The private key is sealed in the OS keychain by `spnrd`/`spnr-cli` (the
//! `keyring` crate, encrypted-at-rest — NOT hardware-bound / non-exportable, see
//! 07-security-privacy.md §1.1). `spnr-proto` only owns the in-memory crypto.

use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};

use crate::canonical::canonical_bytes;
use crate::event::Event;

/// A device's Ed25519 signing identity.
///
/// `device_id = base32(pubkey_bytes[0..10])` (RFC 4648, lowercase, no padding):
/// a truncated fingerprint for routing/logging, NOT the verification key (§3.2).
/// The server stores the FULL 32-byte public key and verifies against it.
pub struct DeviceKey {
    pub(crate) signing: SigningKey,
}

impl DeviceKey {
    /// Generate a fresh Ed25519 keypair (install-time, §3.1).
    ///
    /// Seeded from the OS CSPRNG (`OsRng` via `getrandom`). `spnrd`/`spnr-cli`
    /// seal the resulting private key in the OS keychain.
    pub fn generate() -> DeviceKey {
        let mut csprng = rand_core::OsRng;
        DeviceKey {
            signing: SigningKey::generate(&mut csprng),
        }
    }

    /// Rebuild a `DeviceKey` from the 32-byte private seed restored from the
    /// keychain. The seed is the canonical persisted form of an Ed25519 key.
    ///
    /// (Extension beyond the scaffolded surface — strictly necessary so the
    /// daemon can round-trip the key through the keychain without `spnr-proto`
    /// leaking the concrete `ed25519-dalek` `SigningKey` type. Noted as an
    /// additive constructor; it changes no existing signature.)
    pub fn from_seed(seed: &[u8; 32]) -> DeviceKey {
        DeviceKey {
            signing: SigningKey::from_bytes(seed),
        }
    }

    /// The 32-byte private seed, for sealing in the OS keychain. Additive
    /// companion to [`DeviceKey::from_seed`]; never serialized to the wire.
    pub fn to_seed(&self) -> [u8; 32] {
        self.signing.to_bytes()
    }

    /// Sign an event over its RFC 8785 canonical bytes (§5/§6.1). Returns the
    /// raw 64-byte Ed25519 signature; the envelope carries it as `ed:base64sig`.
    pub fn sign(&self, event: &Event) -> Vec<u8> {
        let canonical = canonical_bytes(event);
        self.signing.sign(&canonical).to_bytes().to_vec()
    }

    /// Verify a signature for an event against a verifying key (server stage 1, §7).
    ///
    /// Returns `false` on a malformed signature length or a verification miss —
    /// never panics on untrusted input (invariant 1). The verification key is the
    /// FULL 32-byte public key, never the truncated `device_id` (§3.2).
    pub fn verify(event: &Event, sig: &[u8], vk: &VerifyingKey) -> bool {
        let signature = match Signature::from_slice(sig) {
            Ok(s) => s,
            Err(_) => return false,
        };
        let canonical = canonical_bytes(event);
        vk.verify(&canonical, &signature).is_ok()
    }

    /// `device_id = base32(pubkey[..10])`, lowercase, no padding (§3.2).
    ///
    /// RFC 4648 base32 of the first 10 bytes of the 32-byte public key →
    /// 16 lowercase chars. A truncated routing/logging fingerprint, NOT a
    /// credential; the server verifies against the full key.
    pub fn device_id(&self) -> String {
        let vk = self.signing.verifying_key();
        let pubkey = vk.to_bytes();
        data_encoding::BASE32_NOPAD
            .encode(&pubkey[..10])
            .to_lowercase()
    }

    /// The full 32-byte public verifying key (registered server-side, §3.3).
    pub fn verifying_key(&self) -> VerifyingKey {
        self.signing.verifying_key()
    }
}
