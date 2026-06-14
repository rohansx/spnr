// Server-rendered operator admin panel for spnr. Aggregates the WHOLE picture in
// one page: live network stats + the active (serving) advertisement pool — both
// read from the Rust backend (/api/stats, /v1/serve) — plus every demand-side
// campaign + the current auction winner from this service's own store.
//
// It is read-only and self-contained (no client JS, auto-refreshes via a meta tag).
// Cross-service reads fail soft: if the backend is unreachable the page still renders
// the campaign side and shows "unavailable" for the network panels.

import type { Store, Campaign } from "./store.js";

const esc = (s: unknown): string =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );

async function fetchJson(url: string, timeoutMs = 4000): Promise<Record<string, unknown> | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

interface ServeCreative {
  id: string;
  text: string;
  short_code: string;
  url: string;
}

function statCard(label: string, value: string, accent = false): string {
  return `<div class="card">
    <div class="card-label">${esc(label)}</div>
    <div class="card-value${accent ? " accent" : ""}">${esc(value)}</div>
  </div>`;
}

function activeAdsRows(creatives: ServeCreative[], backendUrl: string): string {
  if (creatives.length === 0) return `<tr><td colspan="5" class="dim">no active creatives</td></tr>`;
  return creatives
    .map((c, i) => {
      const click = `${backendUrl}/c/${encodeURIComponent(c.short_code)}`;
      return `<tr>
        <td class="dim">${i + 1}</td>
        <td>${esc(c.text)}</td>
        <td><code>${esc(c.id)}</code></td>
        <td><a href="${esc(click)}" target="_blank" rel="noopener"><code>${esc(c.short_code)}</code> ↗</a></td>
        <td><span class="pill pill-on">ACTIVE</span></td>
      </tr>`;
    })
    .join("");
}

function campaignRows(campaigns: readonly Campaign[], winnerId: string | null): string {
  if (campaigns.length === 0)
    return `<tr><td colspan="6" class="dim">no campaigns yet — create one in the advertiser portal</td></tr>`;
  return campaigns
    .map((c) => {
      const serving = c.id === winnerId;
      const status = serving ? `<span class="pill pill-on">SERVING</span>` : `<span class="pill">QUEUED</span>`;
      const created = new Date(c.createdAt).toISOString().replace("T", " ").slice(0, 16);
      return `<tr${serving ? ' class="row-on"' : ""}>
        <td>${esc(c.advertiser)}</td>
        <td>${esc(c.name)}</td>
        <td>$${esc(c.pricePerBlockUsd.toFixed(2))}</td>
        <td>${c.creative ? esc(c.creative.text) : '<span class="dim">— no creative —</span>'}</td>
        <td>${status}</td>
        <td class="dim">${esc(created)} UTC</td>
      </tr>`;
    })
    .join("");
}

export async function renderAdmin(store: Store, backendUrl: string): Promise<string> {
  const [stats, serve] = await Promise.all([
    fetchJson(`${backendUrl}/api/stats`),
    fetchJson(`${backendUrl}/v1/serve`),
  ]);
  const campaigns = store.list();
  const winner = store.auctionWinner();
  const creatives = (serve?.creatives as ServeCreative[] | undefined) ?? [];

  const backendOk = stats !== null;
  const s = (k: string, fallback = "—"): string =>
    stats && stats[k] !== undefined && stats[k] !== null ? String(stats[k]) : fallback;

  const statsPanel = backendOk
    ? `<div class="cards">
        ${statCard("impressions", s("total_impressions", "0"), true)}
        ${statCard("clicks", s("clicks", "0"))}
        ${statCard("dev balance", s("total_balance_usd", "$0.000"))}
        ${statCard("redeemed", s("total_redeemed_usd", "$0.000"))}
        ${statCard("devices", s("devices", "0"))}
        ${statCard("attestation", `${s("attestation_pct", "100")}%`)}
        ${statCard("ledger", s("ledger_balanced") === "true" ? "balanced ✓" : "UNBALANCED")}
      </div>`
    : `<div class="warn">network backend unreachable at <code>${esc(backendUrl)}</code> — stats + active pool unavailable.</div>`;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="10">
<title>spnr · admin</title>
<style>
  :root{ --bg:#060807; --panel:#0a0e0c; --border:#16201b; --green:#3dff7e; --mid:#9fb3a8; --dim:#5f706a; --dimmer:#3a4742; --amber:#ffcb6b; --red:#ff5c5c; }
  *{ box-sizing:border-box; }
  body{ margin:0; background:var(--bg); color:var(--mid); font:14px/1.5 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace; }
  .wrap{ max-width:1100px; margin:0 auto; padding:32px 22px 64px; }
  header{ display:flex; align-items:baseline; justify-content:space-between; gap:16px; border-bottom:1px solid var(--border); padding-bottom:18px; }
  .brand{ font-weight:700; font-size:20px; letter-spacing:.08em; color:var(--green); text-shadow:0 0 16px rgba(61,255,126,.35); }
  .brand span{ animation:blink 1.1s step-end infinite; } @keyframes blink{ 50%{opacity:0;} }
  .tag{ font-size:11px; color:var(--dim); letter-spacing:.12em; }
  h2{ font-size:12.5px; letter-spacing:.14em; color:var(--dim); text-transform:uppercase; margin:34px 0 12px; }
  .cards{ display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:12px; }
  .card{ background:var(--panel); border:1px solid var(--border); padding:14px 16px; }
  .card-label{ font-size:10.5px; letter-spacing:.1em; color:var(--dim); margin-bottom:8px; }
  .card-value{ font-size:22px; font-weight:700; color:var(--mid); }
  .card-value.accent{ color:var(--green); }
  table{ width:100%; border-collapse:collapse; background:var(--panel); border:1px solid var(--border); }
  th,td{ text-align:left; padding:10px 14px; border-bottom:1px solid var(--border); font-size:12.5px; vertical-align:top; }
  th{ color:var(--dim); font-weight:500; letter-spacing:.08em; text-transform:uppercase; font-size:10.5px; }
  tr:last-child td{ border-bottom:none; }
  .row-on{ background:rgba(61,255,126,.05); }
  code{ color:var(--mid); background:#0e1411; padding:1px 5px; border:1px solid var(--border); border-radius:3px; font-size:11.5px; }
  a{ color:var(--green); text-decoration:none; } a:hover{ text-decoration:underline; }
  .pill{ display:inline-block; padding:2px 8px; font-size:10px; letter-spacing:.08em; border:1px solid var(--dimmer); color:var(--dim); border-radius:3px; }
  .pill-on{ border-color:var(--green); color:var(--green); }
  .dim{ color:var(--dim); } .warn{ background:rgba(255,92,92,.08); border:1px solid var(--red); color:var(--red); padding:12px 16px; }
  footer{ margin-top:40px; padding-top:18px; border-top:1px solid var(--border); font-size:11.5px; color:var(--dimmer); }
</style>
</head><body><div class="wrap">
  <header>
    <div class="brand">SPNR<span>_</span></div>
    <div class="tag">ADMIN · network operator · auto-refresh 10s</div>
  </header>

  <h2>Network</h2>
  ${statsPanel}

  <h2>Active advertisements — serving pool (${creatives.length})</h2>
  <table>
    <thead><tr><th>#</th><th>creative</th><th>id</th><th>click code</th><th>status</th></tr></thead>
    <tbody>${activeAdsRows(creatives, backendUrl)}</tbody>
  </table>

  <h2>Campaigns — demand side (${campaigns.length})</h2>
  <table>
    <thead><tr><th>advertiser</th><th>campaign</th><th>$ / block</th><th>creative</th><th>status</th><th>created</th></tr></thead>
    <tbody>${campaignRows(campaigns, winner ? winner.id : null)}</tbody>
  </table>

  <footer>
    backend: <code>${esc(backendUrl)}</code> · auction winner:
    ${winner ? `<code>${esc(winner.name)}</code> @ $${esc(winner.pricePerBlockUsd.toFixed(2))}/block` : "none"}
    · API: <a href="/v2/campaigns">/v2/campaigns</a> · <a href="/v2/auction">/v2/auction</a>
  </footer>
</div></body></html>`;
}
