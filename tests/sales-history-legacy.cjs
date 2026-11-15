const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

async function runSalesHistoryReview() {
  let accounts;
  try { accounts = JSON.parse(fs.readFileSync('test-accounts.local.json', 'utf8')).accounts; }
  catch { throw new Error('Test accounts unavailable (contents omitted).'); }
  const browser = await chromium.launch();
  const output = path.join(os.tmpdir(), 'kumin-history-link');
  fs.mkdirSync(output, { recursive: true });
  try {
    for (const role of ['admin', 'staff']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Seoul' });
      let errors = 0;
      let writes = 0;
      page.on('pageerror', () => { errors += 1; });
      await page.route('**/rest/v1/**', route => {
        if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(route.request().method())) {
          writes += 1;
          return route.fulfill({ status: 451, json: {} });
        }
        return route.continue();
      });
      const account = accounts.find(a => a.role === role);
      try {
        await page.goto('http://127.0.0.1:4173/');
        await page.locator('#loginButton').click();
        await page.locator('#email').fill(account.email);
        await page.locator('#password').fill(account.password);
        await page.locator('#loginForm button[type=submit]').click();
        await page.waitForFunction(() => document.querySelector('#loginButton').textContent === '로그아웃');
      } catch { throw new Error(`${role} login failed (credentials omitted).`); }
      await page.locator('.sidebar [data-view=sales]').click();
      await page.waitForFunction(() => document.querySelector('#salesHistoryMonth').options.length > 0);
      if (role === 'admin') {
        await page.waitForFunction(() => legacySales.length > 0);
        const past = await page.evaluate(() => [...new Set(legacySales.map(r => r.sold_on.slice(0, 7)))].sort().at(-1));
        await page.locator('#salesHistoryMonth').selectOption(past);
        await page.waitForFunction(m => document.querySelector('#salesHistorySummary').textContent.startsWith(m) && !document.querySelector('#salesHistorySummary').hidden, past);
        const matched = await page.evaluate(m => salesHistoryRows.filter(r => r.imported).length === legacySales.filter(r => r.sold_on.startsWith(m)).length, past);
        assert.ok(matched, 'Every accessible imported record must appear in sales history');
        assert.match(await page.locator('#salesHistorySummary').textContent(), /엑셀/);
        await page.locator('[data-history-view=product]').click();
        assert.ok(await page.locator('#salesHistoryBody tbody tr').count() > 1);

        // Independent read fixtures cover source ID collisions, unmatched names and unknown costs.
        const month = await page.evaluate(() => getLocalDate().slice(0, 7));
        const productId = await page.evaluate(() => products[0].id);
        const imported = [
          { id: 1, sold_on: `${month}-01`, product_id: null, product_name_raw: '검수 과거A', quantity: 2, unit_price: 500, unit_cost: 300, amount: 1000, profit: 0, margin_rate: 0 },
          { id: 2, sold_on: `${month}-01`, product_id: null, product_name_raw: '검수 과거B', quantity: 3, unit_price: 300, unit_cost: 100, amount: 900, profit: null, margin_rate: null },
          { id: 3, sold_on: `${month}-01`, product_id: null, product_name_raw: '검수 과거C', quantity: 1, unit_price: 200, unit_cost: null, amount: 200, profit: null, margin_rate: null },
          { id: 4, sold_on: '2025-01-03', product_id: null, product_name_raw: '검수 이전월', quantity: 1, unit_price: 50, unit_cost: 30, amount: 50, profit: 20, margin_rate: 0.4 },
        ];
        await page.route('**/rest/v1/sales_legacy?**', route => {
          const query = new URL(route.request().url()).searchParams;
          const bounds = query.getAll('sold_on');
          const rows = imported.filter(row => bounds.every(b => b.startsWith('gte.') ? row.sold_on >= b.slice(4) : b.startsWith('lt.') ? row.sold_on < b.slice(3) : true));
          return route.fulfill({ json: rows });
        });
        await page.route('**/rest/v1/sales?**', route => route.fulfill({ json: [{ id: 1, sold_at: `${month}-02T00:00:00Z`, total_amount: 2000, status: 'completed' }] }));
        await page.route('**/rest/v1/sale_items?**', route => {
          const q = new URL(route.request().url()).searchParams;
          const requested = q.getAll('sales.sold_at').find(v => v.startsWith('gte.'))?.slice(4, 11);
          return route.fulfill({ json: requested === '2025-01' ? [] : [{ product_id: productId, quantity: 1, amount: 2000, sales: { id: 1, sold_at: `${month}-02T00:00:00Z`, status: 'completed' } }] });
        });
        await page.evaluate(m => prepareSalesHistory(m), month);
        assert.match(await page.locator('#salesHistorySummary').textContent(), /4,100원/);
        assert.match(await page.locator('#salesHistorySummary').textContent(), /기록 4건/);
        assert.match(await page.locator('#salesHistoryBody').textContent(), /검수 과거A/);
        assert.match(await page.locator('#salesHistoryBody').textContent(), /검수 과거B/);
        await page.locator('#salesHistoryMonth').selectOption('2025-01');
        await page.waitForFunction(() => document.querySelector('#salesHistoryBody').textContent.includes('검수 이전월'));
        assert.match(await page.locator('#salesHistorySummary').textContent(), /50원/);
        await page.locator('[data-history-view=daily]').click();
        assert.match(await page.locator('#salesHistoryBody').textContent(), /검수 이전월/);

        await page.locator('.sidebar [data-view=legacySales]').click();
        await page.evaluate(async m => { selectedLegacySalesMonth = m; await loadLegacySales(); }, month);
        await page.locator('#legacySalesViewTabs [data-view=daily]').click();
        assert.deepEqual(await page.locator('#legacySalesHead th').allTextContents(), ['일자', '요일', '상품명', '수량', '판매단가', '매입단가', '매출액', '마진율', '수익']);
        const a = page.locator('#legacySalesRows tr').filter({ hasText: '검수 과거A' });
        const b = page.locator('#legacySalesRows tr').filter({ hasText: '검수 과거B' });
        const c = page.locator('#legacySalesRows tr').filter({ hasText: '검수 과거C' });
        assert.equal(await a.locator('td').nth(4).textContent(), '500원');
        assert.equal(await a.locator('td').nth(5).textContent(), '300원');
        assert.equal(await a.locator('td').last().textContent(), '0원', 'Original zero profit must be preserved');
        assert.equal(await b.locator('td').last().textContent(), '600원');
        assert.equal(await c.locator('td').last().textContent(), '—', 'Unknown cost must not become zero');
        assert.equal(await page.locator('.legacy-sales-total-row td').last().textContent(), '600원 (확인분)');
        assert.equal(await page.locator('#legacySalesHead .col-wide').evaluate(e => e.style.width), '160px');
        for (const width of [1440, 768, 390]) {
          await page.setViewportSize({ width, height: 1000 });
          for (const theme of ['light', 'dark']) {
            await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
            if (width === 1440) assert.ok(await page.locator('#legacySalesRows').evaluate(e => {
              const table = e.closest('table').getBoundingClientRect();
              const wrap = e.closest('.table-wrap').getBoundingClientRect();
              return table.right <= wrap.right + 1;
            }), 'Profit column must fit in the desktop table');
            await page.screenshot({ path: path.join(output, `profit-${width}-${theme}.png`), fullPage: true });
          }
        }
      } else {
        assert.ok(await page.locator('#legacySalesNav').isHidden());
        assert.ok(await page.locator('#salesHistoryMonth').isEnabled());
      }
      assert.equal(errors, 0);
      assert.equal(writes, 0, 'History review must never write business data');
      await page.close();
    }
  } finally { await browser.close(); }
  console.log('Sales history review passed: live imported-month link, both history tabs, mixed sources, unmatched names, cost/profit values and 6 layouts; no business writes.');
}
module.exports = { runSalesHistoryReview };
if (require.main === module) runSalesHistoryReview().catch(error => { console.error(error.message); process.exitCode = 1; });
