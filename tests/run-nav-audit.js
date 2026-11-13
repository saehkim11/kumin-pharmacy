// 모든 네비게이션 메뉴와 하위 탭을 눌러보며 콘솔 오류와 화면 상태를 점검.
// @playwright/test 러너의 숨김폴더 제약을 피해 저수준 API로 직접 실행.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');

const accounts = JSON.parse(fs.readFileSync('test-accounts.local.json', 'utf-8')).accounts;
const admin = accounts.find((a) => a.role === 'admin');
const staff = accounts.find((a) => a.role === 'staff');
const BASE_URL = 'http://127.0.0.1:4173';

function waitForServer(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      http.get(url, (res) => { res.resume(); resolve(); })
        .on('error', () => {
          if (Date.now() - start > timeoutMs) reject(new Error('server did not start in time'));
          else setTimeout(tryOnce, 300);
        });
    };
    tryOnce();
  });
}

async function login(page, account) {
  await page.goto(BASE_URL + '/');
  await page.click('#loginButton');
  await page.fill('#email', account.email);
  await page.fill('#password', account.password);
  await page.click('#loginForm button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#loginButton')?.textContent === '로그아웃', { timeout: 15000 });
}

async function auditRole(browser, account, roleLabel) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });

  await login(page, account);
  await page.waitForTimeout(1000);

  const navButtons = await page.locator('.sidebar nav .nav-button:not([hidden])').all();
  const views = [];
  for (const btn of navButtons) {
    views.push({ view: await btn.getAttribute('data-view'), label: (await btn.textContent()).trim() });
  }
  console.log(`[${roleLabel}] NAV_VIEWS=` + JSON.stringify(views));

  for (const { view, label } of views) {
    await page.click(`.nav-button[data-view="${view}"]`);
    await page.waitForTimeout(700);
    const bodyText = (await page.locator(`#${view}`).textContent()).replace(/\s+/g, ' ').trim();
    console.log(`[${roleLabel}] VIEW=${view} LABEL=${label} TEXT_SNIPPET=${bodyText.slice(0, 220)}`);

    if (view === 'legacySales') {
      const tabs = await page.locator('#legacySalesViewTabs button').all();
      for (const tab of tabs) {
        const tabName = await tab.getAttribute('data-view');
        await tab.click();
        await page.waitForTimeout(500);
        const tabText = (await page.locator('#legacySales').textContent()).replace(/\s+/g, ' ').trim();
        console.log(`[${roleLabel}] VIEW=legacySales TAB=${tabName} TEXT_SNIPPET=${tabText.slice(0, 220)}`);
      }
    }
  }

  console.log(`[${roleLabel}] CONSOLE_ERRORS=` + JSON.stringify(errors));
  await page.close();
}

(async () => {
  const server = spawn('npx', ['http-server', '-p', '4173', '-c-1', '.'], { shell: true, stdio: 'ignore' });
  await waitForServer(BASE_URL + '/index.html', 15000);
  const browser = await chromium.launch();
  try {
    await auditRole(browser, admin, 'admin');
    await auditRole(browser, staff, 'staff');
  } finally {
    await browser.close();
    server.kill();
  }
})();
