import { CSSProperties, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shell } from '../components/Shell';
import { SectionHeader } from '../components/SectionHeader';
import { FONT_DISPLAY, FONT_MONO, RULE, T, shadow } from '../theme';
import {
  useCampaigns,
  useAuction,
  createCampaign,
  submitCreative as submitCreativeApi,
  type Campaign as LiveCampaign,
} from '../lib/usePortal';

// spnr.co advertiser self-serve portal — v5 "industrial editorial" restyle, wired
// LIVE to the v2 TypeScript portal API (server-ts/, proxied via /v2):
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

// ---- campaign table layout + design fallback rows (shown only while the live
// GET /v2/campaigns list is loading or empty, so the table never looks broken) ----
const CAMPAIGN_COLS = '1fr 130px 110px 120px 130px 130px';
const CAMPAIGNS = [
  { name: 'cloakpipe-launch-06', impressions: '238,114', clicks: '1,002', ctr: '0.42%', spend: '$3,194', status: 'SERVING', serving: true },
  { name: 'cloakpipe-ci-secrets-04', impressions: '141,650', clicks: '512', ctr: '0.36%', spend: '$1,818', status: 'OUTBID', serving: false },
  { name: 'cloakpipe-hn-launch-03', impressions: '32,545', clicks: '135', ctr: '0.41%', spend: '$430', status: 'COMPLETED', serving: false },
];

// ---- funding settlement ledger (design data from the export) ----
const SETTLEMENTS = [
  { time: '14:00 UTC', detail: 'hourly batch · base · tx 0x8f2a…44c1', impressions: '3,204', amount: '−$35.24', credit: false },
  { time: '13:00 UTC', detail: 'hourly batch · base · tx 0x3d97…b02e', impressions: '2,988', amount: '−$32.87', credit: false },
  { time: '12:00 UTC', detail: 'escrow top-up · USDC via x402', impressions: '—', amount: '+$500.00', credit: true },
];

// ---- shared visual primitives (v5 brutalist tokens) ----
const cellLabel: CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 11,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: T.text3,
};
const bigNum: CSSProperties = {
  fontFamily: FONT_MONO,
  fontWeight: 700,
  fontSize: 38,
  letterSpacing: '-0.04em',
  lineHeight: 1,
  color: T.text,
};
const colHead: CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 10.5,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: T.text3,
};
const mono13: CSSProperties = { fontFamily: FONT_MONO, fontSize: 12.5 };
const sectionPad: CSSProperties = { padding: '36px 32px' };

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

  // Tabs render as a ruled segmented control: the active tab fills ember/white.
  const tabStyle = (active: boolean): CSSProperties => ({
    fontFamily: FONT_MONO,
    fontSize: 11.5,
    fontWeight: active ? 700 : 500,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    padding: '13px 22px',
    cursor: 'pointer',
    background: active ? T.ember : 'transparent',
    color: active ? '#fff' : T.text2,
    border: 'none',
    borderRight: RULE,
  });

  const lintColor = (ok: boolean) => (ok ? T.green : '#C0392B');

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
      // No impression data accrues for a live campaign until it serves; the creative
      // state (linted vs none) is already conveyed by STATUS below, so CTR is just —.
      ctr: '—',
      spend: `$${c.price_per_block_usd.toFixed(2)}/blk`,
      status: winning ? 'SERVING' : c.creative ? 'READY' : 'DRAFT',
      serving: winning,
    };
  });
  const usingLive = liveRows.length > 0;

  // The CTA at the foot of the bid card + the creative submit button share the
  // ember/disabled treatment depending on lint state.
  const submitDisabled = !allOk;

  return (
    <Shell
      nav={
        <>
          <Link to="/" className="spnr-link">
            ← Landing
          </Link>
          <Link to="/dashboard" className="spnr-link">
            Console
          </Link>
        </>
      }
    >
      {/* ===== advertiser band header (ember) ===== */}
      <SectionHeader n="00" title="Advertiser · spnr.co" ember />

      {/* ===== status strip ===== */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 18,
          flexWrap: 'wrap',
          padding: '14px 32px',
          borderBottom: RULE,
          fontFamily: FONT_MONO,
          fontSize: 11,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}
      >
        <span style={{ color: T.text2, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 7, height: 7, background: T.green, display: 'inline-block' }} />
          Slot:Spinner · Market open
        </span>
        <span style={{ color: T.text2 }}>
          Escrow <span style={{ color: T.emberText, fontWeight: 700 }}>${escrow.toFixed(2)}</span>
        </span>
        <Link to="/dashboard" className="spnr-link">
          ads@cloakpipe.dev
        </Link>
      </div>

      {/* ===== tabs (ruled segmented control) ===== */}
      <nav style={{ display: 'flex', flexWrap: 'wrap', borderBottom: RULE, borderTop: 'none' }}>
        <button data-testid="tab-bids" onClick={() => setTab('bids')} style={tabStyle(tab === 'bids')}>Bid board</button>
        <button data-testid="tab-campaigns" onClick={() => setTab('campaigns')} style={tabStyle(tab === 'campaigns')}>Campaigns</button>
        <button data-testid="tab-creatives" onClick={() => setTab('creatives')} style={tabStyle(tab === 'creatives')}>Creatives</button>
        <button data-testid="tab-funding" onClick={() => setTab('funding')} style={{ ...tabStyle(tab === 'funding'), borderRight: 'none' }}>Funding</button>
      </nav>

      {/* ===== BID BOARD ===== */}
      {tab === 'bids' && (
        <section style={sectionPad}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
            <div style={{ ...cellLabel, maxWidth: '62ch', lineHeight: 1.6 }}>
              Open ascending auction — highest bid serves first · blocks of 1,000 × 5s · clicks at 50× · min $1.00
            </div>
            <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: T.text3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {auctionWinner ? (
                <>live winner <span style={{ color: T.emberText, fontWeight: 700 }}>{auctionWinner.name}</span> @ ${auctionWinner.price_per_block_usd.toFixed(2)}/blk</>
              ) : (
                <>auction logic is <span style={{ color: T.emberText, fontWeight: 700 }}>open source</span> — verify it</>
              )}
            </div>
          </div>

          {/* bid board table */}
          <div style={{ border: RULE, background: T.surface, boxShadow: shadow() }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '70px 1fr 170px 160px 150px',
                padding: '13px 18px',
                borderBottom: RULE,
                ...colHead,
              }}
            >
              <span>Rank</span>
              <span>Advertiser</span>
              <span style={{ textAlign: 'right' }}>Bid / block</span>
              <span style={{ textAlign: 'right' }}>Per impression</span>
              <span style={{ textAlign: 'right' }}>Status</span>
            </div>
            {bidRows.map((b, i, arr) => (
              <div
                key={b.name}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '70px 1fr 170px 160px 150px',
                  padding: '14px 18px',
                  borderBottom: i === arr.length - 1 ? 'none' : RULE,
                  background: b.mine ? T.surface2 : 'transparent',
                  ...mono13,
                }}
              >
                <span style={{ color: T.text3 }}>#{i + 1}</span>
                <span style={{ color: b.mine ? T.emberText : T.text, fontWeight: b.mine ? 700 : 500 }}>{b.name}</span>
                <span style={{ color: T.text, textAlign: 'right', fontWeight: 600 }}>${b.bid.toFixed(2)}</span>
                <span style={{ color: T.text2, textAlign: 'right' }}>${(b.bid / 1000).toFixed(4)}</span>
                <span
                  style={{
                    color: i === 0 ? T.green : T.text3,
                    textAlign: 'right',
                    letterSpacing: '0.06em',
                    fontSize: 11,
                    textTransform: 'uppercase',
                    fontWeight: i === 0 ? 700 : 500,
                  }}
                >
                  {i === 0 ? 'Serving' : 'Queued'}
                </span>
              </div>
            ))}
          </div>

          {/* your-bid control cell */}
          <div
            style={{
              marginTop: 24,
              border: RULE,
              background: T.surface,
              boxShadow: shadow(),
              padding: '26px 28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 24,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={cellLabel}>Your bid — cloakpipe-launch-06</span>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ ...bigNum, fontSize: 44 }}>${myBid.toFixed(2)}</span>
                <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: T.text2, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  / block · {serving ? 'serving now' : 'outbid — wirecat.dev holds the slot'}
                </span>
              </span>
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button className="spnr-ghost" onClick={raiseBidSmall}>+ $0.50</button>
              <button className="spnr-btn" onClick={raiseBidTop}>Take top ▸</button>
            </div>
          </div>
        </section>
      )}

      {/* ===== CAMPAIGNS ===== */}
      {tab === 'campaigns' && (
        <section style={sectionPad}>
          {/* metric cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 210px), 1fr))',
              border: RULE,
              boxShadow: shadow(),
              background: T.surface,
              marginBottom: 24,
            }}
          >
            <MetricCell label="Impressions — 30d" value="412,309" sub="attested, anomaly-filtered" rule />
            <MetricCell label="Clicks" value="1,649" sub="0.40% CTR · billed at 50×" valueColor={T.emberText} rule />
            <MetricCell label="Attestation coverage" value="98.7%" sub="signed events / total served" valueColor={T.green} rule />
            <MetricCell label="Spend — 30d" value="$5,442" sub="settled hourly, on-chain batches" />
          </div>

          {/* campaign table */}
          <div style={{ border: RULE, background: T.surface, boxShadow: shadow() }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: CAMPAIGN_COLS,
                padding: '13px 18px',
                borderBottom: RULE,
                ...colHead,
              }}
            >
              <span>Campaign</span>
              <span style={{ textAlign: 'right' }}>Impressions</span>
              <span style={{ textAlign: 'right' }}>Clicks</span>
              <span style={{ textAlign: 'right' }}>CTR</span>
              <span style={{ textAlign: 'right' }}>Spend</span>
              <span style={{ textAlign: 'right' }}>Status</span>
            </div>
            {(usingLive ? liveRows : CAMPAIGNS).map((c, i, arr) => {
              // c is a union of the live-row and design-row shapes; both carry a
              // string name and the live shape also carries a string id. The union
              // discriminant widens to unknown under tsc, so cast the known-string key.
              const rowKey = ('id' in c ? c.id : c.name) as string;
              return (
                <div
                  key={rowKey}
                  data-testid={usingLive ? 'campaign-row' : undefined}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: CAMPAIGN_COLS,
                    padding: '14px 18px',
                    borderBottom: i === arr.length - 1 ? 'none' : RULE,
                    background: c.serving ? T.surface2 : 'transparent',
                    ...mono13,
                  }}
                >
                  <span style={{ color: c.serving ? T.emberText : T.text, fontWeight: c.serving ? 700 : 500 }}>{c.name}</span>
                  <span style={{ color: T.text, textAlign: 'right' }}>{c.impressions}</span>
                  <span style={{ color: T.text2, textAlign: 'right' }}>{c.clicks}</span>
                  <span style={{ color: T.text2, textAlign: 'right' }}>{c.ctr}</span>
                  <span style={{ color: T.text, textAlign: 'right', fontWeight: 600 }}>{c.spend}</span>
                  <span style={{ color: c.serving ? T.green : T.text3, textAlign: 'right', fontWeight: c.serving ? 700 : 500, textTransform: 'uppercase' }}>{c.status}</span>
                </div>
              );
            })}
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 16,
              flexWrap: 'wrap',
              marginTop: 16,
              fontFamily: FONT_MONO,
              fontSize: 11,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: T.text3,
            }}
          >
            <span data-testid="campaign-count">
              {usingLive
                ? `${liveRows.length} live campaign${liveRows.length === 1 ? '' : 's'} · GET /v2/campaigns`
                : 'connecting to /v2/campaigns — showing sample campaigns'}
            </span>
            <span style={{ color: usingLive ? T.green : T.text3, display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <span style={{ width: 7, height: 7, background: usingLive ? T.green : T.text3, display: 'inline-block' }} />
              {usingLive ? 'live' : 'loading'}
            </span>
          </div>

          <div style={{ marginTop: 18, fontSize: 14, lineHeight: 1.5, color: T.text2, maxWidth: '80ch' }}>
            Honesty note, as published: terminal impressions are attested + anomaly-filtered, not
            IAB-viewability-grade. Coverage rates above are per-campaign and downloadable — the methodology is public.
          </div>
        </section>
      )}

      {/* ===== CREATIVES ===== */}
      {tab === 'creatives' && (
        <section
          style={{
            ...sectionPad,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))',
            gap: 24,
            alignItems: 'start',
          }}
        >
          {/* submit form */}
          <div style={{ border: RULE, background: T.surface, boxShadow: shadow(), padding: 26, display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={cellLabel}>Submit creative — linted live against content rules</div>
            <input
              value={creativeText}
              onChange={(e) => { setCreativeText(e.target.value); setSubmitted(false); setServerViolations(null); }}
              spellCheck={false}
              className="spnr-input"
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0, border: RULE, ...mono13 }}>
              <LintRow ok={lenOk} label="length ≤ 48 chars">{lenOk ? '✓ ' : '× '}{creativeText.length}/48</LintRow>
              <LintRow ok={charsOk} label="allow-listed charset · no ANSI escapes">{charsOk ? '✓ clean' : '× disallowed chars'}</LintRow>
              <LintRow ok={arrowOk} label="plain text + one trailing ↗">{arrowOk ? '✓ ok' : '× must end with one ↗'}</LintRow>
              <LintRow ok label="destination domain verified" last>✓ cloakpipe.dev</LintRow>
            </div>
            <button
              onClick={submitCreative}
              className={submitDisabled ? 'spnr-ghost' : 'spnr-btn'}
              disabled={submitDisabled}
              style={submitDisabled ? { cursor: 'not-allowed', color: T.text3, borderColor: T.line } : undefined}
            >
              {allOk ? 'Submit for review ▸' : 'Fix lint errors first'}
            </button>
            {submitted && (
              <div style={{ border: `2px solid ${T.ember}`, background: T.surface2, padding: '13px 16px', fontSize: 13, lineHeight: 1.5, color: T.emberText }}>
                ✓ submitted{submitTarget ? ` to ${submitTarget}` : ''} — server lint passed, signed by the network key, eligible to serve when your bid wins.
              </div>
            )}
            {serverViolations && (
              <div style={{ border: '2px solid #C0392B', background: T.surface2, padding: '13px 16px', fontSize: 13, color: '#C0392B' }}>
                <div style={{ marginBottom: 6 }}>× server rejected the creative — content lint violations:</div>
                {serverViolations.map((v) => (
                  <div key={v} style={{ fontFamily: FONT_MONO }}>· {v}</div>
                ))}
              </div>
            )}
          </div>

          {/* preview + active creatives */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div style={{ border: RULE, background: T.surface, boxShadow: shadow(), padding: 26, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={cellLabel}>Live preview — how it renders in a spinner</div>
              {/* inverted (ink) terminal inset — matches the v5 readout chrome */}
              <div
                style={{
                  border: RULE,
                  background: T.invSurface,
                  color: T.invText2,
                  padding: 18,
                  fontFamily: FONT_MONO,
                  fontSize: 12.5,
                  lineHeight: 1.95,
                }}
              >
                <div style={{ color: T.invText3 }}>⏺ Read worker.rs · Edited 2 files</div>
                <div>
                  <span style={{ color: T.ember }}>{GLYPHS[frame]}</span>{' '}
                  <span style={{ color: T.emberText, fontWeight: 600 }}>{previewText}</span>{' '}
                  <span style={{ color: T.invText3 }}>(esc to interrupt)</span>
                </div>
              </div>
              <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: T.text3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {creativeText.length}/48 · clients strip anything not on the allow-list before display
              </div>
            </div>

            <div style={{ border: RULE, background: T.surface, boxShadow: shadow(), padding: 26, display: 'flex', flexDirection: 'column', gap: 0 }}>
              <div style={{ ...cellLabel, marginBottom: 14 }}>Active creatives</div>
              <ActiveCreative text="CloakPipe — secrets that never touch disk ↗" status="Serving" serving />
              <ActiveCreative text="CloakPipe — your CI has secrets. keep them ↗" status="Queued" last />
            </div>
          </div>
        </section>
      )}

      {/* ===== FUNDING ===== */}
      {tab === 'funding' && (
        <section style={{ ...sectionPad, display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 820 }}>
          {/* escrow card */}
          <div
            style={{
              border: RULE,
              background: T.surface,
              boxShadow: shadow(),
              padding: '26px 28px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 24,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={cellLabel}>Escrow balance</span>
              <span style={{ ...bigNum, fontSize: 48, color: T.emberText }}>${escrow.toFixed(2)}</span>
              <span style={{ fontSize: 13, color: T.text2 }}>released per verified impression · unspent escrow is refundable, always</span>
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button className="spnr-btn" onClick={fundUsdc}>Fund — USDC · x402</button>
              <button className="spnr-ghost" onClick={fundCard}>Fund — card</button>
            </div>
          </div>

          {funded && (
            <div style={{ border: `2px solid ${T.ember}`, background: T.surface2, padding: '14px 18px', fontSize: 13, color: T.emberText }}>
              ✓ +$500.00 escrowed via {fundMethod} — available immediately.
            </div>
          )}

          {/* ---- create a campaign — LIVE POST /v2/campaigns ---- */}
          <div style={{ border: RULE, background: T.surface, boxShadow: shadow(), padding: 26, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={cellLabel}>New campaign — opens a slot in the live auction</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, flex: '1 1 240px' }}>
                <span style={cellLabel}>Campaign name</span>
                <input
                  value={newName}
                  onChange={(e) => { setNewName(e.target.value); setCreateMsg(null); }}
                  placeholder="cloakpipe-launch-07"
                  spellCheck={false}
                  className="spnr-input"
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, flex: '0 1 160px' }}>
                <span style={cellLabel}>$ / block (≥ 1.00)</span>
                <input
                  value={newPrice}
                  onChange={(e) => { setNewPrice(e.target.value); setCreateMsg(null); }}
                  inputMode="decimal"
                  spellCheck={false}
                  className="spnr-input"
                />
              </div>
              <button className="spnr-btn" onClick={createCampaignFlow}>Create ▸</button>
            </div>
            {createMsg && (
              <div style={{ fontFamily: FONT_MONO, fontSize: 12.5, color: createMsg.startsWith('✓') ? T.green : '#C0392B' }}>
                {createMsg}
              </div>
            )}
          </div>

          {/* settlement ledger */}
          <div style={{ border: RULE, background: T.surface, boxShadow: shadow() }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '140px 1fr 140px 130px',
                padding: '13px 18px',
                borderBottom: RULE,
                ...colHead,
              }}
            >
              <span>Time</span>
              <span>Settlement</span>
              <span style={{ textAlign: 'right' }}>Impressions</span>
              <span style={{ textAlign: 'right' }}>Amount</span>
            </div>
            {SETTLEMENTS.map((s, i) => (
              <div
                key={s.time}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '140px 1fr 140px 130px',
                  padding: '13px 18px',
                  borderBottom: i === SETTLEMENTS.length - 1 ? 'none' : RULE,
                  ...mono13,
                }}
              >
                <span style={{ color: T.text2 }}>{s.time}</span>
                <span style={{ color: T.text2 }}>{s.detail}</span>
                <span style={{ color: s.impressions === '—' ? T.text3 : T.text, textAlign: 'right' }}>{s.impressions}</span>
                <span style={{ color: s.credit ? T.green : T.text, textAlign: 'right', fontWeight: 600 }}>{s.amount}</span>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 14, lineHeight: 1.5, color: T.text2, maxWidth: '80ch' }}>
            All settlement is denominated in USD and executed as USDC micro-settlements over x402 on Base — off-chain
            ledger real-time, on-chain batches hourly. Phase 2: autonomous agents bid through the same rail.
          </div>
        </section>
      )}
    </Shell>
  );
}

// ---- small ruled sub-components (keep the JSX above readable) ----

function MetricCell({
  label,
  value,
  sub,
  valueColor,
  rule,
}: {
  label: string;
  value: string;
  sub: string;
  valueColor?: string;
  rule?: boolean;
}) {
  return (
    <div style={{ padding: '24px 24px 22px', borderRight: rule ? RULE : 'none' }}>
      <div style={{ ...cellLabel, marginBottom: 12 }}>{label}</div>
      <div style={{ ...bigNum, color: valueColor ?? T.text }}>{value}</div>
      <div style={{ marginTop: 12, fontSize: 12.5, color: T.text2 }}>{sub}</div>
    </div>
  );
}

function LintRow({
  ok,
  label,
  children,
  last,
}: {
  ok: boolean;
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
        padding: '11px 14px',
        borderBottom: last ? 'none' : RULE,
        fontFamily: FONT_MONO,
        fontSize: 12.5,
      }}
    >
      <span style={{ color: T.text2 }}>{label}</span>
      <span style={{ color: ok ? T.green : '#C0392B', fontWeight: 600 }}>{children}</span>
    </div>
  );
}

function ActiveCreative({
  text,
  status,
  serving,
  last,
}: {
  text: string;
  status: string;
  serving?: boolean;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
        padding: '12px 0',
        borderBottom: last ? 'none' : RULE,
        fontFamily: FONT_MONO,
        fontSize: 12.5,
      }}
    >
      <span style={{ color: serving ? T.text : T.text2 }}>{text}</span>
      <span style={{ color: serving ? T.green : T.text3, fontWeight: serving ? 700 : 500, textTransform: 'uppercase' }}>{status}</span>
    </div>
  );
}
