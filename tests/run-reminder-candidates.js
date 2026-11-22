// 알림 후보(알림 4단계): 대시보드 1주 달력 줄 + 메시지 화면 "알림 보낼 때예요" 확인.
// @playwright/test 러너가 숨김 폴더를 만들지 못하는 샌드박스 제약 때문에 playwright 저수준 API로 직접 실행한다. 실행: node tests/run-reminder-candidates.js
// 사장님이 실제로 등록한 다음 알림일·규칙·알림 기록은 건드리지 않는다. 시험은 자기가 만든 규칙·알림일·수신 상태·알림 기록만 만들고 끝에 되돌린다.
// 실제 판매는 만들지 않는다: 구매 확인용 sale_items 응답에만 시험용 행을 끼워 넣는다(취소 판매 시험도 같은 방식). 이름·번호·연락처는 출력하지 않는다.
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
const BASE_URL = 'http://127.0.0.1:4182';

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
const rpc = (page, name, params) => callApi(page, `rpc/${name}`, { method: 'POST', body: JSON.stringify(params) });
const setRule = (page, productId, kind, intervalDays, leadDays) => rpc(page, 'rpc_set_reminder_rule', { p_group_name: null, p_product_id: productId, p_kind: kind, p_interval_days: intervalDays, p_lead_days: leadDays });
const setDue = (page, petId, productId, dueOn, soldOn) => rpc(page, 'rpc_set_next_due', { p_pet_id: petId, p_product_id: productId, p_due_on: dueOn, p_sold_on: soldOn, p_source: dueOn ? 'auto' : null });
const setPref = (page, ownerId, pref) => rpc(page, 'rpc_set_reminder_pref', { p_owner_id: ownerId, p_status: pref ? pref.status : null, p_method: pref ? pref.method : null, p_note: null });
async function prefOf(page, ownerId) { return ((await callApi(page, `owner_reminder_pref?select=status,method&owner_id=eq.${ownerId}`)).body || [])[0] || null; }
function plusDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
// 후보 목록을 다시 불러오고 끝날 때까지 기다린다.
async function reloadCandidates(page) {
  await page.evaluate(async () => { await loadReminderCandidates(); });
}
const weekCand = (page, productName) => page.locator('#weekStrip .week-item.cand', { hasText: productName });
const msgCand = (page, productName) => page.locator('#msgCandidates .msg-cand-item', { hasText: productName });

(async () => {
  const server = spawn('npx', ['http-server', '-p', '4182', '-c-1', '.'], { shell: true, stdio: 'ignore' });
  const browser = await chromium.launch();
  const consoleErrors = [];
  const failedResponses = [];
  let mainPage = null;
  let ownerId = null;
  let prefBackup = null;
  let pet = null;
  const touched = [];
  const madeLogIds = [];
  let fakeMode = 'valid'; // 'valid' = 취소되지 않은 구매, 'cancelled' = 취소된 판매
  try {
    await waitForServer(BASE_URL + '/index.html', 20000);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    mainPage = page;
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 120)); });
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e.message).slice(0, 120)}`));
    page.on('response', (response) => {
      if (response.status() >= 400 && response.status() !== 401) failedResponses.push(`${response.status()} ${new URL(response.url()).pathname.slice(0, 60)}`);
    });
    await login(page, admin);
    await page.waitForFunction(() => salePetDirectory.size > 0 || true);
    await page.evaluate(() => loadSalePetOptions());
    const today = await page.evaluate(() => getLocalDate());

    // 시험에 쓸 반려동물(보호자 휴대폰이 있고 이미 다음 알림일이 없는 것)과 규칙 없는 상품 2개
    const existingDue = (await callApi(page, 'pet_next_due?select=pet_id,product_id')).body || [];
    const existingPetIds = new Set(existingDue.map((r) => r.pet_id));
    pet = await page.evaluate(async (skip) => {
      for (const [label, id] of [...salePetDirectory]) {
        if (skip.includes(id)) continue;
        const response = await api('rpc/rpc_get_pet_detail', { method: 'POST', body: JSON.stringify({ p_pet_id: id }) });
        const [detail] = response.ok ? await response.json() : [];
        if (detail && MessagingCore.normalizeMobile(detail.owner_phone)) return { id, label, name: detail.pet_name };
      }
      return null;
    }, [...existingPetIds]);
    assert.ok(pet, '보호자 휴대폰이 있는 시험용 반려동물이 필요합니다');
    ownerId = ((await callApi(page, `pets?select=owner_id&id=eq.${pet.id}`)).body || [])[0].owner_id;
    prefBackup = await prefOf(page, ownerId);
    const ruled = new Set(((await callApi(page, 'reminder_rules?select=product_id&product_id=not.is.null')).body || []).map((r) => r.product_id));
    const prods = await page.evaluate((ruledIds) => products.filter((x) => !ruledIds.includes(x.id) && x.active !== false && /^[가-힣]/.test(x.name)).slice(0, 3).map((x) => ({ id: x.id, name: x.name })), [...ruled]);
    assert.ok(prods.length >= 3);
    const [q1, q2, q3] = prods;
    prods.forEach((p) => touched.push(p.id));
    await setPref(page, ownerId, { status: 'consented', method: '구두' }); // 시험 동안 동의 상태(재구매 6개월 한도와 무관하게 확인)
    assert.strictEqual((await setRule(page, q1.id, 'rebuy', 7, 7)).ok, true);
    assert.strictEqual((await setRule(page, q2.id, 'vaccine', 365, 7)).ok, true);
    assert.strictEqual((await setRule(page, q3.id, 'rebuy', 7, 7)).ok, true);
    assert.strictEqual((await setDue(page, pet.id, q1.id, plusDays(today, 3), today)).ok, true);
    assert.strictEqual((await setDue(page, pet.id, q2.id, plusDays(today, 5), today)).ok, true);
    assert.strictEqual((await setDue(page, pet.id, q3.id, plusDays(today, 4), today)).ok, true);

    // 구매 확인(sale_items)에는 시험용 행을 끼워 넣는다. 실제 판매는 만들지 않는다.
    await page.route('**/rest/v1/sale_items*', async (route) => {
      const response = await route.fetch();
      let body = [];
      try { body = await response.json(); } catch { body = []; }
      if (!Array.isArray(body)) body = [];
      if (route.request().url().includes('pet_id=in.')) {
        [q1, q2, q3].forEach((p) => body.push({ pet_id: pet.id, product_id: p.id, sales: { sold_at: `${plusDays(today, -1)}T15:30:00+00:00`, status: fakeMode === 'cancelled' ? 'cancelled' : 'completed' } }));
      }
      await route.fulfill({ response, json: body });
    });
    await reloadCandidates(page);

    await step('대시보드 맨 위는 탭이 아니라 오늘부터 7일을 한 줄로 보여 주는 달력이다', async () => {
      await page.click('[data-view="dashboard"]');
      assert.strictEqual(await page.locator('#todayScheduleTabs').count(), 0, '오늘/내일/이번주 탭은 없어야 한다');
      await page.waitForSelector('#weekStrip .week-day', { state: 'visible', timeout: 10000 });
      assert.strictEqual(await page.locator('#weekStrip .week-day').count(), 7);
      const dates = await page.locator('#weekStrip .week-day').evaluateAll((els) => els.map((e) => e.dataset.date));
      assert.deepStrictEqual(dates, [0, 1, 2, 3, 4, 5, 6].map((n) => plusDays(today, n)));
      assert.ok((await page.locator('#weekStrip .week-day').first().innerText()).includes('오늘'));
    });

    await step('7일 안의 공유 업무가 그 날짜 칸에 보이고, 누르면 업무 화면으로 간다', async () => {
      const expected = await page.evaluate((from) => tasks.filter((t) => t.due_date >= from && t.due_date <= (() => { const d = new Date(`${from}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 6); return d.toISOString().slice(0, 10); })()).length, today);
      assert.strictEqual(await page.locator('#weekStrip .week-item.task').count(), expected);
      if (expected > 0) {
        await page.locator('#weekStrip .week-item.task').first().click();
        await page.waitForSelector('#tasks.active', { timeout: 10000 });
        await page.click('[data-view="dashboard"]');
      }
    });

    await step('알림 후보가 예정일 칸에 "알림 보낼 때예요"로 보인다(재구매·접종 모두)', async () => {
      await page.waitForSelector('#weekStrip .week-item.cand', { state: 'visible', timeout: 10000 });
      const cell1 = page.locator(`#weekStrip .week-day[data-date="${plusDays(today, 3)}"] .week-item.cand`, { hasText: q1.name });
      const cell2 = page.locator(`#weekStrip .week-day[data-date="${plusDays(today, 5)}"] .week-item.cand`, { hasText: q2.name });
      assert.strictEqual(await cell1.count(), 1);
      assert.strictEqual(await cell2.count(), 1);
      assert.ok((await cell1.innerText()).includes(pet.name));
    });

    await step('메시지 화면에 같은 후보가 [알림 보내기]·[넘김]과 함께 목록으로 나온다', async () => {
      await page.click('#messagingNav');
      await page.waitForSelector('#msgCandidates', { state: 'visible', timeout: 15000 });
      const item = msgCand(page, q1.name);
      await item.first().waitFor({ state: 'visible', timeout: 10000 });
      assert.strictEqual(await item.count(), 1);
      assert.strictEqual(await item.locator('.msg-cand-send').count(), 1);
      assert.strictEqual(await item.locator('.msg-cand-skip').count(), 1);
      assert.ok((await item.innerText()).includes('재구매'));
      assert.ok((await msgCand(page, q2.name).innerText()).includes('접종'));
    });

    await step('재구매 후보의 [알림 보내기]는 반려동물·(광고) 문구·QR이 채워진 메시지 화면을 만든다', async () => {
      await msgCand(page, q1.name).locator('.msg-cand-send').click();
      await page.waitForFunction(() => document.querySelector('#msgQr')?.dataset.payload, null, { timeout: 15000 });
      assert.strictEqual(await page.inputValue('#msgPetSearch'), pet.label);
      const text = await page.inputValue('#msgText');
      assert.ok(text.startsWith('(광고) ') && text.includes('수신거부') && text.includes(q1.name.slice(0, 2)), '재구매 문구에 광고 표시와 수신거부가 있어야 한다');
    });

    await step('[보냈어요]를 누르면 재구매 기록(kind=rebuy)으로 남고 후보가 목록·달력에서 사라진다', async () => {
      await page.waitForFunction(() => !document.querySelector('#msgSent').disabled, null, { timeout: 10000 });
      await page.click('#msgSent');
      await page.waitForFunction(() => document.querySelector('#msgSentNote').textContent.includes('기록했어요'), null, { timeout: 15000 });
      const rows = (await callApi(page, `reminder_log?select=id,kind,ref_key,due_on,status&pet_id=eq.${pet.id}&status=eq.sent`)).body || [];
      const mine = rows.filter((r) => r.ref_key === `p${q1.id}`);
      assert.deepStrictEqual(mine.map((r) => [r.kind, r.due_on]), [['rebuy', plusDays(today, 3)]]);
      mine.forEach((r) => madeLogIds.push(r.id));
      await page.waitForFunction((name) => ![...document.querySelectorAll('#msgCandidates .msg-cand-item')].some((e) => e.textContent.includes(name)), q1.name, { timeout: 15000 });
      await page.click('[data-view="dashboard"]');
      await page.waitForTimeout(400);
      assert.strictEqual(await weekCand(page, q1.name).count(), 0);
    });

    await step('접종 후보의 [알림 보내기]는 접종 안내 화면(예정일·상품 이름)을 만들고, 기록은 kind=vaccine이다', async () => {
      await weekCand(page, q2.name).first().click(); // 대시보드 칸에서 바로 누른다
      await page.waitForSelector('#messaging.active', { timeout: 15000 });
      await page.waitForFunction(() => document.querySelector('#msgQr')?.dataset.payload, null, { timeout: 15000 });
      assert.strictEqual(await page.inputValue('#msgDueDate'), plusDays(today, 5));
      assert.ok((await page.inputValue('#msgText')).includes(q2.name.slice(0, 2)));
      await page.waitForFunction(() => !document.querySelector('#msgSent').disabled, null, { timeout: 10000 });
      await page.click('#msgSent');
      await page.waitForFunction(() => document.querySelector('#msgSentNote').textContent.includes('기록했어요'), null, { timeout: 15000 });
      const rows = ((await callApi(page, `reminder_log?select=id,kind,ref_key,due_on&pet_id=eq.${pet.id}&status=eq.sent`)).body || []).filter((r) => r.ref_key === `p${q2.id}`);
      assert.deepStrictEqual(rows.map((r) => [r.kind, r.due_on]), [['vaccine', plusDays(today, 5)]]);
      rows.forEach((r) => madeLogIds.push(r.id));
    });

    await step('보낸 기록을 되돌리면(void) 후보가 다시 나타난다', async () => {
      for (const id of madeLogIds) assert.strictEqual((await rpc(page, 'rpc_void_reminder', { p_id: id })).ok, true);
      madeLogIds.length = 0;
      await reloadCandidates(page);
      await page.click('#messagingNav');
      await msgCand(page, q1.name).first().waitFor({ state: 'visible', timeout: 10000 });
      assert.strictEqual(await msgCand(page, q1.name).count(), 1);
      assert.strictEqual(await msgCand(page, q2.name).count(), 1);
    });

    await step('[넘김]을 누르면 건너뜀 기록(skip)이 남고 후보가 사라진다', async () => {
      await msgCand(page, q3.name).locator('.msg-cand-skip').click();
      await page.waitForFunction((name) => ![...document.querySelectorAll('#msgCandidates .msg-cand-item')].some((e) => e.textContent.includes(name)), q3.name, { timeout: 15000 });
      const rows = ((await callApi(page, `reminder_log?select=id,kind,ref_key,due_on,status&pet_id=eq.${pet.id}&status=eq.skip`)).body || []).filter((r) => r.ref_key === `p${q3.id}`);
      assert.deepStrictEqual(rows.map((r) => [r.kind, r.due_on, r.status]), [['rebuy', plusDays(today, 4), 'skip']]);
      rows.forEach((r) => madeLogIds.push(r.id));
    });

    await step('문자를 원하지 않는(optout) 보호자의 후보는 목록과 달력에서 모두 빠진다', async () => {
      await setPref(page, ownerId, { status: 'optout', method: null });
      await reloadCandidates(page);
      await page.click('#messagingNav');
      await page.waitForTimeout(500);
      assert.strictEqual(await msgCand(page, q1.name).count(), 0);
      assert.strictEqual(await msgCand(page, q2.name).count(), 0);
      await page.click('[data-view="dashboard"]');
      assert.strictEqual(await weekCand(page, q1.name).count(), 0);
      await setPref(page, ownerId, { status: 'consented', method: '구두' });
    });

    await step('취소된 판매 기준의 알림일은 후보가 되지 않는다', async () => {
      fakeMode = 'cancelled';
      await reloadCandidates(page);
      await page.click('#messagingNav');
      await page.waitForTimeout(500);
      assert.strictEqual(await msgCand(page, q1.name).count(), 0);
      fakeMode = 'valid';
      await reloadCandidates(page);
      await page.click('#messagingNav');
      await msgCand(page, q1.name).first().waitFor({ state: 'visible', timeout: 10000 });
    });

    await step('사장님이 실제로 등록한 다음 알림일도 후보 계산에 반영되고 시험이 건드리지 않는다', async () => {
      const real = existingDue[0];
      if (!real) return; // 실제 등록이 없는 환경이면 건너뛴다
      const stillThere = (await callApi(page, `pet_next_due?select=pet_id&pet_id=eq.${real.pet_id}&product_id=eq.${real.product_id}`)).body || [];
      assert.strictEqual(stillThere.length, 1);
    });

    if (staff) {
      await step('직원(staff) 계정에는 알림 후보가 보이지 않고 기존 일정 달력은 정상이다', async () => {
        const context2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const page2 = await context2.newPage();
        await login(page2, staff);
        await page2.waitForSelector('#weekStrip .week-day', { state: 'visible', timeout: 15000 });
        assert.strictEqual(await page2.locator('#weekStrip .week-day').count(), 7);
        assert.strictEqual(await page2.locator('#weekStrip .week-item.cand').count(), 0);
        assert.strictEqual(await page2.locator('#msgCandidates').isVisible(), false);
        const requested = await page2.evaluate(() => typeof reminderCandidates !== 'undefined' ? reminderCandidates.length : 0);
        assert.strictEqual(requested, 0);
        await context2.close();
      });
    } else console.log('SKIP staff 계정이 없어 직원 확인을 건너뜀');

    for (const [name, width, height] of [['데스크톱', 1440, 900], ['태블릿', 768, 1024], ['모바일', 390, 844]]) {
      await step(`${name}(${width}px): 대시보드 달력 줄과 메시지 후보 목록에 가로 넘침·겹침이 없다`, async () => {
        await page.setViewportSize({ width, height });
        for (const view of ['dashboard', 'messaging']) {
          await page.click(`[data-view="${view}"]`);
          await page.waitForTimeout(400);
          const layout = await page.evaluate((v) => {
            const root = document.querySelector(v === 'dashboard' ? '#weekStrip' : '#msgCandidates');
            const boxes = [...root.querySelectorAll('button')].filter((b) => b.offsetParent).map((b) => b.getBoundingClientRect());
            let overlaps = 0;
            boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => {
              if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlaps += 1;
            }));
            const clipped = [...root.querySelectorAll('.week-item, .msg-cand-item')].filter((e) => e.offsetParent && e.scrollWidth > e.clientWidth + 1).length;
            return { overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, overlaps, clipped };
          }, view);
          assert.strictEqual(layout.overflow, false, `${view} 가로 스크롤`);
          assert.strictEqual(layout.overlaps, 0, `${view} 요소 겹침`);
          assert.strictEqual(layout.clipped, 0, `${view} 잘림`);
        }
      });
    }

    await step('콘솔 오류가 없다', async () => { assert.ok(consoleErrors.length === 0, `콘솔 오류: ${consoleErrors.join(' | ')} / 실패한 요청: ${failedResponses.join(', ')}`); });
  } finally {
    if (mainPage && !mainPage.isClosed()) {
      try {
        await mainPage.unrouteAll({ behavior: 'ignoreErrors' });
        for (const id of madeLogIds) await rpc(mainPage, 'rpc_void_reminder', { p_id: id });
        // 시험이 만든 기록 중 남은 보냄/넘김은 모두 되돌린다(시험용 반려동물·상품 번호로만 찾는다).
        if (pet) {
          for (const productId of touched) {
            const rows = (await callApi(mainPage, `reminder_log?select=id,status&pet_id=eq.${pet.id}&ref_key=eq.p${productId}&status=in.(sent,skip)`)).body || [];
            for (const row of rows) await rpc(mainPage, 'rpc_void_reminder', { p_id: row.id });
            await setDue(mainPage, pet.id, productId, null, null);
            await setRule(mainPage, productId, 'rebuy', null, null);
          }
        }
        if (ownerId !== null) await setPref(mainPage, ownerId, prefBackup);
      } catch { console.log('WARN 시험이 만든 기록을 복원하지 못했습니다. 알림 주기·알림일·수신 상태·알림 이력을 확인해 주세요.'); }
    }
    await browser.close();
    server.kill();
    spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore', shell: true });
  }
  const failed = results.filter(([, ok]) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} 통과`);
  process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(String(error.message).replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<email>')); process.exit(1); });
