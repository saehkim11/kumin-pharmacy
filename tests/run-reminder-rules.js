// 알림 주기 설정(알림 2단계) 화면 확인. @playwright/test 러너가 숨김 폴더를 만들지 못하는 샌드박스 제약 때문에
// playwright 저수준 API로 직접 실행한다(tests/run-task-pet-link.js와 같은 방식). 실행: node tests/run-reminder-rules.js
// 시험이 만든 규칙은 시험 전 상태로 복원한다(없던 규칙은 지우고, 있던 값은 되돌린다). 이름·번호는 출력하지 않는다.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const http = require('http');
const Core = require('../messaging-core.js');

const accountFiles = [process.env.TEST_ACCOUNTS_PATH, 'test-accounts.local.json', path.join('..', '..', 'kumin-pharmacy', 'test-accounts.local.json')].filter(Boolean);
const accountFile = accountFiles.find((file) => fs.existsSync(file));
if (!accountFile) throw new Error('테스트 계정 파일을 찾지 못했습니다. TEST_ACCOUNTS_PATH로 위치를 알려주세요.');
const accounts = JSON.parse(fs.readFileSync(accountFile, 'utf-8')).accounts;
const admin = accounts.find((a) => a.role === 'admin');
const staff = accounts.find((a) => a.role === 'staff');
const BASE_URL = 'http://127.0.0.1:4179';

function waitForServer(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      http.get(url, (res) => { res.resume(); resolve(); }).on('error', () => {
        if (Date.now() - start > timeoutMs) reject(new Error('server did not start in time'));
        else setTimeout(tryOnce, 300);
      });
    };
    tryOnce();
  });
}
async function login(page, account) {
  await page.goto(BASE_URL + '/', { waitUntil: 'networkidle' });
  for (let i = 0; i < 5 && !(await page.locator('#email').isVisible()); i += 1) {
    await page.click('#loginButton');
    await page.waitForTimeout(500);
  }
  let stage = '입력';
  try {
    await page.fill('#email', account.email, { timeout: 10000 });
    await page.fill('#password', account.password, { timeout: 10000 });
    stage = '로그인 완료 대기';
    await page.click('#loginForm button[type="submit"]');
    await page.waitForFunction(() => document.querySelector('#loginButton')?.textContent === '로그아웃', null, { timeout: 60000 });
  } catch {
    throw new Error(`로그인하지 못했습니다: ${stage} 단계(계정 값은 출력하지 않습니다).`);
  }
}
const results = [];
async function step(name, fn) {
  try { await fn(); results.push([name, true]); console.log(`PASS ${name}`); }
  catch (error) {
    results.push([name, false]);
    const lines = String(error.message).split('\n').slice(0, process.env.FULL_ERRORS ? 10 : 1).join('\n     ');
    console.log(`FAIL ${name}\n     ${lines.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<email>')}`);
  }
}

async function callApi(page, apiPath, options) {
  return page.evaluate(async ([p, o]) => {
    const response = await api(p, o || {});
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    return { ok: response.ok, status: response.status, body };
  }, [apiPath, options]);
}
const RULE_COLUMNS = 'id,group_name,product_id,kind,interval_days,lead_days';
async function allRules(page) { return (await callApi(page, `reminder_rules?select=${RULE_COLUMNS}&order=id.asc`)).body || []; }
async function groupRule(page, group) { return ((await callApi(page, `reminder_rules?select=${RULE_COLUMNS}&group_name=eq.${group}`)).body || [])[0] || null; }
async function productRules(page, productId) { return (await callApi(page, `reminder_rules?select=${RULE_COLUMNS}&product_id=eq.${productId}`)).body || []; }
async function setRule(page, { groupName = null, productId = null, kind = 'rebuy', intervalDays = null, leadDays = null }) {
  return callApi(page, 'rpc/rpc_set_reminder_rule', { method: 'POST', body: JSON.stringify({ p_group_name: groupName, p_product_id: productId, p_kind: kind, p_interval_days: intervalDays, p_lead_days: leadDays }) });
}

async function fillRow(page, group, interval, lead = '') {
  const row = page.locator(`#msgRuleCategories .msg-rule-row[data-group="${group}"]`);
  await page.waitForFunction((g) => { const b = document.querySelector(`#msgRuleCategories .msg-rule-row[data-group="${g}"] .msg-rule-save`); return b && !b.disabled; }, group, { timeout: 10000 }); // 앞선 저장·갱신이 끝나 버튼이 다시 눌릴 때까지
  await row.locator('.msg-rule-interval').fill(interval);
  await row.locator('.msg-rule-lead').fill(lead);
  return row;
}
async function saveRow(page, group, interval, lead = '') {
  const row = await fillRow(page, group, interval, lead);
  await row.locator('.msg-rule-note').evaluate((el) => { el.textContent = ''; });
  await row.locator('.msg-rule-save').click();
  return row;
}
async function pickProduct(page, productName, initials) {
  await page.fill('#msgRuleProductSearch', '');
  await page.fill('#msgRuleProductSearch', initials);
  await page.waitForSelector('#msgRuleProductSuggestions .product-suggestion', { state: 'visible', timeout: 10000 });
  await page.locator('#msgRuleProductSuggestions .product-suggestion', { hasText: productName }).first().click();
  await page.waitForSelector('#msgRuleProductForm', { state: 'visible' });
}

(async () => {
  const server = spawn('npx', ['http-server', '-p', '4179', '-c-1', '.'], { shell: true, stdio: 'ignore' });
  const browser = await chromium.launch();
  const consoleErrors = [];
  let mainPage = null;
  let backup = [];
  const touchedProducts = new Set();
  let ruleCalls = 0;
  let expectedAbortUntil = 0; // 불러오기 실패를 흉내 내는 동안(그 직후 잠깐 포함)에만 네트워크 차단 오류를 허용
  const failedResponses = []; // 실패한 요청(상태 코드와 경로만)
  try {
    await waitForServer(BASE_URL + '/index.html', 20000);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    mainPage = page;
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      if (Date.now() < expectedAbortUntil && m.text().includes('net::ERR_FAILED')) return; // 일부러 끊어 본 요청이 남기는 오류는 기대한 것
      consoleErrors.push(m.text().slice(0, 120));
    });
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e.message).slice(0, 120)}`));
    page.on('response', (response) => {
      if (response.request().method() === 'POST' && response.url().includes('rpc/rpc_set_reminder_rule')) ruleCalls += 1;
      if (response.status() >= 400 && response.status() !== 401 && !response.url().includes('rpc/rpc_set_reminder_rule')) failedResponses.push(`${response.status()} ${new URL(response.url()).pathname.slice(0, 60)}`);
    });
    await login(page, admin);
    await page.waitForSelector('#messagingNav', { state: 'visible', timeout: 15000 });
    backup = await allRules(page);
    await page.click('#messagingNav');
    await page.waitForSelector('#msgRules', { state: 'visible', timeout: 15000 });

    // 시험에 쓸 상품: 한글로 시작하는 첫 상품(초성 검색이 안정적으로 되도록)
    const product = await page.evaluate(() => { const p = products.find((x) => /^[가-힣]/.test(x.name)); return { id: p.id, name: p.name, category: p.product_categories ? p.product_categories.name : '' }; });
    const initials = await page.evaluate((name) => getKoreanInitials(name).replace(/\s/g, '').slice(0, 2), product.name);
    touchedProducts.add(product.id);

    await step('알림 주기 설정이 메시지 화면 맨 아래에 있고, 분류별 설정 구역은 없으며 판매 화면에서도 정할 수 있다는 안내가 있다', async () => {
      const order = await page.evaluate(() => {
        const last = document.querySelector('#messaging').lastElementChild;
        const history = document.querySelector('#msgHistory').getBoundingClientRect().top + window.scrollY;
        const rules = document.querySelector('#msgRules').getBoundingClientRect().top + window.scrollY;
        return { isLast: last.id === 'msgRules', below: rules > history };
      });
      assert.deepStrictEqual(order, { isLast: true, below: true });
      assert.strictEqual(await page.locator('#msgRuleCategories').count(), 0, '큰 분류별 설정은 없어야 한다');
      assert.strictEqual(await page.locator('#msgRuleAdNotice').count(), 0);
      const text = await page.locator('#msgRules').innerText();
      assert.ok(!text.includes('분류별로 정하기'));
      assert.ok(text.includes('약·상품 하나씩') && text.includes('판매 화면'));
      assert.strictEqual(await page.locator('#msgRuleProductSearch').count(), 1);
    });

    await step('약·상품 하나씩 정하기: 초성으로 찾아 접종 안내 365일을 저장하면 서버와 목록에 반영된다', async () => {
      await pickProduct(page, product.name, initials);
      assert.ok((await page.textContent('#msgRuleProductName')).includes(product.name));
      await page.click('#msgRuleKinds .msg-rule-kind[data-kind="vaccine"]');
      assert.strictEqual(await page.locator('#msgRuleProductAd').isVisible(), false, '접종 안내에는 광고 안내가 필요 없다');
      await page.fill('#msgRuleProductInterval', '365');
      await page.fill('#msgRuleProductLead', '');
      await page.click('#msgRuleProductSave');
      const item = page.locator(`#msgRuleProductList .msg-rule-item[data-product-id="${product.id}"]`);
      await item.waitFor({ state: 'visible', timeout: 10000 });
      const rules = await productRules(page, product.id);
      assert.strictEqual(rules.length, 1);
      assert.deepStrictEqual([rules[0].kind, rules[0].interval_days, rules[0].lead_days], ['vaccine', 365, 7]);
      assert.ok((await item.innerText()).includes('접종 안내 · 365일마다 · 7일 전부터 알려요'));
    });

    await step('재구매 안내를 고르면 광고 안내가 보이고, [고치기]로 값을 불러와 수정하면 한 행이 갱신된다', async () => {
      const item = page.locator(`#msgRuleProductList .msg-rule-item[data-product-id="${product.id}"]`);
      await item.locator('.msg-rule-edit').click();
      assert.strictEqual(await page.inputValue('#msgRuleProductInterval'), '365');
      await page.click('#msgRuleKinds .msg-rule-kind[data-kind="rebuy"]');
      assert.strictEqual(await page.locator('#msgRuleProductAd').isVisible(), true);
      assert.ok((await page.textContent('#msgRuleProductAd')).includes('광고'));
      await page.fill('#msgRuleProductInterval', '90');
      await page.click('#msgRuleProductSave');
      await page.waitForFunction(async (id) => ((await (await api(`reminder_rules?select=interval_days&product_id=eq.${id}`)).json())[0] || {}).interval_days === 90, product.id, { timeout: 10000 });
      const rules = await productRules(page, product.id);
      assert.strictEqual(rules.length, 1);
      assert.deepStrictEqual([rules[0].kind, rules[0].interval_days], ['rebuy', 90]);
      await page.waitForFunction((id) => (document.querySelector(`#msgRuleProductList .msg-rule-item[data-product-id="${id}"]`)?.textContent || '').includes('재구매 안내 · 1개당 90일 · 여러 개 사면 기간도 곱해요'), product.id, { timeout: 10000 });
    });

    await step('상품 입력의 이상한 값(0·글자·3651일, 며칠 전부터 366)은 저장되지 않고 쉬운 말 안내가 보이며 기존 규칙은 그대로다', async () => {
      await pickProduct(page, product.name, initials);
      for (const [interval, lead] of [['0', ''], ['abc', ''], ['3651', ''], ['90', '366']]) {
        await page.fill('#msgRuleProductInterval', interval);
        await page.fill('#msgRuleProductLead', lead);
        await page.evaluate(() => { document.querySelector('#msgRuleProductNote').textContent = ''; });
        await page.click('#msgRuleProductSave');
        await page.waitForFunction(() => document.querySelector('#msgRuleProductNote').textContent.includes('며칠'), null, { timeout: 5000 });
        const rules = await productRules(page, product.id);
        assert.deepStrictEqual([rules.length, rules[0].interval_days], [1, 90], `${interval}/${lead}`);
      }
    });

    await step('저장 버튼을 빠르게 두 번 눌러도 저장 요청은 한 번만 간다', async () => {
      const before = ruleCalls;
      await page.fill('#msgRuleProductInterval', '120');
      await page.fill('#msgRuleProductLead', '');
      await page.locator('#msgRuleProductSave').evaluate((button) => { button.click(); button.click(); });
      await page.waitForFunction(async (id) => ((await (await api(`reminder_rules?select=interval_days&product_id=eq.${id}`)).json())[0] || {}).interval_days === 120, product.id, { timeout: 10000 });
      await page.waitForTimeout(500); // 응답 개수 집계가 화면 갱신보다 늦을 수 있다
      assert.strictEqual(ruleCalls - before, 1);
      assert.strictEqual((await productRules(page, product.id)).length, 1);
    });

    await step('[지우기]는 더블클릭으로는 지워지지 않고 잠시 뒤 다시 눌러야 지워지며, 지운 뒤 알림 대상이 아니라는 안내가 보인다', async () => {
      const item = page.locator(`#msgRuleProductList .msg-rule-item[data-product-id="${product.id}"]`);
      await item.waitFor({ state: 'visible', timeout: 10000 });
      assert.ok(!(await item.innerText()).includes('분류 규칙'), '분류 규칙 안내는 더 이상 없다');
      await item.locator('.msg-rule-delete').evaluate((button) => { button.click(); button.click(); }); // 더블클릭처럼 아주 빠른 두 번
      await page.waitForTimeout(300);
      assert.strictEqual((await productRules(page, product.id)).length, 1, '한 번 눌러서는, 더블클릭으로도 지워지면 안 된다');
      await page.waitForTimeout(700);
      await item.locator('.msg-rule-delete').click();
      await page.waitForFunction((id) => !document.querySelector(`#msgRuleProductList .msg-rule-item[data-product-id="${id}"]`), product.id, { timeout: 10000 });
      assert.strictEqual((await productRules(page, product.id)).length, 0);
      assert.ok((await page.textContent('#msgRuleProductNote')).includes('알림 대상이 아니에요'));
    });

    await step('규칙을 불러오지 못하면 비어 보이지 않고 이전 목록을 그대로 두며 안내가 보인다', async () => {
      await setRule(page, { productId: product.id, kind: 'rebuy', intervalDays: 60 });
      await page.evaluate(() => msgLoadRules());
      const item = page.locator(`#msgRuleProductList .msg-rule-item[data-product-id="${product.id}"]`);
      await item.waitFor({ state: 'visible', timeout: 10000 });
      expectedAbortUntil = Date.now() + 600000;
      await page.route('**/rest/v1/reminder_rules*', (route) => route.abort());
      await page.evaluate(() => msgLoadRules());
      await page.waitForSelector('#msgRuleLoadNote', { state: 'visible', timeout: 5000 });
      assert.strictEqual(await item.count(), 1, '불러오기에 실패해도 이전 목록이 비워지면 안 된다');
      await page.unroute('**/rest/v1/reminder_rules*');
      expectedAbortUntil = Date.now() + 2000;
      await page.evaluate(() => msgLoadRules());
      await page.waitForSelector('#msgRuleLoadNote', { state: 'hidden', timeout: 10000 });
      await setRule(page, { productId: product.id });
      await page.evaluate(() => msgLoadRules());
      await page.waitForFunction((id) => !document.querySelector(`#msgRuleProductList .msg-rule-item[data-product-id="${id}"]`), product.id, { timeout: 10000 });
    });

    await step('상품을 고른 뒤 검색칸 글자를 바꾸면 이전 상품의 입력 칸이 사라져 엉뚱한 상품에 저장되지 않는다', async () => {
      await pickProduct(page, product.name, initials);
      assert.strictEqual(await page.locator('#msgRuleProductForm').isVisible(), true);
      await page.fill('#msgRuleProductSearch', `${product.name}ㅋ`);
      assert.strictEqual(await page.locator('#msgRuleProductForm').isVisible(), false);
      await page.fill('#msgRuleProductSearch', '');
    });

    await step('검색 결과가 없으면 안내가 보인다', async () => {
      await page.fill('#msgRuleProductSearch', 'ㅋㅋㅋㅋㅋㅋㅋㅋ');
      await page.waitForSelector('#msgRuleProductSuggestions .suggestion-empty', { state: 'visible', timeout: 5000 });
      await page.fill('#msgRuleProductSearch', '');
    });

    if (staff) {
      await step('직원(staff) 계정에는 설정 구역이 보이지 않고, 직접 저장을 시도해도 거부되지만 규칙은 읽을 수 있다', async () => {
        const context2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const page2 = await context2.newPage();
        await login(page2, staff);
        assert.strictEqual(await page2.locator('#msgRules').isVisible(), false);
        assert.strictEqual(await page2.locator('#messagingNav').isVisible(), false);
        const denied = await setRule(page2, { groupName: 'feed', intervalDays: 30 });
        assert.strictEqual(denied.ok, false);
        assert.strictEqual(await groupRule(page, 'feed'), null, '직원이 저장하지 못해야 한다');
        const read = await callApi(page2, 'reminder_rules?select=id');
        assert.strictEqual(read.ok, true);
        await context2.close();
      });
    } else console.log('SKIP staff 계정이 없어 직원 확인을 건너뜀');

    for (const [name, width, height] of [['데스크톱', 1440, 900], ['태블릿', 768, 1024], ['모바일', 390, 844]]) {
      await step(`${name}(${width}px): 알림 주기 설정에 가로 넘침·겹침이 없다`, async () => {
        await page.setViewportSize({ width, height });
        await pickProduct(page, product.name, initials);
        await page.waitForTimeout(300);
        const layout = await page.evaluate(() => {
          const boxes = [...document.querySelectorAll('#msgRules button, #msgRules input')].filter((b) => b.offsetParent).map((b) => b.getBoundingClientRect());
          let overlaps = 0;
          boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => {
            if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlaps += 1;
          }));
          return { overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, overlaps };
        });
        assert.strictEqual(layout.overflow, false, '가로 스크롤');
        assert.strictEqual(layout.overlaps, 0, '요소 겹침');
      });
    }

    await step('콘솔 오류가 없다', async () => { assert.ok(consoleErrors.length === 0, `콘솔 오류: ${consoleErrors.join(' | ')} / 실패한 요청: ${failedResponses.join(', ')}`); });
  } finally {
    if (mainPage && !mainPage.isClosed()) {
      try {
        await mainPage.unrouteAll({ behavior: 'ignoreErrors' }); // 시험 도중 걸어 둔 네트워크 차단이 남아 복원을 막지 않게 한다
        // 시험이 만진 키를 시험 전 상태로 되돌린다(없던 규칙은 지우고, 있던 값은 복원).
        for (const productId of touchedProducts) {
          const before = backup.find((r) => r.product_id === productId);
          await setRule(mainPage, before ? { productId, kind: before.kind, intervalDays: before.interval_days, leadDays: before.lead_days } : { productId });
        }
        const now = await allRules(mainPage);
        const same = JSON.stringify(now.map(({ id, ...rest }) => rest)) === JSON.stringify(backup.map(({ id, ...rest }) => rest));
        if (!same) console.log('WARN 알림 주기 규칙이 시험 전과 다릅니다. 설정 화면에서 확인해 주세요.');
      } catch { console.log('WARN 시험이 만든 규칙을 복원하지 못했습니다. 알림 주기 설정을 확인해 주세요.'); }
    }
    await browser.close();
    server.kill();
    spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { shell: true, stdio: 'ignore' });
  }
  const failed = results.filter(([, ok]) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} 통과${consoleErrors.length ? ` · 콘솔 오류 ${consoleErrors.length}건` : ''}`);
  process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(error.message); process.exit(1); });
