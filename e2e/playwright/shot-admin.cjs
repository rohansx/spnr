const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage({
    viewport: { width: 1280, height: 1600 },
    httpCredentials: { username: 'admin', password: process.argv[2] || '' },
  });
  await p.goto(process.argv[3] || 'http://82.112.226.62:8790/admin', { waitUntil: 'networkidle', timeout: 25000 });
  await p.waitForTimeout(800);
  await p.screenshot({ path: '/tmp/spnr-v5/admin.png', fullPage: true });
  console.log('admin shot ok');
  await b.close();
})().catch((e) => { console.log('FAIL', e.message); process.exitCode = 1; });
