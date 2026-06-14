# ADR 0005 — Naming & Domain Registration Plan

> Decision record for the `spnr` name, package namespaces, and canonical domains — correcting the source specs' refuted ownership claims.
> Status: Draft v0.3 · June 12, 2026

---

## Status

**Accepted** (supersedes the "domains locked / owned" framing in `../source/product-spec-v0.2.md` §5.8 and `../source/tech-spec-v1.0.md` header).

This ADR is **time-sensitive and launch-blocking**: the source specs asserted ownership of names and domains that live checks on 2026-06-12 proved are NOT yet held. The registration actions below must complete before any public announcement (HN/X launch, RFC publication at spnr.dev). Until then, `spnr` has a real namespace gap, not a locked one.

Related: `0001-payout-default-gift-cards-not-api-credits.md`, `0004-platform-risk-adapter-abstraction.md`, `../07-security-privacy.md` (anti-phishing posture), `../13-research-findings.md` (citations for every check below).

---

## Context

### What the source specs claimed (and where)

- `product-spec-v0.2.md` header: *"name and domains locked: spnr · spnr.sh / spnr.dev / spnr.co"* and §5.8: *"canonical domains are exactly three … spnr.sh … spnr.dev … spnr.co."* The phrasing implies all three are owned.
- `tech-spec-v1.0.md` header: *"Domains locked: spnr.sh … spnr.dev … spnr.co."* §13: *"GitHub org"* listed as a name to reserve, with an earlier informal note that the org name was free.
- Both specs correctly flagged crates.io `spnr` as free and npm `spnr` as taken (publish under `@spnr/*`).

### What live checks on 2026-06-12 actually found

> **Research correction:** The specs' "domains locked / owned" claim and the "GitHub org `spnr` is free (404)" claim are both REFUTED. Authoritative findings (whois/RDAP, registry, crates.io/npm/GitHub APIs) are in `../13-research-findings.md` §J.

| Asset | Live status (2026-06-12) | Spec said | Action |
|---|---|---|---|
| **crates.io `spnr`** | FREE / unregistered | free | Reserve `0.0.1` placeholder NOW |
| **npm `spnr`** | TAKEN — dormant frontend lib, v1.8.1, unrelated | taken → `@spnr/*` | Publish under scope `@spnr/*`; claim `@spnr` scope |
| **GitHub `spnr`** | TAKEN — dormant **USER** account "SPNR", id **13784566**, created 2015, soil-science, last active 2016. NOT an org, NOT free. | (informally) free / 404 | Pick alt org handle OR attempt acquisition |
| **`spnr.sh`** | UNREGISTERED / AVAILABLE | "owned / locked" | **Register immediately** |
| **`spnr.co`** | UNREGISTERED / AVAILABLE | "owned / locked" | **Register immediately** |
| **`spnr.dev`** | REGISTERED — Porkbun, created 2023-12-06, serving HTTP 502. Ownership **UNVERIFIED** (founder's? third party's?) | "owned / locked" | **Confirm/secure ownership** before relying on it |
| **`spnr.com`** | REGISTERED 2006 — long-held third-party **parked** domain. Squat/impersonation risk. Expires **2026-09-17**. Not cheaply acquirable. | "not ours" (correct) | **Monitor**; do not depend on it |

#### The GitHub correction in detail

> **Research correction:** The earlier "404 → free" check queried `GET /orgs/spnr`, which 404s because `spnr` is a **user**, not an org. `GET /users/spnr` returns a real account (id 13784566). A 404 on the orgs endpoint does NOT mean the name is claimable — GitHub usernames and org names share one global namespace. See `../13-research-findings.md` §J.

```
# What was checked vs what should have been checked
GET https://api.github.com/orgs/spnr     → 404   ("no ORG named spnr")   ← misread as "free"
GET https://api.github.com/users/spnr    → 200   (user id 13784566, 2015) ← the real state
```

Because the username is held by a dormant 2015 account, we cannot register a GitHub org named exactly `spnr`. GitHub does offer a name-release/dispute path for inactive accounts, but it is slow, discretionary, and not launch-timeline-safe.

#### Confusables to avoid

- **npm `@spnrapp`** — a crypto scope ("Spinner.Cash"). Visually/semantically confusable with `@spnr`; do NOT let it be mistaken for us. Disclose our exact scope (`@spnr`) everywhere.
- **npm `spnr`** (unscoped) — the dormant frontend lib. We never publish unscoped; all packages are `@spnr/*`.

### Why this matters (invariants)

The product literally claims money (developer payouts — see `0001-payout-default-gift-cards-not-api-credits.md`). A squatted lookalike running a cloned redemption page is the obvious attack. Naming/domain control is therefore a **security** concern, not a branding nicety — it feeds directly into the anti-phishing posture (`../07-security-privacy.md`, invariant 5: everything on the user's machine is open and reproducible; the canonical hosts must be unambiguous).

---

## Decision

### 1. Register the available domains immediately

- **`spnr.sh`** → register now. Canonical identity host + installer (`get.spnr.sh`). Primary host in `curl -fsSL https://get.spnr.sh | sh` and the `/c/{code}` click redirector (`https://spnr.sh/c/{code}`, see `0004-platform-risk-adapter-abstraction.md` and `../03-protocol-SAP1.md`).
- **`spnr.co`** → register now. Advertiser portal + redemption dashboard host.
- Enable registrar-lock + auto-renew + DNSSEC on both at creation. `.sh` (registry: GAIA/Tonic) and `.co` (registry: .CO Internet) are both registrar-self-serve; no special eligibility.

### 2. Confirm and secure `spnr.dev`

`spnr.dev` is already registered (Porkbun, 2023-12-06) and currently 502s.

```
IF spnr.dev is the founder's existing registration:
    → verify in the Porkbun account, enable lock + auto-renew + DNSSEC, deploy docs/RFC, resolve the 502.
ELIF spnr.dev is a third party's:
    → it is NOT ours. Treat it like spnr.com: do not depend on it, monitor it,
      and REPLAN the docs/protocol host onto spnr.sh (e.g. https://spnr.sh/spec, https://spnr.sh/security).
      Update every cross-doc reference to spnr.dev accordingly.
```

> **Research correction:** Until ownership of `spnr.dev` is confirmed, no doc may state it as "ours." The source specs route the SAP/1 RFC and `/security` to spnr.dev; that routing is **provisional** pending this verification. See `../13-research-findings.md` §J and `../12-risks-open-questions.md`.

### 3. Reserve the package namespaces

- **crates.io `spnr`** → publish a `0.0.1` placeholder crate now (crates.io has no squat protection; first-come wins permanently). Description points to spnr.sh; yank later if needed but the name is then held.
- **npm `@spnr` scope** → claim the scope; publish all packages as `@spnr/*` (never unscoped `spnr`, which is the dormant lib). Verify the scope is claimable and is not auto-confused with `@spnrapp`.

### 4. Choose a GitHub org handle (do not block on acquiring `spnr`)

Pick one alternative org handle and proceed; optionally pursue the dormant user name in parallel as a non-blocking nice-to-have.

| Candidate | Pros | Cons | Recommendation |
|---|---|---|---|
| `spnr-sh` | Mirrors primary domain; obvious | Hyphen | **Preferred** — ties org identity to the canonical host |
| `spnrhq` | Common "company" convention | Slightly generic | Strong alternate |
| `getspnr` | Mirrors `get.spnr.sh` installer | Reads as marketing | Acceptable fallback |
| `spnr` (acquire dormant user) | Exact match | Slow, discretionary, not timeline-safe | Pursue async only |

Decision: default to **`spnr-sh`** unless taken at registration time, then fall back to `spnrhq` → `getspnr`. Whatever is chosen, state it explicitly in `README.md` and pin it in `../09-repo-build-layout.md` (replacing the bare "GitHub org" placeholder in tech-spec §13).

### 5. Keep the anti-phishing posture (unchanged, reinforced)

The canonical-host discipline from `../07-security-privacy.md` survives intact and now binds to the *actually-secured* hosts:

- **Single canonical login/redemption host.** Login and redemption live on exactly one host (`spnr.co` for the dashboard; `spnr.sh` for CLI-initiated flows). Never spread auth across lookalikes.
- **CLI opens exact URLs.** `spnr login` and `spnr redeem` open the precise URL from the binary so users never type a domain that could be mistyped into a squat.
- **Explicit operator statement.** README and every auth email state: *"We operate only on spnr.sh, spnr.dev, and spnr.co."* (Drop spnr.dev from this list if step 2 finds it is not ours.)
- **Server-side URL allow-listing** for the OSC-8 click surface (see `../03-protocol-SAP1.md`, `../05-fraud-attestation.md`).

### 6. Monitor `spnr.com`

```
spnr.com: third-party, parked since 2006, expires 2026-09-17.
  → WATCH the 2026-09-17 expiry (drop-catch opportunity, low probability).
  → MONITOR for a cloned-redemption-page weaponization (the real threat).
  → DO NOT budget for acquisition (not cheaply acquirable).
  → If it ever serves a spnr-lookalike redemption flow → security incident
    (UDRP / abuse report path), per ../07-security-privacy.md.
```

### Registration order (state machine)

```
START
  ├─[parallel, T+0h]─► register spnr.sh   ──► lock+autorenew+DNSSEC ──► HELD
  ├─[parallel, T+0h]─► register spnr.co   ──► lock+autorenew+DNSSEC ──► HELD
  ├─[parallel, T+0h]─► crates.io spnr 0.0.1 publish ─────────────────► HELD
  ├─[parallel, T+0h]─► claim npm @spnr scope ────────────────────────► HELD
  ├─[parallel, T+0h]─► register GitHub org (spnr-sh|spnrhq|getspnr) ──► HELD
  └─[T+0h]─► verify spnr.dev ownership
               ├─ ours      ──► secure + deploy docs ────────────────► HELD
               └─ not ours  ──► REPLAN docs onto spnr.sh + update docs ► MITIGATED
ALL HELD/MITIGATED ──► namespace gate GREEN ──► clear to announce
```

---

## Consequences

### Positive

- **Removes a launch-blocking namespace gap.** The specs treated names/domains as settled; this ADR turns "assumed owned" into "actually held," which is a precondition for the HN/X launch and RFC publication.
- **crates.io `spnr` + `@spnr` scope secured early** before any announcement draws squatters (crates.io especially has no recourse after the fact).
- **Anti-phishing posture is now anchored to real, locked hosts** with DNSSEC + registrar-lock, strengthening the money-handling threat model in `../07-security-privacy.md`.
- **Honest documentation.** No doc repeats a refuted "owned/locked" claim; spnr.dev routing is explicitly provisional until verified.

### Negative / costs

- **Brand-handle compromise on GitHub.** The org is `spnr-sh` (or alternate), not the exact `spnr` — a minor identity blemish. The dormant 2015 user *may* be recoverable later, but we ship without it.
- **Provisional docs host.** If `spnr.dev` turns out not to be ours, every reference to it (RFC at spnr.dev, `spnr.dev/security`) must be rewritten to spnr.sh paths — a documentation-wide find/replace and a change to the "we operate only on …" anti-phishing string.
- **Ongoing monitoring burden.** `spnr.com` (expiry 2026-09-17) and the confusable `@spnrapp` scope require periodic abuse monitoring; this is now a tracked operational item in `../12-risks-open-questions.md`.
- **Renewal/treasury discipline.** Three domains + packages now carry auto-renew obligations; a lapsed `spnr.sh` would be catastrophic (it is the installer and click-redirect host) — registrar-lock + auto-renew + calendar alerts are mandatory, not optional.

### Follow-ups (tracked in `../12-risks-open-questions.md`)

1. Confirm `spnr.dev` ownership (blocking for any spnr.dev reference).
2. Record the final GitHub org handle in `README.md` and `../09-repo-build-layout.md`.
3. Watch `spnr.com` 2026-09-17 expiry; set a drop-catch reminder.
4. Periodic squat/lookalike scan (typosquats: `spnrr`, `spnr.io`, `spnr.app`, Unicode confusables) as part of the security cadence.
