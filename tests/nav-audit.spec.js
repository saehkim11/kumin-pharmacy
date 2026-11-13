// 모든 네비게이션 메뉴와 하위 탭을 눌러보며 콘솔 오류와 화면 상태를 점검하는 감사용 테스트.
// 실패 여부보다 스크린샷/콘솔 로그를 남겨 UI 점검 자료로 쓰는 것이 목적.
const { test, expect } = require('@playwright/test');
const fs = require('fs');

const accounts = JSON.parse(fs.readFileSync('test-accounts.local.json', 'utf-8')).accounts;
const admin = accounts.find((a) => a.role === 'admin');
const staff = accounts.find((a) => a.role === 'staff');

async function login(page, account) {
  await page.goto('/');
  await page.click('#loginButton');
  await page.fill('#email', account.email);
  await page.fill('#password', account.password);
  await page.click('#loginForm button[type="submit"]');
  await expect(page.locator('#loginButton')).toHaveText('로그아웃', { timeout: 15000 });
}

test('admin: 전체 인덱스 버튼 및 하위 탭 순회', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });

  await login(page, admin);
  await page.waitForTimeout(1000);

  const navButtons = await page.locator('.sidebar nav .nav-button:not([hidden])').all();
  const views = [];
  for (const btn of navButtons) {
    const view = await btn.getAttribute('data-view');
    const label = (await btn.textContent()).trim();
    views.push({ view, label });
  }
  console.log('ADMIN_NAV_VIEWS=' + JSON.stringify(views));

  for (const { view, label } of views) {
    await page.click(`.nav-button[data-view="${view}"]`);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `pwout/admin_${view}.png`, fullPage: true });

    if (view === 'legacySales') {
      const tabs = await page.locator('#legacySalesViewTabs button').all();
      for (const tab of tabs) {
        const tabName = await tab.getAttribute('data-view');
        await tab.click();
        await page.waitForTimeout(400);
        await page.screenshot({ path: `pwout/admin_legacySales_${tabName}.png`, fullPage: true });
      }
    }
  }

  console.log('ADMIN_CONSOLE_ERRORS=' + JSON.stringify(errors));
});

test('staff: 보이는 메뉴와 숨김 메뉴 확인', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });

  await login(page, staff);
  await page.waitForTimeout(1000);

  const visible = await page.locator('.sidebar nav .nav-button:not([hidden])').all();
  const views = [];
  for (const btn of visible) views.push(await btn.getAttribute('data-view'));
  console.log('STAFF_VISIBLE_VIEWS=' + JSON.stringify(views));

  for (const view of views) {
    await page.click(`.nav-button[data-view="${view}"]`);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `pwout/staff_${view}.png`, fullPage: true });
  }

  console.log('STAFF_CONSOLE_ERRORS=' + JSON.stringify(errors));
});
