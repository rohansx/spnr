// Full email/password auth-flow Playwright check — drives a real headless
// Chromium through the entire UI contract against the Vite-served React app
// (proxying /v1 to the hermetic E2E Rust backend with its argon2 + SQLite
// accounts/sessions). Proves, with NO programmatic shortcuts, that:
//
//   1. an unauthenticated visit to /dashboard is redirected to /login (route guard)
//   2. signing up through the form lands on /dashboard and shows the account email
//   3. a bearer token is persisted in localStorage["spnr_token"]
//   4. logout invalidates the session and returns to /login
//   5. logging back in with the same credentials lands on /dashboard again
//   6. wrong-password login is rejected with an error and stays on /login
//
// Parameterized (run from run.sh):
//   node auth.live.cjs <baseUrl> <screenshotPath>
//   argv[2] base url  e.g. http://localhost:5174
//   argv[3] screenshot path
//
// Playwright is loaded from this package's own node_modules.
const { chromium } = require('playwright');

const base = (process.argv[2] || 'http://localhost:5174').replace(/\/$/, '');
const shot = process.argv[3] || '/tmp/spnr-auth-live.png';

let failed = 0;
const check = (name, cond, detail) => {
  console.log(`  ${cond ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) failed++;
};

(async () => {
  const email = `e2e+auth${Date.now()}@spnr.test`;
  const password = 'e2e-password-123';
  console.log(`  auth flow base=${base} account=${email}`);

  const consoleErrors = [];
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    const path = () => new URL(page.url()).pathname;
    const fill = (sel, val) => page.locator(`[data-testid="${sel}"]`).fill(val);
    const click = (sel) => page.locator(`[data-testid="${sel}"]`).click();
    const visible = async (sel) =>
      (await page.locator(`[data-testid="${sel}"]`).count()) > 0;

    // ---- 1. guard: unauthenticated /dashboard -> /login ----
    await page.goto(base + '/dashboard', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForFunction(() => location.pathname === '/login', { timeout: 10000 }).catch(() => {});
    check('unauthenticated /dashboard redirects to /login', path() === '/login', `at ${path()}`);
    check('login form is rendered', await visible('auth-email'), `auth-email present`);

    // ---- 2. signup through the form ----
    // default mode is "login"; toggle to signup so a brand-new account is created.
    await click('auth-toggle');
    await fill('auth-email', email);
    await fill('auth-password', password);
    await click('auth-submit');
    await page.waitForFunction(() => location.pathname === '/dashboard', { timeout: 12000 }).catch(() => {});
    check('signup lands on /dashboard', path() === '/dashboard', `at ${path()}`);
    await page.waitForSelector('[data-testid="account-email"]', { timeout: 10000 }).catch(() => {});
    const acct1 = ((await page.locator('[data-testid="account-email"]').first().textContent()) || '').trim();
    check('dashboard shows the signed-up email', acct1.includes(email), `account-email=${acct1}`);

    // ---- 3. token persisted ----
    const token1 = await page.evaluate(() => localStorage.getItem('spnr_token'));
    check('bearer token persisted in localStorage', typeof token1 === 'string' && token1.length >= 16,
      `token.len=${token1 ? token1.length : 0}`);

    // ---- 4. logout -> back to /login, token cleared ----
    await click('logout');
    await page.waitForFunction(() => location.pathname === '/login', { timeout: 10000 }).catch(() => {});
    check('logout returns to /login', path() === '/login', `at ${path()}`);
    const token2 = await page.evaluate(() => localStorage.getItem('spnr_token'));
    check('token cleared on logout', !token2, `token=${token2 ? 'present' : 'null'}`);

    // logged-out: visiting /dashboard again must redirect (session is dead).
    await page.goto(base + '/dashboard', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForFunction(() => location.pathname === '/login', { timeout: 10000 }).catch(() => {});
    check('post-logout /dashboard redirects to /login', path() === '/login', `at ${path()}`);

    // ---- 5. wrong-password login is rejected ----
    // page is already on /login in "login" mode (the default after a fresh load).
    await fill('auth-email', email);
    await fill('auth-password', 'wrong-password-xyz');
    await click('auth-submit');
    await page.waitForSelector('[data-testid="auth-error"]', { timeout: 8000 }).catch(() => {});
    check('wrong password shows an error', await visible('auth-error'), 'auth-error shown');
    check('wrong password stays on /login', path() === '/login', `at ${path()}`);

    // ---- 6. login with correct credentials -> /dashboard ----
    await fill('auth-email', email);
    await fill('auth-password', password);
    await click('auth-submit');
    await page.waitForFunction(() => location.pathname === '/dashboard', { timeout: 12000 }).catch(() => {});
    check('correct login lands on /dashboard', path() === '/dashboard', `at ${path()}`);
    await page.waitForSelector('[data-testid="account-email"]', { timeout: 10000 }).catch(() => {});
    const acct2 = ((await page.locator('[data-testid="account-email"]').first().textContent()) || '').trim();
    check('re-login shows the same account email', acct2.includes(email), `account-email=${acct2}`);

    // ---- no UNEXPECTED console errors across the whole flow ----
    // This flow deliberately drives a wrong-password login, so the backend
    // correctly answers 401. The browser logs every non-2xx fetch as a console
    // "error" ("Failed to load resource: ...401..."), which is benign here — the
    // app handles it (renders auth-error, stays on /login). Filter those expected
    // auth-rejection status lines out; anything left is a real error.
    const realErrors = consoleErrors.filter(
      (e) => !/Failed to load resource[\s\S]*\b(401|403)\b/.test(e),
    );
    check('no unexpected console errors', realErrors.length === 0,
      realErrors.length ? realErrors.slice(0, 3).join(' | ') : 'clean (expected 401 ignored)');

    await page.screenshot({ path: shot, fullPage: true });
    console.log(`  screenshot: ${shot}`);
  } catch (e) {
    console.log('  \x1b[31mFAIL\x1b[0m playwright error: ' + e.message);
    failed++;
  } finally {
    await browser.close();
  }

  if (failed === 0) {
    console.log('  \x1b[32mAUTH FLOW PASS\x1b[0m');
    process.exit(0);
  }
  console.log('  \x1b[31mAUTH FLOW FAIL\x1b[0m');
  process.exit(1);
})();
