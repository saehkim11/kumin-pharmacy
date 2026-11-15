const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');

async function runAnalyticsComplaints() {
  let account;
  try { account = JSON.parse(fs.readFileSync('test-accounts.local.json', 'utf8')).accounts.find(row => row.role === 'admin'); }
  catch { throw new Error('Test account unavailable (contents omitted).'); }
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Seoul' });
  let errors = 0;
  let blocked = 0;
  let updated = false;
  let failAnalytics = false;
  let saleRequests = 0;
  page.on('pageerror', () => { errors += 1; });
  await page.route('**/rest/v1/**', route => {
    if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(route.request().method())) { blocked += 1; return route.fulfill({ status: 451, json: {} }); }
    return route.continue();
  });
  try {
    try {
      await page.goto('http://127.0.0.1:4173/'); await page.locator('#loginButton').click();
      await page.locator('#email').fill(account.email); await page.locator('#password').fill(account.password);
      await page.locator('#loginForm button[type=submit]').click();
      await page.waitForFunction(() => document.querySelector('#loginButton').textContent === '로그아웃');
    } catch { throw new Error('Analytics login failed (credentials omitted).'); }
    await page.locator('.sidebar [data-view=analytics]').click();
    assert.ok((await page.locator('#analyticsYear option').allTextContents()).includes('2025년'), 'Actual imported years must be selectable');
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'Analysis must not overflow the page');
        if (width === 1440) assert.equal(await page.locator('.profit-split>div').evaluateAll(cards => cards.every(card => !card.querySelector('table') || card.querySelector('table').getBoundingClientRect().width <= card.getBoundingClientRect().width + 1)), true, 'Desktop profitability tables must show all columns');
        await page.screenshot({ path: require('node:path').join(require('node:os').tmpdir(), `kumin-pair-analytics-${width}-${theme}.png`), fullPage: true });
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    const productId = await page.evaluate(() => products[0].id);
    const today = await page.evaluate(() => getLocalDate());
    const imported = [
      { id: 1, sold_on: '2025-12-03', product_id: null, product_name_raw: '미연결 검수A', quantity: 3, unit_price: 100000, unit_cost: 50000, amount: 300000, profit: 120000, margin_rate: 0.4 },
      { id: 2, sold_on: '2025-12-03', product_id: null, product_name_raw: '미연결 검수B', quantity: 1, unit_price: 250000, unit_cost: 100000, amount: 250000, profit: null, margin_rate: 0.6 },
      { id: 3, sold_on: '2025-12-03', product_id: null, product_name_raw: '원가 미상', quantity: 1, unit_price: 40000, unit_cost: null, amount: 40000, profit: null, margin_rate: null },
      { id: 4, sold_on: '2025-12-03', product_id: null, product_name_raw: '매출액 미상', quantity: null, unit_price: null, unit_cost: null, amount: null, profit: 99, margin_rate: null },
    ];
    const sales = () => [{ id: 1, sold_at: `${today}T00:00:00Z`, total_amount: 1000, status: 'completed' }, ...(updated ? [{ id: 2, sold_at: `${today}T00:00:00Z`, total_amount: 2000, status: 'completed' }] : [])];
    const items = () => sales().map(row => ({ id: row.id, sale_id: row.id, product_id: productId, quantity: 1, amount: row.total_amount }));
    const profit = () => sales().map(row => ({ sold_at: row.sold_at, product_id: productId, quantity: 1, amount: row.total_amount, cost_amount: row.total_amount * 0.6 }));
    const bounded = (rows, query, key) => rows.filter(row => query.getAll(key).every(bound => bound.startsWith('gte.') ? row[key] >= bound.slice(4) : bound.startsWith('lt.') ? row[key] < bound.slice(3) : bound.startsWith('lte.') ? row[key] <= bound.slice(4) : true));
    await page.route('**/rest/v1/**', async route => {
      const request = route.request(); const url = new URL(request.url()); const resource = url.pathname.split('/').at(-1);
      if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(request.method())) {
        if (resource === 'rpc_create_sale') { saleRequests += 1; updated = true; return route.fulfill({ json: 'audit-sale' }); }
        blocked += 1; return route.fulfill({ status: 451, json: {} });
      }
      if (resource === 'sales_legacy') return route.fulfill({ json: bounded(imported, url.searchParams, 'sold_on') });
      if (resource === 'sales') return route.fulfill({ json: bounded(sales(), url.searchParams, 'sold_at') });
      if (resource === 'sale_items') {
        if (url.searchParams.get('select')?.includes('sales!inner')) {
          const joined = items().map(row => ({ ...row, sales: sales().find(s => s.id === row.sale_id) })).filter(row => url.searchParams.getAll('sales.sold_at').every(bound => bound.startsWith('gte.') ? row.sales.sold_at >= bound.slice(4) : bound.startsWith('lt.') ? row.sales.sold_at < bound.slice(3) : true));
          return route.fulfill({ json: joined });
        }
        return route.fulfill({ json: items() });
      }
      if (resource === 'v_sale_items_profit') return route.fulfill(failAnalytics ? { status: 503, json: {} } : { json: bounded(profit(), url.searchParams, 'sold_at') });
      return route.continue();
    });
    await page.evaluate(() => refreshAnalyticsData());
    await page.locator('#analyticsSource').selectOption('legacy');
    await page.locator('#analyticsYear').selectOption('2025');
    assert.match(await page.locator('#analyticsRevenueSummary').textContent(), /590,000원/);
    assert.equal(await page.locator('#analytics .analysis-kpis strong').first().textContent(), '270,000원', 'Original profit must take precedence and unknown cost must be excluded');
    assert.match(await page.locator('#analyticsUnknownCost').textContent(), /2개/);
    assert.ok((await page.locator('#analytics').textContent()).includes('미연결 검수A'));
    assert.ok((await page.locator('#analytics').textContent()).includes('미연결 검수B'));
    assert.ok(!(await page.locator('#analytics .analysis-kpis p').allTextContents()).includes('주문 1건당 이익'));
    await page.locator('.sidebar [data-view=sales]').click();
    await page.evaluate(() => prepareSalesHistory('2025-12'));
    assert.match(await page.locator('#salesHistorySummary').textContent(), /590,000원/, 'The same fixture period must agree with sales history');
    await page.locator('.sidebar [data-view=analytics]').click();
    await page.locator('#analyticsSource').selectOption('all');
    assert.equal(await page.evaluate(() => new Set(analyticsSales.map(row => row.id)).size === analyticsSales.length), true, 'Source IDs must not collide');
    await page.locator('#analyticsSource').selectOption('registered');
    assert.equal(await page.locator('#analytics .analysis-kpis strong').first().textContent(), '400원');
    await page.locator('.sidebar [data-view=sales]').click();
    await page.locator('#saleProductSearch').fill('ㅂ'); await page.locator('#saleProductSuggestions .product-suggestion').first().click();
    await page.locator('#salePrice').fill('2000'); await page.locator('#addSaleItem').click(); await page.locator('#submitSale').click();
    await page.waitForFunction(() => !document.querySelector('#submitSale').disabled);
    assert.match(await page.locator('#saleMessage').textContent(), /판매가 등록되었습니다/);
    await page.locator('.sidebar [data-view=analytics]').click();
    assert.equal(await page.locator('#analytics .analysis-kpis strong').first().textContent(), '1,200원', 'Sale completion must refresh profit without reload');
    assert.equal(await page.locator('#analyticsSource').inputValue(), 'registered');
    failAnalytics = true;
    await page.evaluate(() => refreshAnalyticsData());
    assert.match(await page.locator('#analyticsRefreshMessage').textContent(), /최신 자료를 불러오지 못했습니다/);
    assert.match(await page.locator('#dashboardAnalyticsRefreshMessage').textContent(), /최신 자료를 불러오지 못했습니다/);
    assert.equal(await page.locator('#analytics .analysis-kpis strong').first().textContent(), '1,200원');
    assert.equal(blocked, 0); assert.equal(saleRequests, 1); assert.equal(errors, 0);
    console.log('ERP customer complaints passed: live legacy year, source scope, original profit, unknown cost/amount, unmatched names, ID separation, sale-to-analysis refresh and refresh failure; business writes intercepted.');
  } finally { await browser.close(); }
}
module.exports = { runAnalyticsComplaints };
if (require.main === module) runAnalyticsComplaints().catch(error => { console.error(error.message); process.exitCode = 1; });
