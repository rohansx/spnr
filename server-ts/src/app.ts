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
import { adminAuth } from "./admin-auth.js";

/** Rust backend the admin panel reads /api/stats + /v1/serve from. */
const BACKEND_URL = process.env.SPNR_BACKEND ?? "http://82.112.226.62:8787";

export function createApp(store: Store = new Store()): Express {
  const app = express();
  app.use(express.json({ limit: "16kb" }));
  // Admin mutation forms post application/x-www-form-urlencoded bodies.
  app.use(express.urlencoded({ extended: false, limit: "16kb" }));

  // Liveness probe (hermetic E2E + load balancers) — OPEN.
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // Operator admin panel: campaigns + active serving pool + network stats + sessions,
  // one page. Basic-Auth guarded (fails closed without SPNR_ADMIN_PASSWORD).
  app.get("/", (_req: Request, res: Response) => res.redirect("/admin"));
  app.get("/admin", adminAuth, async (_req: Request, res: Response) => {
    try {
      res.type("html").send(await renderAdmin(store, BACKEND_URL));
    } catch {
      res.status(500).type("html").send("<h1>spnr admin temporarily unavailable</h1>");
    }
  });

  // --- Admin mutation routes (Basic-Auth guarded) -> proxy to the Rust backend's
  //     token-protected /admin/creatives surface, then redirect back to the panel.
  const adminToken = (): string => process.env.SPNR_ADMIN_TOKEN ?? "";

  // Add an advertisement to the serving pool. urlencoded body: text, url, advertiser?.
  app.post("/admin/ads", adminAuth, async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const text = typeof body.text === "string" ? body.text : "";
    const url = typeof body.url === "string" ? body.url : "";
    const advertiser = typeof body.advertiser === "string" ? body.advertiser : "";
    try {
      await fetch(`${BACKEND_URL}/admin/creatives`, {
        method: "POST",
        headers: { "content-type": "application/json", "X-Admin-Token": adminToken() },
        body: JSON.stringify({ text, url, advertiser }),
      });
    } catch {
      // Fail soft: redirect back; the refreshed panel reflects the real backend state.
    }
    res.redirect("/admin");
  });

  // Remove an advertisement from the serving pool by creative id.
  app.post("/admin/ads/:id/delete", adminAuth, async (req: Request, res: Response) => {
    const id = req.params.id ?? "";
    try {
      await fetch(`${BACKEND_URL}/admin/creatives/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { "X-Admin-Token": adminToken() },
      });
    } catch {
      // Fail soft: redirect back; the refreshed panel reflects the real backend state.
    }
    res.redirect("/admin");
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
