// Ad-pool fetch + round-robin selection. Mirrors the daemon's `featured_ad()`:
// sequential rotation through the served creatives, no targeting (event-only firewall).
import { K, SERVE_REFRESH_MS, type FeaturedAd } from "../config.js";
import { backendUrl } from "./backend.js";

interface ServeCreative {
  id: string;
  text: string;
  short_code: string;
  url: string;
}
interface Pool {
  creatives: ServeCreative[];
  fetchedAt: number;
}

let featuredIdx = 0;

async function loadPool(): Promise<Pool | undefined> {
  return (await chrome.storage.local.get(K.pool))[K.pool] as Pool | undefined;
}

/** Fetch /v1/serve and cache the pool. Called on install and periodically. */
export async function refreshPool(nowMs: number): Promise<void> {
  const base = await backendUrl();
  const res = await fetch(`${base}/v1/serve`, { method: "GET" });
  if (!res.ok) throw new Error(`/v1/serve ${res.status}`);
  const body = (await res.json()) as { creatives?: ServeCreative[] };
  const creatives = body.creatives ?? [];
  await chrome.storage.local.set({ [K.pool]: { creatives, fetchedAt: nowMs } satisfies Pool });
}

/** Next ad in round-robin order, refreshing the pool lazily if stale/empty. */
export async function nextFeatured(nowMs: number): Promise<FeaturedAd | null> {
  let pool = await loadPool();
  if (!pool || pool.creatives.length === 0 || nowMs - pool.fetchedAt > SERVE_REFRESH_MS) {
    try {
      await refreshPool(nowMs);
      pool = await loadPool();
    } catch {
      // Fail quiet: keep whatever we had; if nothing, no bar this turn (invariant 6).
    }
  }
  if (!pool || pool.creatives.length === 0) return null;

  const c = pool.creatives[featuredIdx % pool.creatives.length];
  featuredIdx = (featuredIdx + 1) % pool.creatives.length;
  const base = await backendUrl();
  return {
    creativeId: c.id,
    text: c.text,
    clickUrl: `${base}/c/${c.short_code}`,
  };
}
