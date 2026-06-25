// Shared configuration. The backend default matches the install one-liner
// (install/get.sh → SPNR_SERVER). Override by setting `spnr.backend` in
// chrome.storage.local for local-server testing.
export const DEFAULT_BACKEND = "http://82.112.226.62:8787";

export const CLIENT_VERSION = "0.1.0";

// How often the worker refreshes the served creative pool.
export const SERVE_REFRESH_MS = 5 * 60 * 1000;

// Storage keys (chrome.storage.local).
export const K = {
  backend: "spnr.backend",
  identity: "spnr.identity", // { jwk, pubHex, deviceId }
  chain: "spnr.chain", // { prev, ctr }
  queue: "spnr.queue", // SignedEvent[] awaiting ingest
  salt: "spnr.salt", // hex, for session-id hashing
  pool: "spnr.pool", // { creatives, fetchedAt }
  registered: "spnr.registered", // boolean
} as const;

// Message types between content script and service worker.
export type Msg =
  | { type: "spnr/featured" } // content → worker: give me the next ad to show
  | { type: "spnr/impression"; creativeId: string; sessionId: string }; // turn complete

export interface FeaturedAd {
  creativeId: string;
  text: string;
  clickUrl: string; // full {backend}/c/{short_code}
}
