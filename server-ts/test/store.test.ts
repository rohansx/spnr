import { describe, it, expect } from "vitest";
import { Store, MIN_PRICE_PER_BLOCK_USD } from "../src/store.js";
import { ARROW } from "../src/lint.js";

describe("Store.createCampaign", () => {
  it("creates a campaign at the $1/block floor", () => {
    const store = new Store();
    const r = store.createCampaign({ advertiser: "acct:a", name: "C1", pricePerBlockUsd: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.pricePerBlockUsd).toBe(MIN_PRICE_PER_BLOCK_USD);
      expect(store.list()).toHaveLength(1);
    }
  });

  it("rejects price < 1 (min $1/block)", () => {
    const store = new Store();
    const r = store.createCampaign({ advertiser: "acct:a", name: "Cheap", pricePerBlockUsd: 0.5 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("validation");
    }
    expect(store.list()).toHaveLength(0);
  });

  it("rejects missing advertiser/name", () => {
    const store = new Store();
    expect(store.createCampaign({ advertiser: "", name: "X", pricePerBlockUsd: 2 }).ok).toBe(false);
    expect(store.createCampaign({ advertiser: "acct:a", name: "", pricePerBlockUsd: 2 }).ok).toBe(false);
  });
});

describe("Store.auctionWinner", () => {
  it("returns the highest-priced campaign", () => {
    const store = new Store();
    store.createCampaign({ advertiser: "acct:a", name: "low", pricePerBlockUsd: 2 });
    const high = store.createCampaign({ advertiser: "acct:b", name: "high", pricePerBlockUsd: 9 });
    store.createCampaign({ advertiser: "acct:c", name: "mid", pricePerBlockUsd: 5 });

    const winner = store.auctionWinner();
    expect(winner).toBeDefined();
    expect(winner?.name).toBe("high");
    if (high.ok) expect(winner?.id).toBe(high.value.id);
  });

  it("breaks ties FIFO (earliest entry wins at equal price)", () => {
    const store = new Store();
    const first = store.createCampaign({ advertiser: "acct:a", name: "first", pricePerBlockUsd: 7 });
    store.createCampaign({ advertiser: "acct:b", name: "second", pricePerBlockUsd: 7 });

    const winner = store.auctionWinner();
    expect(winner?.name).toBe("first");
    if (first.ok) expect(winner?.id).toBe(first.value.id);
  });

  it("returns undefined with no campaigns", () => {
    expect(new Store().auctionWinner()).toBeUndefined();
  });
});

describe("Store.setCreative", () => {
  it("attaches a valid creative", () => {
    const store = new Store();
    const c = store.createCampaign({ advertiser: "acct:a", name: "C", pricePerBlockUsd: 3 });
    expect(c.ok).toBe(true);
    if (!c.ok) return;

    const r = store.setCreative(c.value.id, `CloakPipe — privacy-safe LLM apps ${ARROW}`, "https://x.test");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.creative?.text).toContain(ARROW);
  });

  it("rejects a lint-failing creative", () => {
    const store = new Store();
    const c = store.createCampaign({ advertiser: "acct:a", name: "C", pricePerBlockUsd: 3 });
    if (!c.ok) throw new Error("setup failed");

    const r = store.setCreative(c.value.id, "No arrow here", "https://x.test");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("lint_failed");
  });

  it("404s for an unknown campaign", () => {
    const store = new Store();
    const r = store.setCreative("nope", `ok ${ARROW}`, "https://x.test");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("not_found");
  });
});
