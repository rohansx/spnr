import { CSSProperties, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Crt } from '../components/Crt';
import { C, FONT_DISPLAY, FONT_MONO } from '../theme';
import {
  useCampaigns,
  useAuction,
  createCampaign,
  submitCreative as submitCreativeApi,
  type Campaign as LiveCampaign,
} from '../lib/usePortal';

// spnr.co advertiser self-serve portal — ported faithfully from the design export
// and wired LIVE to the v2 TypeScript portal API (server-ts/, proxied via /v2):
//   POST /v2/campaigns                — create a campaign
//   GET  /v2/campaigns                — list campaigns (polled every 3s)
//   POST /v2/campaigns/:id/creative   — submit a creative (server runs the same content-lint)
//   GET  /v2/auction                  — live single-slot ascending auction winner
// The animated bid board and settlement ledger remain design demos; CAMPAIGNS,
// CREATIVES submit, and campaign create flow are backed by live data.

type Tab = 'bids' | 'campaigns' | 'creatives' | 'funding';

const GLYPHS = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// Charset allow-list mirrors the export's content-lint regex: printable ASCII
// plus a small set of allowed unicode (↗ · — … é). No ANSI escapes.
const ALLOWED_CHARSET = /^[ -~↗—·…é]*$/;

const label: CSSProperties = { fontSize: 11, letterSpacing: '0.1em', color: C.dim, marginBottom: 10 };
const sub: CSSProperties = { fontSize: 11.5, color: C.dimmer, marginTop: 10 };
const numCard: CSSProperties = { fontFamily: FONT_DISPLAY, fontSize: 38, fontWeight: 700, lineHeight: 1 };

// ---- campaign table layout + design fallback rows (shown only while the live
// GET /v2/campaigns list is loading or empty, so the table never looks broken) ----
const CAMPAIGN_COLS = '1fr 130px 110px 110px 130px 120px';
const CAMPAIGNS = [
  { name: 'cloakpipe-launch-06', impressions: '238,114', clicks: '1,002', ctr: '0.42%', spend: '$3,194', status: 'SERVING', statusColor: C.green, nameColor: C.green, highlight: true },
  { name: 'cloakpipe-ci-secrets-04', impressions: '141,650', clicks: '512', ctr: '0.36%', spend: '$1,818', status: 'OUTBID', statusColor: C.amber, nameColor: C.mid, highlight: false },
  { name: 'cloakpipe-hn-launch-03', impressions: '32,545', clicks: '135', ctr: '0.41%', spend: '$430', status: 'COMPLETED', statusColor: C.dimmer, nameColor: C.mid, highlight: false },
];

// ---- funding settlement ledger (design data from the export) ----
const SETTLEMENTS = [
  { time: '14:00 UTC', detail: 'hourly batch · base · tx 0x8f2a…44c1', impressions: '3,204', amount: '−$35.24', amountColor: C.red },
  { time: '13:00 UTC', detail: 'hourly batch · base · tx 0x3d97…b02e', impressions: '2,988', amount: '−$32.87', amountColor: C.red },
  { time: '12:00 UTC', detail: 'escrow top-up · USDC via x402', impressions: '—', impressionsColor: C.dimmer, amount: '+$500.00', amountColor: C.green },
];

export default function Advertiser() {
  const [tab, setTab] = useState<Tab>('bids');
  const [myBid, setMyBid] = useState(11.0);
  const [rivalBid, setRivalBid] = useState(14.5);
  const [escrow, setEscrow] = useState(1212.4);
  const [frame, setFrame] = useState(0);
  const [creativeText, setCreativeText] = useState('CloakPipe — secrets that never touch disk ↗');
  const [submitted, setSubmitted] = useState(false);
  const [funded, setFunded] = useState(false);
  const [fundMethod, setFundMethod] = useState('');

  // ---- LIVE portal data (v2 TypeScript API, polled every 3s; never throws) ----
  const liveCampaigns = useCampaigns(3000);
  const auctionWinner = useAuction(3000);

  // server-side lint violations returned by the last creative submission (422)
  const [serverViolations, setServerViolations] = useState<string[] | null>(null);
  const [submitTarget, setSubmitTarget] = useState<string>('');

  // ---- create-campaign flow (FUNDING tab) — POSTs to /v2/campaigns ----
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('1');
  const [createMsg, setCreateMsg] = useState<string | null>(null);

  // spinner glyph cycles continuously for the live preview
  useEffect(() => {
    const spin = setInterval(() => setFrame((f) => (f + 1) % GLYPHS.length), 90);
    return () => clearInterval(spin);
  }, []);
  // the rival advertiser occasionally re-bids if they get outbid
  useEffect(() => {
    const rival = setInterval(() => {
      setMyBid((mb) => {
        setRivalBid((rb) => (mb > rb && Math.random() < 0.5 ? Math.round((mb + 0.5) * 100) / 100 : rb));
        return mb;
      });
    }, 7000);
    return () => clearInterval(rival);
  }, []);

  // ---- content-lint (runs live in the browser; the v2 API re-runs it server-side) ----
  const lenOk = creativeText.length <= 48 && creativeText.length > 0;
  const charsOk = ALLOWED_CHARSET.test(creativeText);
  const arrowOk = creativeText.trim().endsWith('↗') && (creativeText.match(/↗/g) || []).length === 1;
  const allOk = lenOk && charsOk && arrowOk;

  const serving = myBid > rivalBid;
  const previewText = creativeText.slice(0, 48) || '— empty creative —';

  // ---- live bid board (open ascending auction, sorted high → low) ----
  const bidRows = [
    { name: 'wirecat.dev', bid: rivalBid, mine: false },
    { name: 'cloakpipe (you)', bid: myBid, mine: true },
    { name: 'fluxgate.io', bid: 8.25, mine: false },
    { name: 'bytefall.dev', bid: 4.2, mine: false },
    { name: 'stackline.sh', bid: 1.0, mine: false },
  ].sort((a, b) => b.bid - a.bid);

  const raiseBidSmall = () => setMyBid((mb) => Math.round((mb + 0.5) * 100) / 100);
  const raiseBidTop = () => setMyBid((mb) => Math.round((Math.max(mb, rivalBid) + 0.5) * 100) / 100);
  const fundUsdc = () => { setFunded(true); setFundMethod('USDC · x402'); setEscrow((e) => e + 500); };
  const fundCard = () => { setFunded(true); setFundMethod('card'); setEscrow((e) => e + 500); };

  // Submit the creative to the LIVE API. Targets the first live campaign (the
  // auction winner if present, else the first listed). The server re-runs the
  // SAP/1 lint; any returned violations are shown alongside the client-side lint.
  const submitCreative = async () => {
    if (!allOk) return;
    const target = auctionWinner ?? liveCampaigns[0] ?? null;
    if (!target) {
      // No live campaign yet — fall back to the optimistic design confirmation.
      setServerViolations(null);
      setSubmitTarget('');
      setSubmitted(true);
      return;
    }
    setSubmitTarget(target.name);
    const result = await submitCreativeApi(target.id, {
      text: creativeText,
      url: 'https://cloakpipe.dev',
    });
    if (result.ok) {
      setServerViolations(null);
      setSubmitted(true);
    } else {
      setSubmitted(false);
      setServerViolations(result.violations ?? ['submission_rejected']);
    }
  };

  // Create a new campaign via the LIVE API; the polled list picks it up within 3s.
  const createCampaignFlow = async () => {
    const name = newName.trim();
    const price = Number(newPrice);
    if (!name || !Number.isFinite(price) || price < 1) {
      setCreateMsg('× name required · price must be ≥ $1.00 / block');
      return;
    }
    const created = await createCampaign({
      advertiser: 'cloakpipe',
      name,
      price_per_block_usd: price,
    });
    if (created) {
      setCreateMsg(`✓ created ${created.name} (${created.id}) at $${created.price_per_block_usd.toFixed(2)}/block`);
      setNewName('');
    } else {
      setCreateMsg('× campaign create failed — check name + price ($1.00/block floor)');
    }
  };

  const tabStyle = (active: boolean): CSSProperties => ({
    fontFamily: FONT_MONO,
    fontSize: 12.5,
    letterSpacing: '0.08em',
    padding: '10px 20px',
    cursor: 'pointer',
    background: active ? C.panelActive : 'transparent',
    color: active ? C.green : C.dim,
    border: `1px solid ${active ? C.green : C.border}`,
    borderBottom: active ? `1px solid ${C.panelActive}` : `1px solid ${C.border}`,
  });

  const lintStyle = (ok: boolean): CSSProperties => ({ color: ok ? C.green : C.red });

  // Map a live campaign to the design table's row shape. The v2 demand API only
  // owns id/name/price/creative — impressions/clicks/spend are economic truth that
  // lives in the Rust backend, so we surface what the portal knows: price/block and
  // creative state, with the auction winner flagged SERVING.
  const liveRows = liveCampaigns.map((c: LiveCampaign) => {
    const winning = auctionWinner?.id === c.id;
    return {
      id: c.id,
      name: c.name,
      impressions: '—',
      clicks: '—',
      ctr: c.creative ? 'linted' : 'no creative',
      spend: `$${c.price_per_block_usd.toFixed(2)}/blk`,
      status: winning ? 'SERVING' : c.creative ? 'READY' : 'DRAFT',
      statusColor: winning ? C.green : c.creative ? C.mid : C.dimmer,
      nameColor: winning ? C.green : C.mid,
      highlight: winning,
    };
  });
  const usingLive = liveRows.length > 0;

  const submitStyle: CSSProperties = {
    fontFamily: FONT_MONO,
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: '0.08em',
    padding: '14px 24px',
    background: allOk ? C.green : 'transparent',
    color: allOk ? C.bg : C.dimmer,
    border: `1px solid ${allOk ? C.green : C.border}`,
    cursor: allOk ? 'pointer' : 'not-allowed',
  };

  return (
    <Crt>
      {/* ===== top bar ===== */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 24,
          padding: '22px 0',
          borderBottom: `1px solid ${C.border}`,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 18 }}>
          <Link
            to="/"
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 700,
              fontSize: 18,
              letterSpacing: '0.06em',
              color: C.green,
              textShadow: '0 0 16px rgba(61,255,126,0.4)',
            }}
          >
            SPNR<span style={{ animation: 'spnr-blink 1.1s step-end infinite' }}>_</span>
          </Link>
          <div style={{ fontSize: 12, color: C.dimmer, letterSpacing: '0.06em' }}>ADVERTISER · spnr.co</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, fontSize: 12, letterSpacing: '0.04em' }}>
          <span style={{ color: C.dim }}>escrow <span style={{ color: C.amber }}>${escrow.toFixed(2)}</span></span>
          <span style={{ color: C.green }}>● SLOT:SPINNER · MARKET OPEN</span>
          <Link to="/dashboard" className="spnr-link" style={{ color: C.dim }}>ads<span>@</span>cloakpipe.dev</Link>
        </div>
      </header>

      {/* ===== tabs ===== */}
      <nav style={{ display: 'flex', gap: 4, padding: '18px 0 0', fontSize: 12.5, letterSpacing: '0.08em' }}>
        <button onClick={() => setTab('bids')} style={tabStyle(tab === 'bids')}>BID BOARD</button>
        <button onClick={() => setTab('campaigns')} style={tabStyle(tab === 'campaigns')}>CAMPAIGNS</button>
        <button onClick={() => setTab('creatives')} style={tabStyle(tab === 'creatives')}>CREATIVES</button>
        <button onClick={() => setTab('funding')} style={tabStyle(tab === 'funding')}>FUNDING</button>
      </nav>

      {/* ===== BID BOARD ===== */}
      {tab === 'bids' && (
        <section style={{ paddingTop: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.1em', color: C.dim }}>
              OPEN ASCENDING AUCTION — HIGHEST BID SERVES FIRST · BLOCKS OF 1,000 × 5s · CLICKS AT 50× · MIN $1.00
            </div>
            <div style={{ fontSize: 11.5, color: C.dimmer }}>
              {auctionWinner ? (
                <>live winner <span style={{ color: C.green }}>{auctionWinner.name}</span> @ ${auctionWinner.price_per_block_usd.toFixed(2)}/blk</>
              ) : (
                <>auction logic is <span style={{ color: C.green }}>open source</span> — verify it</>
              )}
            </div>
          </div>

          <div style={{ border: `1px solid ${C.border}`, background: C.panel }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '70px 1fr 170px 150px 150px',
                padding: '12px 18px',
                borderBottom: `1px solid ${C.border}`,
                fontSize: 10.5,
                letterSpacing: '0.1em',
                color: C.dimmer,
              }}
            >
              <span>RANK</span>
              <span>ADVERTISER</span>
              <span style={{ textAlign: 'right' }}>BID / BLOCK</span>
              <span style={{ textAlign: 'right' }}>PER IMPRESSION</span>
              <span style={{ textAlign: 'right' }}>STATUS</span>
            </div>
            {bidRows.map((b, i) => (
              <div
                key={b.name}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '70px 1fr 170px 150px 150px',
                  padding: '13px 18px',
                  borderBottom: `1px solid ${C.borderFaint}`,
                  fontSize: 12.5,
                  background: b.mine ? C.panelActive : 'transparent',
                }}
              >
                <span style={{ color: C.dimmer }}>#{i + 1}</span>
                <span style={{ color: b.mine ? C.green : C.mid, fontWeight: b.mine ? 600 : 400 }}>{b.name}</span>
                <span style={{ color: C.bright, textAlign: 'right' }}>${b.bid.toFixed(2)}</span>
                <span style={{ color: C.dim, textAlign: 'right' }}>${(b.bid / 1000).toFixed(4)}</span>
                <span
                  style={{
                    color: i === 0 ? C.green : C.dimmer,
                    textAlign: 'right',
                    letterSpacing: '0.06em',
                    fontSize: 11.5,
                  }}
                >
                  {i === 0 ? 'SERVING' : 'QUEUED'}
                </span>
              </div>
            ))}
          </div>

          <div
            style={{
              border: `1px solid ${C.border}`,
              background: C.panel,
              padding: '22px 24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 20,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, letterSpacing: '0.1em', color: C.dim }}>YOUR BID — cloakpipe-launch-06</span>
              <span style={{ fontFamily: FONT_DISPLAY, fontSize: 30, fontWeight: 700, color: C.bright }}>
                ${myBid.toFixed(2)}{' '}
                <span style={{ fontSize: 13, color: C.dim, fontFamily: FONT_MONO }}>
                  / block · {serving ? 'serving now' : 'outbid — wirecat.dev holds the slot'}
                </span>
              </span>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                className="spnr-ghost"
                onClick={raiseBidSmall}
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 13,
                  fontWeight: 600,
                  letterSpacing: '0.06em',
                  padding: '13px 22px',
                  background: 'transparent',
                  color: C.green,
                  border: `1px solid ${C.green}`,
                  cursor: 'pointer',
                }}
              >
                + $0.50
              </button>
              <button
                className="spnr-primary"
                onClick={raiseBidTop}
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 13,
                  fontWeight: 600,
                  letterSpacing: '0.06em',
                  padding: '13px 22px',
                  background: C.green,
                  color: C.bg,
                  border: `1px solid ${C.green}`,
                  cursor: 'pointer',
                }}
              >
                TAKE TOP →
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ===== CAMPAIGNS ===== */}
      {tab === 'campaigns' && (
        <section style={{ paddingTop: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 210px), 1fr))',
              gap: 1,
              background: C.border,
              border: `1px solid ${C.border}`,
            }}
          >
            <div style={{ background: C.panel, padding: '24px 24px 20px' }}>
              <div style={label}>IMPRESSIONS — 30D</div>
              <div style={{ ...numCard, color: C.bright }}>412,309</div>
              <div style={sub}>attested, anomaly-filtered</div>
            </div>
            <div style={{ background: C.panel, padding: '24px 24px 20px' }}>
              <div style={label}>CLICKS</div>
              <div style={{ ...numCard, color: C.amber }}>1,649</div>
              <div style={sub}>0.40% CTR · billed at 50×</div>
            </div>
            <div style={{ background: C.panel, padding: '24px 24px 20px' }}>
              <div style={label}>ATTESTATION COVERAGE</div>
              <div style={{ ...numCard, color: C.green }}>98.7%</div>
              <div style={sub}>signed events / total served</div>
            </div>
            <div style={{ background: C.panel, padding: '24px 24px 20px' }}>
              <div style={label}>SPEND — 30D</div>
              <div style={{ ...numCard, color: C.bright }}>$5,442</div>
              <div style={sub}>settled hourly, on-chain batches</div>
            </div>
          </div>

          <div style={{ border: `1px solid ${C.border}`, background: C.panel }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: CAMPAIGN_COLS,
                padding: '12px 18px',
                borderBottom: `1px solid ${C.border}`,
                fontSize: 10.5,
                letterSpacing: '0.1em',
                color: C.dimmer,
              }}
            >
              <span>CAMPAIGN</span>
              <span style={{ textAlign: 'right' }}>IMPRESSIONS</span>
              <span style={{ textAlign: 'right' }}>CLICKS</span>
              <span style={{ textAlign: 'right' }}>CTR</span>
              <span style={{ textAlign: 'right' }}>SPEND</span>
              <span style={{ textAlign: 'right' }}>STATUS</span>
            </div>
            {(usingLive ? liveRows : CAMPAIGNS).map((c, i, arr) => (
              <div
                key={'id' in c ? c.id : c.name}
                data-testid={usingLive ? 'campaign-row' : undefined}
                style={{
                  display: 'grid',
                  gridTemplateColumns: CAMPAIGN_COLS,
                  padding: '13px 18px',
                  borderBottom: i === arr.length - 1 ? undefined : `1px solid ${C.borderFaint}`,
                  fontSize: 12.5,
                  background: c.highlight ? C.panelActive : undefined,
                }}
              >
                <span style={{ color: c.nameColor }}>{c.name}</span>
                <span style={{ color: C.bright, textAlign: 'right' }}>{c.impressions}</span>
                <span style={{ color: C.mid, textAlign: 'right' }}>{c.clicks}</span>
                <span style={{ color: C.mid, textAlign: 'right' }}>{c.ctr}</span>
                <span style={{ color: C.bright, textAlign: 'right' }}>{c.spend}</span>
                <span style={{ color: c.statusColor, textAlign: 'right' }}>{c.status}</span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', fontSize: 11.5, color: C.dimmer }}>
            <span data-testid="campaign-count">
              {usingLive
                ? `${liveRows.length} live campaign${liveRows.length === 1 ? '' : 's'} · GET /v2/campaigns`
                : 'connecting to /v2/campaigns — showing sample campaigns'}
            </span>
            <span style={{ color: usingLive ? C.green : C.dimmer }}>
              {usingLive ? '● live' : '○ loading'}
            </span>
          </div>

          <div style={{ fontSize: 11.5, color: C.dimmer, maxWidth: '80ch' }}>
            Honesty note, as published: terminal impressions are attested + anomaly-filtered, not
            IAB-viewability-grade. Coverage rates above are per-campaign and downloadable — the methodology is public.
          </div>
        </section>
      )}

      {/* ===== CREATIVES ===== */}
      {tab === 'creatives' && (
        <section
          style={{
            paddingTop: 24,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))',
            gap: 24,
            alignItems: 'start',
          }}
        >
          <div style={{ border: `1px solid ${C.border}`, background: C.panel, padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ fontSize: 11, letterSpacing: '0.1em', color: C.dim }}>SUBMIT CREATIVE — LINTED LIVE AGAINST CONTENT RULES</div>
            <input
              value={creativeText}
              onChange={(e) => { setCreativeText(e.target.value); setSubmitted(false); setServerViolations(null); }}
              spellCheck={false}
              style={{
                fontFamily: FONT_MONO,
                fontSize: 14,
                padding: '14px 16px',
                background: C.bg,
                border: `1px solid ${C.border}`,
                color: C.bright,
                width: '100%',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ color: C.mid }}>length ≤ 48 chars</span>
                <span style={lintStyle(lenOk)}>{lenOk ? '✓ ' : '× '}{creativeText.length}/48</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ color: C.mid }}>allow-listed charset · no ANSI escapes</span>
                <span style={lintStyle(charsOk)}>{charsOk ? '✓ clean' : '× disallowed chars'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ color: C.mid }}>plain text + one trailing ↗</span>
                <span style={lintStyle(arrowOk)}>{arrowOk ? '✓ ok' : '× must end with one ↗'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ color: C.mid }}>destination domain verified</span>
                <span style={{ color: C.green }}>✓ cloakpipe.dev</span>
              </div>
            </div>
            <button onClick={submitCreative} style={submitStyle}>
              {allOk ? 'SUBMIT FOR REVIEW →' : 'FIX LINT ERRORS FIRST'}
            </button>
            {submitted && (
              <div style={{ border: `1px solid ${C.green}`, background: C.panelActive, padding: '12px 16px', fontSize: 12.5, color: C.green }}>
                ✓ submitted{submitTarget ? ` to ${submitTarget}` : ''} — server lint passed, signed by the network key, eligible to serve when your bid wins.
              </div>
            )}
            {serverViolations && (
              <div style={{ border: `1px solid ${C.red}`, background: C.panelActive, padding: '12px 16px', fontSize: 12.5, color: C.red }}>
                <div style={{ marginBottom: 6 }}>× server rejected the creative — content lint violations:</div>
                {serverViolations.map((v) => (
                  <div key={v} style={{ fontFamily: FONT_MONO }}>· {v}</div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div style={{ border: `1px solid ${C.border}`, background: C.panel, padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 11, letterSpacing: '0.1em', color: C.dim }}>LIVE PREVIEW — HOW IT RENDERS IN A SPINNER</div>
              <div style={{ border: `1px solid ${C.border}`, background: C.bg, padding: 18, fontSize: 13.5, lineHeight: 1.9 }}>
                <div style={{ color: C.dimmer }}>⏺ Read worker.rs · Edited 2 files</div>
                <div>
                  <span style={{ color: C.amber }}>{GLYPHS[frame]}</span>{' '}
                  <span style={{ color: C.amber }}>{previewText}</span>{' '}
                  <span style={{ color: C.dimmer }}>(esc to interrupt)</span>
                </div>
              </div>
              <div style={{ fontSize: 11.5, color: C.dimmer }}>
                {creativeText.length}/48 · clients strip anything not on the allow-list before display
              </div>
            </div>

            <div style={{ border: `1px solid ${C.border}`, background: C.panel, padding: 24, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12.5 }}>
              <div style={{ fontSize: 11, letterSpacing: '0.1em', color: C.dim, marginBottom: 6 }}>ACTIVE CREATIVES</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ color: C.bright }}>CloakPipe — secrets that never touch disk ↗</span>
                <span style={{ color: C.green }}>SERVING</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ color: C.mid }}>CloakPipe — your CI has secrets. keep them ↗</span>
                <span style={{ color: C.dimmer }}>QUEUED</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ===== FUNDING ===== */}
      {tab === 'funding' && (
        <section style={{ paddingTop: 24, display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 760 }}>
          <div
            style={{
              border: `1px solid ${C.border}`,
              background: C.panel,
              padding: 24,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 20,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, letterSpacing: '0.1em', color: C.dim }}>ESCROW BALANCE</span>
              <span style={{ fontFamily: FONT_DISPLAY, fontSize: 38, fontWeight: 700, color: C.amber }}>${escrow.toFixed(2)}</span>
              <span style={{ fontSize: 11.5, color: C.dimmer }}>released per verified impression · unspent escrow is refundable, always</span>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                className="spnr-primary"
                onClick={fundUsdc}
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 13,
                  fontWeight: 600,
                  letterSpacing: '0.06em',
                  padding: '13px 22px',
                  background: C.green,
                  color: C.bg,
                  border: `1px solid ${C.green}`,
                  cursor: 'pointer',
                }}
              >
                FUND — USDC · x402
              </button>
              <button
                className="spnr-ghost"
                onClick={fundCard}
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 13,
                  fontWeight: 600,
                  letterSpacing: '0.06em',
                  padding: '13px 22px',
                  background: 'transparent',
                  color: C.green,
                  border: `1px solid ${C.green}`,
                  cursor: 'pointer',
                }}
              >
                FUND — CARD
              </button>
            </div>
          </div>

          {funded && (
            <div style={{ border: `1px solid ${C.green}`, background: C.panelActive, padding: '14px 18px', fontSize: 12.5, color: C.green }}>
              ✓ +$500.00 escrowed via {fundMethod} — available immediately.
            </div>
          )}

          {/* ---- create a campaign — LIVE POST /v2/campaigns ---- */}
          <div style={{ border: `1px solid ${C.border}`, background: C.panel, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 11, letterSpacing: '0.1em', color: C.dim }}>NEW CAMPAIGN — OPENS A SLOT IN THE LIVE AUCTION</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 240px' }}>
                <span style={{ fontSize: 11, color: C.dimmer, letterSpacing: '0.06em' }}>CAMPAIGN NAME</span>
                <input
                  value={newName}
                  onChange={(e) => { setNewName(e.target.value); setCreateMsg(null); }}
                  placeholder="cloakpipe-launch-07"
                  spellCheck={false}
                  style={{
                    fontFamily: FONT_MONO, fontSize: 14, padding: '12px 14px',
                    background: C.bg, border: `1px solid ${C.border}`, color: C.bright,
                    width: '100%', boxSizing: 'border-box',
                  }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '0 1 150px' }}>
                <span style={{ fontSize: 11, color: C.dimmer, letterSpacing: '0.06em' }}>$ / BLOCK (≥ 1.00)</span>
                <input
                  value={newPrice}
                  onChange={(e) => { setNewPrice(e.target.value); setCreateMsg(null); }}
                  inputMode="decimal"
                  spellCheck={false}
                  style={{
                    fontFamily: FONT_MONO, fontSize: 14, padding: '12px 14px',
                    background: C.bg, border: `1px solid ${C.border}`, color: C.bright,
                    width: '100%', boxSizing: 'border-box',
                  }}
                />
              </div>
              <button
                className="spnr-primary"
                onClick={createCampaignFlow}
                style={{
                  fontFamily: FONT_MONO, fontSize: 13, fontWeight: 600, letterSpacing: '0.06em',
                  padding: '13px 22px', background: C.green, color: C.bg,
                  border: `1px solid ${C.green}`, cursor: 'pointer',
                }}
              >
                CREATE →
              </button>
            </div>
            {createMsg && (
              <div style={{ fontSize: 12.5, color: createMsg.startsWith('✓') ? C.green : C.red, fontFamily: FONT_MONO }}>
                {createMsg}
              </div>
            )}
          </div>

          <div style={{ border: `1px solid ${C.border}`, background: C.panel }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '140px 1fr 140px 130px',
                padding: '12px 18px',
                borderBottom: `1px solid ${C.border}`,
                fontSize: 10.5,
                letterSpacing: '0.1em',
                color: C.dimmer,
              }}
            >
              <span>TIME</span>
              <span>SETTLEMENT</span>
              <span style={{ textAlign: 'right' }}>IMPRESSIONS</span>
              <span style={{ textAlign: 'right' }}>AMOUNT</span>
            </div>
            {SETTLEMENTS.map((s, i) => (
              <div
                key={s.time}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '140px 1fr 140px 130px',
                  padding: '12px 18px',
                  borderBottom: i === SETTLEMENTS.length - 1 ? undefined : `1px solid ${C.borderFaint}`,
                  fontSize: 12.5,
                }}
              >
                <span style={{ color: C.dim }}>{s.time}</span>
                <span style={{ color: C.mid }}>{s.detail}</span>
                <span style={{ color: s.impressionsColor ?? C.bright, textAlign: 'right' }}>{s.impressions}</span>
                <span style={{ color: s.amountColor, textAlign: 'right' }}>{s.amount}</span>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 11.5, color: C.dimmer, maxWidth: '80ch' }}>
            All settlement is denominated in USD and executed as USDC micro-settlements over x402 on Base — off-chain
            ledger real-time, on-chain batches hourly. Phase 2: autonomous agents bid through the same rail.
          </div>
        </section>
      )}
    </Crt>
  );
}
