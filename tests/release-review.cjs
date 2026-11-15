// Release regressions use real login/read access, but intercept every REST write.
const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');

async function runReleaseReview() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Seoul' });
  const state = { sales: [], purchases: 0, taskCreates: 0, assignments: 0, status: 0, comments: 0, unexpectedWrites: 0, saleFail: true, purchaseFail: true, failProducts: false, taskStatusFail: true, commentFail: true };
  const results = [];
  let pageErrors = 0;
  page.on('pageerror', () => { pageErrors += 1; });
  const taskA = '00000000-0000-0000-0000-000000000001';
  const taskB = '00000000-0000-0000-0000-000000000002';
  await page.route('**/rest/v1/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const resource = url.pathname.split('/').at(-1);
    const method = request.method();
    if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(method)) {
      await new Promise(resolve => setTimeout(resolve, 120));
      if (resource === 'rpc_create_sale') {
        state.sales.push(request.postDataJSON().p_idempotency_key);
        return route.fulfill(state.saleFail ? { status: 400, json: { message: '검수용 저장 실패' } } : { json: 'audit-sale' });
      }
      if (resource === 'rpc_receive_purchase') {
        state.purchases += 1;
        if (!state.purchaseFail) state.failProducts = true;
        return route.fulfill(state.purchaseFail ? { status: 400, json: { message: '검수용 저장 실패' } } : { json: 'audit-purchase' });
      }
      if (resource === 'action_tasks' && method === 'POST') {
        state.taskCreates += 1;
        return route.fulfill({ status: 201, json: [{ id: taskA }] });
      }
      if (resource === 'task_assignees') {
        state.assignments += 1;
        return route.fulfill(state.assignments === 1 ? { status: 400, json: {} } : { status: 201, json: [] });
      }
      if (resource === 'action_tasks' && method === 'PATCH') {
        state.status += 1;
        return route.fulfill(state.taskStatusFail ? { status: 400, json: {} } : { status: 204 });
      }
      if (resource === 'task_comments') {
        state.comments += 1;
        return route.fulfill(state.commentFail ? { status: 400, json: {} } : { status: 201, json: [] });
      }
      state.unexpectedWrites += 1;
      return route.fulfill({ status: 451, json: { message: 'Unmatched test write blocked' } });
    }
    if (resource === 'products' && state.failProducts) return route.fulfill({ status: 503, json: {} });
    if (resource === 'action_tasks') return route.fulfill({ json: [] });
    if (resource === 'task_comments') {
      const taskId = url.searchParams.get('task_id');
      if (taskId === `eq.${taskA}`) {
        await new Promise(resolve => setTimeout(resolve, 180));
        return route.fulfill({ json: [{ id: 'comment-a', task_id: taskA, author_id: 'audit', body: 'A 업무 댓글', created_at: '2026-11-14T01:00:00Z' }] });
      }
      if (taskId === `eq.${taskB}`) return route.fulfill({ json: [{ id: 'comment-b', task_id: taskB, author_id: 'audit', body: 'B 업무 댓글', created_at: '2026-11-14T01:00:00Z' }] });
      return route.fulfill({ json: [] });
    }
    if (resource === 'sales' && state.dashboardFixture) {
      const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
      return route.fulfill({ json: [{ id: 'old-sale', sold_at: `${yesterday}T12:00:00`, total_amount: 98765, status: 'completed' }] });
    }
    return route.continue();
  });
  const waitUnlocked = selector => page.waitForFunction(s => !document.querySelector(s).disabled, selector);
  try {
    let account;
    try { account = JSON.parse(fs.readFileSync('test-accounts.local.json', 'utf8')).accounts.find(a => a.role === 'admin'); }
    catch { throw new Error('Release review account file could not be read (contents omitted)'); }
    try {
      await page.goto('http://127.0.0.1:4173/');
      await page.locator('#loginButton').click();
      await page.locator('#email').fill(account.email);
      await page.locator('#password').fill(account.password);
      await page.locator('#loginForm button[type=submit]').click();
      await page.waitForFunction(() => document.querySelector('#loginButton').textContent === '로그아웃');
    } catch { throw new Error('Release review login failed (credentials omitted)'); }

    // A partial name must not silently become an unlinked pet sale.
    await page.locator('.sidebar [data-view=sales]').click();
    await page.locator('#saleProductSearch').fill('ㅂ');
    await page.locator('#saleProductSuggestions .product-suggestion').first().click();
    await page.locator('#salePrice').fill('1000');
    await page.locator('#salePetSearch').fill('검수미선택');
    await page.locator('#addSaleItem').click();
    assert.equal(await page.locator('#saleRows tr').count(), 0, 'Unselected pet must block adding');
    assert.match(await page.locator('#saleMessage').textContent(), /추천 목록/);
    await page.locator('#salePetSearch').fill('');
    await page.locator('#addSaleItem').click();

    await page.evaluate(() => { document.querySelector('#submitSale').click(); document.querySelector('#submitSale').click(); });
    await waitUnlocked('#submitSale');
    assert.equal(state.sales.length, 1, 'Sale double click must make one request');
    assert.equal(await page.locator('#saleRows tr').count(), 1, 'Failed sale must retain cart');
    await page.locator('#submitSale').click();
    await waitUnlocked('#submitSale');
    assert.equal(state.sales.length, 2);
    assert.equal(state.sales[0], state.sales[1], 'Same cart retry must reuse idempotency key');
    results.push('sale double click, failure retention, retry idempotency, pet selection validation');

    await page.locator('.sidebar [data-view=purchases]').click();
    await page.evaluate(() => {
      purchaseItems = [{ id: products[0].id, name: '검수용 상품', quantity: 1, unitCost: 100, lotNo: '', expiryDate: '' }];
      purchaseSupplier.value = [...purchaseSupplier.options].find(o => o.value).value;
      renderPurchase();
      document.querySelector('#submitPurchase').click(); document.querySelector('#submitPurchase').click();
    });
    await waitUnlocked('#submitPurchase');
    assert.equal(state.purchases, 1, 'Purchase double click must make one request');
    assert.equal(await page.locator('#purchaseRows tr').count(), 1);
    state.purchaseFail = false;
    await page.locator('#submitPurchase').click();
    await waitUnlocked('#submitPurchase');
    assert.match(await page.locator('#purchaseMessage').textContent(), /입고가 등록되었습니다/);
    assert.match(await page.locator('#purchaseMessage').textContent(), /다시 등록하지 말고/);
    assert.equal(await page.locator('#purchaseRows tr').count(), 0);
    state.failProducts = false;
    results.push('purchase double click, failure retention, saved purchase with refresh failure');

    await page.locator('.sidebar [data-view=tasks]').click();
    await page.locator('#newTaskTitle').fill('검수용 업무');
    await page.locator('#newTaskDueDate').fill('2026-11-14');
    const assignee = await page.locator('#newTaskAssignee option').evaluateAll(os => os.find(o => o.value)?.value);
    assert.ok(assignee, 'Test account needs a selectable assignee');
    await page.locator('#newTaskAssignee').selectOption(assignee);
    await page.locator('#newTaskForm button[type=submit]').click();
    await waitUnlocked('#newTaskForm button[type=submit]');
    assert.equal(state.taskCreates, 1);
    assert.match(await page.locator('#newTaskMessage').textContent(), /업무는 저장됐지만/);
    await page.locator('#newTaskForm button[type=submit]').click();
    await waitUnlocked('#newTaskForm button[type=submit]');
    assert.equal(state.taskCreates, 1, 'Assignment retry must not recreate task');
    assert.equal(state.assignments, 2);
    assert.match(await page.locator('#newTaskMessage').textContent(), /업무를 등록했습니다/);
    results.push('task partial save retries assignment without duplicate task');

    const makeTasks = () => page.evaluate(([a, b]) => [a, b].map((id, i) => ({ id, title: `${i ? 'B' : 'A'} 업무`, status: 'todo', priority: 'normal', due_date: getLocalDate(), task_assignees: [{ user_id: currentUser.id }] })), [taskA, taskB]);
    const tasks = await makeTasks();
    await page.evaluate(async ts => { const first = showTask(ts[0]); const second = showTask(ts[1]); await Promise.all([first, second]); }, tasks);
    assert.equal(await page.locator('#taskDetailTitle').textContent(), 'B 업무');
    assert.match(await page.locator('#commentList').textContent(), /B 업무 댓글/);
    assert.doesNotMatch(await page.locator('#commentList').textContent(), /A 업무 댓글/);
    await page.locator('#taskStatus').selectOption('doing');
    await page.locator('#saveTaskStatus').click();
    await waitUnlocked('#saveTaskStatus');
    assert.match(await page.locator('#taskActionMessage').textContent(), /저장하지 못했습니다/);
    await page.locator('#commentBody').fill('실패 후 보관할 댓글');
    await page.locator('#commentForm button').click();
    await waitUnlocked('#commentForm button');
    assert.equal(await page.locator('#commentBody').inputValue(), '실패 후 보관할 댓글');
    assert.match(await page.locator('#taskActionMessage').textContent(), /입력한 내용은 보관/);
    results.push('task A/B response race, status failure feedback, comment failure draft retention');

    // Keyboard traversal must advance instead of resetting the first suggestion.
    for (const [view, input, list] of [['sales', '#saleProductSearch', '#saleProductSuggestions'], ['purchases', '#purchaseProductSearch', '#purchaseProductSuggestions']]) {
      await page.locator(`.sidebar [data-view=${view}]`).click();
      await page.locator(input).fill('ㅂ');
      await page.locator(input).press('ArrowDown');
      const first = await page.locator(input).getAttribute('aria-activedescendant');
      await page.locator(input).press('ArrowDown');
      const second = await page.locator(input).getAttribute('aria-activedescendant');
      assert.notEqual(first, second, `${input} down arrow must advance`);
      await page.locator(input).press('Escape');
      assert.equal(await page.locator(list).isVisible(), false);
    }
    await page.evaluate(() => { salePetDirectory = new Map([['검수펫 하나', 'one'], ['검수펫 둘', 'two']]); });
    await page.locator('.sidebar [data-view=sales]').click();
    await page.locator('#salePetSearch').fill('검수펫');
    await page.locator('#salePetSearch').press('ArrowDown');
    const petFirst = await page.locator('#salePetSearch').getAttribute('aria-activedescendant');
    await page.locator('#salePetSearch').press('ArrowDown');
    assert.notEqual(await page.locator('#salePetSearch').getAttribute('aria-activedescendant'), petFirst);
    await page.locator('#salePetSearch').press('Escape');
    results.push('three suggestion pickers keyboard traversal');

    state.dashboardFixture = true;
    await page.evaluate(() => loadDashboard());
    assert.equal(await page.locator('.summary-card strong').nth(0).textContent(), '0원', 'Yesterday must not appear as today sales');
    assert.equal(await page.locator('.summary-card strong').nth(1).textContent(), '0건');
    state.dashboardFixture = false;
    results.push('today dashboard excludes yesterday sale');

    let graphCases = 0;
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
        await page.locator('.sidebar [data-view=structure]').click();
        assert.equal(await page.locator('#siteTree').count(), 0);
        for (const flow of ['sale', 'purchase', 'tasks', 'legacy']) {
          await page.locator(`[data-flow=${flow}]`).click();
          const cards = await page.locator('.flow-card').count();
          for (let i = 0; i < cards; i++) {
            await page.locator('.flow-card').nth(i).click();
            const name = await page.locator('.flow-card').nth(i).locator('strong').textContent();
            assert.equal(await page.locator('#flowNodeDetail h4').textContent(), name);
          }
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
          graphCases += 1;
        }
      }
    }
    results.push(`flow graph ${graphCases} route/viewport/theme cases`);
    let forecastRequests = 0;
    await page.route('**/api.open-meteo.com/v1/forecast?**', async route => {
      forecastRequests += 1;
      await new Promise(resolve => setTimeout(resolve, 350));
      await route.fulfill({ json: { daily: { time: ['2026-11-14'], weather_code: [1], temperature_2m_mean: [12], temperature_2m_max: [15], temperature_2m_min: [8], precipitation_sum: [0] } } });
    });
    await page.evaluate(() => { weatherForecastCache = null; weatherForecastPromise = null; weatherPopLoaded = true; weatherPopPromise = null; weatherModelCache = null; environmentalWeather = []; dongPopulationDaily = []; });
    await page.locator('.sidebar [data-view=legacySales]').click();
    await page.locator('#legacySalesViewTabs [data-view=weather]').click();
    await page.locator('#legacySalesViewTabs [data-view=daily]').click();
    await page.locator('#legacySalesViewTabs [data-view=weather]').click();
    await page.waitForFunction(() => Array.isArray(weatherForecastCache));
    assert.equal(forecastRequests, 1, 'Pending weather request must be shared across tab switches');
    assert.equal(await page.evaluate(() => new Promise(resolve => setTimeout(() => resolve(true), 10))), true, 'Browser event loop must remain responsive');
    results.push('delayed forecast request with repeated tab switches');
    assert.equal(state.unexpectedWrites, 0, 'No unexpected test write may reach the server');
    assert.equal(pageErrors, 0, 'No unhandled browser errors');
    const reportDir = path.join(os.tmpdir(), 'kumin-release-review');
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, 'report.json'), JSON.stringify({ results, graphCases, unexpectedWrites: state.unexpectedWrites, pageErrors }, null, 2));
    console.log(`Release review passed: ${results.length} regression groups, ${graphCases} graph cases; all REST writes intercepted; browser exceptions 0.`);
    return results;
  } finally { await browser.close(); }
}
module.exports = { runReleaseReview };
if (require.main === module) runReleaseReview().catch(error => { console.error(error.message); process.exitCode = 1; });
