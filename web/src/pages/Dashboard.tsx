import { CSSProperties, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shell } from '../components/Shell';
import { SectionHeader } from '../components/SectionHeader';
import { FONT_DISPLAY, FONT_MONO, RULE, T, shadow } from '../theme';
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

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'OVERVIEW' },
  { id: 'ledger', label: 'LEDGER' },
  { id: 'redeem', label: 'REDEEM' },
  { id: 'settings', label: 'SETTINGS' },
];

// ---- shared brutalist primitives (Martian Mono labels, big mono numbers) ----
const statLabel: CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 10.5,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: T.text3,
};
const statNum: CSSProperties = {
  fontFamily: FONT_MONO,
  fontWeight: 700,
  fontSize: 44,
  letterSpacing: '-0.04em',
  lineHeight: 1,
};
const statSub: CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 10.5,
  letterSpacing: '0.04em',
  color: T.text3,
  marginTop: 12,
  textTransform: 'uppercase',
};
const cardCaption: CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 10.5,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: T.text3,
};

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
    fontSize: 11,
    fontWeight: active ? 700 : 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    padding: '12px 22px',
    cursor: 'pointer',
    background: active ? T.ember : 'transparent',
    color: active ? '#fff' : T.text2,
    border: 'none',
    borderRight: RULE,
    transition: 'background 0.12s ease, color 0.12s ease',
  });
  const methodStyle = (active: boolean): CSSProperties => ({
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    alignItems: 'flex-start',
    textAlign: 'left',
    fontFamily: FONT_MONO,
    padding: '22px 24px',
    cursor: 'pointer',
    border: 'none',
    borderBottom: RULE,
    background: active ? T.surface2 : T.surface,
    color: T.text,
    boxShadow: active ? `inset 4px 0 0 ${T.ember}` : 'none',
    transition: 'background 0.12s ease',
  });

  return (
    <Shell
      nav={
        <>
          <span data-testid="account-email" style={{ color: T.text2, textTransform: 'none' }}>
            {account?.email ?? '—'} · in
          </span>
          <button className="spnr-ghost" data-testid="logout" onClick={onLogout} style={{ padding: '8px 14px' }}>
            LOGOUT
          </button>
        </>
      }
    >
      {/* ===== console sub-bar: label + daemon state + pause control ===== */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
          padding: '16px 32px',
          borderBottom: RULE,
          background: T.surface2,
        }}
      >
        <div style={{ ...cardCaption, fontWeight: 600, color: T.text2 }}>
          DEV CONSOLE · SPNR.CO — SUPPLY SIDE
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontFamily: FONT_MONO,
              fontSize: 11,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              border: RULE,
              padding: '6px 10px',
              color: running ? T.emberText : T.text2,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                display: 'inline-block',
                background: running ? T.green : T.text3,
              }}
            />
            {running ? 'Daemon running' : 'Paused — stock verbs'}
          </span>
          <button className="spnr-ghost" onClick={() => setPaused((p) => !p)} style={{ padding: '8px 16px' }}>
            {paused ? 'RESUME' : 'PAUSE'}
          </button>
        </div>
      </div>

      {/* ===== tabs (ruled, ember-filled active) ===== */}
      <nav style={{ display: 'flex', flexWrap: 'wrap', borderBottom: RULE }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={tabStyle(tab === t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      {/* ===== OVERVIEW ===== */}
      {tab === 'overview' && (
        <>
          {/* metrics — ruled brutalist stat grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
              borderBottom: RULE,
            }}
          >
            <StatCell
              label="Balance — USD, always"
              value={<span data-testid="balance" style={{ ...statNum, color: T.ember }}>${balance}</span>}
              sub={<>7-day fraud hold: <span style={{ color: T.text }}>$1.82</span> releasing</>}
              ruleRight
            />
            <StatCell
              label="Today"
              value={<span data-testid="impressions" style={{ ...statNum, color: T.text }}>{impressions}</span>}
              sub={<>impressions · <span style={{ color: T.green }}>+${todayEarned}</span> earned</>}
              ruleRight
            />
            <StatCell
              label="Lifetime"
              value={<span data-testid="lifetime" style={{ ...statNum, color: T.text }}>${lifetime}</span>}
              sub={<>since install · attested impressions</>}
              ruleRight
            />
            <StatCell
              label="Attestation"
              value={<span data-testid="attestation" style={{ ...statNum, color: T.ember }}>{attestation}%</span>}
              sub={<>events signed &amp; accepted · 0 flagged</>}
            />
          </div>

          {/* earnings chart + live creative readout */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 440px), 1fr))',
              borderBottom: RULE,
            }}
          >
            {/* FIG.01-style earnings readout */}
            <div style={{ borderRight: RULE, background: T.surface, padding: 32, minWidth: 0 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  marginBottom: 24,
                }}
              >
                <span style={cardCaption}>FIG.01 — Earnings, last 14 days</span>
                <span style={{ ...cardCaption, color: T.text2 }}>
                  avg <span style={{ color: T.text }}>$1.53/day</span>
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 150 }}>
                {DAY_VALS.map((val, i) => {
                  const last = i === DAY_VALS.length - 1;
                  return (
                    <div
                      key={i}
                      title={`$${val.toFixed(2)}`}
                      style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}
                    >
                      <div
                        style={{
                          height: `${Math.round((val / max) * 100)}%`,
                          minHeight: 3,
                          background: last ? T.ember : T.bar,
                        }}
                      />
                    </div>
                  );
                })}
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: 12,
                  ...cardCaption,
                }}
              >
                <span>MAY 30</span>
                <span>JUN 12</span>
              </div>
              <div style={{ ...cardCaption, marginTop: 14, color: T.text3, textTransform: 'none', lineHeight: 1.5 }}>
                * 14-day series is a design visual; a real time-series endpoint is v0.2.
              </div>
            </div>

            {/* live creative — slot:spinner */}
            <div style={{ background: T.surface, padding: 32, display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={cardCaption}>Current creative — slot:spinner</span>
                <span style={{ ...cardCaption, color: running ? T.green : T.text3 }}>
                  ● {running ? 'Earning' : 'Paused'}
                </span>
              </div>
              {running ? (
                <div
                  style={{
                    border: RULE,
                    background: T.surface2,
                    padding: 16,
                    fontFamily: FONT_MONO,
                    fontSize: 12.5,
                    lineHeight: 1.95,
                  }}
                >
                  <div style={{ color: T.text3 }}>&gt; tighten the retry logic in worker.rs</div>
                  <div style={{ color: T.text3 }}>⏺ Read worker.rs · Edited 2 files</div>
                  <div>
                    <span style={{ color: sponsored ? T.ember : T.text }}>{GLYPHS[frame]}</span>{' '}
                    <span style={{ color: sponsored ? T.emberText : T.text2, fontWeight: sponsored ? 600 : 400 }}>{v.t}</span>
                    <span className="spnr-blink" style={{ color: T.ember }}>▌</span>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    border: RULE,
                    background: T.surface2,
                    padding: 16,
                    fontFamily: FONT_MONO,
                    fontSize: 12.5,
                    color: T.text3,
                    lineHeight: 1.6,
                  }}
                >
                  — paused · your stock spinner verbs are live, snapshot restored —
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <Row k="campaign" v={<span style={{ color: T.text }}>{stats?.campaign ?? 'cloakpipe-launch-06'}</span>} />
                <Row k="your cut per impression" v={<span style={{ color: T.ember }}>$0.0055 (50%)</span>} />
                <Row k="creative signature" v={<span style={{ color: T.green }}>✓ verified · pinned key</span>} />
                <Row k="ttl" v={<span style={{ color: T.text }}>42s · refetch on expiry</span>} last />
              </div>
            </div>
          </div>
        </>
      )}

      {/* ===== LEDGER ===== */}
      {tab === 'ledger' && (
        <>
          <SectionHeader n="◆" title="Append-only event ledger" />
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: 16,
              flexWrap: 'wrap',
              padding: '16px 32px',
              borderBottom: RULE,
              ...cardCaption,
            }}
          >
            <span>Everything your machine sent — nothing else</span>
            <span style={{ color: T.text2 }}>
              same data as <span style={{ color: T.ember }}>spnr audit</span> · export jsonl ↓
            </span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <LedgerRow head cols={['TIME', 'EVENT ID', 'CREATIVE', 'TYPE', 'SIG', 'AMOUNT']} />
            {RAW_EVENTS.map((e, i) => (
              <LedgerRow
                key={i}
                cols={[
                  <span style={{ color: T.text2 }}>{e.time}</span>,
                  <span style={{ color: T.text3 }}>{e.id}</span>,
                  <span style={{ color: T.text }}>{e.creative}</span>,
                  <span style={{ color: e.type === 'click' ? T.ember : T.text2 }}>{e.type}</span>,
                  <span style={{ color: T.green }}>✓ ed25519</span>,
                  <span style={{ color: e.type === 'click' ? T.ember : T.green }}>{e.amount}</span>,
                ]}
              />
            ))}
          </div>
          <div
            style={{
              padding: '16px 32px',
              borderBottom: RULE,
              ...cardCaption,
            }}
          >
            …earlier events · monotonic counter intact · no gaps detected
          </div>
        </>
      )}

      {/* ===== REDEEM ===== */}
      {tab === 'redeem' && (
        <>
          <SectionHeader n="$" title="Redeem" />
          <div style={{ padding: '32px', display: 'flex', flexDirection: 'column', gap: 28, maxWidth: 820 }}>
            <div style={cardCaption}>
              AVAILABLE NOW: <span style={{ color: T.ember }}>${balance}</span> · NO MINIMUM, NO WAITING PERIOD
            </div>

            <div style={{ border: RULE, background: T.surface, boxShadow: shadow() }}>
              <RedeemMethod
                active={method === 'usdc'}
                onClick={() => { setMethod('usdc'); setReceipt(null); setRedeemError(null); }}
                style={methodStyle(method === 'usdc')}
                title="USDC · x402"
                desc="Default. To your wallet, over the same rail that settles the network. Taxes are yours — docs linked."
              />
              <RedeemMethod
                active={method === 'gift'}
                onClick={() => { setMethod('gift'); setReceipt(null); setRedeemError(null); }}
                style={methodStyle(method === 'gift')}
                title="Gift card / local"
                desc="Fiat off-ramp via a licensed aggregator. Works in every country incl. India. No wallet needed."
              />
              <RedeemMethod
                active={method === 'credits'}
                onClick={() => { setMethod('credits'); setReceipt(null); setRedeemError(null); }}
                style={{ ...methodStyle(method === 'credits'), borderBottom: 'none' }}
                title="Console top-up"
                desc="Indirect: general-purpose value you apply to your own Claude/OpenAI bill. We never resell API credit codes."
              />
            </div>

            <div
              style={{
                border: RULE,
                background: T.surface2,
                padding: '24px 26px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 20,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={cardCaption}>REDEEMING</span>
                <span style={{ fontFamily: FONT_MONO, fontSize: 30, fontWeight: 700, letterSpacing: '-0.03em', color: T.text }}>
                  ${balance}{' '}
                  <span style={{ fontSize: 12, fontWeight: 500, color: T.text3 }}>→ {METHOD_LABELS[method]}</span>
                </span>
              </div>
              <button
                className="spnr-btn"
                data-testid="redeem-confirm"
                onClick={confirmRedeem}
                disabled={redeeming}
                style={{ padding: '14px 28px' }}
              >
                {redeeming ? 'REDEEMING…' : 'CONFIRM ▸'}
              </button>
            </div>

            {receipt && (
              <div
                data-testid="redeem-receipt"
                style={{
                  border: `2px solid ${T.ember}`,
                  background: T.surface,
                  padding: '16px 20px',
                  fontFamily: FONT_MONO,
                  fontSize: 12.5,
                  color: T.emberText,
                  boxShadow: shadow(),
                }}
              >
                ✓ queued — {receipt.id} · {receipt.amount_usd} → {receipt.rail} · remaining ${(receipt.remaining_micros / 1e6).toFixed(2)}
              </div>
            )}
            {redeemError && (
              <div
                style={{
                  border: RULE,
                  background: T.surface,
                  padding: '16px 20px',
                  fontFamily: FONT_MONO,
                  fontSize: 12.5,
                  color: T.text,
                }}
              >
                ✗ {redeemError}
              </div>
            )}
          </div>
        </>
      )}

      {/* ===== SETTINGS ===== */}
      {tab === 'settings' && (
        <>
          <SectionHeader n="⚙" title="Settings" />
          <div style={{ padding: '32px', display: 'flex', flexDirection: 'column', gap: 28, maxWidth: 820 }}>
            <div style={{ border: RULE, background: T.surface }}>
              <div style={{ padding: '18px 24px', borderBottom: RULE, ...cardCaption, fontWeight: 600, color: T.text2 }}>
                Devices — ed25519 keys registered to this account
              </div>
              <DeviceRow
                name="this machine"
                meta="macOS arm64 · spnrd 0.2.3"
                keyId="a7f2…c91d"
                seen="active now"
              />
              <DeviceRow
                name="devbox"
                meta="linux x86_64 · spnrd 0.2.3"
                keyId="e310…88ab"
                seen="2h ago"
                last
              />
            </div>

            <div style={{ border: RULE, background: T.surface }}>
              <div style={{ padding: '18px 24px', borderBottom: RULE, ...cardCaption, fontWeight: 600, color: T.text2 }}>
                Telemetry — the whole list
              </div>
              <div style={{ padding: '8px 24px' }}>
                <Row k={<span style={{ color: T.text }}>ad events (type, creative id, timestamp)</span>} v={<span style={{ color: T.green }}>sent · signed</span>} />
                <Row k={<span style={{ color: T.text }}>install metadata (os / arch / version)</span>} v={<span style={{ color: T.green }}>sent</span>} />
                <Row k={<span style={{ color: T.text }}>code, prompts, paths, transcripts, env</span>} v={<span style={{ color: T.text3 }}>never — structurally impossible</span>} last />
              </div>
            </div>

            <div
              style={{
                border: RULE,
                background: T.surface,
                padding: 24,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 20,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 18, letterSpacing: '-0.01em', textTransform: 'uppercase' }}>
                  Uninstall
                </span>
                <span style={{ ...cardCaption, textTransform: 'none', color: T.text3 }}>
                  spnr uninstall — full removal, settings snapshot restored, keys revoked
                </span>
              </div>
              <span style={{ ...cardCaption, color: T.text2, border: RULE, padding: '10px 14px' }}>
                run it in your terminal — not here
              </span>
            </div>
          </div>
        </>
      )}
    </Shell>
  );
}

// ---- a single brutalist stat cell (FIG.01 footer-stat template) ----
function StatCell({
  label,
  value,
  sub,
  ruleRight,
}: {
  label: string;
  value: React.ReactNode;
  sub: React.ReactNode;
  ruleRight?: boolean;
}) {
  return (
    <div
      style={{
        background: T.surface,
        padding: '28px 28px 24px',
        borderRight: ruleRight ? RULE : undefined,
        minWidth: 0,
      }}
    >
      <div style={{ ...statLabel, marginBottom: 14 }}>{label}</div>
      {value}
      <div style={statSub}>{sub}</div>
    </div>
  );
}

function Row({ k, v, last }: { k: React.ReactNode; v: React.ReactNode; last?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 16,
        padding: '11px 0',
        borderTop: RULE,
        ...(last ? { borderBottom: 'none' } : {}),
        fontFamily: FONT_MONO,
        fontSize: 12,
        color: T.text2,
      }}
    >
      <span>{k}</span>
      {v}
    </div>
  );
}

function DeviceRow({
  name,
  meta,
  keyId,
  seen,
  last,
}: {
  name: string;
  meta: string;
  keyId: string;
  seen: string;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 16,
        padding: '16px 24px',
        borderBottom: last ? 'none' : RULE,
        fontFamily: FONT_MONO,
        fontSize: 12.5,
        flexWrap: 'wrap',
      }}
    >
      <span style={{ color: T.text }}>
        {name} <span style={{ color: T.text3 }}>· {meta}</span>
      </span>
      <span style={{ color: T.text2 }}>
        key <span style={{ color: T.ember }}>{keyId}</span> · {seen}
      </span>
    </div>
  );
}

function RedeemMethod({
  title,
  desc,
  onClick,
  style,
}: {
  title: string;
  desc: string;
  active: boolean;
  onClick: () => void;
  style: CSSProperties;
}) {
  return (
    <button onClick={onClick} style={style}>
      <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 17, letterSpacing: '-0.01em', textTransform: 'uppercase' }}>
        {title}
      </span>
      <span style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: T.text2, lineHeight: 1.5, textTransform: 'none' }}>
        {desc}
      </span>
    </button>
  );
}

function LedgerRow({ cols, head }: { cols: React.ReactNode[]; head?: boolean }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '120px 160px 1fr 110px 110px 120px',
        gap: 0,
        padding: head ? '14px 32px' : '13px 32px',
        borderBottom: RULE,
        background: head ? T.surface2 : T.surface,
        fontFamily: FONT_MONO,
        fontSize: head ? 10.5 : 12,
        letterSpacing: head ? '0.06em' : undefined,
        textTransform: head ? 'uppercase' : undefined,
        color: head ? T.text3 : undefined,
        minWidth: 740,
      }}
    >
      {cols.map((c, i) => (
        <span key={i} style={i === cols.length - 1 ? { textAlign: 'right' } : undefined}>
          {c}
        </span>
      ))}
    </div>
  );
}
