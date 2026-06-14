# ADR 0008 — Frontend is a Vite + React + TypeScript SPA (design exports migrated off dc-runtime)

> Status: **Accepted** · 2026-06-13
> Related: [ADR 0007 — language split](0007-language-split-rust-client-ts-backend.md) · [06-money-settlement.md](../06-money-settlement.md) · [01-architecture.md](../01-architecture.md)

## Context

The visual design arrived as **design-tool exports** (`*.dc.html`): three pages rendered by a proprietary
`dc-runtime` (`support.js`) that needs `window.React`/`window.ReactDOM` UMD globals, with `{{ binding }}`
template syntax, custom elements (`<x-dc>`, `<helmet>`, `<sc-if>`, `<sc-for>`), `style-hover` attributes, and a
bottom `<script type="text/x-dc">` component class extending `DCLogic`.

The first pass scaffolded those exports **as-is** inside Vite (a multi-page app serving the `.dc.html` files +
vendored React UMD + `support.js`). That rendered, and we wired the dashboard to live data — but it was a
**fragile shim, not a real frontend**: three hand-edited 25 KB export files running a foreign runtime, with
`{{ }}` bindings, inline `support.js`, and no component model, types, routing, or build-time checks. "We
migrated to Vite" should mean a real app, not the export bolted into Vite.

## Decision

Migrate to a real **Vite + React 18 + TypeScript SPA** in `web/`:

- **Each page is a React component** — `src/pages/{Landing,Dashboard,Advertiser}.tsx` — using a shared design
  system (`src/theme.ts` = the `C` palette + fonts + glow, extracted verbatim from the export), the shared CRT
  shell (`src/components/Crt.tsx`), and `react-router-dom` routing (`/`, `/dashboard`, `/advertiser`).
- **dc-runtime is gone:** no `support.js`, no React UMD, no `{{ }}`, no `<x-dc>`/`<sc-*>`/`<helmet>`,
  no `style-hover`. `{{ }}` → React expressions; `<sc-if>` → `{cond && …}`; `<sc-for>` → `.map`; the `DCLogic`
  class's state/intervals/methods → `useState`/`useEffect`/handlers; `style-hover` → small `theme.css` helpers.
- **Idiomatic live data:** `src/lib/useStats.ts` polls the Rust backend's `/api/stats` (the same endpoint and
  same single Ed25519/BLAKE3 verifier from [ADR-0007](0007-language-split-rust-client-ts-backend.md)); the
  dashboard's balance/impressions/lifetime/attestation render from the live ledger, not the export's mocks.
- **Design fidelity preserved:** the export's inline styles are ported to React `CSSProperties` objects backed
  by the `C` tokens — pixel-faithful to the original (verified by Playwright screenshots).
- **The original exports are preserved** under `web/.design-export/` as reference, not app source.
- **Product copy corrected:** the export's "API credits (default)" redeem/landing copy is replaced with the
  real wedge (USDC default; gift-card/local off-ramp; never resold credit codes) per
  [ADR-0006](0006-crypto-native-agent-economy-launch-wedge.md)/[ADR-0001](0001-payout-default-gift-cards-not-api-credits.md).

## Consequences

- 🟢 Maintainable, typed frontend with a real component model, routing, and a `typecheck` + `vite build` gate.
- 🟢 The live dashboard is wired the React way and **Playwright-tested on the `/dashboard` SPA route** in the
  canonical E2E (`e2e/run.sh`): UI impressions/balance/attestation match the ledger, no mock values, no console
  errors.
- 🟠 Styling is currently inline `CSSProperties` (a faithful 1:1 port of the export). Extracting to CSS modules
  is optional future polish.
- ⚪ Follow-ups: wire the Advertiser forms to the v2 TypeScript portal API (`server-ts/`); add a real 14-day
  earnings time-series endpoint (the chart is a design visual today).

## Alternatives considered

- **Keep the dc-runtime export in Vite (status quo):** rejected — fragile, unmaintainable, depends on a
  proprietary runtime + UMD globals, no types/build checks.
- **Re-export from the design tool on every change:** rejected — couples the product to the tool and keeps the
  `{{ }}`/`support.js` shim.
