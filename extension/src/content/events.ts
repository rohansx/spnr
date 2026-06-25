// Firewall-safe turn detection driving the persistent sponsored banner. The banner is
// always visible (like claude.ai's own notices); we rotate it per turn and record one
// impression per turn. "Turn complete" is detected markup-agnostically by watching the
// TIMING of DOM activity (token streaming) — never the content (content firewall,
// invariant 2). We detect the ACT of submitting, never the prompt text.
import type { FeaturedAd } from "../config.js";
import { findComposer, findSendButton } from "./dom-anchors.js";
import { setAd } from "./bar.js";

// Raw per-page session id. Never sent raw — the worker stores only a salted hash.
const sessionId = crypto.randomUUID();

let currentCreativeId: string | null = null;
let submitAt = 0;
let lastActivity = 0;
let lastSubmitAt = 0;
let poll: number | null = null;
let activityObs: MutationObserver | null = null;
let dead = false;

const POLL_MS = 300;
const MIN_TURN_MS = 1200; // don't close a turn faster than this
const QUIET_MS = 1500; // turn is "done" this long after token streaming stops
const MAX_TURN_MS = 90_000; // hard safety cap

function contextAlive(): boolean {
  try {
    return (
      !dead &&
      typeof chrome !== "undefined" &&
      !!chrome.runtime &&
      !!chrome.runtime.id &&
      typeof chrome.runtime.sendMessage === "function"
    );
  } catch {
    return false;
  }
}

function teardown(): void {
  dead = true;
  stopTurn();
}

function safeSend(msg: unknown): Promise<unknown> {
  try {
    if (!contextAlive()) {
      teardown();
      return Promise.resolve(null);
    }
    return Promise.resolve(chrome.runtime.sendMessage(msg)).catch(() => {
      teardown();
      return null;
    });
  } catch {
    teardown();
    return Promise.resolve(null);
  }
}

/** Ask the worker for the next ad (round-robin) and show it in the banner. */
async function rotateAd(): Promise<void> {
  const ad = (await safeSend({ type: "spnr/featured" })) as FeaturedAd | null;
  if (!ad) return;
  setAd(ad);
  currentCreativeId = ad.creativeId;
  console.debug("[spnr] ad:", ad.text);
}

let revealed = false;

/** Reveal the banner the first time the user starts querying (typing or submitting).
 *  We react to the ACT of typing, never its content (content firewall). */
async function reveal(): Promise<void> {
  if (revealed || !contextAlive()) return;
  revealed = true;
  await rotateAd();
}

function stopTurn(): void {
  if (poll !== null) {
    clearInterval(poll);
    poll = null;
  }
  if (activityObs) {
    activityObs.disconnect();
    activityObs = null;
  }
}

/** Close the current turn: record one impression for the shown ad, then rotate to the
 *  next ad (banner stays visible the whole time). */
function finalizeTurn(): void {
  stopTurn();
  const creativeId = currentCreativeId;
  if (creativeId) void safeSend({ type: "spnr/impression", creativeId, sessionId });
  void rotateAd(); // advance to the next creative for the next turn
}

function startWatch(): void {
  stopTurn();
  submitAt = Date.now();
  lastActivity = Date.now();

  // Bump lastActivity on ANY DOM change (streaming tokens). We read nothing from the
  // mutations — only that they occurred and when (firewall-safe).
  activityObs = new MutationObserver(() => {
    lastActivity = Date.now();
  });
  activityObs.observe(document.body, { childList: true, subtree: true, characterData: true });

  poll = setInterval(() => {
    if (!contextAlive()) return;
    const now = Date.now();
    if (now - submitAt < MIN_TURN_MS) return;
    if (now - lastActivity > QUIET_MS || now - submitAt > MAX_TURN_MS) {
      finalizeTurn();
    }
  }, POLL_MS) as unknown as number;
}

async function onSubmit(): Promise<void> {
  if (!contextAlive()) return teardown();
  const now = Date.now();
  if (now - lastSubmitAt < 400) return; // de-dupe Enter + click for one send
  lastSubmitAt = now;

  void reveal(); // ensure the banner is up if they submit without typing first

  // If a turn is already open, close it (count + rotate) before starting a new one.
  if (poll !== null) finalizeTurn();
  startWatch();
}

/** Wire submit detection. We attach broadly and re-check the anchors lazily, so we
 *  don't depend on the composer existing at install time. */
export function wireEvents(): void {
  // First typing in the composer reveals the banner. We read NOTHING from the field —
  // only that an input occurred (content firewall, invariant 2).
  document.addEventListener(
    "input",
    (e) => {
      const composer = findComposer();
      if (composer && (e.target === composer || composer.contains(e.target as Node))) {
        void reveal();
      }
    },
    true,
  );

  // Enter-to-send on the composer (read NOTHING from the field — only the keystroke).
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
      const composer = findComposer();
      if (composer && (e.target === composer || composer.contains(e.target as Node))) {
        void onSubmit();
      }
    },
    true,
  );

  // Click on the send button.
  document.addEventListener(
    "click",
    (e) => {
      const send = findSendButton();
      if (send && (e.target === send || send.contains(e.target as Node))) {
        void onSubmit();
      }
    },
    true,
  );
}
