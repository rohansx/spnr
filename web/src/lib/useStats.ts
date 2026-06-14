import { useEffect, useState } from 'react';

/** The live `/api/stats` shape served by the Rust backend (spnr-server). */
export interface Stats {
  campaign: string;
  advertiser: string;
  creative_text: string;
  short_code: string;
  devices: number;
  total_impressions: number;
  clicks: number;
  total_balance_micros: number;
  total_balance_usd: string;
  ledger_entries: number;
  ledger_balanced: boolean;
  attestation_pct: number;
  accepted: number;
  rejected: number;
  total_redeemed_micros: number;
  total_redeemed_usd: string;
}

/**
 * Poll the live backend stats every `intervalMs`. Returns `null` until the first
 * successful fetch (callers fall back to design placeholders). Never throws — a
 * backend hiccup just keeps the last value.
 */
export function useStats(intervalMs = 2000): Stats | null {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let alive = true;
    const pull = () =>
      fetch('/api/stats')
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((s: Stats) => {
          if (alive) setStats(s);
        })
        .catch(() => {});
    pull();
    const id = setInterval(pull, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [intervalMs]);

  return stats;
}
