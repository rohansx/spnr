// Content-script entrypoint — the browser analog of the fast CLI hooks. DOM only:
// mounts the persistent sponsored banner into the composer box, loads the first ad,
// and wires firewall-safe turn detection. No keys, no network.
import { mountBanner } from "./bar.js";
import { wireEvents } from "./events.js";

// After the extension is reloaded/updated, an already-open tab's content script is
// orphaned: any chrome.* access then rejects (context invalidated / channel closed).
// That is expected and harmless — swallow it so it never surfaces as a page error.
// (A hard refresh of the tab loads the fresh content script.)
window.addEventListener("unhandledrejection", (e) => {
  const m = String(e.reason?.message || e.reason);
  if (
    m.includes("Extension context invalidated") ||
    m.includes("sendMessage") ||
    m.includes("message channel closed") ||
    m.includes("receiving end does not exist")
  ) {
    e.preventDefault();
  }
});

mountBanner();
wireEvents();
