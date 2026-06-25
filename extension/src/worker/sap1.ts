// SAP/1 event object, RFC 8785 canonical encoding, and the BLAKE3 hash chain —
// the browser mirror of crates/spnr-proto/src/{event,canonical,chain}.rs.
//
// Determinism is load-bearing: the server recomputes canonical bytes to verify the
// signature AND the digest the next event's `prev` must match. The encoder here is a
// SEPARATE code path from anything else, exactly as the Rust two-serializer rule
// requires.
import { blake3 } from "hash-wasm";
import { toHex } from "./encoding.js";

/** Closed `type` enum — wire strings match event.rs EventType serde renames. */
export type EventType =
  | "imp"
  | "click_hint"
  | "session_start"
  | "session_end"
  | "heartbeat_summary"
  | "gap";

/** A single SAP/1 event — exactly these keys, no more, no fewer (event.rs §4). */
export interface SapEvent {
  v: number; // u8, currently 1
  id: string; // ULID, 26 chars
  ctr: number; // u64 monotonic (safe-integer range in practice)
  prev: string; // "b3:" + hex(blake3(prev canonical))
  t: number; // i64 unix seconds
  type: EventType;
  session: string; // "s:" + salted hash
  creative?: string; // required for imp/click_hint; OMITTED (not null) otherwise
  n?: number; // u32; for imp = impressions this window
}

/** Genesis sentinel for a device's first event (event.rs GENESIS_PREV). */
export const GENESIS_PREV =
  "b3:0000000000000000000000000000000000000000000000000000000000000000";

/**
 * RFC 8785 (JCS) canonical bytes of a JSON value, constrained to the closed SAP/1
 * schema: object keys sorted by UTF-16 code unit (JS default string order), integers
 * printed plain, ASCII strings via JSON.stringify, optional fields omitted when
 * `undefined`. Because every field is ASCII text or an integer, this is byte-identical
 * to Rust `serde_jcs`. Non-integer numbers are rejected rather than risk a float-format
 * divergence (none occur in the schema).
 */
export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(jcs(value));
}

function jcs(v: unknown): string {
  if (v === null) return "null";
  switch (typeof v) {
    case "string":
      return JSON.stringify(v); // ASCII-only schema → matches JCS escaping
    case "boolean":
      return v ? "true" : "false";
    case "number":
      if (!Number.isInteger(v)) throw new Error("JCS: non-integer number in SAP/1 schema");
      return String(v);
    case "object": {
      if (Array.isArray(v)) return "[" + v.map(jcs).join(",") + "]";
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o)
        .filter((k) => o[k] !== undefined) // omit absent optionals (not null)
        .sort(); // default JS sort = UTF-16 code-unit order = RFC 8785
      return "{" + keys.map((k) => JSON.stringify(k) + ":" + jcs(o[k])).join(",") + "}";
    }
    default:
      throw new Error("JCS: unsupported type " + typeof v);
  }
}

/**
 * `prev` for the NEXT event from the previous event's canonical bytes:
 * "b3:" + hex(blake3(prev_canonical)). Mirrors chain.rs `chain_next`.
 */
export async function chainNext(prevCanonical: Uint8Array): Promise<string> {
  // hash-wasm blake3 defaults to 256-bit output → 64 lowercase-hex chars.
  const hex = await blake3(prevCanonical, 256);
  return "b3:" + hex;
}

/** Generate a ULID (26-char Crockford base32; high 48 bits = ms timestamp). */
export function newUlid(nowMs: number): string {
  const ENC = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford
  let ts = nowMs;
  const time = new Array(10);
  for (let i = 9; i >= 0; i--) {
    time[i] = ENC[ts % 32];
    ts = Math.floor(ts / 32);
  }
  let rand = "";
  const r = crypto.getRandomValues(new Uint8Array(16));
  for (let i = 0; i < 16; i++) rand += ENC[r[i] % 32];
  return time.join("") + rand;
}

/** Convenience: the chain digest of an event (for tests / next-prev computation). */
export async function digestOf(event: SapEvent): Promise<string> {
  return chainNext(canonicalBytes(event));
}

/** Hex of arbitrary bytes — re-exported for callers that build sigs. */
export { toHex };
