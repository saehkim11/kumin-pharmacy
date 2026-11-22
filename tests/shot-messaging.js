// 메시지 화면 캡처(눈으로 확인용). 실행: node tests/shot-messaging.js <출력폴더> [접두어]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path'); const http = require('http');
const out = process.argv[2]; const prefix = process.argv[3] || 'msg';
const file = [process.env.TEST_ACCOUNTS_PATH, 'test-accounts.local.json', path.join('..', '..', 'kumin-pharmacy', 'test-accounts.local.json')].filter(Boolean).find((f) => fs.existsSync(f));
const admin = JSON.parse(fs.readFileSync(file, 'utf-8')).accounts.find((a) => a.role === 'admin');
const BASE = 'http://127.0.0.1:4179';
const wait = (url) => new Promise((res, rej) => { const t = Date.now(); const go = () => http.get(url, (r) => { r.resume(); res(); }).on('error', () => Date.now() - t > 15000 ? rej(new Error('server')) : setTimeout(go, 300)); go(); });
(async () => {
  const server = spawn('python', ['-m', 'http.server', '4179', '--bind', '127.0.0.1'], { stdio: 'ignore' });
  await wait(BASE + '/');
  const browser = await chromium.launch();
  try {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } }); const page = await ctx.newPage();
      await page.goto(BASE + '/', { waitUntil: 'networkidle' });
      for (let i = 0; i < 5 && !(await page.locator('#email').isVisible()); i += 1) { await page.click('#loginButton'); await page.waitForTimeout(500); }
      await page.fill('#email', admin.email); await page.fill('#password', admin.password);
      await page.click('#loginForm button[type="submit"]');
      await page.waitForFunction(() => document.querySelector('#loginButton')?.textContent === '로그아웃', { timeout: 60000 });
      await page.waitForSelector('#messagingNav', { state: 'visible', timeout: 15000 });
      await page.click('#messagingNav'); await page.waitForTimeout(2500);
      await page.click('#msgTypeChoices >> text=직접 쓰기').catch(() => {}); await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(out, `${prefix}-${w}.png`), fullPage: true });
      await ctx.close();
    }
  } finally { await browser.close(); server.kill(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
