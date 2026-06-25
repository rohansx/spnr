// Device identity: WebCrypto Ed25519 keypair, persisted in chrome.storage.local.
// Browser analog of the CLI's OS-keychain-sealed key (crates/spnr-proto/src/key.rs):
// same threat posture (encrypted-at-rest, not hardware-bound). The key never leaves
// the service worker; the content script never sees it.
import { K } from "../config.js";
import { base32NoPad, fromHex, toHex } from "./encoding.js";

export interface Identity {
  jwk: JsonWebKey; // Ed25519 private key (PKCS#8/JWK form)
  pubHex: string; // 32-byte public key, lowercase hex (registered server-side)
  deviceId: string; // base32(pubkey[..10]) lowercase, 16 chars
}

let cached: { id: Identity; key: CryptoKey } | null = null;

/** True if this Chrome supports Ed25519 in WebCrypto (min Chrome 137). */
export async function ed25519Supported(): Promise<boolean> {
  try {
    await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
    return true;
  } catch {
    return false;
  }
}

async function importSigningKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, true, ["sign"]);
}

/** Load the persisted identity, or generate + persist a fresh one on first run. */
export async function getOrCreateIdentity(): Promise<{ id: Identity; key: CryptoKey }> {
  if (cached) return cached;

  const stored = (await chrome.storage.local.get(K.identity))[K.identity] as Identity | undefined;
  if (stored) {
    cached = { id: stored, key: await importSigningKey(stored.jwk) };
    return cached;
  }

  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;

  const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const pubHex = toHex(rawPub);
  const id: Identity = {
    jwk,
    pubHex,
    deviceId: base32NoPad(rawPub.slice(0, 10)),
  };

  await chrome.storage.local.set({ [K.identity]: id });
  cached = { id, key: pair.privateKey };
  return cached;
}

/** Sign canonical bytes; returns the 64-byte Ed25519 signature as lowercase hex. */
export async function signHex(canonical: Uint8Array): Promise<string> {
  const { key } = await getOrCreateIdentity();
  const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", key, canonical as BufferSource));
  return toHex(sig);
}

/** Per-device random salt for hashing session ids (raw id never leaves the machine). */
export async function getSalt(): Promise<Uint8Array> {
  const hex = (await chrome.storage.local.get(K.salt))[K.salt] as string | undefined;
  if (hex) return fromHex(hex);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  await chrome.storage.local.set({ [K.salt]: toHex(salt) });
  return salt;
}
