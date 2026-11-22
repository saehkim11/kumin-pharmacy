// 판매 화면의 다음 알림일·처음 정하기·수신 동의(알림 3단계) 화면 확인.
// @playwright/test 러너가 숨김 폴더를 만들지 못하는 샌드박스 제약 때문에 playwright 저수준 API로 직접 실행한다. 실행: node tests/run-sale-next-due.js
// 실제 판매를 만들지 않는다: 판매 등록 요청(rpc/rpc_create_sale)은 가로채 가짜 번호로 응답한다.
// 시험이 만든 규칙·다음 알림일·수신 상태는 끝나기 전에 시험 전 상태로 되돌린다. 이름·번호·연락처는 출력하지 않는다.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const http = require('http');

const accountFiles = [process.env.TEST_ACCOUNTS_PATH, 'test-accounts.local.json', path.join('..', '..', 'kumin-pharmacy', 'test-accounts.local.json')].filter(Boolean);
const accountFile = accountFiles.find((file) => fs.existsSync(file));
if (!accountFile) throw new Error('테스트 계정 파일을 찾지 못했습니다. TEST_ACCOUNTS_PATH로 위치를 알려주세요.');
const accounts = JSON.parse(fs.readFileSync(accountFile, 'utf-8')).accounts;
const admin = accounts.find((a) => a.role === 'admin');
const staff = accounts.find((a) => a.role === 'staff');
const BASE_URL = 'http://127.0.0.1:4181';

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
async function productRules(page, productId) { return (await callApi(page, `reminder_rules?select=${RULE_COLUMNS}&product_id=eq.${productId}`)).body || []; }
async function setRule(page, { productId, kind = 'rebuy', intervalDays = null, leadDays = null }) {
  return callApi(page, 'rpc/rpc_set_reminder_rule', { method: 'POST', body: JSON.stringify({ p_group_name: null, p_product_id: productId, p_kind: kind, p_interval_days: intervalDays, p_lead_days: leadDays }) });
}
async function dueRow(page, petId, productId) {
  return ((await callApi(page, `pet_next_due?select=due_on,sold_on,source&pet_id=eq.${petId}&product_id=eq.${productId}`)).body || [])[0] || null;
}
async function clearDue(page, petId, productId) {
  return callApi(page, 'rpc/rpc_set_next_due', { method: 'POST', body: JSON.stringify({ p_pet_id: petId, p_product_id: productId, p_due_on: null, p_sold_on: null, p_source: null }) });
}
async function prefOf(page, ownerId) {
  return ((await callApi(page, `owner_reminder_pref?select=status,method&owner_id=eq.${ownerId}`)).body || [])[0] || null;
}
async function setPref(page, ownerId, pref) {
  return callApi(page, 'rpc/rpc_set_reminder_pref', { method: 'POST', body: JSON.stringify({ p_owner_id: ownerId, p_status: pref ? pref.status : null, p_method: pref ? pref.method : null, p_note: null }) });
}
function plusDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
// 상품·수량·가격·반려동물을 채우고 [판매 목록에 담기]를 누른다(가격은 상품 목록의 값).
async function addItem(page, product, quantity, price, petLabel) {
  await page.evaluate(([p, q, pr, label]) => {
    saleProductValue.value = p.code;
    saleProductSearch.value = p.name;
    document.querySelector('#saleQuantity').value = q;
    document.querySelector('#salePrice').value = pr;
    salePetSearch.value = label;
    document.querySelector('#addSaleItem').click();
  }, [product, quantity, price, petLabel]);
}
const dueBlock = (page, productId) => page.locator(`#saleNextDue .sale-due-item[data-product-id="${productId}"]`);

(async () => {
  const server = spawn('npx', ['http-server', '-p', '4181', '-c-1', '.'], { shell: true, stdio: 'ignore' });
  const browser = await chromium.launch();
  const consoleErrors = [];
  const failedResponses = [];
  let mainPage = null;
  let ruleBackup = [];
  let prefBackup = null;
  let ownerId = null;
  let pet = null;
  const touchedProducts = [];
  let expectedFailureUntil = 0; // 일부러 실패시킨 요청이 남기는 콘솔 오류만 허용
  try {
    await waitForServer(BASE_URL + '/index.html', 20000);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    mainPage = page;
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      if (Date.now() < expectedFailureUntil && m.text().includes('status of 500')) return;
      consoleErrors.push(m.text().slice(0, 120));
    });
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e.message).slice(0, 120)}`));
    page.on('response', (response) => {
      if (response.status() >= 400 && response.status() !== 401 && !response.url().includes('rpc/rpc_set_next_due')) failedResponses.push(`${response.status()} ${new URL(response.url()).pathname.slice(0, 60)}`);
    });
    // 실제 판매는 만들지 않는다.
    await page.route('**/rest/v1/rpc/rpc_create_sale', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '999999' }));
    await login(page, admin);
    await page.click('[data-view="sales"]');
    await page.waitForSelector('#saleDate:not([disabled])', { timeout: 20000 });
    await page.waitForFunction(() => salePetDirectory.size > 0, null, { timeout: 20000 });
    ruleBackup = (await callApi(page, `reminder_rules?select=${RULE_COLUMNS}&product_id=not.is.null`)).body || [];

    pet = await page.evaluate(() => { const [label, id] = [...salePetDirectory][0]; return { label, id }; });
    ownerId = ((await callApi(page, `pets?select=owner_id&id=eq.${pet.id}`)).body || [])[0].owner_id;
    prefBackup = await prefOf(page, ownerId);

    // 규칙이 없는 상품 4개(한글 이름)
    const ruled = new Set(ruleBackup.map((r) => r.product_id));
    const prods = await page.evaluate((ruledIds) => products.filter((x) => !ruledIds.includes(x.id) && x.active !== false && /^[가-힣]/.test(x.name)).slice(0, 4).map((x) => ({ id: x.id, code: x.code, name: x.name, price: x.sale_price })), [...ruled]);
    assert.ok(prods.length >= 4, '규칙이 없는 시험용 상품이 4개 필요합니다');
    prods.forEach((p) => touchedProducts.push(p.id));
    const [p1, p2, p3, p4] = prods;
    const today = await page.evaluate(() => saleDate.value);

    await step('반려동물을 고르지 않고 담으면 다음 알림일 영역에 아무것도 나타나지 않는다', async () => {
      await addItem(page, p1, 1, 1000, '');
      await page.waitForTimeout(300);
      assert.strictEqual(await page.locator('#saleNextDue .sale-due-item').count(), 0);
      await page.evaluate(() => { saleItems = []; renderSale(); });
    });

    await step('반려동물을 고르고 규칙이 없는 상품을 담으면 "며칠 쓰나요?" 버튼(7·14·30·60·90일)과 직접 입력, 알림 안 함이 보인다', async () => {
      await addItem(page, p1, 2, 1000, pet.label);
      const block = dueBlock(page, p1.id);
      await block.waitFor({ state: 'visible', timeout: 10000 });
      assert.ok((await block.innerText()).includes('며칠'));
      assert.deepStrictEqual(await block.locator('.sale-due-unit').evaluateAll((els) => els.map((e) => e.dataset.days)), ['7', '14', '30', '60', '90']);
      assert.strictEqual(await block.locator('.sale-due-custom').count(), 1);
      assert.strictEqual(await block.locator('.sale-due-none').count(), 1);
    });

    await step('직접 입력의 이상한 값(0·글자·3651)은 저장되지 않고 안내가 나온다', async () => {
      const block = dueBlock(page, p1.id);
      await block.locator('.sale-due-custom').click();
      for (const bad of ['0', 'abc', '3651']) {
        await block.locator('.sale-due-custom-input').fill(bad);
        await block.locator('.sale-due-custom-ok').click();
        await page.waitForTimeout(300);
        assert.strictEqual((await productRules(page, p1.id)).length, 0, bad);
        assert.ok((await block.locator('.sale-due-note').innerText()).trim().length > 0, `안내 ${bad}`);
      }
    });

    await step('[30일]을 누르면 그 상품의 규칙(재구매 30일)이 저장되고, 다음 알림일이 판매일 + 30일 × 수량으로 자동 채워진다', async () => {
      const block = dueBlock(page, p1.id);
      await block.locator('.sale-due-unit[data-days="30"]').click();
      await block.locator('.sale-due-date').waitFor({ state: 'visible', timeout: 10000 });
      const rules = await productRules(page, p1.id);
      assert.deepStrictEqual([rules.length, rules[0].kind, rules[0].interval_days], [1, 'rebuy', 30]);
      assert.strictEqual(await block.locator('.sale-due-date').inputValue(), plusDays(today, 60));
      assert.ok((await block.locator('.sale-due-text').innerText()).includes('2개 × 30일 = 60일 뒤'));
    });

    await step('같은 상품·같은 반려동물이 가격이 달라 두 줄이어도 알림일 블록은 하나이고 수량이 합산된다', async () => {
      await addItem(page, p1, 1, 1500, pet.label);
      await page.waitForTimeout(300);
      assert.strictEqual(await dueBlock(page, p1.id).count(), 1);
      assert.strictEqual(await dueBlock(page, p1.id).locator('.sale-due-date').inputValue(), plusDays(today, 90));
    });

    await step('판매일을 바꾸면 자동 계산이 따라가고, 직접 고친 날짜는 수량이 바뀌어도 유지된다', async () => {
      const earlier = plusDays(today, -3);
      await page.fill('#saleDate', earlier);
      await page.waitForTimeout(300);
      assert.strictEqual(await dueBlock(page, p1.id).locator('.sale-due-date').inputValue(), plusDays(earlier, 90));
      const manual = plusDays(earlier, 45);
      await dueBlock(page, p1.id).locator('.sale-due-date').fill(manual);
      await page.waitForTimeout(300);
      await addItem(page, p1, 1, 1500, pet.label); // 수량 합계가 4가 된다
      await page.waitForTimeout(300);
      assert.strictEqual(await dueBlock(page, p1.id).locator('.sale-due-date').inputValue(), manual);
      await page.fill('#saleDate', today);
      await page.waitForTimeout(200);
      await dueBlock(page, p1.id).locator('.sale-due-date').fill(plusDays(today, 45));
      await page.waitForTimeout(200);
    });

    await step('[알림 안 함]을 누른 상품은 저장 대상에서 빠지고, 상품을 지우면 그 블록만 사라진다', async () => {
      await addItem(page, p2, 1, 1000, pet.label);
      await dueBlock(page, p2.id).waitFor({ state: 'visible', timeout: 10000 });
      await dueBlock(page, p2.id).locator('.sale-due-none').click();
      await page.waitForTimeout(300);
      assert.ok((await dueBlock(page, p2.id).innerText()).includes('보내지 않아요'));
      assert.strictEqual(await dueBlock(page, p1.id).count(), 1);
      // p3을 담았다가 지우면 p3 블록만 사라진다
      await addItem(page, p3, 1, 1000, pet.label);
      await dueBlock(page, p3.id).waitFor({ state: 'visible', timeout: 10000 });
      const index = await page.evaluate((id) => saleItems.findIndex((item) => item.id === id), p3.id);
      await page.locator('#saleRows tr').nth(index).locator('button').click();
      await page.waitForTimeout(300);
      assert.strictEqual(await dueBlock(page, p3.id).count(), 0);
      assert.strictEqual(await dueBlock(page, p1.id).count(), 1);
    });

    await step('접종 안내 규칙 상품은 3주·4주·1년 버튼이 보이고, 누르면 그 날짜가 정해진다', async () => {
      assert.strictEqual((await setRule(page, { productId: p4.id, kind: 'vaccine', intervalDays: 365, leadDays: 7 })).ok, true);
      await page.evaluate(async () => { saleRulesLoaded = false; await ensureSaleRules(); });
      await addItem(page, p4, 1, 1000, pet.label);
      const block = dueBlock(page, p4.id);
      await block.locator('.sale-due-fixed').first().waitFor({ state: 'visible', timeout: 10000 });
      assert.deepStrictEqual(await block.locator('.sale-due-fixed').evaluateAll((els) => els.map((e) => e.dataset.days)), ['21', '28', '365']);
      assert.strictEqual(await block.locator('.sale-due-date').inputValue(), plusDays(today, 365));
      await block.locator('.sale-due-fixed[data-days="28"]').click();
      await page.waitForTimeout(300);
      assert.strictEqual(await block.locator('.sale-due-date').inputValue(), plusDays(today, 28));
    });

    await step('메시지 화면에 다녀와도 담아 둔 목록의 다음 알림일이 그대로 저장된다', async () => {
      await page.click('[data-view="messaging"]');
      await page.waitForSelector('#msgRules', { state: 'visible', timeout: 15000 });
      await page.click('[data-view="sales"]');
      await page.waitForFunction((id) => { const b = document.querySelector(`#saleNextDue .sale-due-item[data-product-id="${id}"] .sale-due-date`); return b && b.value; }, p1.id, { timeout: 10000 });
    });

    await step('판매를 등록하면 알림일이 저장되고(고친 값=직접, 접종=직접, 알림 안 함은 저장 안 함) 판매 성공 메시지가 그대로 나온다', async () => {
      await page.click('#submitSale');
      await page.waitForFunction(() => document.querySelector('#saleMessage').textContent.includes('판매가 등록되었습니다'), null, { timeout: 20000 });
      await page.waitForTimeout(800);
      const row1 = await dueRow(page, pet.id, p1.id);
      assert.deepStrictEqual(row1, { due_on: plusDays(today, 45), sold_on: today, source: 'manual' });
      const row4 = await dueRow(page, pet.id, p4.id);
      assert.deepStrictEqual(row4, { due_on: plusDays(today, 28), sold_on: today, source: 'manual' });
      assert.strictEqual(await dueRow(page, pet.id, p2.id), null);
      assert.ok(!(await page.textContent('#saleMessage')).includes('저장하지 못했어요'));
      assert.strictEqual(await page.locator('#saleNextDue .sale-due-item').count(), 0, '등록 뒤 알림일 영역은 비워진다');
    });

    await step('다음 알림일 저장이 실패해도 판매 성공 메시지는 유지되고 쉬운 안내가 덧붙는다', async () => {
      expectedFailureUntil = Date.now() + 60000;
      await page.route('**/rest/v1/rpc/rpc_set_next_due', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
      await addItem(page, p1, 1, 1000, pet.label);
      await dueBlock(page, p1.id).locator('.sale-due-date').waitFor({ state: 'visible', timeout: 10000 });
      await page.click('#submitSale');
      await page.waitForFunction(() => document.querySelector('#saleMessage').textContent.includes('저장하지 못했어요'), null, { timeout: 20000 });
      const text = await page.textContent('#saleMessage');
      assert.ok(text.includes('판매가 등록되었습니다') && text.includes('다음 알림일'));
      await page.unroute('**/rest/v1/rpc/rpc_set_next_due');
      await page.waitForTimeout(300);
      expectedFailureUntil = 0;
    });

    await step('반려동물을 고르면 수신 동의 체크가 보이고, 체크하면 서버에 저장되며 해제하면 지워진다', async () => {
      await page.evaluate(() => { saleItems = []; renderSale(); });
      await setPref(page, ownerId, null);
      await page.evaluate((label) => { salePetSearch.value = label; selectSalePet(label); }, pet.label);
      await page.waitForSelector('#saleConsent', { state: 'visible', timeout: 10000 });
      await page.waitForFunction(() => !document.querySelector('#saleConsentCheck').disabled, null, { timeout: 10000 });
      assert.strictEqual(await page.locator('#saleConsentCheck').isChecked(), false);
      await page.locator('#saleConsentCheck').check();
      await page.waitForFunction(() => document.querySelector('#saleConsentStatus').textContent.includes('안내 받기로 한 분'), null, { timeout: 10000 });
      const saved = await prefOf(page, ownerId);
      assert.deepStrictEqual([saved.status, saved.method], ['consented', '구두']);
      await page.waitForFunction(() => !document.querySelector('#saleConsentCheck').disabled, null, { timeout: 10000 });
      await page.locator('#saleConsentCheck').uncheck();
      await page.waitForFunction(() => document.querySelector('#saleConsentStatus').textContent.includes('아직 확인하지'), null, { timeout: 10000 });
      assert.strictEqual(await prefOf(page, ownerId), null);
    });

    await step('문자를 원하지 않는 보호자는 체크 칸이 잠기고 이유가 보이며, 반려동물 이름을 지우면 동의 칸이 사라진다', async () => {
      await setPref(page, ownerId, { status: 'optout', method: null });
      await page.evaluate((label) => { salePetSearch.value = ''; selectSalePet(label); }, pet.label);
      await page.waitForFunction(() => document.querySelector('#saleConsentStatus').textContent.includes('원하지 않는'), null, { timeout: 10000 });
      assert.strictEqual(await page.locator('#saleConsentCheck').isDisabled(), true);
      await page.fill('#salePetSearch', '');
      await page.waitForSelector('#saleConsent', { state: 'hidden', timeout: 10000 });
    });

    if (staff) {
      await step('직원(staff) 계정의 판매 화면에는 다음 알림일·수신 동의 영역이 나타나지 않는다', async () => {
        const context2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const page2 = await context2.newPage();
        await login(page2, staff);
        await page2.click('[data-view="sales"]');
        await page2.waitForSelector('#saleDate:not([disabled])', { timeout: 20000 });
        await page2.evaluate(() => { saleItems.push({ ...products[0], sale_price: 1000, quantity: 1, petId: 1, petLabel: '시험' }); renderSale(); salePetSearch.value = [...salePetDirectory.keys()][0] || ''; salePetSearch.dispatchEvent(new Event('input')); });
        await page2.waitForTimeout(800);
        assert.strictEqual(await page2.locator('#saleNextDue').isVisible(), false);
        assert.strictEqual(await page2.locator('#saleConsent').isVisible(), false);
        await context2.close();
      });
    } else console.log('SKIP staff 계정이 없어 직원 확인을 건너뜀');

    for (const [name, width, height] of [['데스크톱', 1440, 900], ['태블릿', 768, 1024], ['모바일', 390, 844]]) {
      await step(`${name}(${width}px): 판매 화면에 가로 넘침·겹침이 없다`, async () => {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => { saleItems = []; renderSale(); });
        await addItem(page, p3, 2, 1000, pet.label);
        await dueBlock(page, p3.id).waitFor({ state: 'visible', timeout: 10000 });
        await page.evaluate((label) => selectSalePet(label), pet.label);
        await page.waitForTimeout(500);
        const layout = await page.evaluate(() => {
          const boxes = [...document.querySelectorAll('#saleNextDue button, #saleNextDue input, #saleConsent input')].filter((b) => b.offsetParent).map((b) => b.getBoundingClientRect());
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
        await mainPage.unrouteAll({ behavior: 'ignoreErrors' });
        for (const productId of touchedProducts) {
          if (pet) await clearDue(mainPage, pet.id, productId);
          const before = ruleBackup.find((r) => r.product_id === productId);
          await setRule(mainPage, before ? { productId, kind: before.kind, intervalDays: before.interval_days, leadDays: before.lead_days } : { productId });
        }
        if (ownerId !== null) await setPref(mainPage, ownerId, prefBackup);
        const rulesNow = (await callApi(mainPage, `reminder_rules?select=${RULE_COLUMNS}&product_id=not.is.null`)).body || [];
        const same = JSON.stringify(rulesNow.map(({ id, ...rest }) => rest)) === JSON.stringify(ruleBackup.map(({ id, ...rest }) => rest));
        if (!same) console.log('WARN 알림 주기 규칙이 시험 전과 다릅니다. 설정 화면에서 확인해 주세요.');
      } catch { console.log('WARN 시험이 만든 기록을 복원하지 못했습니다. 알림 주기 설정과 보호자 수신 상태를 확인해 주세요.'); }
    }
    await browser.close();
    server.kill();
    spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore', shell: true });
  }
  const failed = results.filter(([, ok]) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} 통과`);
  process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(String(error.message).replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<email>')); process.exit(1); });
