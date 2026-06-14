// Screenshot the authed developer dashboard + the advertiser dashboard (campaigns
// tab) in the v5 design, against whatever backend/portal vite is proxying to.
//   node shot-dashboards.cjs <baseUrl> <outDir>
const { chromium } = require('playwright');
const base = (process.argv[2] || 'http://localhost:5181').replace(/\/$/, '');
const out = process.argv[3] || '/tmp/spnr-v5';
const fs = require('fs');

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ headless: true });
  const errs = [];
  try {
    const p = await b.newPage({ viewport: { width: 1280, height: 1500 } });
    p.on('pageerror', (e) => errs.push(String(e)));

    // ---- dev dashboard: sign up a fresh account, seed the token, load /dashboard ----
    await p.goto(base + '/login', { waitUntil: 'domcontentloaded', timeout: 20000 });
    const email = `shot+${Date.now()}@spnr.test`;
    const token = await p.evaluate(async (em) => {
      const r = await fetch('/v1/signup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: em, password: 'shot-password-123' }),
      });
      return r.ok ? (await r.json()).token : null;
    }, email);
    if (token) await p.evaluate((t) => localStorage.setItem('spnr_token', t), token);
    await p.goto(base + '/dashboard', { waitUntil: 'networkidle', timeout: 20000 });
    await p.waitForSelector('[data-testid="account-email"]', { timeout: 10000 }).catch(() => {});
    await p.waitForTimeout(900);
    await p.screenshot({ path: `${out}/dashboard.png`, fullPage: true });

    // ---- advertiser dashboard: open the Campaigns tab ----
    await p.goto(base + '/advertiser', { waitUntil: 'networkidle', timeout: 20000 });
    const tab = p.locator('[data-testid="tab-campaigns"]');
    if (await tab.count()) await tab.first().click();
    await p.waitForSelector('[data-testid="campaign-row"]', { timeout: 9000 }).catch(() => {});
    await p.waitForTimeout(700);
    await p.screenshot({ path: `${out}/advertiser.png`, fullPage: true });

    console.log('dashboards shot ok · pageerrors:', errs.length ? errs.slice(0, 3).join(' | ') : 'none');
  } catch (e) {
    console.log('FAIL', e.message);
    process.exitCode = 1;
  } finally {
    await b.close();
  }
})();
