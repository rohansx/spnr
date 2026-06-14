import { CSSProperties, useEffect, useRef, useState } from 'react';
import { Shell } from '../components/Shell';
import { SectionHeader } from '../components/SectionHeader';
import { FONT_DISPLAY, FONT_MONO, RULE, T, shadow } from '../theme';

// spnr landing — v5 "industrial editorial". A brutalist Swiss grid on a paper
// canvas: hard 2px rules frame every cell, blur-less offset shadows, heavy
// uppercase Archivo display + Martian Mono mono labels, a single ember-green
// accent, light by default with a dark toggle (provided by Shell). The page is
// fully self-contained — it drives its own demo loops with useState/useEffect
// and uses no app hooks.

// ---- demo data (ported verbatim from the v5 reference) ----
const VERBS: { t: string; s: boolean }[] = [
  { t: 'Pondering…', s: false },
  { t: 'CloakPipe — secrets that never touch disk ↗', s: true },
  { t: 'Reticulating…', s: false },
  { t: 'Marinating…', s: false },
  { t: 'ctxgraph — see what your agent sees ↗', s: true },
  { t: 'Brewing…', s: false },
];
const GLYPHS = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const INITIAL_BARS = [4, 7, 5, 9, 6, 8, 11, 7, 10, 13, 9, 12, 15, 11, 14, 10, 16, 13, 18, 14, 17, 15, 19, 16];

const INSTALL_CMD = 'curl -fsSL get.spnr.sh | sh';

// ---- shared style fragments ----
const monoLabel: CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 11,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
};
const bigHead: CSSProperties = {
  margin: 0,
  fontFamily: FONT_DISPLAY,
  fontWeight: 900,
  lineHeight: 0.9,
  letterSpacing: '-0.035em',
  textTransform: 'uppercase',
};

export default function Landing() {
  const [frame, setFrame] = useState(0);
  const [verbIdx, setVerbIdx] = useState(0);
  const [impressions, setImpressions] = useState(132);
  const [balanceNum, setBalanceNum] = useState(23.87);
  const [popKey, setPopKey] = useState(0);
  const [bars, setBars] = useState<number[]>(INITIAL_BARS);
  const [hours, setHours] = useState(4);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>();

  // glyph spinner — advances the braille frame every 90ms.
  useEffect(() => {
    const spin = setInterval(() => setFrame((f) => (f + 1) % GLYPHS.length), 90);
    return () => clearInterval(spin);
  }, []);

  // verb cycle — every 2.4s rotate to the next spinner verb. When the verb we
  // just left was sponsored, bank an impression: +1 imp, +$0.011, fire a "+$0.011"
  // pop, and push a fresh bar onto the sparkline.
  useEffect(() => {
    const cycle = setInterval(() => {
      setVerbIdx((prev) => {
        const wasSponsored = VERBS[prev].s;
        if (wasSponsored) {
          setImpressions((n) => n + 1);
          setBalanceNum((b) => b + 0.011);
          setPopKey((k) => k + 1);
          setBars((bs) => bs.slice(1).concat([Math.min(20, 6 + Math.round(Math.random() * 14))]));
        }
        return (prev + 1) % VERBS.length;
      });
    }, 2400);
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
  const todayEarned = (impressions * 0.011).toFixed(2);
  const copyLabel = copied ? 'Copied' : 'Copy';

  // estimator math
  const monthlyImps = hours * 120 * 22;
  const monthly = Math.round(monthlyImps * 0.011);
  const yearly = monthly * 12;

  const maxBar = Math.max(...bars);

  return (
    <Shell nav={<LandingNav />}>
      {/* ============ HERO ============ */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 430px), 1fr))',
          borderBottom: RULE,
        }}
      >
        <div
          style={{
            padding: '48px 40px 44px',
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
            borderRight: RULE,
            minWidth: 0,
          }}
        >
          <div
            style={{
              ...monoLabel,
              display: 'inline-flex',
              alignSelf: 'flex-start',
              alignItems: 'center',
              gap: 8,
              border: RULE,
              padding: '6px 10px',
              color: T.emberText,
            }}
          >
            <span style={{ width: 7, height: 7, background: T.ember, display: 'inline-block' }} />
            Open beta · macOS &amp; Linux
          </div>
          <h1 style={{ ...bigHead, fontSize: 72 }}>Get paid while your agent thinks.</h1>
          <p
            style={{
              margin: 0,
              fontSize: 19,
              lineHeight: 1.45,
              color: T.text2,
              maxWidth: '44ch',
              textWrap: 'pretty',
            }}
          >
            Your AI coding agent spends half its life on a spinner. spnr turns that wait into income — one tasteful
            sponsored line, counted per impression, redeemable today. It reads timestamps. Never your code.
          </p>

          <div id="install" style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'stretch',
                border: RULE,
                background: T.surface,
                maxWidth: 460,
                boxShadow: shadow(6),
              }}
            >
              <code
                style={{
                  flex: 1,
                  fontFamily: FONT_MONO,
                  fontSize: 13,
                  padding: '15px 16px',
                  color: T.text,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                }}
              >
                <span style={{ color: T.text3 }}>$</span> curl -fsSL get.spnr.sh | sh
              </code>
              <button
                onClick={copyInstall}
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 11,
                  textTransform: 'uppercase',
                  padding: '0 20px',
                  border: 'none',
                  borderLeft: RULE,
                  background: T.ember,
                  color: '#fff',
                  cursor: 'pointer',
                  minWidth: 88,
                  fontWeight: 600,
                }}
              >
                {copyLabel}
              </button>
            </div>
            <div style={{ ...monoLabel, color: T.text3 }}>
              or claude plugin install spnr · open source · ~$0.011/imp
            </div>
          </div>
        </div>

        {/* READOUT — FIG.01 live session */}
        <div style={{ padding: 32, display: 'flex', alignItems: 'center', background: T.surface2, minWidth: 0 }}>
          <div style={{ width: '100%', background: T.surface, border: RULE, boxShadow: shadow(8) }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                borderBottom: RULE,
                fontFamily: FONT_MONO,
                fontSize: 10.5,
                textTransform: 'uppercase',
                color: T.text3,
              }}
            >
              <span>FIG.01 — Live session</span>
              <span style={{ color: T.green }}>● Earning</span>
            </div>

            {/* agent line inset */}
            <div
              style={{
                margin: 14,
                border: RULE,
                background: T.surface2,
                padding: 14,
                fontFamily: FONT_MONO,
                fontSize: 12,
                lineHeight: 1.95,
                color: T.text2,
              }}
            >
              <div>
                <span style={{ color: T.text3 }}>&gt;</span> tighten the retry logic in worker.rs
              </div>
              <div style={{ color: T.text3 }}>⏺ Read worker.rs · Edited 2 files</div>
              {sponsored ? (
                <div>
                  <span style={{ color: T.ember }}>{GLYPHS[frame]}</span>{' '}
                  <span style={{ color: T.emberText, fontWeight: 600 }}>{v.t}</span>
                </div>
              ) : (
                <div>
                  <span style={{ color: T.text }}>{GLYPHS[frame]}</span> <span style={{ color: T.text2 }}>{v.t}</span>
                </div>
              )}
            </div>

            {/* balance meter */}
            <div style={{ margin: '0 14px', padding: '4px 0 0', position: 'relative' }}>
              <div style={{ fontFamily: FONT_MONO, fontSize: 10.5, textTransform: 'uppercase', color: T.text3 }}>
                Balance / USD
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 2 }}>
                <span
                  style={{
                    fontFamily: FONT_MONO,
                    fontWeight: 700,
                    fontSize: 44,
                    letterSpacing: '-0.04em',
                    lineHeight: 1,
                    color: T.text,
                  }}
                >
                  ${balance}
                </span>
              </div>
              <div style={{ position: 'absolute', top: 18, right: 4 }}>
                {popKey > 0 && (
                  <span
                    key={popKey}
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 13,
                      fontWeight: 600,
                      color: T.green,
                      animation: 'spnr-rise 1.6s ease-out forwards',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    +$0.011
                  </span>
                )}
              </div>
            </div>

            {/* sparkline */}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 40, margin: '14px 14px 0' }}>
              {bars.map((h, i) => (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    height: `${Math.round((h / maxBar) * 100)}%`,
                    minHeight: 3,
                    background: i === bars.length - 1 ? T.ember : T.bar,
                  }}
                />
              ))}
            </div>

            {/* footer stats */}
            <div style={{ display: 'flex', borderTop: RULE, marginTop: 14, fontFamily: FONT_MONO }}>
              <div style={{ flex: 1, padding: '12px 14px', borderRight: RULE }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: T.text }}>{impressions}</div>
                <div style={{ fontSize: 10, textTransform: 'uppercase', color: T.text3, marginTop: 3 }}>
                  Impressions today
                </div>
              </div>
              <div style={{ flex: 1, padding: '12px 14px' }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: T.green }}>+${todayEarned}</div>
                <div style={{ fontSize: 10, textTransform: 'uppercase', color: T.text3, marginTop: 3 }}>
                  Earned today
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ HOW IT WORKS ============ */}
      <section id="how" style={{ borderBottom: RULE }}>
        <SectionHeader n="01" title="How it works" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))' }}>
          <HowCell
            n="01"
            title="Install in one line"
            body="A signed static binary under 10 MB. Auth is a GitHub device flow right in your terminal — no marketplace, no sign-in tab, no GUI."
            ruled
          />
          <HowCell
            n="02"
            title="Earn while it waits"
            body="One sponsored line takes a spinner verb's place while your agent thinks. Every 5-second impression is signed by your device key and counted conservatively."
            ruled
          />
          <HowCell
            n="03"
            title="Cash out day one"
            body="Balances are dollars. Redeem as Claude or OpenAI credits immediately — or USDC over x402 if you opt in. No points, no waiting period."
          />
        </div>
      </section>

      {/* ============ EARNINGS ESTIMATOR ============ */}
      <section id="earn" style={{ borderBottom: RULE }}>
        <SectionHeader n="02" title="Earnings estimator" />
        <div
          style={{
            background: '#141414',
            color: '#F4F4F2',
            padding: '44px 40px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))',
            gap: 44,
            alignItems: 'center',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h2 style={{ ...bigHead, fontSize: 40, lineHeight: 0.94, letterSpacing: '-0.03em', color: '#F4F4F2', margin: '0 0 14px' }}>
              Heavy users cover their whole subscription.
            </h2>
            <p style={{ margin: '0 0 28px', fontSize: 16, lineHeight: 1.5, color: '#B0B0AE', maxWidth: '42ch' }}>
              Drag to match how much you run your agent each day. The estimate uses current auction rates — and you keep
              50% of every impression.
            </p>
            <div style={{ ...monoLabel, color: '#8C8C88', marginBottom: 12, letterSpacing: '0.04em' }}>
              Active agent time — <span style={{ color: '#F4F4F2' }}>{hours} hrs/day</span>
            </div>
            <input
              type="range"
              className="spnr-range"
              min={1}
              max={8}
              step={1}
              value={hours}
              onInput={(e) => setHours(parseInt((e.target as HTMLInputElement).value, 10))}
              onChange={(e) => setHours(parseInt(e.target.value, 10))}
              style={{ width: '100%', maxWidth: 420 }}
            />
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                maxWidth: 420,
                fontFamily: FONT_MONO,
                fontSize: 10,
                color: '#8C8C88',
                marginTop: 8,
              }}
            >
              <span>1</span>
              <span>8 HRS</span>
            </div>
          </div>
          <div style={{ background: '#1E1E1E', border: '2px solid #333339', padding: 30 }}>
            <div style={{ ...monoLabel, color: '#8C8C88', letterSpacing: '0.04em' }}>Estimated earnings</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '8px 0 4px' }}>
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontWeight: 700,
                  fontSize: 56,
                  lineHeight: 1,
                  letterSpacing: '-0.05em',
                  color: '#2BD389',
                }}
              >
                ${monthly.toLocaleString()}
              </span>
              <span style={{ fontFamily: FONT_MONO, fontSize: 16, fontWeight: 600, color: '#B0B0AE' }}>/MO</span>
            </div>
            <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: '#8C8C88', marginBottom: 22, textTransform: 'uppercase' }}>
              ≈ ${yearly.toLocaleString()}/yr · {monthlyImps.toLocaleString()} imp
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', fontFamily: FONT_MONO, fontSize: 12 }}>
              <RateRow label="Per impression" value="$0.011" />
              <RateRow label="Your share" value="50%" valueColor="#2BD389" />
              <RateRow label="Payout" value="CREDITS / USDC" />
            </div>
          </div>
        </div>
      </section>

      {/* ============ PRIVACY ============ */}
      <section id="trust" style={{ borderBottom: RULE }}>
        <SectionHeader n="03" title="What it sees" />
        <div style={{ padding: 40, borderBottom: RULE }}>
          <h2 style={{ ...bigHead, fontSize: 44, lineHeight: 0.94, letterSpacing: '-0.03em', maxWidth: '20ch', margin: '0 0 14px' }}>
            It literally cannot read your work.
          </h2>
          <p style={{ margin: 0, fontSize: 17, lineHeight: 1.5, color: T.text2, maxWidth: '64ch' }}>
            The parser that counts impressions can't touch content fields — enforced in CI, auditable in source. Every
            byte on your machine is open source. Run{' '}
            <code
              style={{
                fontFamily: FONT_MONO,
                fontSize: 13,
                background: T.surface2,
                border: RULE,
                padding: '1px 7px',
              }}
            >
              spnr audit
            </code>{' '}
            to see the raw outbound queue anytime.
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))' }}>
          <div style={{ padding: 32, borderRight: RULE }}>
            <div style={{ ...monoLabel, fontWeight: 600, color: T.ember, marginBottom: 18 }}>▸ Never collected</div>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontFamily: FONT_MONO, fontSize: 14 }}>
              <PrivacyItem mark="×" markColor={T.text3}>Code</PrivacyItem>
              <PrivacyItem mark="×" markColor={T.text3}>Prompts &amp; completions</PrivacyItem>
              <PrivacyItem mark="×" markColor={T.text3}>File paths &amp; repo names</PrivacyItem>
              <PrivacyItem mark="×" markColor={T.text3}>Transcript content</PrivacyItem>
              <PrivacyItem mark="×" markColor={T.text3}>Environment variables</PrivacyItem>
            </ul>
          </div>
          <div style={{ padding: 32 }}>
            <div style={{ ...monoLabel, fontWeight: 600, color: T.green, marginBottom: 18 }}>
              ▸ Collected — the whole list
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontFamily: FONT_MONO, fontSize: 14 }}>
              <PrivacyItem mark="✓" markColor={T.green}>Ad events: type, creative id, timestamp</PrivacyItem>
              <PrivacyItem mark="✓" markColor={T.green}>Install metadata: os / arch / version</PrivacyItem>
              <PrivacyItem mark="✓" markColor={T.green}>Account email</PrivacyItem>
            </ul>
            <div style={{ marginTop: 20, fontSize: 15, lineHeight: 1.5, color: T.text2 }}>
              That's everything. Open protocol, reproducible builds, published hashes.
            </div>
          </div>
        </div>
      </section>

      {/* ============ COMPARISON ============ */}
      <section style={{ borderBottom: RULE }}>
        <SectionHeader n="04" title="Versus the incumbent" />
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr', fontFamily: FONT_MONO, fontSize: 13 }}>
          {/* header row */}
          <div style={{ padding: '14px 18px', borderBottom: RULE, borderRight: RULE }} />
          <div style={{ ...cmpHead, borderRight: RULE, color: T.text3 }}>The incumbent</div>
          <div style={{ ...cmpHead, color: T.ember, fontWeight: 700 }}>spnr</div>

          {CMP_ROWS.map((row, i) => {
            const last = i === CMP_ROWS.length - 1;
            const bb = last ? undefined : RULE;
            return (
              <div key={row.k} style={{ display: 'contents' }}>
                <div style={{ padding: '14px 18px', borderBottom: bb, borderRight: RULE, ...cmpKey }}>{row.k}</div>
                <div style={{ padding: '14px 18px', borderBottom: bb, borderRight: RULE, color: T.text3 }}>
                  {row.incumbent}
                </div>
                <div style={{ padding: '14px 18px', borderBottom: bb, color: T.text }}>{row.spnr}</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ============ PAYOUTS ============ */}
      <section style={{ borderBottom: RULE }}>
        <SectionHeader n="05" title="The money" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))' }}>
          <PayoutCell badge="Default" badgeBg={T.green} badgeColor="#fff" title="Credits" ruled>
            Claude / OpenAI credits, subscription offset, or gift cards. Instant, no KYC at small scale, works
            everywhere.
          </PayoutCell>
          <PayoutCell badge="Opt-in" badgeBg={T.ember} badgeColor="#fff" title="USDC over x402" ruled>
            Straight to your wallet on the same rail that settles the network. Works where Stripe doesn't.
          </PayoutCell>
          <PayoutCell
            badge="Never"
            badgeBg={T.text3}
            badgeColor={T.bg}
            title="Points &amp; gimmicks"
            muted
            background={T.surface2}
          >
            No vague points, opaque rates, streaks, multipliers, or ads inside model output. Out of scope, permanently.
          </PayoutCell>
        </div>
      </section>

      {/* ============ ADVERTISERS ============ */}
      <section id="advertisers" style={{ borderBottom: RULE }}>
        <SectionHeader n="06" title="For advertisers" ember />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))' }}>
          <div style={{ padding: 40, borderRight: RULE, minWidth: 0 }}>
            <h2 style={{ ...bigHead, fontSize: 38, lineHeight: 0.94, letterSpacing: '-0.03em', maxWidth: '16ch', margin: '0 0 16px' }}>
              The only verified terminal ad slot.
            </h2>
            <p style={{ margin: '0 0 26px', fontSize: 16, lineHeight: 1.5, color: T.text2, maxWidth: '46ch' }}>
              The highest-intent developer audience on earth — people actively running AI coding agents — with
              cryptographically attested impressions, anomaly-filtered and priced honestly.
            </p>
            <a
              href="#"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                fontFamily: FONT_MONO,
                fontSize: 12,
                textTransform: 'uppercase',
                fontWeight: 600,
                background: T.line,
                color: T.bg,
                padding: '14px 22px',
                textDecoration: 'none',
                border: RULE,
              }}
            >
              Open the bid board → spnr.co
            </a>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', minWidth: 0 }}>
            <AdStat value="$1" label="Min bid · open auction" ruledRight ruledBottom />
            <AdStat value="50×" label="Click vs. impression" ruledBottom />
            <AdStat value="1,000" label="Impressions / block" ruledRight />
            <div style={{ padding: 26, background: T.line }}>
              <div style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 30, letterSpacing: '-0.03em', color: T.ember }}>
                SIGNED
              </div>
              <div style={{ fontFamily: FONT_MONO, fontSize: 10, textTransform: 'uppercase', color: T.invText3, marginTop: 6 }}>
                Per-imp attestations
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ FINAL CTA ============ */}
      <section style={{ padding: '56px 40px', borderBottom: RULE, textAlign: 'center' }}>
        <h2 style={{ ...bigHead, fontSize: 56, margin: '0 0 24px', textWrap: 'balance' }}>
          Your spinner's been working for free.
        </h2>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'stretch', border: RULE, background: T.surface, boxShadow: shadow(6) }}>
            <code
              style={{
                fontFamily: FONT_MONO,
                fontSize: 13,
                padding: '16px 18px',
                color: T.text,
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ color: T.text3 }}>$</span> curl -fsSL get.spnr.sh | sh
            </code>
            <button
              onClick={copyInstall}
              style={{
                fontFamily: FONT_MONO,
                fontSize: 11,
                textTransform: 'uppercase',
                padding: '0 22px',
                border: 'none',
                borderLeft: RULE,
                background: T.ember,
                color: '#fff',
                cursor: 'pointer',
                minWidth: 88,
                fontWeight: 600,
              }}
            >
              {copyLabel}
            </button>
          </div>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 24,
          flexWrap: 'wrap',
          alignItems: 'center',
          padding: '28px 40px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: '56ch' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: 18, letterSpacing: '-0.04em', textTransform: 'uppercase' }}>
              SPNR
            </span>
            <span style={{ width: 8, height: 8, background: T.ember, display: 'inline-block' }} />
          </div>
          <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: T.text3, textTransform: 'uppercase', lineHeight: 1.6 }}>
            Exactly three domains — spnr.sh · spnr.dev · spnr.co. Anything else claiming to pay you isn't us.
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            gap: 0,
            fontFamily: FONT_MONO,
            fontSize: 11,
            textTransform: 'uppercase',
            border: RULE,
          }}
        >
          <a href="#" className="spnr-link" style={{ padding: '10px 14px', borderRight: RULE }}>
            RFC
          </a>
          <a href="#" className="spnr-link" style={{ padding: '10px 14px', borderRight: RULE }}>
            Audit schema
          </a>
          <a href="#" className="spnr-link" style={{ padding: '10px 14px' }}>
            GitHub ↗
          </a>
        </div>
      </footer>
    </Shell>
  );
}

// ---- nav slot for the Shell ----
function LandingNav() {
  return (
    <>
      <a href="#how" className="spnr-link">
        How it works
      </a>
      <a href="#earn" className="spnr-link">
        Earnings
      </a>
      <a href="#trust" className="spnr-link">
        Privacy
      </a>
      <a href="#advertisers" className="spnr-link">
        Advertisers
      </a>
      <a href="#install" className="spnr-btn">
        INSTALL ▸
      </a>
    </>
  );
}

// ---- HOW IT WORKS cell ----
interface HowCellProps {
  n: string;
  title: string;
  body: string;
  ruled?: boolean;
}
function HowCell({ n, title, body, ruled = false }: HowCellProps) {
  return (
    <div style={{ padding: 32, borderRight: ruled ? RULE : undefined }}>
      <div style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 13, color: T.ember }}>{n}</div>
      <h3
        style={{
          margin: '14px 0 10px',
          fontFamily: FONT_DISPLAY,
          fontWeight: 800,
          fontSize: 24,
          letterSpacing: '-0.02em',
          textTransform: 'uppercase',
        }}
      >
        {title}
      </h3>
      <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: T.text2 }}>{body}</p>
    </div>
  );
}

// ---- estimator rate-table row ----
function RateRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderTop: '2px solid #333339' }}>
      <span style={{ color: '#8C8C88', textTransform: 'uppercase' }}>{label}</span>
      <span style={valueColor ? { color: valueColor } : undefined}>{value}</span>
    </div>
  );
}

// ---- privacy list item ----
function PrivacyItem({ mark, markColor, children }: { mark: string; markColor: string; children: React.ReactNode }) {
  return (
    <li style={{ display: 'flex', gap: 14, alignItems: 'center', padding: '11px 0', borderTop: RULE }}>
      <span style={{ color: markColor, fontWeight: 700 }}>{mark}</span>
      <span>{children}</span>
    </li>
  );
}

// ---- payouts cell ----
interface PayoutCellProps {
  badge: string;
  badgeBg: string;
  badgeColor: string;
  title: string;
  children: React.ReactNode;
  ruled?: boolean;
  muted?: boolean;
  background?: string;
}
function PayoutCell({ badge, badgeBg, badgeColor, title, children, ruled = false, muted = false, background }: PayoutCellProps) {
  return (
    <div style={{ padding: 32, borderRight: ruled ? RULE : undefined, background }}>
      <div
        style={{
          display: 'inline-flex',
          fontFamily: FONT_MONO,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: badgeColor,
          background: badgeBg,
          padding: '4px 9px',
        }}
      >
        {badge}
      </div>
      <h3
        style={{
          margin: '16px 0 10px',
          fontFamily: FONT_DISPLAY,
          fontWeight: 800,
          fontSize: 23,
          letterSpacing: '-0.02em',
          textTransform: 'uppercase',
          color: muted ? T.text3 : T.text,
        }}
        dangerouslySetInnerHTML={{ __html: title }}
      />
      <p style={{ margin: 0, fontSize: 15.5, lineHeight: 1.5, color: muted ? T.text3 : T.text2 }}>{children}</p>
    </div>
  );
}

// ---- advertiser stat cell ----
function AdStat({
  value,
  label,
  ruledRight = false,
  ruledBottom = false,
}: {
  value: string;
  label: string;
  ruledRight?: boolean;
  ruledBottom?: boolean;
}) {
  return (
    <div style={{ padding: 26, borderRight: ruledRight ? RULE : undefined, borderBottom: ruledBottom ? RULE : undefined }}>
      <div style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 34, letterSpacing: '-0.04em' }}>{value}</div>
      <div style={{ fontFamily: FONT_MONO, fontSize: 10, textTransform: 'uppercase', color: T.text3, marginTop: 6 }}>
        {label}
      </div>
    </div>
  );
}

// ---- comparison table data + shared cell styles ----
const CMP_ROWS: { k: string; incumbent: string; spnr: string }[] = [
  { k: 'Install', incumbent: 'IDE marketplace + sign-in', spnr: 'One command, in-terminal auth' },
  { k: 'Payouts', incumbent: 'Accruing, "coming soon"', spnr: 'Redeemable day one' },
  { k: 'Backend', incumbent: 'Closed source', spnr: 'Open protocol, self-hostable' },
  { k: 'Geography', incumbent: 'Stripe countries', spnr: 'Global — credits + stablecoin' },
];

const cmpHead: CSSProperties = {
  padding: '14px 18px',
  borderBottom: RULE,
  fontSize: 11,
  textTransform: 'uppercase',
};
const cmpKey: CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  color: T.text3,
};
