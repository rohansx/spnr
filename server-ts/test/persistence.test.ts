import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";
import { ARROW } from "../src/lint.js";

// Each test gets a UNIQUE temp path so it exercises the real on-disk persistence
// path (not the in-memory sentinel) without colliding with the default store file.
function uniqueDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spnr-portal-"));
  return path.join(dir, "portal-store.json");
}

describe("Store durable persistence (SPNR_PORTAL_DB)", () => {
  const created: string[] = [];

  function newDb(): string {
    const p = uniqueDbPath();
    created.push(p);
    return p;
  }

  afterEach(() => {
    for (const p of created.splice(0)) {
      fs.rmSync(path.dirname(p), { recursive: true, force: true });
    }
  });

  it("restores campaigns AND the next-id counter after reopening the same path", () => {
    const dbPath = newDb();

    // First store: create a campaign + attach a creative. This writes to disk.
    const first = new Store(dbPath);
    const created1 = first.createCampaign({ advertiser: "acct:a", name: "Persisted", pricePerBlockUsd: 4 });
    expect(created1.ok).toBe(true);
    if (!created1.ok) return;
    const setC = first.setCreative(created1.value.id, `CloakPipe — keep it ${ARROW}`, "https://x.test");
    expect(setC.ok).toBe(true);

    // The file actually exists on disk.
    expect(fs.existsSync(dbPath)).toBe(true);

    // A brand-new store at the SAME path restores prior state.
    const reopened = new Store(dbPath);
    const list = reopened.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(created1.value.id);
    expect(list[0]?.name).toBe("Persisted");
    expect(list[0]?.pricePerBlockUsd).toBe(4);
    expect(list[0]?.creative?.text).toContain(ARROW);
    expect(reopened.get(created1.value.id)?.advertiser).toBe("acct:a");

    // The next-id counter survived: the next campaign id continues the sequence
    // (cmp_2 after cmp_1) instead of colliding with the restored cmp_1.
    const created2 = reopened.createCampaign({ advertiser: "acct:b", name: "Next", pricePerBlockUsd: 5 });
    expect(created2.ok).toBe(true);
    if (!created2.ok) return;
    expect(created2.value.id).toBe("cmp_2");
    expect(created2.value.id).not.toBe(created1.value.id);
    expect(reopened.list()).toHaveLength(2);
  });

  it("starts empty on a fresh path and never throws on a missing/corrupt file", () => {
    // Fresh, never-written path => empty, no throw.
    const freshPath = newDb();
    const fresh = new Store(freshPath);
    expect(fresh.list()).toHaveLength(0);
    expect(fresh.auctionWinner()).toBeUndefined();

    // Corrupt JSON => start empty, never throw.
    const corruptPath = newDb();
    fs.writeFileSync(corruptPath, "{ this is : not valid json ]]", "utf8");
    let corrupt: Store | undefined;
    expect(() => {
      corrupt = new Store(corruptPath);
    }).not.toThrow();
    expect(corrupt?.list()).toHaveLength(0);
  });
});
