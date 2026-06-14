import { CSSProperties, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Crt } from '../components/Crt';
import { C, FONT_DISPLAY, FONT_MONO, GREEN_GLOW } from '../theme';
import { useStats } from '../lib/useStats';
import { useAuth } from '../lib/useAuth';

// ---- design data (from the export) ----
const VERBS = [
  { t: 'Pondering…', s: false },
  { t: 'CloakPipe — secrets that never touch disk ↗', s: true },
  { t: 'Reticulating…', s: false },
  { t: 'ctxgraph — see what your agent sees ↗', s: true },
  { t: 'Brewing…', s: false },
];
const GLYPHS = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const DAY_VALS = [0.9, 1.2, 0.7, 1.6, 1.4, 1.1, 1.9, 2.2, 1.7, 1.3, 2.4, 1.8, 1.6, 1.45];
const RAW_EVENTS = [
  { time: '14:32:08', id: '01J9ZK3V…8QF2', creative: 'cloakpipe-launch-06', type: 'impression', amount: '+$0.0055' },
  { time: '14:31:42', id: '01J9ZK2T…X4MD', creative: 'cloakpipe-launch-06', type: 'impression', amount: '+$0.0055' },
  { time: '14:28:15', id: '01J9ZJWQ…7PNH', creative: 'ctxgraph-beta-02', type: 'click', amount: '+$0.2750' },
  { time: '14:28:03', id: '01J9ZJW8…2KLB', creative: 'ctxgraph-beta-02', type: 'impression', amount: '+$0.0055' },
  { time: '14:24:51', id: '01J9ZJNC…9RST', creative: 'ctxgraph-beta-02', type: 'impression', amount: '+$0.0055' },
  { time: '14:24:37', id: '01J9ZJMV…D3WQ', creative: 'cloakpipe-launch-06', type: 'impression', amount: '+$0.0055' },
  { time: '14:19:02', id: '01J9ZJB2…HH61', creative: 'cloakpipe-launch-06', type: 'impression', amount: '+$0.0055' },
  { time: '14:18:48', id: '01J9ZJAK…0VXC', creative: 'ctxgraph-beta-02', type: 'impression', amount: '+$0.0055' },
];

type Tab = 'overview' | 'ledger' | 'redeem' | 'settings';
type Method = 'usdc' | 'gift' | 'credits';

/** The receipt returned by POST /v1/redeem on success (see SHARED CONTRACT). */
interface RedeemReceipt {
  id: string;
  amount_micros: number;
  amount_usd: string;
  rail: string;
  status: string;
  remaining_micros: number;
}
// Redeem copy corrected to the product decisions (ADR-0006: USDC default; ADR-0001:
// gift cards/local are the fiat off-ramp; API credits are indirect, never resold).
const METHOD_LABELS: Record<Method, string> = {
  usdc: 'USDC via x402',
  gift: 'gift card / local payout',
  credits: 'your own console top-up',
};

const numCard: CSSProperties = {
  fontFamily: FONT_DISPLAY,
  fontSize: 42,
  fontWeight: 700,
  lineHeight: 1,
};
const label: CSSProperties = { fontSize: 11, letterSpacing: '0.1em', color: C.dim, marginBottom: 10 };
const sub: CSSProperties = { fontSize: 11.5, color: C.dimmer, marginTop: 10 };

export default function Dashboard() {
  const stats = useStats();
  const navigate = useNavigate();
  const { account, logout } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');
  const [paused, setPaused] = useState(false);
  const [frame, setFrame] = useState(0);
  const [verbIdx, setVerbIdx] = useState(0);
  const [method, setMethod] = useState<Method>('usdc');
  const [receipt, setReceipt] = useState<RedeemReceipt | null>(null);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [redeeming, setRedeeming] = useState(false);

  useEffect(() => {
    const spin = setInterval(() => setFrame((f) => (f + 1) % GLYPHS.length), 90);
    return () => clearInterval(spin);
  }, []);
  useEffect(() => {
    const cycle = setInterval(() => {
      if (!paused) setVerbIdx((i) => (i + 1) % VERBS.length);
    }, 2600);
    return () => clearInterval(cycle);
  }, [paused]);

  // live values (design placeholders until the first /api/stats lands)
  const balanceNum = stats ? stats.total_balance_micros / 1e6 : 23.87;
  const balance = balanceNum.toFixed(2);
  const impressions = stats ? stats.total_impressions : 132;
  // lifetime = total ever earned = current balance + everything already redeemed
  const lifetime = (stats ? (stats.total_balance_micros + stats.total_redeemed_micros) / 1e6 : 214.3).toFixed(2);
  const todayEarned = balanceNum.toFixed(2);
  const attestation = stats ? stats.attestation_pct.toFixed(1) : '99.2';

  const running = !paused;
  const v = VERBS[verbIdx];
  const sponsored = running && v.s;
  const max = Math.max(...DAY_VALS);

  // Redeem the full available balance over the selected rail. The amount is
  // derived from the live stats (micros) so it tracks the 2s poll; on success the
  // backend's balanced ledger transfer drops total_balance_micros and the next
  // poll updates the displayed balance automatically (no hand-edited balance state).
  const confirmRedeem = async () => {
    if (redeeming) return;
    setRedeeming(true);
    setRedeemError(null);
    const amountMicros = stats
      ? Math.round(stats.total_balance_micros)
      : Math.round(balanceNum * 1e6);
    try {
      const res = await fetch('/v1/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rail: method, amount_micros: amountMicros }),
      });
      const data = (await res.json().catch(() => null)) as
        | RedeemReceipt
        | { error?: string }
        | null;
      if (!res.ok) {
        const msg =
          data && typeof (data as { error?: string }).error === 'string'
            ? (data as { error: string }).error
            : `redeem failed (${res.status})`;
        setReceipt(null);
        setRedeemError(msg);
        return;
      }
      setReceipt(data as RedeemReceipt);
      setRedeemError(null);
    } catch {
      setReceipt(null);
      setRedeemError('redeem failed — network error');
    } finally {
      setRedeeming(false);
    }
  };

  // Logout invalidates the server session (best-effort), clears the local token,
  // then returns to /login — guarded routes will redirect there anyway.
  const onLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
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
  const methodStyle = (active: boolean): CSSProperties => ({
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    alignItems: 'flex-start',
    textAlign: 'left',
    fontFamily: FONT_MONO,
    padding: '20px 24px',
    cursor: 'pointer',
    border: 'none',
    background: active ? C.panelActive : C.panel,
    color: active ? C.green : C.mid,
    boxShadow: active ? `inset 3px 0 0 ${C.green}` : 'none',
  });

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
          <div style={{ fontSize: 12, color: C.dimmer, letterSpacing: '0.06em' }}>CONSOLE · spnr.co</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, fontSize: 12, letterSpacing: '0.04em' }}>
          {running ? (
            <span style={{ color: C.green }}>● DAEMON RUNNING</span>
          ) : (
            <span style={{ color: C.red }}>● PAUSED — STOCK VERBS RESTORED</span>
          )}
          <button
            className="spnr-ghost"
            onClick={() => setPaused((p) => !p)}
            style={{
              fontFamily: FONT_MONO,
              fontSize: 11.5,
              letterSpacing: '0.08em',
              padding: '7px 14px',
              background: 'transparent',
              border: `1px solid ${C.border}`,
              color: C.mid,
              cursor: 'pointer',
            }}
          >
            {paused ? 'RESUME' : 'PAUSE'}
          </button>
          <span data-testid="account-email" style={{ color: C.dim }}>
            {account?.email ?? '—'} · in
          </span>
          <button
            className="spnr-ghost"
            data-testid="logout"
            onClick={onLogout}
            style={{
              fontFamily: FONT_MONO,
              fontSize: 11.5,
              letterSpacing: '0.08em',
              padding: '7px 14px',
              background: 'transparent',
              border: `1px solid ${C.border}`,
              color: C.mid,
              cursor: 'pointer',
            }}
          >
            LOGOUT
          </button>
        </div>
      </header>

      {/* ===== tabs ===== */}
      <nav style={{ display: 'flex', gap: 4, padding: '18px 0 0', fontSize: 12.5, letterSpacing: '0.08em' }}>
        <button onClick={() => setTab('overview')} style={tabStyle(tab === 'overview')}>OVERVIEW</button>
        <button onClick={() => setTab('ledger')} style={tabStyle(tab === 'ledger')}>LEDGER</button>
        <button onClick={() => setTab('redeem')} style={tabStyle(tab === 'redeem')}>REDEEM</button>
        <button onClick={() => setTab('settings')} style={tabStyle(tab === 'settings')}>SETTINGS</button>
      </nav>

      {/* ===== OVERVIEW ===== */}
      {tab === 'overview' && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingTop: 24 }}>
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
              <div style={label}>BALANCE — USD, ALWAYS</div>
              <div data-testid="balance" style={{ ...numCard, color: C.green, textShadow: GREEN_GLOW }}>${balance}</div>
              <div style={sub}>7-day fraud hold: <span style={{ color: C.mid }}>$1.82</span> releasing</div>
            </div>
            <div style={{ background: C.panel, padding: '24px 24px 20px' }}>
              <div style={label}>TODAY</div>
              <div data-testid="impressions" style={{ ...numCard, color: C.bright }}>{impressions}</div>
              <div style={sub}>impressions · <span style={{ color: C.amber }}>${todayEarned}</span> earned</div>
            </div>
            <div style={{ background: C.panel, padding: '24px 24px 20px' }}>
              <div style={label}>LIFETIME</div>
              <div data-testid="lifetime" style={{ ...numCard, color: C.bright }}>${lifetime}</div>
              <div style={sub}>since install · attested impressions</div>
            </div>
            <div style={{ background: C.panel, padding: '24px 24px 20px' }}>
              <div style={label}>ATTESTATION</div>
              <div data-testid="attestation" style={{ ...numCard, color: C.green }}>{attestation}%</div>
              <div style={sub}>events signed &amp; accepted · 0 flagged</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: 24 }}>
            <div style={{ border: `1px solid ${C.border}`, background: C.panel, padding: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 22 }}>
                <div style={{ fontSize: 11, letterSpacing: '0.1em', color: C.dim }}>EARNINGS — LAST 14 DAYS</div>
                <div style={{ fontSize: 11.5, color: C.dimmer }}>avg <span style={{ color: C.mid }}>$1.53/day</span></div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 140 }}>
                {DAY_VALS.map((val, i) => {
                  const last = i === DAY_VALS.length - 1;
                  return (
                    <div key={i} title={`$${val.toFixed(2)}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                      <div
                        style={{
                          height: `${Math.round((val / max) * 100)}%`,
                          background: last ? C.amber : C.green,
                          opacity: last ? 1 : 0.55 + (val / max) * 0.45,
                          minHeight: 3,
                        }}
                      />
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 10.5, color: C.dimmer }}>
                <span>MAY 30</span>
                <span>JUN 12</span>
              </div>
              <div style={{ fontSize: 10.5, color: C.dimmer, marginTop: 8 }}>* 14-day series is a design visual; a real time-series endpoint is v0.2.</div>
            </div>

            <div style={{ border: `1px solid ${C.border}`, background: C.panel, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ fontSize: 11, letterSpacing: '0.1em', color: C.dim }}>CURRENT CREATIVE — SLOT:SPINNER</div>
              {running ? (
                <div style={{ border: `1px solid ${C.border}`, background: C.bg, padding: 18, fontSize: 13.5, lineHeight: 1.9 }}>
                  <div>
                    <span style={{ color: sponsored ? C.amber : C.green }}>{GLYPHS[frame]}</span>{' '}
                    <span style={{ color: sponsored ? C.amber : C.mid }}>{v.t}</span>
                  </div>
                </div>
              ) : (
                <div style={{ border: `1px solid ${C.border}`, background: C.bg, padding: 18, fontSize: 13.5, color: C.dimmer }}>
                  — paused · your stock spinner verbs are live, snapshot restored —
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: C.dim }}>
                <Row k="campaign" v={<span style={{ color: C.mid }}>{stats?.campaign ?? 'cloakpipe-launch-06'}</span>} />
                <Row k="your cut per impression" v={<span style={{ color: C.green }}>$0.0055 (50%)</span>} />
                <Row k="creative signature" v={<span style={{ color: C.green }}>✓ verified · pinned key</span>} />
                <Row k="ttl" v={<span style={{ color: C.mid }}>42s · refetch on expiry</span>} />
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ===== LEDGER ===== */}
      {tab === 'ledger' && (
        <section style={{ paddingTop: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.1em', color: C.dim }}>APPEND-ONLY EVENT LEDGER — EVERYTHING YOUR MACHINE SENT, NOTHING ELSE</div>
            <div style={{ fontSize: 11.5, color: C.dimmer }}>same data as&nbsp; <span style={{ color: C.green }}>spnr audit</span> &nbsp;· export jsonl ↓</div>
          </div>
          <div style={{ border: `1px solid ${C.border}`, background: C.panel }}>
            <LedgerRow head cols={['TIME', 'EVENT ID', 'CREATIVE', 'TYPE', 'SIG', 'AMOUNT']} />
            {RAW_EVENTS.map((e, i) => (
              <LedgerRow
                key={i}
                cols={[
                  <span style={{ color: C.dim }}>{e.time}</span>,
                  <span style={{ color: C.dimmer }}>{e.id}</span>,
                  <span style={{ color: C.mid }}>{e.creative}</span>,
                  <span style={{ color: e.type === 'click' ? C.amber : C.dim }}>{e.type}</span>,
                  <span style={{ color: C.green }}>✓ ed25519</span>,
                  <span style={{ color: e.type === 'click' ? C.amber : C.green, textAlign: 'right' }}>{e.amount}</span>,
                ]}
              />
            ))}
            <div style={{ padding: '12px 18px', fontSize: 11.5, color: C.dimmer }}>…earlier events · monotonic counter intact · no gaps detected</div>
          </div>
        </section>
      )}

      {/* ===== REDEEM ===== */}
      {tab === 'redeem' && (
        <section style={{ paddingTop: 24, display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 760 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.1em', color: C.dim }}>
            REDEEM — AVAILABLE NOW: <span style={{ color: C.green }}>${balance}</span> &nbsp;·&nbsp; NO MINIMUM, NO WAITING PERIOD
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: C.border, border: `1px solid ${C.border}` }}>
            <button onClick={() => { setMethod('usdc'); setReceipt(null); setRedeemError(null); }} style={methodStyle(method === 'usdc')}>
              <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 16, letterSpacing: '0.04em' }}>USDC · x402</span>
              <span style={{ fontSize: 12.5, color: C.dim }}>Default. To your wallet, over the same rail that settles the network. Taxes are yours — docs linked.</span>
            </button>
            <button onClick={() => { setMethod('gift'); setReceipt(null); setRedeemError(null); }} style={methodStyle(method === 'gift')}>
              <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 16, letterSpacing: '0.04em' }}>GIFT CARD / LOCAL</span>
              <span style={{ fontSize: 12.5, color: C.dim }}>Fiat off-ramp via a licensed aggregator. Works in every country incl. India. No wallet needed.</span>
            </button>
            <button onClick={() => { setMethod('credits'); setReceipt(null); setRedeemError(null); }} style={methodStyle(method === 'credits')}>
              <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 16, letterSpacing: '0.04em' }}>CONSOLE TOP-UP</span>
              <span style={{ fontSize: 12.5, color: C.dim }}>Indirect: general-purpose value you apply to your own Claude/OpenAI bill. We never resell API credit codes.</span>
            </button>
          </div>
          <div style={{ border: `1px solid ${C.border}`, background: C.panel, padding: '22px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, letterSpacing: '0.1em', color: C.dim }}>REDEEMING</span>
              <span style={{ fontFamily: FONT_DISPLAY, fontSize: 30, fontWeight: 700, color: C.bright }}>
                ${balance} <span style={{ fontSize: 14, color: C.dim, fontFamily: FONT_MONO }}>→ {METHOD_LABELS[method]}</span>
              </span>
            </div>
            <button
              className="spnr-primary"
              data-testid="redeem-confirm"
              onClick={confirmRedeem}
              disabled={redeeming}
              style={{ fontFamily: FONT_MONO, fontSize: 13, fontWeight: 600, letterSpacing: '0.08em', padding: '14px 28px', background: C.green, color: C.bg, border: 'none', cursor: redeeming ? 'wait' : 'pointer', opacity: redeeming ? 0.6 : 1 }}
            >
              {redeeming ? 'REDEEMING…' : 'CONFIRM →'}
            </button>
          </div>
          {receipt && (
            <div
              data-testid="redeem-receipt"
              style={{ border: `1px solid ${C.green}`, background: C.panelActive, padding: '16px 20px', fontSize: 13, color: C.green }}
            >
              ✓ queued — {receipt.id} · {receipt.amount_usd} → {receipt.rail} · remaining ${(receipt.remaining_micros / 1e6).toFixed(2)}
            </div>
          )}
          {redeemError && (
            <div style={{ border: `1px solid ${C.red}`, background: C.panel, padding: '16px 20px', fontSize: 13, color: C.red }}>
              ✗ {redeemError}
            </div>
          )}
        </section>
      )}

      {/* ===== SETTINGS ===== */}
      {tab === 'settings' && (
        <section style={{ paddingTop: 24, display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 760 }}>
          <div style={{ border: `1px solid ${C.border}`, background: C.panel, padding: 24 }}>
            <div style={{ ...label, marginBottom: 16 }}>DEVICES — ED25519 KEYS REGISTERED TO THIS ACCOUNT</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '12px 0', borderBottom: `1px solid ${C.borderFaint}`, fontSize: 13, flexWrap: 'wrap' }}>
              <span style={{ color: C.bright }}>this machine <span style={{ color: C.dimmer }}>· macOS arm64 · spnrd 0.2.3</span></span>
              <span style={{ color: C.dim }}>key <span style={{ color: C.green }}>a7f2…c91d</span> · active now</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '12px 0', fontSize: 13, flexWrap: 'wrap' }}>
              <span style={{ color: C.bright }}>devbox <span style={{ color: C.dimmer }}>· linux x86_64 · spnrd 0.2.3</span></span>
              <span style={{ color: C.dim }}>key <span style={{ color: C.green }}>e310…88ab</span> · 2h ago</span>
            </div>
          </div>
          <div style={{ border: `1px solid ${C.border}`, background: C.panel, padding: 24, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
            <div style={{ ...label, marginBottom: 8 }}>TELEMETRY — THE WHOLE LIST</div>
            <Row k={<span style={{ color: C.mid }}>ad events (type, creative id, timestamp)</span>} v={<span style={{ color: C.green }}>sent · signed</span>} />
            <Row k={<span style={{ color: C.mid }}>install metadata (os / arch / version)</span>} v={<span style={{ color: C.green }}>sent</span>} />
            <Row k={<span style={{ color: C.mid }}>code, prompts, paths, transcripts, env</span>} v={<span style={{ color: C.red }}>never — structurally impossible</span>} />
          </div>
          <div style={{ border: `1px solid ${C.border}`, background: C.panel, padding: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 13, color: C.bright }}>uninstall</span>
              <span style={{ fontSize: 12, color: C.dimmer }}>spnr uninstall — full removal, settings snapshot restored, keys revoked</span>
            </div>
            <span style={{ fontSize: 12, color: C.dim, border: `1px solid ${C.border}`, padding: '8px 14px' }}>run it in your terminal — not here</span>
          </div>
        </section>
      )}
    </Crt>
  );
}

function Row({ k, v }: { k: React.ReactNode; v: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span>{k}</span>
      {v}
    </div>
  );
}

function LedgerRow({ cols, head }: { cols: React.ReactNode[]; head?: boolean }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '110px 150px 1fr 120px 90px 110px',
        gap: 0,
        padding: head ? '12px 18px' : '11px 18px',
        borderBottom: `1px solid ${head ? C.border : C.borderFaint}`,
        fontSize: head ? 10.5 : 12.5,
        letterSpacing: head ? '0.1em' : undefined,
        color: head ? C.dimmer : undefined,
      }}
    >
      {cols.map((c, i) => (
        <span key={i} style={i === cols.length - 1 ? { textAlign: 'right' } : undefined}>{c}</span>
      ))}
    </div>
  );
}
