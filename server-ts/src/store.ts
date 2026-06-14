// Demand-side store: campaigns, creatives, and the open ascending auction —
// now with durable JSON persistence so a restart keeps prior campaigns/creatives.
//
// This is the TypeScript demand side (advertiser portal + auction) per ADR-0007.
// It deliberately holds NO event ingest, NO signature/chain verification, NO ledger.
// Economic truth (signed/chained/idempotent events, attestation, settlement) lives in
// the Rust spnr-server. This service would CALL that backend; it never re-implements it.
//
// Immutability: every mutating method returns a NEW record/array; we never mutate a
// stored object in place. The store swaps its internal references atomically.
//
// PERSISTENCE CONTRACT (mirrors the Rust SPNR_DB contract, JSON edition):
//   - Path comes from env SPNR_PORTAL_DB; default "portal-store.json" (cwd-relative).
//   - A fresh/missing/unparseable path => start EMPTY, never throw.
//   - Re-opening an existing path RESTORES campaigns + the next-id counter.
//   - Every mutation rewrites the full state atomically (tmp file in the same dir,
//     then fs.renameSync over the target) — no native modules, no experimental flags.

import fs from "node:fs";
import path from "node:path";
import { lintCreative, type LintResult } from "./lint.js";

/** Minimum price per impression block, in USD. Floor is $1/block. */
export const MIN_PRICE_PER_BLOCK_USD = 1;

/** Env var naming the JSON store file. Default is cwd-relative "portal-store.json". */
export const PORTAL_DB_ENV = "SPNR_PORTAL_DB";
export const DEFAULT_PORTAL_DB = "portal-store.json";

/**
 * Sentinel path => pure in-memory store (no disk I/O at all). Mirrors the Rust
 * contract where unit tests build AppState with `db: None` and stay in-memory.
 * A bare `new Store()` under the vitest runner resolves to this so unit tests
 * never share/clobber a real on-disk default file.
 */
export const IN_MEMORY_DB = ":memory:";

export interface Creative {
  readonly text: string;
  readonly url: string;
}

export interface Campaign {
  readonly id: string;
  readonly advertiser: string;
  readonly name: string;
  readonly pricePerBlockUsd: number;
  /** Monotonic sequence used for FIFO tie-breaking within an equal price. */
  readonly seq: number;
  readonly createdAt: number;
  readonly creative: Creative | null;
}

export interface CreateCampaignInput {
  readonly advertiser: string;
  readonly name: string;
  readonly pricePerBlockUsd: number;
}

export type StoreError =
  | { readonly code: "validation"; readonly message: string }
  | { readonly code: "not_found"; readonly message: string }
  | { readonly code: "lint_failed"; readonly message: string; readonly violations: readonly string[] };

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: StoreError };

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}
function err(error: StoreError): Result<never> {
  return { ok: false, error };
}

/** On-disk shape. Versioned so future migrations stay explicit. */
interface PersistedState {
  readonly version: 1;
  readonly campaigns: ReadonlyArray<Campaign>;
  readonly seq: number;
  readonly idCounter: number;
}

/**
 * Resolve the configured store path. An explicit SPNR_PORTAL_DB env value always
 * wins (incl. the ":memory:" sentinel). When the env is unset:
 *   - under the vitest runner (process.env.VITEST) we default to in-memory so a
 *     bare `new Store()` in a unit test stays pure (the Rust `db: None` analog);
 *   - otherwise (production) we default to the cwd-relative "portal-store.json".
 */
function resolveDbPath(): string {
  const fromEnv = process.env[PORTAL_DB_ENV];
  if (fromEnv && fromEnv.trim()) return fromEnv;
  if (process.env.VITEST) return IN_MEMORY_DB;
  return DEFAULT_PORTAL_DB;
}

/** Narrow an unknown JSON value into a Creative, or null. Never throws. */
function parseCreative(raw: unknown): Creative | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.text !== "string" || typeof r.url !== "string") return null;
  return Object.freeze({ text: r.text, url: r.url });
}

/** Narrow an unknown JSON value into a Campaign, or null if it is malformed. */
function parseCampaign(raw: unknown): Campaign | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string") return null;
  if (typeof r.advertiser !== "string") return null;
  if (typeof r.name !== "string") return null;
  if (typeof r.pricePerBlockUsd !== "number" || !Number.isFinite(r.pricePerBlockUsd)) return null;
  if (typeof r.seq !== "number" || !Number.isFinite(r.seq)) return null;
  if (typeof r.createdAt !== "number" || !Number.isFinite(r.createdAt)) return null;
  return Object.freeze({
    id: r.id,
    advertiser: r.advertiser,
    name: r.name,
    pricePerBlockUsd: r.pricePerBlockUsd,
    seq: r.seq,
    createdAt: r.createdAt,
    creative: parseCreative(r.creative),
  });
}

export class Store {
  private campaigns: ReadonlyArray<Campaign> = [];
  private seq = 0;
  private idCounter = 0;
  private readonly dbPath: string;

  /**
   * Construct a store. Loads any prior state from the configured JSON path.
   * `dbPath` defaults to env SPNR_PORTAL_DB, else cwd-relative "portal-store.json".
   * Existing callers using `new Store()` keep working unchanged.
   */
  constructor(dbPath: string = resolveDbPath()) {
    this.dbPath = dbPath;
    this.load();
  }

  /**
   * Load state from disk. A missing or unparseable file leaves the store empty —
   * this NEVER throws, mirroring the "start empty on fresh/corrupt path" contract.
   */
  private load(): void {
    if (this.dbPath === IN_MEMORY_DB) return; // pure in-memory: nothing to restore.

    let text: string;
    try {
      text = fs.readFileSync(this.dbPath, "utf8");
    } catch {
      // Missing file (ENOENT) or any read error => start empty.
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      // Corrupt JSON => start empty.
      return;
    }

    if (!raw || typeof raw !== "object") return;
    const state = raw as Record<string, unknown>;

    const campaignsRaw = Array.isArray(state.campaigns) ? state.campaigns : [];
    const campaigns = campaignsRaw
      .map(parseCampaign)
      .filter((c): c is Campaign => c !== null);

    // Restore counters. Prefer the persisted values; fall back to deriving safe
    // monotonic counters from the campaigns themselves so ids/seqs never collide.
    const persistedSeq = typeof state.seq === "number" && Number.isFinite(state.seq) ? state.seq : undefined;
    const persistedIdCounter =
      typeof state.idCounter === "number" && Number.isFinite(state.idCounter) ? state.idCounter : undefined;

    const maxSeq = campaigns.reduce((m, c) => (c.seq >= m ? c.seq + 1 : m), 0);
    const maxId = campaigns.reduce((m, c) => {
      const n = Number.parseInt(c.id.replace(/^cmp_/, ""), 10);
      return Number.isFinite(n) && n >= m ? n : m;
    }, 0);

    this.campaigns = Object.freeze(campaigns);
    this.seq = persistedSeq !== undefined ? persistedSeq : maxSeq;
    this.idCounter = persistedIdCounter !== undefined ? persistedIdCounter : maxId;
  }

  /**
   * Atomically persist the full current state. Writes to a tmp file in the SAME
   * directory as the target (so rename is a same-filesystem atomic op), then
   * fs.renameSync over the target. Best-effort: persistence failures never break
   * the in-memory API (the mutation already succeeded in memory).
   */
  private persist(): void {
    if (this.dbPath === IN_MEMORY_DB) return; // pure in-memory: nothing to write.

    const state: PersistedState = {
      version: 1,
      campaigns: this.campaigns,
      seq: this.seq,
      idCounter: this.idCounter,
    };
    const json = JSON.stringify(state, null, 2);

    const dir = path.dirname(this.dbPath);
    const base = path.basename(this.dbPath);
    const tmp = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);

    try {
      fs.writeFileSync(tmp, json, "utf8");
      fs.renameSync(tmp, this.dbPath);
    } catch {
      // Best-effort cleanup of the tmp file; swallow persistence errors so the
      // in-memory mutation (already applied) stays the source of truth.
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        // ignore
      }
    }
  }

  /** Snapshot of all campaigns, insertion order. */
  list(): ReadonlyArray<Campaign> {
    return this.campaigns;
  }

  get(id: string): Campaign | undefined {
    return this.campaigns.find((c) => c.id === id);
  }

  /**
   * Create a campaign. Validates advertiser/name presence and the $1/block floor.
   * Returns a NEW Campaign; appends a new array to internal state (no mutation).
   * Persists the full state (incl. the next-id counter) atomically on success.
   */
  createCampaign(input: CreateCampaignInput): Result<Campaign> {
    const advertiser = typeof input.advertiser === "string" ? input.advertiser.trim() : "";
    const name = typeof input.name === "string" ? input.name.trim() : "";
    const price = input.pricePerBlockUsd;

    if (!advertiser) {
      return err({ code: "validation", message: "advertiser is required" });
    }
    if (!name) {
      return err({ code: "validation", message: "name is required" });
    }
    if (typeof price !== "number" || !Number.isFinite(price)) {
      return err({ code: "validation", message: "price_per_block_usd must be a number" });
    }
    if (price < MIN_PRICE_PER_BLOCK_USD) {
      return err({
        code: "validation",
        message: `price_per_block_usd must be >= ${MIN_PRICE_PER_BLOCK_USD} (min $1/block)`,
      });
    }

    const campaign: Campaign = Object.freeze({
      id: `cmp_${++this.idCounter}`,
      advertiser,
      name,
      pricePerBlockUsd: price,
      seq: this.seq++,
      createdAt: Date.now(),
      creative: null,
    });

    this.campaigns = Object.freeze([...this.campaigns, campaign]);
    this.persist();
    return ok(campaign);
  }

  /**
   * Attach (or replace) a campaign's creative after linting it against the SAP/1
   * content rules. Rejects on any lint violation. Returns the NEW campaign.
   * Persists the full state atomically on success.
   */
  setCreative(id: string, text: unknown, url: unknown): Result<Campaign> {
    const existing = this.get(id);
    if (!existing) {
      return err({ code: "not_found", message: `campaign ${id} not found` });
    }

    const lint: LintResult = lintCreative(text);
    if (!lint.ok) {
      return err({
        code: "lint_failed",
        message: "creative failed content lint",
        violations: lint.violations,
      });
    }

    const urlStr = typeof url === "string" ? url.trim() : "";
    if (!urlStr) {
      return err({ code: "validation", message: "url is required" });
    }

    const updated: Campaign = Object.freeze({
      ...existing,
      creative: Object.freeze({ text: text as string, url: urlStr }),
    });

    this.campaigns = Object.freeze(this.campaigns.map((c) => (c.id === id ? updated : c)));
    this.persist();
    return ok(updated);
  }

  /**
   * Single-slot open ascending auction. The winner is the campaign with the highest
   * price_per_block; ties break FIFO (earliest seq wins). Returns undefined when no
   * campaign is eligible. A campaign needs no creative to "win" the slot price race —
   * but in practice serving is gated on an approved creative downstream (Rust side).
   */
  auctionWinner(): Campaign | undefined {
    if (this.campaigns.length === 0) {
      return undefined;
    }
    return this.campaigns.reduce((best, c) => {
      if (c.pricePerBlockUsd > best.pricePerBlockUsd) return c;
      if (c.pricePerBlockUsd === best.pricePerBlockUsd && c.seq < best.seq) return c;
      return best;
    });
  }
}
