// Screenshot the v5 redesign for visual verification.
//   node shot-v5.cjs <baseUrl> <outDir>
const { chromium } = require('playwright');
const base = (process.argv[2] || 'http://localhost:5180').replace(/\/$/, '');
const out = process.argv[3] || '/tmp/spnr-v5';
const fs = require('fs');

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errs = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
    page.on('pageerror', (e) => errs.push(String(e)));

    // Landing — light
    await page.goto(base + '/', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/landing-light.png`, fullPage: true });

    // Landing — dark (click the MOON toggle)
    await page.getByRole('button', { name: /toggle dark mode/i }).click().catch(() => {});
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/landing-dark.png`, fullPage: true });

    // Login (reset to light first via localStorage)
    await page.evaluate(() => { try { localStorage.setItem('spnr-theme', 'light'); } catch (e) {} });
    await page.goto(base + '/login', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/login.png`, fullPage: true });

    console.log('shots written to', out);
    console.log('pageerrors:', errs.length ? errs.slice(0, 3).join(' | ') : 'none');
  } catch (e) {
    console.log('FAIL', e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
