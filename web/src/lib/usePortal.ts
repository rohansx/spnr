import { useEffect, useState } from 'react';

// Typed client for the v2 demand-side portal API (server-ts/, Express). The /v2
// proxy in vite.config.ts points these calls at the TypeScript service (8790).
// Wire shapes mirror server-ts/src/app.ts (`toWire`) exactly: snake_case
// price_per_block_usd, id format cmp_N. Nothing here ever throws — fetch failures
// resolve to null/[] so the CRT design can fall back to its placeholder rows.

/** A creative attached to a campaign (server-ts Creative wire shape). */
export interface Creative {
  text: string;
  url: string;
}

/** A campaign as returned by GET /v2/campaigns and POST /v2/campaigns. */
export interface Campaign {
  id: string;
  advertiser: string;
  name: string;
  price_per_block_usd: number;
  creative: Creative | null;
  created_at: number;
}

/** GET /v2/auction response — the single-slot winner, or null when empty. */
export interface AuctionResp {
  winner: Campaign | null;
}

/** Body for POST /v2/campaigns. */
export interface CreateCampaignBody {
  advertiser: string;
  name: string;
  price_per_block_usd: number;
}

/** Body for POST /v2/campaigns/:id/creative. */
export interface CreativeBody {
  text: string;
  url: string;
}

/** Result of submitting a creative: ok, plus server lint violations on 422. */
export interface SubmitResult {
  ok: boolean;
  violations?: string[];
}

/**
 * Poll GET /v2/campaigns every `intervalMs`. Returns `[]` until the first
 * successful fetch (callers fall back to design placeholders). Never throws — a
 * portal hiccup just keeps the last value.
 */
export function useCampaigns(intervalMs = 3000): Campaign[] {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  useEffect(() => {
    let alive = true;
    const pull = () =>
      fetch('/v2/campaigns')
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((data: { campaigns?: Campaign[] }) => {
          if (alive && Array.isArray(data?.campaigns)) setCampaigns(data.campaigns);
        })
        .catch(() => {});
    pull();
    const id = setInterval(pull, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [intervalMs]);

  return campaigns;
}

/**
 * Poll GET /v2/auction every `intervalMs`. Returns `null` until the first
 * successful fetch with a winner. Never throws.
 */
export function useAuction(intervalMs = 3000): Campaign | null {
  const [winner, setWinner] = useState<Campaign | null>(null);

  useEffect(() => {
    let alive = true;
    const pull = () =>
      fetch('/v2/auction')
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((data: AuctionResp) => {
          if (alive) setWinner(data?.winner ?? null);
        })
        .catch(() => {});
    pull();
    const id = setInterval(pull, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [intervalMs]);

  return winner;
}

/**
 * POST /v2/campaigns. Returns the created Campaign on 201, or null on any
 * failure (validation 400, network, malformed body). Never throws.
 */
export async function createCampaign(body: CreateCampaignBody): Promise<Campaign | null> {
  try {
    const res = await fetch('/v2/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return (await res.json()) as Campaign;
  } catch {
    return null;
  }
}

/**
 * POST /v2/campaigns/:id/creative. The server re-runs the SAP/1 content lint.
 * Returns { ok: true } on 200, or { ok: false, violations } on a 422 lint
 * failure (or { ok: false } on any other failure). Never throws.
 */
export async function submitCreative(id: string, body: CreativeBody): Promise<SubmitResult> {
  try {
    const res = await fetch(`/v2/campaigns/${encodeURIComponent(id)}/creative`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => null)) as { violations?: string[] } | null;
    return { ok: false, violations: Array.isArray(data?.violations) ? data.violations : undefined };
  } catch {
    return { ok: false };
  }
}
