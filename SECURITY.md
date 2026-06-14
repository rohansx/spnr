# Security Policy

## Status: v0.1 research prototype

spnr is an early-stage research prototype. **There is no real money settlement.**
The `redeem` flow only writes a balanced double-entry ledger entry in USD-micros;
it issues **no payout** (x402/USDC settlement is stubbed and not implemented).
`spnr login` is also a stub. The backend runs locally on `:8787` — there is no
hosted production deployment. Do not treat spnr as production-ready, and do not
rely on it to move funds.

## Privacy & Safety Invariants

spnr runs on a developer's hot path (the agent CLI's spinner), so its safety
properties are load-bearing and tested:

- **Content firewall.** The hot-path binaries (`spnr-hook`, `spnr-status`) read
  **only** the `hook_event_name` and `session_id` fields from stdin. They never
  read your prompt, working directory, transcript, files, or environment.
- **Raw session ids never leave the machine.** Only a salted BLAKE3 fingerprint
  of the session id is ever sent off-device. Run `spnr audit` to print the exact
  outbound queue before it is flushed.
- **Editor-safe atomic merge.** `~/.claude/settings.json` is only ever replaced
  via an atomic temp + fsync + rename. All of your existing keys round-trip
  unchanged.
- **Append-only, reversible install.** `spnr install` snapshots your settings
  and **appends** hooks without clobbering existing ones. `spnr uninstall`
  restores the pristine snapshot; `spnr pause` disables spnr without uninstalling.
- **Never degrade the host.** The hot-path binaries always exit 0. A failure is
  a no-op, never a crash that breaks your coding session.

Signed telemetry (impressions) uses the SAP/1 protocol: Ed25519-signed,
BLAKE3 hash-chained events with ULIDs and a monotonic counter, deduplicated and
signature-verified server-side on ingest.

## Reporting a Vulnerability

Please report security issues **privately** — do not open a public GitHub issue.

- Preferred: open a [GitHub Security Advisory](https://github.com/rohansx/spnr/security/advisories/new)
  on the repository (private disclosure).
- Or email the maintainer: **security@spnr.dev** *(placeholder — update before
  any public reliance)*.

Please include reproduction steps, affected components, and impact. Because this
is a prototype maintained on a best-effort basis, we cannot commit to a fixed
response SLA, but we will acknowledge and triage credible reports as quickly as
we can. Coordinated disclosure is appreciated — give us a chance to fix before
going public.
