// spnr v0.2 demand-side HTTP API (advertiser portal + auction), typed Express.
//
// SCOPE (ADR-0007): this TypeScript service owns the DEMAND side —
//   - campaign creation / listing
//   - creative submission + content lint (SAP/1 §2.1)
//   - the open single-slot ascending auction (serving decision input)
//
// IT DOES NOT, AND MUST NOT, do event INGEST or signature/chain/dedup verification.
// All economic truth (signed, chained, idempotent impression events; attestation
// tallies that drive /api/stats `attestation_pct`/`accepted`/`rejected`; the
// double-entry ledger; settlement) is established server-side by the RUST spnr-server.
// This service would CALL that backend (e.g. to push a winning creative for signing,
// or to read attestation coverage) — it never re-implements verification here.

import express, { type Express, type Request, type Response } from "express";
import { Store } from "./store.js";
import { renderAdmin } from "./admin.js";

/** Rust backend the admin panel reads /api/stats + /v1/serve from. */
const BACKEND_URL = process.env.SPNR_BACKEND ?? "http://82.112.226.62:8787";

export function createApp(store: Store = new Store()): Express {
  const app = express();
  app.use(express.json({ limit: "16kb" }));

  // Liveness probe (hermetic E2E + load balancers).
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // Operator admin panel: campaigns + active serving pool + network stats, one page.
  app.get("/", (_req: Request, res: Response) => res.redirect("/admin"));
  app.get("/admin", async (_req: Request, res: Response) => {
    try {
      res.type("html").send(await renderAdmin(store, BACKEND_URL));
    } catch {
      res.status(500).type("html").send("<h1>spnr admin temporarily unavailable</h1>");
    }
  });

  // Create a campaign. Body: { advertiser, name, price_per_block_usd >= 1 }.
  app.post("/v2/campaigns", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = store.createCampaign({
      advertiser: body.advertiser as string,
      name: body.name as string,
      pricePerBlockUsd: body.price_per_block_usd as number,
    });

    if (!result.ok) {
      res.status(400).json({ error: result.error.message });
      return;
    }
    res.status(201).json(toWire(result.value));
  });

  // List all campaigns (insertion order).
  app.get("/v2/campaigns", (_req: Request, res: Response) => {
    res.json({ campaigns: store.list().map(toWire) });
  });

  // Submit/replace a creative. Body: { text, url }. Linted before acceptance.
  app.post("/v2/campaigns/:id/creative", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const id = req.params.id ?? "";
    const result = store.setCreative(id, body.text, body.url);

    if (!result.ok) {
      const { error } = result;
      if (error.code === "not_found") {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error.code === "lint_failed") {
        res.status(422).json({ error: error.message, violations: error.violations });
        return;
      }
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(200).json(toWire(result.value));
  });

  // Current single-slot auction winner (highest price_per_block, FIFO within price).
  app.get("/v2/auction", (_req: Request, res: Response) => {
    const winner = store.auctionWinner();
    res.json({ winner: winner ? toWire(winner) : null });
  });

  return app;
}

// Wire shape: snake_case price field, mirrors the inbound contract.
function toWire(c: ReturnType<Store["list"]>[number]) {
  return {
    id: c.id,
    advertiser: c.advertiser,
    name: c.name,
    price_per_block_usd: c.pricePerBlockUsd,
    creative: c.creative,
    created_at: c.createdAt,
  };
}
