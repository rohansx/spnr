// Small, dependency-free encoders that must match the Rust wire format exactly.

const HEX = "0123456789abcdef";

/** Lowercase hex, matching Rust `data_encoding::HEXLOWER`. */
export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += HEX[b >> 4] + HEX[b & 0x0f];
  return out;
}

export function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567"; // RFC 4648, lowercased

/**
 * RFC 4648 base32, lowercase, no padding — matches Rust
 * `data_encoding::BASE32_NOPAD.encode(..).to_lowercase()`. Used for `device_id`
 * (= base32(pubkey[..10]) → 16 chars).
 */
export function base32NoPad(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}
