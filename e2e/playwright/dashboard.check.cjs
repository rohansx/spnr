// Playwright dashboard check — drives a real headless Chromium against the live
// spnr dashboard and asserts the attested-impression metrics render.
//
// Run from run.sh: NODE_PATH=$(npm root -g) node dashboard.check.cjs <url> <screenshot>
const { chromium } = require('playwright');

(async () => {
  const url = process.argv[2] || 'http://127.0.0.1:8787';
  const shot = process.argv[3] || '/tmp/spnr-dashboard.png';
  let failed = 0;
  const check = (name, cond, detail) => {
    console.log(`  ${cond ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!cond) failed++;
  };

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
    const txt = async (sel) =>
      ((await page.locator(`[data-testid="${sel}"]`).first().textContent()) || '').trim();

    const imp = parseInt(await txt('impressions'), 10);
    const bal = await txt('balance');
    const campaign = await txt('campaign');
    const creative = await txt('creative');
    const ledger = await txt('ledger');
    const devices = parseInt(await txt('devices'), 10);
    const clicks = parseInt(await txt('clicks'), 10);

    check('dashboard renders impressions ≥ 1', imp >= 1, `impressions=${imp}`);
    check('balance shows a dollar value', /^\$\d/.test(bal), `balance=${bal}`);
    check('campaign shown', /CloakPipe|House Ad/.test(campaign), campaign);
    check('creative shown', /CloakPipe/.test(creative), creative);
    check('ledger sum-to-zero OK', /OK/.test(ledger), ledger);
    check('device count ≥ 1', devices >= 1, `devices=${devices}`);
    check('clicks rendered', Number.isFinite(clicks), `clicks=${clicks}`);

    await page.screenshot({ path: shot, fullPage: true });
    console.log(`  screenshot: ${shot}`);
  } catch (e) {
    console.log('  \x1b[31mFAIL\x1b[0m playwright error: ' + e.message);
    failed++;
  } finally {
    await browser.close();
  }

  if (failed === 0) {
    console.log('  \x1b[32mPLAYWRIGHT PASS\x1b[0m');
    process.exit(0);
  }
  console.log('  \x1b[31mPLAYWRIGHT FAIL\x1b[0m');
  process.exit(1);
})();
