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

async function fetchJson(
  url: string,
  headers?: Record<string, string>,
  timeoutMs = 4000,
): Promise<Record<string, unknown> | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal, headers });
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

interface DeviceRow {
  device_id: string;
  email: string;
  ip: string;
  os: string;
  arch: string;
  hostname: string;
  version: string;
  impressions: number;
  first_seen: number;
  last_seen: number;
}

function statCard(label: string, value: string, accent = false): string {
  return `<div class="cell">
    <div class="cell-label">${esc(label)}</div>
    <div class="cell-value${accent ? " accent" : ""}">${esc(value)}</div>
  </div>`;
}

function activeAdsRows(creatives: ServeCreative[], backendUrl: string): string {
  if (creatives.length === 0) return `<tr><td colspan="6" class="dim">no active creatives</td></tr>`;
  return creatives
    .map((c, i) => {
      const click = `${backendUrl}/c/${encodeURIComponent(c.short_code)}`;
      const del = `/admin/ads/${encodeURIComponent(c.id)}/delete`;
      return `<tr>
        <td class="num dim">${i + 1}</td>
        <td>${esc(c.text)}</td>
        <td><code>${esc(c.id)}</code></td>
        <td><a href="${esc(click)}" target="_blank" rel="noopener"><code>${esc(c.short_code)}</code> ↗</a></td>
        <td><span class="pill pill-on">ACTIVE</span></td>
        <td><form method="POST" action="${esc(del)}" class="inline" onsubmit="return confirm('Remove this advertisement from the serving pool?')"><button type="submit" class="btn-del">delete</button></form></td>
      </tr>`;
    })
    .join("");
}

function deviceRows(devices: DeviceRow[]): string {
  if (devices.length === 0) return `<tr><td colspan="7" class="dim">no connected sessions yet</td></tr>`;
  return devices
    .map((d) => {
      const email = d.email && String(d.email).trim() !== "" ? esc(d.email) : '<span class="dim">—</span>';
      const last =
        typeof d.last_seen === "number" && d.last_seen > 0
          ? new Date(d.last_seen * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC"
          : "—";
      return `<tr>
        <td>${email}</td>
        <td><code>${esc(d.ip)}</code></td>
        <td>${esc(d.os)}</td>
        <td>${esc(d.hostname)}</td>
        <td><code>${esc(d.version)}</code></td>
        <td class="num">${esc(d.impressions ?? 0)}</td>
        <td class="dim">${esc(last)}</td>
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
        <td class="num">$${esc(c.pricePerBlockUsd.toFixed(2))}</td>
        <td>${c.creative ? esc(c.creative.text) : '<span class="dim">— no creative —</span>'}</td>
        <td>${status}</td>
        <td class="dim">${esc(created)} UTC</td>
      </tr>`;
    })
    .join("");
}

export async function renderAdmin(store: Store, backendUrl: string): Promise<string> {
  const adminToken = process.env.SPNR_ADMIN_TOKEN;
  const adminHeaders = adminToken ? { "X-Admin-Token": adminToken } : undefined;
  const [stats, serve, devicesResp] = await Promise.all([
    fetchJson(`${backendUrl}/api/stats`),
    fetchJson(`${backendUrl}/v1/serve`),
    fetchJson(`${backendUrl}/admin/devices`, adminHeaders),
  ]);
  const campaigns = store.list();
  const winner = store.auctionWinner();
  const creatives = (serve?.creatives as ServeCreative[] | undefined) ?? [];
  const devices = (devicesResp?.devices as DeviceRow[] | undefined) ?? [];

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
        ${statCard("ledger", s("ledger_balanced") === "true" ? "OK ✓" : "UNBAL")}
      </div>`
    : `<div class="warn">network backend unreachable at <code>${esc(backendUrl)}</code> — stats + active pool unavailable.</div>`;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="10">
<title>spnr · admin</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&family=Martian+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{
    --bg:#F2F2F0; --surface:#FFFFFF; --surface2:#E9E9E6;
    --text:#121212; --text2:#565654; --text3:#8E8E8A;
    --line:#121212; --ember:#0B7A4F; --ember-text:#0A5D3C;
    --green:#00955E; --shadow:#121212; --red:#B42318;
    --display:'Archivo', system-ui, sans-serif;
    --mono:'Martian Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  *{ box-sizing:border-box; }
  html,body{ margin:0; padding:0; background:var(--bg); }
  body{ color:var(--text); font:17px/1.45 var(--display); -webkit-font-smoothing:antialiased; }
  ::selection{ background:var(--ember); color:#fff; }
  @keyframes spnr-blink{ 0%,49%{opacity:1;} 50%,100%{opacity:0;} }
  @keyframes spnr-rise{ from{opacity:0; transform:translateY(8px);} to{opacity:1; transform:translateY(0);} }

  .frame{ max-width:1240px; margin:0 auto; background:var(--bg); border-left:2px solid var(--line); border-right:2px solid var(--line); }

  /* nav */
  header{ display:flex; align-items:center; justify-content:space-between; gap:24px; padding:22px 32px; border-bottom:2px solid var(--line); }
  .brand{ display:flex; align-items:center; gap:11px; }
  .wordmark{ font-family:var(--display); font-weight:900; font-size:24px; letter-spacing:-0.04em; text-transform:uppercase; }
  .wordmark span{ animation:spnr-blink 1.1s step-end infinite; color:var(--ember); }
  .dot{ width:10px; height:10px; background:var(--ember); display:inline-block; }
  .tag{ font-family:var(--mono); font-size:11px; letter-spacing:0.06em; text-transform:uppercase; color:var(--text2); }

  /* section header band */
  .sec{ border-bottom:2px solid var(--line); }
  .sechd{ display:flex; align-items:center; gap:16px; padding:18px 32px; border-bottom:2px solid var(--line); }
  .secn{ font-family:var(--mono); font-size:11px; border:2px solid var(--line); padding:4px 9px; color:var(--ember-text); letter-spacing:0.06em; }
  .sectitle{ font-family:var(--display); font-weight:800; font-size:15px; letter-spacing:0.12em; text-transform:uppercase; }
  .seccount{ margin-left:auto; font-family:var(--mono); font-size:11px; letter-spacing:0.06em; text-transform:uppercase; color:var(--text3); }
  .secbody{ padding:32px; }

  /* stat cells */
  .cards{ display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); }
  .cell{ border-right:2px solid var(--line); border-bottom:2px solid var(--line); padding:20px 22px; animation:spnr-rise .4s ease-out backwards; }
  .cell:nth-child(2){ animation-delay:.04s; } .cell:nth-child(3){ animation-delay:.08s; }
  .cell:nth-child(4){ animation-delay:.12s; } .cell:nth-child(5){ animation-delay:.16s; }
  .cell:nth-child(6){ animation-delay:.2s; } .cell:nth-child(7){ animation-delay:.24s; }
  .cell-label{ font-family:var(--mono); font-size:10.5px; letter-spacing:0.08em; text-transform:uppercase; color:var(--text3); margin-bottom:10px; }
  .cell-value{ font-family:var(--mono); font-size:28px; font-weight:700; letter-spacing:-0.03em; color:var(--text); line-height:1; overflow-wrap:anywhere; }
  .cell-value.accent{ color:var(--ember); }
  .warn{ margin:0; background:var(--surface); border:2px solid var(--red); color:var(--red); padding:18px 22px; font-family:var(--mono); font-size:13px; box-shadow:6px 6px 0 var(--red); }
  .warn code{ background:transparent; border:none; padding:0; color:var(--red); }

  /* tables */
  .tablewrap{ border:2px solid var(--line); background:var(--surface); box-shadow:6px 6px 0 var(--shadow); }
  table{ width:100%; border-collapse:collapse; background:var(--surface); }
  th,td{ text-align:left; padding:13px 16px; border-bottom:2px solid var(--line); font-size:13px; vertical-align:top; }
  th{ font-family:var(--mono); color:var(--text3); font-weight:600; letter-spacing:0.08em; text-transform:uppercase; font-size:10.5px; background:var(--surface2); }
  td{ font-family:var(--display); color:var(--text); }
  tr:last-child td{ border-bottom:none; }
  td.num,.num{ font-family:var(--mono); letter-spacing:-0.02em; }
  .row-on{ background:rgba(11,122,79,.07); }
  code{ font-family:var(--mono); color:var(--text); background:var(--surface2); padding:2px 6px; border:2px solid var(--line); font-size:11.5px; }
  a{ color:var(--ember); text-decoration:none; font-family:var(--mono); font-size:12px; }
  a:hover{ text-decoration:underline; }

  /* pills */
  .pill{ display:inline-block; font-family:var(--mono); padding:3px 9px; font-size:10px; letter-spacing:0.08em; text-transform:uppercase; border:2px solid var(--line); color:var(--text3); }
  .pill-on{ border-color:var(--ember); color:#fff; background:var(--ember); }

  .dim{ color:var(--text3); }

  /* add-ad form */
  form.adform{ display:grid; grid-template-columns:1fr 1fr auto; gap:18px; align-items:end; border:2px solid var(--line); background:var(--surface); box-shadow:6px 6px 0 var(--shadow); padding:24px; }
  form.adform label{ display:flex; flex-direction:column; gap:8px; font-family:var(--mono); font-size:10.5px; letter-spacing:0.08em; color:var(--text3); text-transform:uppercase; }
  form.adform .full{ grid-column:1 / -1; }
  input[type=text], input[type=url]{ background:var(--surface); border:2px solid var(--line); color:var(--text); padding:11px 13px; font:13px/1.4 var(--mono); }
  input[type=text]::placeholder, input[type=url]::placeholder{ color:var(--text3); }
  input:focus{ outline:none; border-color:var(--ember); box-shadow:3px 3px 0 var(--ember); }
  button{ cursor:pointer; font-family:var(--mono); letter-spacing:0.06em; text-transform:uppercase; }
  .btn{ background:var(--ember); color:#fff; border:2px solid var(--line); padding:13px 22px; font-size:12px; font-weight:600; transition:background .12s,color .12s; }
  .btn:hover{ background:var(--text); color:var(--bg); }
  form.inline{ display:inline; margin:0; }
  .btn-del{ background:transparent; border:2px solid var(--line); color:var(--text2); padding:5px 12px; font-size:10.5px; letter-spacing:0.06em; transition:background .12s,color .12s,border-color .12s; }
  .btn-del:hover{ border-color:var(--red); background:var(--red); color:#fff; }

  /* footer */
  footer{ display:flex; flex-wrap:wrap; gap:14px 24px; align-items:center; padding:28px 32px; font-family:var(--mono); font-size:11px; letter-spacing:0.04em; text-transform:uppercase; color:var(--text3); }
  footer code{ font-size:11px; }
</style>
</head><body><div class="frame">
  <header>
    <div class="brand">
      <span class="wordmark">spnr<span>_</span></span>
      <span class="dot"></span>
    </div>
    <div class="tag">ADMIN · network operator · auto-refresh 10s</div>
  </header>

  <section class="sec">
    <div class="sechd"><span class="secn">[ 01 ]</span><span class="sectitle">Network</span></div>
    <div class="secbody" style="padding:0;">${statsPanel}</div>
  </section>

  <section class="sec">
    <div class="sechd"><span class="secn">[ 02 ]</span><span class="sectitle">Add advertisement</span></div>
    <div class="secbody">
      <form class="adform" method="POST" action="/admin/ads">
        <label class="full">creative text
          <input type="text" name="text" placeholder="CloakPipe — privacy-safe LLM apps →" required>
        </label>
        <label>destination url
          <input type="url" name="url" placeholder="https://cloakpipe.com" required>
        </label>
        <label>advertiser
          <input type="text" name="advertiser" placeholder="house">
        </label>
        <button type="submit" class="btn">add to serving pool</button>
      </form>
    </div>
  </section>

  <section class="sec">
    <div class="sechd"><span class="secn">[ 03 ]</span><span class="sectitle">Active advertisements — serving pool</span><span class="seccount">${creatives.length} live</span></div>
    <div class="secbody">
      <div class="tablewrap"><table>
        <thead><tr><th>#</th><th>creative</th><th>id</th><th>click code</th><th>status</th><th>action</th></tr></thead>
        <tbody>${activeAdsRows(creatives, backendUrl)}</tbody>
      </table></div>
    </div>
  </section>

  <section class="sec">
    <div class="sechd"><span class="secn">[ 04 ]</span><span class="sectitle">Connected sessions</span><span class="seccount">${devices.length} devices</span></div>
    <div class="secbody">
      <div class="tablewrap"><table>
        <thead><tr><th>email</th><th>ip</th><th>os</th><th>hostname</th><th>version</th><th>impressions</th><th>last seen</th></tr></thead>
        <tbody>${deviceRows(devices)}</tbody>
      </table></div>
    </div>
  </section>

  <section class="sec">
    <div class="sechd"><span class="secn">[ 05 ]</span><span class="sectitle">Campaigns — demand side</span><span class="seccount">${campaigns.length} total</span></div>
    <div class="secbody">
      <div class="tablewrap"><table>
        <thead><tr><th>advertiser</th><th>campaign</th><th>$ / block</th><th>creative</th><th>status</th><th>created</th></tr></thead>
        <tbody>${campaignRows(campaigns, winner ? winner.id : null)}</tbody>
      </table></div>
    </div>
  </section>

  <footer>
    <span>backend: <code>${esc(backendUrl)}</code></span>
    <span>auction winner: ${winner ? `<code>${esc(winner.name)}</code> @ $${esc(winner.pricePerBlockUsd.toFixed(2))}/block` : "none"}</span>
    <span>API: <a href="/v2/campaigns">/v2/campaigns</a> · <a href="/v2/auction">/v2/auction</a></span>
  </footer>
</div></body></html>`;
}
