// Build, sign, chain, and deliver SAP/1 impression events to the existing
// POST /v1/ingest. The per-device hash chain + monotonic counter are maintained
// client-side; the server re-verifies signature, chain continuity, counter
// monotonicity, and ULID dedup (server/spnr-server/src/main.rs accept_event).
import { K } from "../config.js";
import { backendUrl } from "./backend.js";
import { getOrCreateIdentity, getSalt, signHex } from "./identity.js";
import {
  canonicalBytes,
  chainNext,
  GENESIS_PREV,
  newUlid,
  toHex,
  type SapEvent,
} from "./sap1.js";

interface ChainState {
  prev: string;
  ctr: number;
}
interface SignedEvent {
  e: SapEvent;
  s: string; // lowercase-hex Ed25519 signature (main.rs SignedEvent.s)
}

async function loadChain(): Promise<ChainState> {
  return (
    ((await chrome.storage.local.get(K.chain))[K.chain] as ChainState | undefined) ?? {
      prev: GENESIS_PREV,
      ctr: 0,
    }
  );
}

async function loadQueue(): Promise<SignedEvent[]> {
  return ((await chrome.storage.local.get(K.queue))[K.queue] as SignedEvent[] | undefined) ?? [];
}

/** "s:" + hex(sha256(salt || rawSessionId)) — raw id never leaves the machine. */
async function hashSession(rawSessionId: string): Promise<string> {
  const salt = await getSalt();
  const raw = new TextEncoder().encode(rawSessionId);
  const buf = new Uint8Array(salt.length + raw.length);
  buf.set(salt, 0);
  buf.set(raw, salt.length);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buf as BufferSource));
  return "s:" + toHex(digest);
}

/**
 * Record one impression for `creativeId` in `rawSessionId`. Builds the event,
 * advances the local chain, signs, enqueues, and attempts a flush. MVP accounting:
 * one impression per qualifying turn (n = 1).
 */
export async function recordImpression(
  creativeId: string,
  rawSessionId: string,
  nowMs: number,
): Promise<void> {
  const chain = await loadChain();
  const event: SapEvent = {
    v: 1,
    id: newUlid(nowMs),
    ctr: chain.ctr,
    prev: chain.prev,
    t: Math.floor(nowMs / 1000),
    type: "imp",
    session: await hashSession(rawSessionId),
    creative: creativeId,
    n: 1,
  };

  const canonical = canonicalBytes(event);
  const s = await signHex(canonical);

  // Advance the local chain BEFORE delivery; continuity is independent of server reach.
  const nextPrev = await chainNext(canonical);
  await chrome.storage.local.set({ [K.chain]: { prev: nextPrev, ctr: chain.ctr + 1 } });

  const queue = await loadQueue();
  queue.push({ e: event, s });
  await chrome.storage.local.set({ [K.queue]: queue });

  await flush();
}

/** POST any queued events. On success, clears the delivered prefix. Fail-quiet. */
export async function flush(): Promise<void> {
  const queue = await loadQueue();
  if (queue.length === 0) return;

  const { id } = await getOrCreateIdentity();
  const base = await backendUrl();
  try {
    const res = await fetch(`${base}/v1/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_id: id.deviceId, events: queue }),
    });
    if (!res.ok) return; // keep queued; retry next turn
    // Server accepted the batch (accepted/rejected counts ignored for MVP); clear it.
    await chrome.storage.local.set({ [K.queue]: [] });
  } catch {
    // Network down: keep the queue; the chain stays valid for eventual delivery.
  }
}
