// Live advertiser-portal Playwright check — drives a real headless Chromium against
// the Vite-served /advertiser page (proxying /v2 to the hermetic server-ts) and
// asserts the CAMPAIGNS tab renders the LIVE campaigns from the v2 API (not the
// static design fallback rows, which carry no data-testid).
//
//   node advertiser.live.cjs <advertiserUrl> <campaignsUrl> <screenshotPath>
const { chromium } = require('playwright');

const advUrl = process.argv[2] || 'http://localhost:5174/advertiser';
const campaignsUrl = process.argv[3] || 'http://localhost:5174/v2/campaigns';
const shot = process.argv[4] || '/tmp/spnr-advertiser-live.png';

let failed = 0;
const errs = [];
const check = (n, c, d) => {
  console.log(`  ${c ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'} ${n}${d ? ' — ' + d : ''}`);
  if (!c) failed++;
};

(async () => {
  let backendCount;
  try {
    const j = await (await fetch(campaignsUrl)).json();
    backendCount = j.campaigns.length;
  } catch (e) {
    console.log('  \x1b[31mFAIL\x1b[0m could not fetch /v2/campaigns: ' + e.message);
    process.exit(1);
  }
  console.log(`  /v2/campaigns has ${backendCount}`);

  const b = await chromium.launch({ headless: true });
  try {
    const p = await b.newPage({ viewport: { width: 1280, height: 980 } });
    p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    p.on('pageerror', (e) => errs.push(String(e)));

    await p.goto(advUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await p.getByText('CAMPAIGNS', { exact: true }).first().click();
    await p.waitForSelector('[data-testid="campaign-row"]', { timeout: 9000 }).catch(() => {});

    const rows = await p.locator('[data-testid="campaign-row"]').count();
    const countLine = ((await p.locator('[data-testid="campaign-count"]').first().textContent().catch(() => '')) || '').trim();

    check('advertiser shows live campaigns == v2 API', rows === backendCount && rows >= 1, `rows=${rows} api=${backendCount}`);
    check('live campaign-count line present', /live campaign/i.test(countLine), `"${countLine}"`);
    check('no console errors', errs.length === 0, errs.slice(0, 3).join(' | ') || 'clean');

    await p.screenshot({ path: shot });
    console.log(`  screenshot: ${shot}`);
  } catch (e) {
    console.log('  \x1b[31mFAIL\x1b[0m playwright error: ' + e.message);
    failed++;
  } finally {
    await b.close();
  }

  console.log(failed === 0 ? '\x1b[32mLIVE ADVERTISER PASS\x1b[0m' : '\x1b[31mLIVE ADVERTISER FAIL\x1b[0m');
  process.exit(failed === 0 ? 0 : 1);
})();
