import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { Store } from "../src/store.js";
import { ARROW } from "../src/lint.js";

let app: Express;

beforeEach(() => {
  app = createApp(new Store());
});

describe("GET /health", () => {
  it("returns { ok: true }", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe("POST /v2/campaigns", () => {
  it("creates a campaign at >= $1/block", async () => {
    const res = await request(app)
      .post("/v2/campaigns")
      .send({ advertiser: "acct:a", name: "C1", price_per_block_usd: 2 });
    expect(res.status).toBe(201);
    expect(res.body.price_per_block_usd).toBe(2);
    expect(res.body.id).toMatch(/^cmp_/);
  });

  it("rejects price < 1 with 400", async () => {
    const res = await request(app)
      .post("/v2/campaigns")
      .send({ advertiser: "acct:a", name: "Cheap", price_per_block_usd: 0.5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/min \$1\/block|>= 1/);
  });
});

describe("GET /v2/campaigns", () => {
  it("lists created campaigns", async () => {
    await request(app).post("/v2/campaigns").send({ advertiser: "acct:a", name: "A", price_per_block_usd: 1 });
    await request(app).post("/v2/campaigns").send({ advertiser: "acct:b", name: "B", price_per_block_usd: 3 });
    const res = await request(app).get("/v2/campaigns");
    expect(res.status).toBe(200);
    expect(res.body.campaigns).toHaveLength(2);
  });
});

describe("POST /v2/campaigns/:id/creative", () => {
  async function makeCampaign(): Promise<string> {
    const res = await request(app)
      .post("/v2/campaigns")
      .send({ advertiser: "acct:a", name: "C", price_per_block_usd: 4 });
    return res.body.id as string;
  }

  it("accepts a valid creative", async () => {
    const id = await makeCampaign();
    const res = await request(app)
      .post(`/v2/campaigns/${id}/creative`)
      .send({ text: `CloakPipe — privacy-safe LLM apps ${ARROW}`, url: "https://x.test" });
    expect(res.status).toBe(200);
    expect(res.body.creative.text).toContain(ARROW);
  });

  it("rejects a lint-failing creative with 422 + violations", async () => {
    const id = await makeCampaign();
    const res = await request(app)
      .post(`/v2/campaigns/${id}/creative`)
      .send({ text: "no arrow", url: "https://x.test" });
    expect(res.status).toBe(422);
    expect(res.body.violations).toContain("missing_trailing_arrow");
  });

  it("404s for an unknown campaign", async () => {
    const res = await request(app)
      .post("/v2/campaigns/nope/creative")
      .send({ text: `ok ${ARROW}`, url: "https://x.test" });
    expect(res.status).toBe(404);
  });
});

describe("GET /v2/auction", () => {
  it("returns null with no campaigns", async () => {
    const res = await request(app).get("/v2/auction");
    expect(res.status).toBe(200);
    expect(res.body.winner).toBeNull();
  });

  it("returns the highest-priced campaign as the single-slot winner", async () => {
    await request(app).post("/v2/campaigns").send({ advertiser: "acct:a", name: "low", price_per_block_usd: 2 });
    await request(app).post("/v2/campaigns").send({ advertiser: "acct:b", name: "high", price_per_block_usd: 9 });
    await request(app).post("/v2/campaigns").send({ advertiser: "acct:c", name: "mid", price_per_block_usd: 5 });
    const res = await request(app).get("/v2/auction");
    expect(res.status).toBe(200);
    expect(res.body.winner.name).toBe("high");
    expect(res.body.winner.price_per_block_usd).toBe(9);
  });
});
