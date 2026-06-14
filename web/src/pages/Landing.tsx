import { CSSProperties, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { C, FONT_DISPLAY, FONT_MONO } from '../theme';

// ---- design data (from the export) ----
const VERBS = [
  { t: 'Pondering…', s: false },
  { t: 'CloakPipe — secrets that never touch disk ↗', s: true },
  { t: 'Reticulating…', s: false },
  { t: 'Marinating…', s: false },
  { t: 'ctxgraph — see what your agent sees ↗', s: true },
  { t: 'Brewing…', s: false },
];
const GLYPHS = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const TICKER = [
  <>SLOT:SPINNER · TOP BID <span style={{ color: C.green }}>$4.20</span> ▲</>,
  <>24H IMPRESSIONS <span style={{ color: C.text }}>1,204,118</span></>,
  <>AVG / IMPRESSION <span style={{ color: C.green }}>$0.011</span></>,
  <>DEV PAYOUT POOL <span style={{ color: C.amber }}>$6,622.65</span></>,
  <>CLICKS BILLED AT <span style={{ color: C.text }}>50×</span></>,
  <>AUCTION OPEN · MIN <span style={{ color: C.green }}>$1.00</span></>,
];

const INSTALL_CMD = 'curl -fsSL get.spnr.sh | sh';

// shared section-label style ("┌─ NN · TITLE ─┐")
const sectionLabel: CSSProperties = {
  fontSize: 12,
  letterSpacing: '0.14em',
  color: C.green,
  marginBottom: 18,
};
const container: CSSProperties = { maxWidth: 1160, margin: '0 auto', padding: '80px 32px' };
const h2: CSSProperties = {
  margin: 0,
  fontFamily: FONT_DISPLAY,
  fontWeight: 700,
  fontSize: 40,
  lineHeight: 1.1,
  color: C.bright,
  textTransform: 'uppercase',
  textWrap: 'balance',
};
const cardCell: CSSProperties = { background: C.panel, padding: '28px 26px', display: 'flex', flexDirection: 'column', gap: 14 };
const cardTitle: CSSProperties = {
  fontFamily: FONT_DISPLAY,
  fontWeight: 600,
  fontSize: 17,
  color: C.green,
  letterSpacing: '0.04em',
};
const cardBody: CSSProperties = { margin: 0, fontSize: 13.5, color: C.mid, textWrap: 'pretty' };
const statNum: CSSProperties = {
  fontFamily: FONT_DISPLAY,
  fontSize: 30,
  fontWeight: 700,
  color: C.green,
  textShadow: '0 0 18px rgba(61,255,126,0.3)',
};
const statLabel: CSSProperties = { fontSize: 11.5, color: C.dim, marginTop: 6, letterSpacing: '0.06em' };

export default function Landing() {
  const [frame, setFrame] = useState(0);
  const [verbIdx, setVerbIdx] = useState(0);
  const [impressions, setImpressions] = useState(132);
  const [balanceNum, setBalanceNum] = useState(23.87);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const spin = setInterval(() => setFrame((f) => (f + 1) % GLYPHS.length), 90);
    return () => clearInterval(spin);
  }, []);

  useEffect(() => {
    const cycle = setInterval(() => {
      setVerbIdx((prev) => {
        const wasSponsored = VERBS[prev].s;
        if (wasSponsored) {
          setImpressions((n) => n + 1);
          setBalanceNum((b) => b + 0.011);
        }
        return (prev + 1) % VERBS.length;
      });
    }, 2600);
    return () => clearInterval(cycle);
  }, []);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const copyInstall = () => {
    if (navigator.clipboard) navigator.clipboard.writeText(INSTALL_CMD);
    setCopied(true);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1600);
  };

  const v = VERBS[verbIdx];
  const sponsored = v.s;
  const balance = balanceNum.toFixed(2);
  const copyLabel = copied ? 'COPIED' : 'COPY';

  return (
    <div
      style={{
        minHeight: '100vh',
        background: C.bg,
        color: C.text,
        fontFamily: FONT_MONO,
        fontSize: 15,
        lineHeight: 1.6,
        position: 'relative',
      }}
    >
      {/* CRT atmosphere: glow + scanlines */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          background: 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(61,255,126,0.07), transparent 70%)',
          zIndex: 0,
        }}
      />
      <div
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          background:
            'repeating-linear-gradient(0deg, transparent 0px, transparent 2px, rgba(0,0,0,0.22) 2px, rgba(0,0,0,0.22) 3px)',
          zIndex: 0,
        }}
      />

      <div style={{ position: 'relative', zIndex: 1 }}>
        {/* ============ TICKER ============ */}
        <div style={{ borderBottom: `1px solid ${C.border}`, overflow: 'hidden', background: C.panel }}>
          <div
            style={{
              display: 'flex',
              width: 'max-content',
              animation: 'spnr-marquee 28s linear infinite',
              padding: '9px 0',
              fontSize: 12,
              letterSpacing: '0.04em',
              color: C.dim,
              whiteSpace: 'nowrap',
            }}
          >
            {[...TICKER, ...TICKER].map((item, i) => (
              <span key={i} style={{ padding: '0 28px' }}>
                {item}
              </span>
            ))}
          </div>
        </div>

        {/* ============ NAV ============ */}
        <header
          style={{
            maxWidth: 1160,
            margin: '0 auto',
            padding: '26px 32px',
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 24,
          }}
        >
          <Link
            to="/"
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 700,
              fontSize: 20,
              letterSpacing: '0.06em',
              color: C.green,
              textShadow: '0 0 18px rgba(61,255,126,0.45)',
            }}
          >
            SPNR<span style={{ animation: 'spnr-blink 1.1s step-end infinite' }}>_</span>
          </Link>
          <nav style={{ display: 'flex', gap: 28, fontSize: 12.5, color: C.dim, letterSpacing: '0.04em' }}>
            <a href="#how" className="spnr-link" style={{ color: C.dim }}>
              HOW
            </a>
            <a href="#privacy" className="spnr-link" style={{ color: C.dim }}>
              PRIVACY
            </a>
            <Link to="/dashboard" className="spnr-link" style={{ color: C.dim }}>
              CONSOLE
            </Link>
            <Link to="/advertiser" className="spnr-link" style={{ color: C.dim }}>
              BID BOARD
            </Link>
            <a href="#" className="spnr-link" style={{ color: C.dim }}>
              GITHUB ↗
            </a>
          </nav>
        </header>

        {/* ============ HERO ============ */}
        <section
          style={{
            maxWidth: 1160,
            margin: '0 auto',
            padding: '64px 32px 96px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 440px), 1fr))',
            gap: 64,
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 30, minWidth: 0 }}>
            <div style={{ fontSize: 12, letterSpacing: '0.14em', color: C.dim }}>
              OPEN BETA · v0.2 · LINUX + MACOS · <span style={{ color: C.green }}>MARKET OPEN</span>
            </div>
            <h1
              style={{
                margin: 0,
                fontFamily: FONT_DISPLAY,
                fontWeight: 700,
                fontSize: 84,
                lineHeight: 0.98,
                letterSpacing: '0.01em',
                color: C.green,
                textTransform: 'uppercase',
                textShadow: '0 0 32px rgba(61,255,126,0.35)',
                textWrap: 'balance',
              }}
            >
              Sell
              <br />
              the wait.
            </h1>
            <p style={{ margin: 0, maxWidth: '46ch', color: C.mid, fontSize: 15, textWrap: 'pretty' }}>
              Your spinner is the most-watched line on Earth. spnr is the open, terminal-native exchange that sells it
              — one sponsored line while your agent thinks, settled per impression, redeemable from day one. It reads
              timestamps. Never your code.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'stretch',
                  border: `1px solid ${C.green}`,
                  background: C.panel,
                  maxWidth: 480,
                  boxShadow: '0 0 24px rgba(61,255,126,0.12)',
                }}
              >
                <code
                  style={{
                    flex: 1,
                    fontSize: 14,
                    padding: '14px 18px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    color: C.text,
                  }}
                >
                  <span style={{ color: C.dim }}>$</span> curl -fsSL get.spnr.sh | sh
                </code>
                <button
                  onClick={copyInstall}
                  className="spnr-primary"
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 12,
                    letterSpacing: '0.08em',
                    padding: '0 18px',
                    border: 'none',
                    borderLeft: `1px solid ${C.green}`,
                    background: C.green,
                    color: C.bg,
                    cursor: 'pointer',
                    minWidth: 82,
                    fontWeight: 600,
                  }}
                >
                  {copyLabel}
                </button>
              </div>
              <div style={{ fontSize: 12, color: C.dimmer }}>
                or&nbsp; claude plugin install spnr &nbsp;·&nbsp; every byte open source · self-hostable
              </div>
            </div>
          </div>

          {/* live session pane */}
          <div
            style={{
              border: `1px solid ${C.border}`,
              background: C.panel,
              minWidth: 0,
              boxShadow: '0 0 60px rgba(61,255,126,0.06)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 16px',
                borderBottom: `1px solid ${C.border}`,
                fontSize: 11.5,
                letterSpacing: '0.08em',
                color: C.dim,
              }}
            >
              <span>LIVE SESSION — ~/work/ingest</span>
              <span style={{ color: C.green }}>● REC</span>
            </div>
            <div style={{ padding: '20px 20px 16px', fontSize: 13.5, lineHeight: 1.9, minHeight: 192 }}>
              <div>
                <span style={{ color: C.dimmer }}>&gt;</span> tighten the retry logic in ingest/worker.rs
              </div>
              <div style={{ color: C.dimmer }}>⏺ Read worker.rs · Edited 2 files</div>
              {sponsored ? (
                <div>
                  <span style={{ color: C.amber }}>{GLYPHS[frame]}</span>{' '}
                  <span style={{ color: C.amber }}>{v.t}</span>{' '}
                  <span style={{ color: C.dimmer }}>(esc to interrupt)</span>
                </div>
              ) : (
                <div>
                  <span style={{ color: C.green }}>{GLYPHS[frame]}</span>{' '}
                  <span style={{ color: C.mid }}>{v.t}</span>{' '}
                  <span style={{ color: C.dimmer }}>(esc to interrupt)</span>
                </div>
              )}
              <div>
                <span
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 16,
                    background: C.green,
                    verticalAlign: 'text-bottom',
                    animation: 'spnr-blink 1.1s step-end infinite',
                    boxShadow: '0 0 10px rgba(61,255,126,0.6)',
                  }}
                />
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 16,
                padding: '10px 16px',
                borderTop: `1px solid ${C.border}`,
                fontSize: 11.5,
                color: C.dim,
              }}
            >
              <span>
                <span style={{ color: C.green }}>spnr</span> ▸ {impressions} impressions today
              </span>
              <span>
                balance <span style={{ color: C.amber }}>${balance}</span>
              </span>
            </div>
          </div>
        </section>

        {/* ============ HOW IT WORKS ============ */}
        <section id="how" style={{ borderTop: `1px solid ${C.border}` }}>
          <div style={container}>
            <div style={{ ...sectionLabel, marginBottom: 44 }}>┌─ 01 · HOW IT WORKS ─┐</div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
                gap: 1,
                background: C.border,
                border: `1px solid ${C.border}`,
              }}
            >
              <div style={cardCell}>
                <div style={cardTitle}>INSTALL</div>
                <p style={cardBody}>
                  One command. Signature-verified, single static binary under 10 MB. Auth is a GitHub device flow
                  printed in your terminal — no marketplace, no GUI, no sign-in tab.
                </p>
              </div>
              <div style={cardCell}>
                <div style={cardTitle}>WAIT</div>
                <p style={cardBody}>
                  While your agent thinks, one sponsored line takes a spinner verb's place. Each 5-second impression is
                  signed by your device key and counted conservatively — headless runs earn nothing.
                </p>
              </div>
              <div style={cardCell}>
                <div style={cardTitle}>REDEEM</div>
                {/* Corrected per ADR-0006/0001: default is USDC over x402; fiat (gift cards/
                    local) is the off-ramp; spnr never resells API credit codes. */}
                <p style={cardBody}>
                  Balances are USD, always. Redeem as USDC over x402 by default — or take the fiat off-ramp (gift cards
                  / local payout) in any country. No points. No "payouts coming soon."
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ============ THE MONEY ============ */}
        <section style={{ borderTop: `1px solid ${C.border}` }}>
          <div style={container}>
            <div style={sectionLabel}>┌─ 02 · THE MONEY ─┐</div>
            <h2 style={{ ...h2, margin: '0 0 44px', letterSpacing: '0.01em', maxWidth: '26ch' }}>
              50% of every impression. Redeemable the day you install.
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', borderTop: `1px solid ${C.green}` }}>
              {/* Corrected per ADR-0006/0001: USDC over x402 is the DEFAULT; gift cards /
                  local are the fiat OFF-RAMP; API credit codes are never resold. */}
              <div
                style={{
                  padding: '22px 0',
                  fontSize: 12.5,
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  borderBottom: `1px solid ${C.border}`,
                  color: C.green,
                }}
              >
                DEFAULT
              </div>
              <div style={{ padding: '22px 0', borderBottom: `1px solid ${C.border}`, fontSize: 14, color: C.mid }}>
                <span style={{ color: C.bright, fontWeight: 600 }}>USDC over x402.</span> The settlement rail already
                runs on-chain; the default tier pays that USD balance straight to your wallet. Works where Stripe
                doesn't — global by default.
              </div>
              <div
                style={{
                  padding: '22px 0',
                  fontSize: 12.5,
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  borderBottom: `1px solid ${C.border}`,
                  color: C.amber,
                }}
              >
                OFF-RAMP
              </div>
              <div style={{ padding: '22px 0', borderBottom: `1px solid ${C.border}`, fontSize: 14, color: C.mid }}>
                <span style={{ color: C.bright, fontWeight: 600 }}>Gift cards / local payout.</span> Prefer fiat or in a
                tax-sensitive country (incl. India)? Take a Visa prepaid, Amazon, or local gift card via a licensed
                aggregator — which you can spend on your own Claude / OpenAI bill. We never resell API credit codes.
              </div>
              <div
                style={{
                  padding: '22px 0',
                  fontSize: 12.5,
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  borderBottom: `1px solid ${C.border}`,
                  color: C.red,
                }}
              >
                NEVER
              </div>
              <div style={{ padding: '22px 0', borderBottom: `1px solid ${C.border}`, fontSize: 14, color: C.mid }}>
                Vague points. Opaque conversion rates. Streaks, multipliers, watch-to-earn. Ads inside model output.
                Resold provider credit codes. Out of scope, permanently.
              </div>
            </div>
            <div style={{ marginTop: 26, fontSize: 12, color: C.dimmer, letterSpacing: '0.04em' }}>
              ~$0.011 PER IMPRESSION AT CURRENT AUCTION RATES · HEAVY USE COVERS A FULL CLAUDE SUBSCRIPTION
            </div>
          </div>
        </section>

        {/* ============ PRIVACY ============ */}
        <section id="privacy" style={{ borderTop: `1px solid ${C.border}` }}>
          <div style={container}>
            <div style={sectionLabel}>┌─ 03 · WHAT IT SEES ─┐</div>
            <h2 style={{ ...h2, margin: '0 0 20px', maxWidth: '28ch' }}>
              Structurally incapable of reading your work.
            </h2>
            <p style={{ margin: '0 0 44px', maxWidth: '62ch', fontSize: 14, color: C.mid, textWrap: 'pretty' }}>
              The parser that derives impressions cannot touch content fields — enforced in CI, auditable in source.
              Every byte that runs on your machine is open source, with reproducible builds and published hashes. Run{' '}
              <code style={{ color: C.green, background: C.panelActive, padding: '2px 8px', border: `1px solid ${C.border}` }}>
                spnr audit
              </code>{' '}
              to dump the raw outbound queue, any time.
            </p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))',
                gap: 1,
                background: C.border,
                border: `1px solid ${C.border}`,
              }}
            >
              <div style={{ background: C.panel, padding: 26 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: '0.08em', marginBottom: 18, color: C.red }}>
                  NEVER COLLECTED
                </div>
                <ul
                  style={{
                    margin: 0,
                    padding: 0,
                    listStyle: 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 9,
                    fontSize: 13.5,
                    color: C.mid,
                  }}
                >
                  <li>
                    <span style={{ color: C.red }}>×</span>&nbsp; code
                  </li>
                  <li>
                    <span style={{ color: C.red }}>×</span>&nbsp; prompts &amp; completions
                  </li>
                  <li>
                    <span style={{ color: C.red }}>×</span>&nbsp; file paths &amp; repo names
                  </li>
                  <li>
                    <span style={{ color: C.red }}>×</span>&nbsp; transcript content
                  </li>
                  <li>
                    <span style={{ color: C.red }}>×</span>&nbsp; environment variables
                  </li>
                </ul>
              </div>
              <div style={{ background: C.panel, padding: 26 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: '0.08em', marginBottom: 18, color: C.green }}>
                  COLLECTED — THE WHOLE LIST
                </div>
                <ul
                  style={{
                    margin: 0,
                    padding: 0,
                    listStyle: 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 9,
                    fontSize: 13.5,
                    color: C.mid,
                  }}
                >
                  <li>
                    <span style={{ color: C.green }}>✓</span>&nbsp; ad events: type, creative id, timestamp
                  </li>
                  <li>
                    <span style={{ color: C.green }}>✓</span>&nbsp; install metadata: os / arch / version
                  </li>
                  <li>
                    <span style={{ color: C.green }}>✓</span>&nbsp; account email
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ============ COMPARISON ============ */}
        <section style={{ borderTop: `1px solid ${C.border}` }}>
          <div style={container}>
            <div style={sectionLabel}>┌─ 04 · VS. THE IDE ONE ─┐</div>
            <h2 style={{ ...h2, margin: '0 0 44px', maxWidth: '28ch' }}>No apologies to terminal jockeys.</h2>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '170px 1fr 1fr',
                border: `1px solid ${C.border}`,
                fontSize: 13.5,
              }}
            >
              <Cmp />
            </div>
          </div>
        </section>

        {/* ============ BID BOARD ============ */}
        <section id="advertisers" style={{ borderTop: `1px solid ${C.green}`, background: '#0A0F0B' }}>
          <div
            style={{
              maxWidth: 1160,
              margin: '0 auto',
              padding: '80px 32px',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))',
              gap: 56,
              alignItems: 'center',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
              <div style={{ fontSize: 12, letterSpacing: '0.14em', color: C.amber }}>┌─ 05 · FOR ADVERTISERS ─┐</div>
              <h2 style={{ ...h2, maxWidth: '22ch' }}>The only verified terminal ad slot.</h2>
              <p style={{ margin: 0, maxWidth: '50ch', fontSize: 14, color: C.mid, textWrap: 'pretty' }}>
                The highest-intent developer audience on earth — people actively running AI coding agents — with
                cryptographically attested impressions, anomaly-filtered and priced honestly. Not IAB-viewability; we
                publish the methodology instead of overstating it.
              </p>
              <Link
                to="/advertiser"
                className="spnr-primary"
                style={{
                  alignSelf: 'flex-start',
                  fontSize: 13,
                  fontWeight: 600,
                  letterSpacing: '0.06em',
                  color: C.bg,
                  background: C.amber,
                  padding: '13px 24px',
                  marginTop: 8,
                }}
              >
                OPEN THE BID BOARD → SPNR.CO
              </Link>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 1,
                background: C.border,
                border: `1px solid ${C.border}`,
                minWidth: 0,
              }}
            >
              <div style={{ background: C.panel, padding: '26px 24px' }}>
                <div style={statNum}>$1</div>
                <div style={statLabel}>MINIMUM BID, OPEN AUCTION</div>
              </div>
              <div style={{ background: C.panel, padding: '26px 24px' }}>
                <div style={statNum}>1,000 × 5s</div>
                <div style={statLabel}>IMPRESSIONS PER BLOCK</div>
              </div>
              <div style={{ background: C.panel, padding: '26px 24px' }}>
                <div style={statNum}>50×</div>
                <div style={statLabel}>CLICK RATE VS. IMPRESSION</div>
              </div>
              <div style={{ background: C.panel, padding: '26px 24px' }}>
                <div style={{ ...statNum, color: C.amber, textShadow: 'none' }}>SIGNED</div>
                <div style={statLabel}>PER-IMPRESSION ATTESTATIONS</div>
              </div>
            </div>
          </div>
        </section>

        {/* ============ FOOTER ============ */}
        <footer style={{ borderTop: `1px solid ${C.border}` }}>
          <div
            style={{
              maxWidth: 1160,
              margin: '0 auto',
              padding: '44px 32px 56px',
              display: 'flex',
              flexDirection: 'column',
              gap: 18,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 24,
                flexWrap: 'wrap',
                fontSize: 12,
                color: C.dim,
                letterSpacing: '0.04em',
              }}
            >
              <span>
                <span style={{ color: C.green }}>SPNR</span> — THE OPEN, TERMINAL-NATIVE AD EXCHANGE
              </span>
              <span style={{ display: 'flex', gap: 24 }}>
                <a href="#" className="spnr-link" style={{ color: C.dim }}>
                  PROTOCOL RFC
                </a>
                <a href="#" className="spnr-link" style={{ color: C.dim }}>
                  AUDIT SCHEMA
                </a>
                <a href="#" className="spnr-link" style={{ color: C.dim }}>
                  GITHUB ↗
                </a>
              </span>
            </div>
            <div style={{ fontSize: 12, color: C.dimmer, maxWidth: '78ch' }}>
              We operate on exactly three domains: <span style={{ color: C.green }}>spnr.sh</span> ·{' '}
              <span style={{ color: C.green }}>spnr.dev</span> · <span style={{ color: C.green }}>spnr.co</span>.
              Anything else claiming to pay you isn't us.
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

// ---- comparison table rows (head + 5 data rows) ----
const CMP_ROWS: { k: string; incumbent: string; spnr: string }[] = [
  { k: 'INSTALL', incumbent: 'IDE marketplace + sign-in', spnr: 'one command, in-terminal auth' },
  { k: 'PAYOUTS', incumbent: 'accruing only, "coming soon"', spnr: 'redeemable day one' },
  { k: 'BACKEND', incumbent: 'closed source', spnr: 'open protocol, self-hostable' },
  { k: 'GEOGRAPHY', incumbent: 'Stripe-supported countries', spnr: 'global — USDC + fiat off-ramp' },
  { k: 'FRAUD', incumbent: 'IDE viewability checks', spnr: 'signed attestations + anomaly scoring' },
];

function Cmp() {
  const cellBase: CSSProperties = { padding: '14px 18px' };
  const labelCell: CSSProperties = { ...cellBase, fontSize: 12, letterSpacing: '0.06em', color: C.dim };
  return (
    <>
      <div style={{ ...cellBase, borderBottom: `1px solid ${C.border}`, background: C.panel }} />
      <div
        style={{
          ...cellBase,
          borderBottom: `1px solid ${C.border}`,
          background: C.panel,
          fontSize: 12,
          letterSpacing: '0.08em',
          color: C.dimmer,
        }}
      >
        THE INCUMBENT
      </div>
      <div
        style={{
          ...cellBase,
          borderBottom: `1px solid ${C.border}`,
          background: C.panelActive,
          fontSize: 12,
          letterSpacing: '0.08em',
          color: C.green,
          fontWeight: 600,
        }}
      >
        SPNR
      </div>
      {CMP_ROWS.map((row, i) => {
        const last = i === CMP_ROWS.length - 1;
        const border = last ? undefined : `1px solid ${C.border}`;
        return (
          <div key={row.k} style={{ display: 'contents' }}>
            <div style={{ ...labelCell, borderBottom: border }}>{row.k}</div>
            <div style={{ ...cellBase, borderBottom: border, color: C.dim }}>{row.incumbent}</div>
            <div style={{ ...cellBase, borderBottom: border, background: C.panelActive, color: C.text }}>{row.spnr}</div>
          </div>
        );
      })}
    </>
  );
}
