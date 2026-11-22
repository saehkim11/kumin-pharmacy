// 로그인 유지 확인(저수준 Playwright). 실행: node tests/run-keep-login.js — 계정 값은 출력하지 않는다.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path'); const http = require('http'); const assert = require('assert');
const file = [process.env.TEST_ACCOUNTS_PATH, 'test-accounts.local.json', path.join('..', '..', 'kumin-pharmacy', 'test-accounts.local.json')].filter(Boolean).find((f) => fs.existsSync(f));
if (!file) throw new Error('테스트 계정 파일을 찾지 못했습니다.');
const admin = JSON.parse(fs.readFileSync(file, 'utf-8')).accounts.find((a) => a.role === 'admin');
const BASE = 'http://127.0.0.1:4178';
const wait = (url) => new Promise((res, rej) => { const t = Date.now(); const go = () => http.get(url, (r) => { r.resume(); res(); }).on('error', () => Date.now() - t > 15000 ? rej(new Error('server')) : setTimeout(go, 300)); go(); });
const loggedIn = (page) => page.waitForFunction(() => document.querySelector('#loginButton')?.textContent === '로그아웃', { timeout: 30000 }).then(() => true, () => false);
async function login(page, keep) {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  for (let i = 0; i < 5 && !(await page.locator('#email').isVisible()); i += 1) { await page.click('#loginButton'); await page.waitForTimeout(500); }
  assert.strictEqual(await page.isChecked('#keepLogin'), true, '기본은 체크');
  if (!keep) await page.uncheck('#keepLogin');
  await page.fill('#email', admin.email); await page.fill('#password', admin.password);
  await page.click('#loginForm button[type="submit"]');
  assert.ok(await loggedIn(page), '로그인');
}
(async () => {
  const server = spawn('python', ['-m', 'http.server', '4178', '--bind', '127.0.0.1'], { stdio: 'ignore' });
  await wait(BASE + '/');
  const browser = await chromium.launch();
  let ok = 0, bad = 0;
  const t = async (n, f) => { try { await f(); ok++; console.log('PASS ' + n); } catch (e) { bad++; console.log('FAIL ' + n + '\n  ' + String(e.message).split('\n')[0]); } };
  try {
    await t('유지 체크(기본): 새로고침과 브라우저를 껐다 켠 뒤에도 로그인 유지', async () => {
      const ctx = await browser.newContext(); const page = await ctx.newPage();
      await login(page, true);
      await page.reload({ waitUntil: 'networkidle' }); assert.ok(await loggedIn(page), '새로고침');
      const state = await ctx.storageState(); await ctx.close(); // 브라우저를 닫아도 localStorage는 남는다
      const ctx2 = await browser.newContext({ storageState: state }); const p2 = await ctx2.newPage();
      await p2.goto(BASE + '/', { waitUntil: 'networkidle' }); assert.ok(await loggedIn(p2), '재시작');
      await ctx2.close();
    });
    await t('유지 해제: 새로고침은 유지되지만 브라우저를 껐다 켜면 로그아웃', async () => {
      const ctx = await browser.newContext(); const page = await ctx.newPage();
      await login(page, false);
      await page.reload({ waitUntil: 'networkidle' }); assert.ok(await loggedIn(page), '새로고침');
      const state = await ctx.storageState(); await ctx.close();
      const ctx2 = await browser.newContext({ storageState: state }); const p2 = await ctx2.newPage();
      await p2.goto(BASE + '/', { waitUntil: 'networkidle' }); await p2.waitForTimeout(3000);
      assert.strictEqual(await p2.textContent('#loginButton'), '로그인');
      await p2.click('#loginButton'); assert.strictEqual(await p2.isChecked('#keepLogin'), false, '선택 기억');
      await ctx2.close();
    });
    await t('로그아웃하면 저장된 로그인이 지워진다', async () => {
      const ctx = await browser.newContext(); const page = await ctx.newPage();
      await login(page, true);
      await page.click('#loginButton'); await page.waitForTimeout(2000);
      await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(2500);
      assert.strictEqual(await page.textContent('#loginButton'), '로그인');
      await ctx.close();
    });
  } finally { await browser.close(); server.kill(); }
  console.log(`${ok}/${ok + bad} 통과`); process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e.message); process.exit(1); });
