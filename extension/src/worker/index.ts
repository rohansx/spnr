// Service-worker entrypoint — the browser analog of the spnrd daemon. Owns the
// signing key, network, registration, and the impression queue. The content script
// (the "hooks") talks to it only via messages; it never touches the key or the network.
import type { Msg, FeaturedAd } from "../config.js";
import { ed25519Supported } from "./identity.js";
import { flush } from "./ingest.js";
import { recordImpression } from "./ingest.js";
import { ensureRegistered } from "./register.js";
import { nextFeatured, refreshPool } from "./serve.js";

async function bootstrap(): Promise<void> {
  if (!(await ed25519Supported())) {
    console.warn("[spnr] Ed25519 unavailable in this Chrome — render-only, no earning.");
    return;
  }
  try {
    await ensureRegistered();
    await refreshPool(Date.now());
    await flush(); // deliver anything queued from a previous session
  } catch (e) {
    console.warn("[spnr] bootstrap deferred:", e);
  }
}

chrome.runtime.onInstalled.addListener(() => void bootstrap());
chrome.runtime.onStartup.addListener(() => void bootstrap());

chrome.runtime.onMessage.addListener((msg: Msg, _sender, sendResponse) => {
  switch (msg.type) {
    case "spnr/featured":
      // Content asks for the next ad on each prompt submit (round-robin rotation).
      nextFeatured(Date.now())
        .then((ad: FeaturedAd | null) => sendResponse(ad))
        .catch(() => sendResponse(null));
      return true; // async response

    case "spnr/impression":
      // Turn completed while the bar was visible → record one impression.
      recordImpression(msg.creativeId, msg.sessionId, Date.now())
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));
      return true;
  }
  return false;
});
