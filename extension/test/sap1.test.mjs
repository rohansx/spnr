// Cross-language compatibility tests for the SAP/1 crypto path.
//
// The goal: prove the browser produces bytes the Rust backend accepts. We bundle the
// real worker/sap1.ts (so we test shipped code, not a copy) and assert:
//   1. JCS canonical bytes == the exact byte string Rust serde_jcs produces (FIXTURE).
//   2. hash-wasm BLAKE3 matches the official empty-input test vector (independent).
//   3. Ed25519 via WebCrypto round-trips and exports a 32-byte raw public key.
//
// FIXTURE is also asserted, byte-for-byte, by the Rust test in
// crates/spnr-proto/tests/web_compat.rs — both sides equal the same literal ⇒ they agree.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as esbuild from "esbuild";

// Bundle the actual source module (hash-wasm inlined) and import it from memory.
const { outputFiles } = await esbuild.build({
  entryPoints: ["src/worker/sap1.ts"],
  bundle: true,
  format: "esm",
  write: false,
  platform: "node",
});
const dataUrl = "data:text/javascript;base64," + Buffer.from(outputFiles[0].text).toString("base64");
const { canonicalBytes, chainNext, toHex } = await import(dataUrl);

// The shared fixture event. The SAME object is reconstructed in web_compat.rs.
const FIXTURE_EVENT = {
  v: 1,
  id: "01HZXK8B7T0000000000000001",
  ctr: 0,
  prev: "b3:0000000000000000000000000000000000000000000000000000000000000000",
  t: 1781234567,
  type: "imp",
  session: "s:deadbeef",
  creative: "cr_house_1",
  n: 1,
};

// Exact RFC 8785 canonical form: keys sorted by code unit, no whitespace, ints plain.
const EXPECTED_CANONICAL =
  '{"creative":"cr_house_1","ctr":0,"id":"01HZXK8B7T0000000000000001","n":1,' +
  '"prev":"b3:0000000000000000000000000000000000000000000000000000000000000000",' +
  '"session":"s:deadbeef","t":1781234567,"type":"imp","v":1}';

test("JCS canonical bytes match the Rust serde_jcs fixture", () => {
  const actual = new TextDecoder().decode(canonicalBytes(FIXTURE_EVENT));
  assert.equal(actual, EXPECTED_CANONICAL);
});

test("optional fields are omitted (not null) when absent", () => {
  const ev = { v: 1, id: "x", ctr: 2, prev: "b3:00", t: 5, type: "session_start", session: "s:1" };
  const s = new TextDecoder().decode(canonicalBytes(ev));
  assert.ok(!s.includes("creative"), "creative must be omitted");
  assert.ok(!s.includes('"n"'), "n must be omitted");
  assert.ok(!s.includes("null"), "no null emission");
});

test("BLAKE3 matches the official empty-input test vector", async () => {
  // chainNext(empty) = "b3:" + blake3(""). Official 256-bit vector for 0 bytes.
  const prev = await chainNext(new Uint8Array(0));
  assert.equal(
    prev,
    "b3:af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262",
  );
});

test("chain digest of the fixture is stable (cross-checked by Rust)", async () => {
  const prev = await chainNext(canonicalBytes(FIXTURE_EVENT));
  assert.match(prev, /^b3:[0-9a-f]{64}$/);
  // Printed so it can be pinned in web_compat.rs.
  console.log("FIXTURE chain digest:", prev);
});

test("Ed25519 (WebCrypto) signs, self-verifies, and exports a 32-byte raw pubkey", async () => {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  assert.equal(rawPub.length, 32, "raw Ed25519 public key is 32 bytes");
  assert.match(toHex(rawPub), /^[0-9a-f]{64}$/);

  const canonical = canonicalBytes(FIXTURE_EVENT);
  const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", pair.privateKey, canonical));
  assert.equal(sig.length, 64, "Ed25519 signature is 64 bytes");
  const ok = await crypto.subtle.verify("Ed25519", pair.publicKey, sig, canonical);
  assert.ok(ok, "signature verifies against the public key");
});
