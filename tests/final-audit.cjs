const { chromium } = require('playwright');
const fs = require('fs');
const assert = require('node:assert/strict');
let accounts;
try { accounts = JSON.parse(fs.readFileSync('test-accounts.local.json', 'utf8')).accounts; }
catch { throw new Error('Test accounts could not be loaded (values omitted).'); }
const out = require('path').join(require('os').tmpdir(), 'kumin-final-audit');
fs.mkdirSync(out, { recursive: true });
async function runAudit() {
  const browser = await chromium.launch();
  const report = [];
  try {
    for (const role of ['admin', 'staff']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const errors = [];
      const failed = [];
      page.on('pageerror', () => errors.push('JavaScript exception'));
      page.on('console', m => { if (m.type() === 'error') errors.push('Console error'); });
      page.on('response', r => { if (r.status() >= 400) failed.push({ status: r.status(), resource: new URL(r.url()).pathname.replace(/\/rest\/v1\/.*/, '/rest/v1/[resource]') }); });
      const account = accounts.find(a => a.role === role);
      try {
      await page.goto('http://127.0.0.1:4173/');
      await page.locator('#loginButton').click();
      await page.locator('#email').fill(account.email);
      await page.locator('#password').fill(account.password);
      await page.locator('#loginForm button[type=submit]').click();
      await page.waitForFunction(() => document.querySelector('#loginButton').textContent === '로그아웃');
      await page.waitForFunction(() => !document.querySelector('#saleProductSearch').disabled);
      } catch {
        throw new Error(`${role}: login or initial loading failed (credentials omitted)`);
      }
      const views = await page.locator('.sidebar nav button:not([hidden])').evaluateAll(bs => bs.map(b => b.dataset.view));
      report.push({ role, views });
      if (role === 'admin') {
        await page.locator('.sidebar [data-view="legacySales"]').click();
        await page.waitForFunction(() => document.querySelector('#legacySalesMonth').options.length > 0);
        await page.locator('#legacySalesSearch').fill('ㄴㅅㄱ');
        for (const tab of ['daily', 'product', 'weekday', 'margin', 'recent3m', 'yoy']) {
          await page.locator(`#legacySalesViewTabs [data-view="${tab}"]`).click();
          const valid = await page.evaluate((tab) => {
            const month = document.querySelector('#legacySalesMonth').value;
            const filtered = legacySales.filter(r => r.sold_on.startsWith(month) && matchesKoreanText(r.product_name_raw, 'ㄴㅅㄱ'));
            const total = filtered.reduce((s, r) => s + Number(r.amount || 0), 0);
            const rows = [...document.querySelectorAll('#legacySalesRows tr')];
            const row = tab === 'recent3m' || tab === 'yoy' ? rows.at(-1) : rows[0];
            const col = { daily: 6, product: 3, weekday: 3, margin: 1, recent3m: 3, yoy: 3 }[tab];
            return row?.cells[col]?.textContent === won(total);
          }, tab);
          assert.ok(valid, `Filtered total must agree in ${tab}`);
        }
        await page.locator('#legacySalesSearch').fill('검수검색결과없음');
        await page.locator('#legacySalesViewTabs [data-view="product"]').click();
        assert.ok(await page.locator('#legacySalesEmpty').isVisible());
        assert.equal(await page.locator('#legacySalesHead th').first().textContent(), '상품명');
        await page.locator('#legacySalesSearch').fill('');
        const months = await page.locator('#legacySalesMonth option').evaluateAll(os => os.map(o => o.value));
        await page.locator('#legacySalesMonth').selectOption(months.at(-1));
        assert.ok((await page.locator('#legacySalesMonthSummary').textContent()).includes(months.at(-1)));
        await page.locator('#legacySalesMonth').selectOption(months[0]);
        await page.locator('#legacySalesViewTabs [data-view="weather"]').click();
        assert.ok(await page.locator('#legacySalesSearch').isDisabled());
        assert.ok(await page.locator('#legacySalesMonth').isDisabled());
        await page.locator('#legacySalesViewTabs [data-view="daily"]').click();
        assert.ok(await page.locator('#legacySalesSearch').isEnabled());
        report.push({ role, legacyAssertions: '6 filtered totals, empty state, month selection, forecast scope passed' });
      }
      await page.locator('.sidebar [data-view="sales"]').click();
      await page.locator('#saleProductSearch').fill('ㅂ');
      await page.locator('#saleProductSuggestions .product-suggestion').first().click();
      assert.equal(await page.locator('#saleQuantity').evaluate(e => e === document.activeElement), true);
      await page.locator('#saleQuantity').fill('2');
      await page.locator('#salePrice').fill('12345');
      await page.locator('#addSaleItem').click();
      assert.ok((await page.locator('#saleRows').textContent()).includes('24,690'));
      await page.locator('[data-history-view="product"]').click();
      assert.ok(await page.locator('#salesHistoryBody').isVisible());
      await page.locator('[data-history-view="daily"]').click();
      report.push({ role, salesCart: 'initial search, selection, focus, calculation and history tabs passed (no sale saved)' });
      for (const width of [1440, 768, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const view of views) {
          await page.locator(`.sidebar nav [data-view="${view}"]`).click();
          await page.waitForTimeout(200);
          const layout = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1, buttons: [...document.querySelectorAll('.view.active button, .sidebar button')].filter(b => b.getClientRects().length && !b.disabled).map(b => ({ text: b.textContent.trim(), height: Math.round(b.getBoundingClientRect().height), font: getComputedStyle(b).fontSize })).filter(b => b.height < 36) }));
          report.push({ role, width, view, ...layout });
          assert.equal(layout.overflow, false, `${role} ${width} ${view}: page overflow`);
          assert.equal(layout.buttons.length, 0, `${role} ${width} ${view}: small controls`);
          await page.screenshot({ path: `${out}/${role}-${width}-${view}.png`, fullPage: true });
          if (view === 'legacySales') {
            const tabs = await page.locator('#legacySalesViewTabs button').evaluateAll(bs => bs.map(b => b.dataset.view));
            for (const tab of tabs) {
              await page.locator(`#legacySalesViewTabs [data-view="${tab}"]`).click();
              await page.waitForTimeout(tab === 'weather' ? 2500 : 100);
              report.push({ role, width, tab, rows: await page.locator('#legacySalesRows tr').count(), summary: await page.locator('#legacySalesMonthSummary').textContent(), empty: await page.locator('#legacySalesEmpty').isVisible(), overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1) });
              await page.screenshot({ path: `${out}/${role}-${width}-legacy-${tab}.png`, fullPage: true });
            }
          }
        }
      }
      // Isolated task fixtures exercise writes without changing pharmacy records.
      const fixture = await page.evaluate(() => {
        const userId = currentUser.id;
        const today = new Date();
        const date = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
        return [1,2,3].map(n => ({ id: `audit-${n}`, title: `검수용 업무 ${n}`, due_date: date, status: 'todo', priority: 'normal', task_assignees: [{ user_id: userId }] }));
      });
      let postedComment = false;
      let patchedStatus = false;
      await page.route('**/rest/v1/action_tasks?**', async route => {
        if (route.request().method() === 'PATCH') {
          patchedStatus = route.request().postDataJSON().status === 'doing';
          fixture[2].status = 'doing';
          await route.fulfill({ status: 204 });
        } else await route.fulfill({ json: fixture });
      });
      await page.route('**/rest/v1/task_comments**', async route => {
        if (route.request().method() === 'POST') {
          postedComment = route.request().postDataJSON().body === '검수용 진행 확인';
          await route.fulfill({ status: 201, json: [] });
        } else await route.fulfill({ json: [] });
      });
      await page.evaluate(() => loadTasks());
      await page.locator('.sidebar [data-view="tasks"]').click();
      await page.locator(`.task-day[aria-label="${fixture[0].due_date} · 업무 3건"]`).click();
      assert.equal(await page.locator('#taskDayList button').count(), 3);
      await page.locator('#taskDayList button').nth(2).click();
      await page.waitForFunction(() => document.querySelector('#taskDetailTitle').textContent === '검수용 업무 3');
      await page.locator('#taskStatus').selectOption('doing');
      await page.locator('#saveTaskStatus').click();
      await page.waitForTimeout(300);
      assert.ok(patchedStatus);
      assert.ok((await page.locator('#taskDayList button').nth(2).textContent()).includes('진행 중'));
      await page.locator('#commentBody').fill('검수용 진행 확인');
      await page.locator('#commentForm button').click();
      await page.waitForTimeout(300);
      assert.ok(postedComment);
      await page.screenshot({ path: `${out}/${role}-390-task-selection.png`, fullPage: true });
      await page.locator('#themeToggle').click();
      assert.equal(await page.locator('.task-day:not(.muted)').first().evaluate(e => getComputedStyle(e).color === getComputedStyle(document.body).color), true);
      await page.screenshot({ path: `${out}/${role}-390-dark-tasks.png`, fullPage: true });
      await page.locator('#themeToggle').click();
      await page.locator('#previousMonth').click();
      await page.locator('#nextMonth').click();
      report.push({ role, taskFixtures: 'all 3 same-day tasks selectable; status and comment request passed (isolated API fixtures)' });
      await page.locator('#loginButton').click();
      await page.waitForFunction(() => document.querySelector('#loginButton').textContent === '로그인');
      report.push({ role, logout: true, errors, failed });
      assert.deepEqual(errors, [], `${role}: browser errors`);
      assert.deepEqual(failed, [], `${role}: HTTP failures`);
      await page.close();
    }
  } finally {
    fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
    await browser.close();
  }
  console.log('Final audit passed: both roles, 3 sizes, 7 sales tabs, filtered totals, sales cart, isolated task actions, logout; no browser or HTTP errors.');
}
module.exports = { runAudit };
if (require.main === module) runAudit().catch(error => { console.error(error.message); process.exitCode = 1; });
