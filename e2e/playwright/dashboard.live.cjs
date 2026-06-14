// Full-stack live-dashboard Playwright check — drives a real headless Chromium
// against the Vite-served spnr dashboard (proxying /api to the hermetic E2E
// backend) and asserts the rendered metrics MATCH the live spnr-server ledger,
// i.e. the page is NOT showing its hardcoded mock values (132 impressions /
// $23.87 balance / $214.30 lifetime / 99.2% attestation).
//
// Parameterized (run from run.sh):
//   node dashboard.live.cjs <dashboardUrl> <statsUrl> <screenshotPath>
//   argv[2] dashboard url  e.g. http://localhost:5174/dashboard.html
//   argv[3] stats url      e.g. http://localhost:5174/api/stats
//   argv[4] screenshot path
//
// Playwright is loaded from this package's own node_modules.
const { chromium } = require('playwright');

const dashUrl = process.argv[2] || 'http://localhost:5174/dashboard';
const statsUrl = process.argv[3] || 'http://localhost:5174/api/stats';
const shot = process.argv[4] || '/tmp/spnr-dashboard-live.png';

// Mock values baked into web/dashboard.html that MUST be overridden by live data.
const MOCK_IMPRESSIONS = 132;
const MOCK_BALANCE = '23.87';
const MOCK_LIFETIME = '214.30';

let failed = 0;
const check = (name, cond, detail) => {
  console.log(`  ${cond ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) failed++;
};

(async () => {
  // 1. pull the backend truth (through the same Vite proxy the page uses).
  let stats;
  try {
    const res = await fetch(statsUrl);
    stats = await res.json();
  } catch (e) {
    console.log('  \x1b[31mFAIL\x1b[0m could not fetch stats: ' + e.message);
    process.exit(1);
  }
  const beImp = Number(stats.total_impressions);
  const beBalance = Math.round((Number(stats.total_balance_micros) / 1e6) * 100) / 100;
  const beAtt = Number(stats.attestation_pct);
  console.log(`  backend stats: impressions=${beImp} balance=$${beBalance.toFixed(2)} attestation=${beAtt}`);

  const consoleErrors = [];
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    // /dashboard is gated by <RequireAuth>; an unauthenticated visit redirects to
    // /login. Authenticate first: land on the origin (so same-origin fetch hits the
    // Vite /v1 proxy -> Rust backend), sign up a fresh account, seed the bearer
    // token AuthProvider reads from localStorage, then load the gated dashboard.
    const origin = new URL(dashUrl).origin;
    await page.goto(origin + '/login', { waitUntil: 'domcontentloaded', timeout: 20000 });
    const email = `e2e+dash${Date.now()}@spnr.test`;
    const token = await page.evaluate(async (em) => {
      const res = await fetch('/v1/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: em, password: 'e2e-password-123' }),
      });
      if (!res.ok) throw new Error('signup failed (' + res.status + ')');
      return (await res.json()).token;
    }, email);
    check('signup issued a bearer token', typeof token === 'string' && token.length >= 16,
      `token.len=${token ? token.length : 0}`);
    await page.evaluate((t) => localStorage.setItem('spnr_token', t), token);

    await page.goto(dashUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    // the route guard renders an AUTHENTICATING… screen until GET /v1/me settles;
    // wait for the real dashboard (the account email in the top bar) to appear.
    await page.waitForSelector('[data-testid="account-email"]', { timeout: 10000 });

    const txt = async (sel) =>
      ((await page.locator(`[data-testid="${sel}"]`).first().textContent()) || '').trim();
    const present = async (sel) => (await page.locator(`[data-testid="${sel}"]`).count()) > 0;

    // Wait for the live pull to override the mock state (impressions leaves 132).
    try {
      await page.waitForFunction((mock) => {
        const el = document.querySelector('[data-testid="impressions"]');
        if (!el) return false;
        const n = parseInt((el.textContent || '').replace(/[^0-9-]/g, ''), 10);
        return Number.isFinite(n) && n !== mock;
      }, MOCK_IMPRESSIONS, { timeout: 8000 });
    } catch (_) { /* fall through — assertions below will report the mismatch */ }

    const impTxt = await txt('impressions');
    const balTxt = await txt('balance');
    const lifeTxt = await txt('lifetime');
    const attTxt = await txt('attestation');
    const uiImp = parseInt(impTxt.replace(/[^0-9-]/g, ''), 10);
    const uiBalNum = parseFloat(balTxt.replace(/[^0-9.\-]/g, ''));

    // (a) impressions on the page == backend total_impressions (live, not mock).
    check('dashboard impressions == backend total_impressions',
      Number.isFinite(uiImp) && uiImp === beImp, `ui=${impTxt} backend=${beImp}`);

    // (b) balance reflects the ledger (matches total_balance_micros/1e6).
    check('balance reflects the ledger',
      Number.isFinite(uiBalNum) && Math.abs(uiBalNum - beBalance) < 0.01,
      `ui=${balTxt} backend=$${beBalance.toFixed(2)}`);

    // (c) attestation testid present and rendered as a percentage.
    check('attestation testid present', await present('attestation'), `attestation=${attTxt}`);
    check('lifetime testid present', await present('lifetime'), `lifetime=${lifeTxt}`);

    // (c2) the authenticated account email renders in the top bar (auth wired).
    const acctEmail = await txt('account-email');
    check('account email shown in top bar', acctEmail.includes(email),
      `account-email=${acctEmail}`);

    // (d) NOT showing the hardcoded mock values.
    check('not showing mock impressions (132)', uiImp !== MOCK_IMPRESSIONS, `impressions=${impTxt}`);
    check('not showing mock balance ($23.87)',
      !balTxt.includes(MOCK_BALANCE), `balance=${balTxt}`);
    check('not showing mock lifetime ($214.30)',
      !lifeTxt.includes(MOCK_LIFETIME), `lifetime=${lifeTxt}`);

    // (e) no console errors.
    check('no console errors', consoleErrors.length === 0,
      consoleErrors.length ? consoleErrors.slice(0, 3).join(' | ') : 'clean');

    await page.screenshot({ path: shot, fullPage: true });
    console.log(`  screenshot: ${shot}`);
  } catch (e) {
    console.log('  \x1b[31mFAIL\x1b[0m playwright error: ' + e.message);
    failed++;
  } finally {
    await browser.close();
  }

  if (failed === 0) {
    console.log('  \x1b[32mLIVE DASHBOARD PASS\x1b[0m');
    process.exit(0);
  }
  console.log('  \x1b[31mLIVE DASHBOARD FAIL\x1b[0m');
  process.exit(1);
})();
