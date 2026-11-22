// 공유 업무에 반려동물 연결(알림 1단계) 확인. @playwright/test 러너가 숨김 폴더를 만들지 못하는 샌드박스 제약 때문에
// playwright 저수준 API로 직접 실행한다(tests/run-messaging-qr.js와 같은 방식). 실행: node tests/run-task-pet-link.js
// 보호자 이름·전화번호·문구는 출력하지 않는다. 시험이 만든 업무는 응답에서 번호를 모아 끝에서 그것만 삭제한다.
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
const BASE_URL = 'http://127.0.0.1:4178';

function localDate(offsetDays = 0) {
  const now = new Date(Date.now() + offsetDays * 86400000);
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
// 오늘과 다른, 같은 달 안의 날짜(달력은 이번 달만 보여 주므로 월말에도 이번 달 안에 있어야 한다)
function otherDayThisMonth() {
  const [year, month, day] = localDate(0).split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return localDate(day < lastDay ? 1 : -1);
}
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
    // 오류 안내에 계정 값이 섞일 수 있어 이메일 모양은 가린다. FULL_ERRORS=1이면 호출 기록 몇 줄을 더 보여 준다.
    const lines = String(error.message).split('\n').slice(0, process.env.FULL_ERRORS ? 10 : 1).join('\n     ');
    console.log(`FAIL ${name}\n     ${lines.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<email>')}`);
  }
}
const baseName = (label) => label.replace(/ #\d+$/, '').split(' (')[0];

const idCollectors = [];
const createdTaskIds = new Set();
async function callApi(page, apiPath, options) {
  return page.evaluate(async ([p, o]) => {
    const response = await api(p, o || {});
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    return { ok: response.ok, status: response.status, body };
  }, [apiPath, options]);
}
async function serverTask(page, id) {
  const result = await callApi(page, `action_tasks?select=id,pet_id,title,due_date,scheduled_time&id=eq.${id}`);
  return (result.body && result.body[0]) || null;
}

async function openTasks(page) {
  await page.click('.sidebar [data-view="tasks"]');
  await page.waitForSelector('#taskCalendar .task-day', { state: 'visible', timeout: 15000 });
}
async function openPetCards(page) {
  for (let i = 0; i < 40; i += 1) {
    await page.evaluate(() => { const el = document.querySelector('#newTaskPetSearch'); el.value = ''; el.blur(); });
    await page.waitForTimeout(250);
    await page.evaluate(() => document.querySelector('#newTaskPetSearch').focus());
    if (await page.locator('#newTaskPetSuggestions').isVisible() && await page.locator('#newTaskPetSuggestions .product-suggestion').count()) return;
    await page.waitForTimeout(500);
  }
  throw new Error('반려동물 카드가 나타나지 않았습니다.');
}
async function pickPetCard(page, index = 0, avoidName = '') {
  await openPetCards(page);
  const labels = await page.locator('#newTaskPetSuggestions .product-suggestion').allTextContents();
  let i = index;
  while (i < labels.length && avoidName && baseName(labels[i]) === avoidName) i += 1;
  const label = labels[i];
  await page.locator('#newTaskPetSuggestions .product-suggestion').nth(i).click();
  const petId = await page.evaluate(() => Number(document.querySelector('#newTaskPetId').value));
  return { label, petId };
}
async function createTask(page, { title, date, time, petIndex = null, avoidName = '' }) {
  let pet = null;
  if (petIndex !== null) pet = await pickPetCard(page, petIndex, avoidName);
  await page.fill('#newTaskTitle', title);
  await page.fill('#newTaskDueDate', date);
  await page.fill('#newTaskTime', time || '');
  const options = await page.locator('#newTaskAssignee option').evaluateAll((els) => els.map((e) => e.value).filter(Boolean));
  await page.selectOption('#newTaskAssignee', options[0]);
  const before = createdTaskIds.size;
  await page.evaluate(() => { const m = document.querySelector('#newTaskMessage'); if (m) m.textContent = ''; }); // 이전 등록의 안내 문구가 남아 있으면 새 등록을 기다리지 않고 지나간다
  await page.click('#newTaskForm button[type="submit"]');
  await page.waitForFunction(() => (document.querySelector('#newTaskMessage')?.textContent || '').includes('업무를 등록했습니다'), null, { timeout: 20000 });
  for (let i = 0; i < 50 && createdTaskIds.size === before; i += 1) { await Promise.all(idCollectors); await page.waitForTimeout(100); }
  assert.ok(createdTaskIds.size > before, '새로 만든 업무 번호를 응답에서 받지 못했습니다.');
  const newestId = [...createdTaskIds].pop();
  await page.waitForFunction((id) => tasks.some((t) => t.id === id), newestId, { timeout: 15000 }); // 달력 데이터가 새로 읽혀 새 업무가 들어올 때까지
  return pet;
}
async function openTask(page, id, date) {
  // 달력은 업무를 다시 읽은 뒤에야 새 업무를 그리므로, 그날 목록에 이 업무가 나타날 때까지 날짜를 다시 눌러 본다.
  const button = page.locator(`#taskDayList button[data-task-id="${id}"]`);
  for (let i = 0; i < 20; i += 1) {
    await page.evaluate((d) => [...document.querySelectorAll('#taskCalendar .task-day')].find((b) => (b.getAttribute('aria-label') || '').startsWith(d)).click(), date);
    if (await button.count()) break;
    await page.waitForTimeout(500);
  }
  await button.click({ timeout: 5000 });
  await page.waitForFunction((i) => selectedTask && selectedTask.id === i, id, { timeout: 10000 });
}

(async () => {
  const server = spawn('npx', ['http-server', '-p', '4178', '-c-1', '.'], { shell: true, stdio: 'ignore' });
  const browser = await chromium.launch();
  const consoleErrors = [];
  let mainPage = null;
  try {
    await waitForServer(BASE_URL + '/index.html', 20000);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    mainPage = page;
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 120)); });
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e.message).slice(0, 120)}`));
    page.on('response', (response) => {
      if (response.request().method() !== 'POST' || !/\/rest\/v1\/action_tasks(\?|$)/.test(response.url()) || !response.ok()) return;
      idCollectors.push((async () => {
        try { const rows = await response.json(); (rows || []).forEach((row) => createdTaskIds.add(row.id)); } catch { /* 본문 없음 */ }
      })());
    });
    await login(page, admin);
    await openTasks(page);
    await page.waitForSelector('#ownerTaskForm', { state: 'visible' });
    const today = localDate(0);
    let petA = null; let petB = null; let taskA = null; let taskB = null; let taskPlain = null;

    await step('업무 등록 폼에 반려동물 검색칸이 있고, 초성으로 찾아 카드를 누르면 번호와 제목이 채워진다', async () => {
      assert.strictEqual(await page.locator('#newTaskPetSearch').count(), 1);
      await openPetCards(page);
      const first = await page.locator('#newTaskPetSuggestions .product-suggestion').first().textContent();
      const initials = await page.evaluate((text) => getKoreanInitials(text).replace(/\s/g, '').slice(0, 2), first);
      await page.fill('#newTaskPetSearch', initials);
      await page.waitForSelector('#newTaskPetSuggestions .product-suggestion', { state: 'visible' });
      const labels = await page.locator('#newTaskPetSuggestions .product-suggestion').allTextContents();
      assert.ok(labels.length >= 1 && labels.includes(first), '초성 일부로 찾아져야 한다');
      await page.locator('#newTaskPetSuggestions .product-suggestion', { hasText: first }).first().click();
      const picked = await page.evaluate(() => ({ id: Number(document.querySelector('#newTaskPetId').value), title: document.querySelector('#newTaskTitle').value, expectedId: salePetDirectory.get(document.querySelector('#newTaskPetSearch').value) }));
      assert.ok(picked.id > 0 && picked.id === picked.expectedId, '고른 카드의 번호가 들어가야 한다');
      assert.strictEqual(picked.title.trim(), Core.plainPetLabel(first));
      assert.ok(!/#\d/.test(picked.title), '제목에 구분용 번호표가 새면 안 된다');
      await page.fill('#newTaskPetSearch', '');
      await page.fill('#newTaskTitle', '');
    });

    await step('고른 반려동물을 바꾸거나 지우면 미리 채운 제목도 따라 바뀌고, 직접 덧붙인 글자는 남는다', async () => {
      const a = await pickPetCard(page, 0);
      assert.strictEqual((await page.inputValue('#newTaskTitle')).trim(), Core.plainPetLabel(a.label));
      await page.fill('#newTaskPetSearch', '');
      assert.strictEqual(await page.inputValue('#newTaskTitle'), '', '지운 반려동물의 이름이 제목에 남으면 안 된다');
      const a2 = await pickPetCard(page, 0);
      await page.fill('#newTaskTitle', `${await page.inputValue('#newTaskTitle')}접종`);
      const b = await pickPetCard(page, 0, baseName(a2.label));
      assert.strictEqual(await page.inputValue('#newTaskTitle'), `${Core.plainPetLabel(b.label)} 접종`, '다른 반려동물을 고르면 이름만 바뀌고 덧붙인 글자는 남아야 한다');
      await page.fill('#newTaskPetSearch', '');
      assert.strictEqual(await page.inputValue('#newTaskTitle'), '접종');
      await page.fill('#newTaskTitle', '');
    });

    await step('반려동물을 고르고 등록하면 서버 업무에 pet_id가 정확히 저장된다', async () => {
      petA = await createTask(page, { title: '[시험] 연결 업무 A', date: today, time: '10:30', petIndex: 0 });
      const id = [...createdTaskIds].pop();
      taskA = id;
      const row = await serverTask(page, id);
      assert.strictEqual(row.pet_id, petA.petId);
    });

    await step('반려동물 없이도 등록되고 기존처럼 동작한다', async () => {
      await createTask(page, { title: '[시험] 연결 없는 업무', date: today, time: '' });
      taskPlain = [...createdTaskIds].pop();
      assert.strictEqual((await serverTask(page, taskPlain)).pet_id, null);
    });

    await step('업무 상세: 연결된 업무는 반려동물과 [알림 보내기]가 보이고, 연결 없는 업무는 보이지 않는다', async () => {
      await openTask(page, taskA, today);
      await page.waitForSelector('#taskDetailPet', { state: 'visible' });
      assert.ok((await page.textContent('#taskDetailPet')).includes(baseName(petA.label)));
      assert.strictEqual(await page.locator('#taskDetailNotify').isVisible(), true);
      await openTask(page, taskPlain, today);
      assert.strictEqual(await page.locator('#taskDetailPet').isVisible(), false);
      assert.strictEqual(await page.locator('#taskDetailNotify').isVisible(), false);
    });

    await step('카드를 고른 뒤 글자를 고치면 번호가 비고, 글자만 입력한 채 등록하면 막힌다', async () => {
      await pickPetCard(page, 0);
      await page.fill('#newTaskPetSearch', 'ㅋㅋㅋ');
      assert.strictEqual(await page.inputValue('#newTaskPetId'), '', '고른 뒤 글자를 고치면 이전 번호가 남으면 안 된다');
      await page.fill('#newTaskTitle', '[시험] 막혀야 하는 업무');
      await page.fill('#newTaskDueDate', today);
      const options = await page.locator('#newTaskAssignee option').evaluateAll((els) => els.map((e) => e.value).filter(Boolean));
      await page.selectOption('#newTaskAssignee', options[0]);
      const before = createdTaskIds.size;
      await page.evaluate(() => { const m = document.querySelector('#newTaskMessage'); if (m) m.textContent = ''; });
      await page.click('#newTaskForm button[type="submit"]');
      await page.waitForFunction(() => (document.querySelector('#newTaskMessage')?.textContent || '').includes('추천 목록'), null, { timeout: 5000 });
      await Promise.all(idCollectors);
      assert.strictEqual(createdTaskIds.size, before, '글자만 입력한 채로는 업무가 만들어지면 안 된다');
      await page.fill('#newTaskPetSearch', '');
      await page.fill('#newTaskTitle', '');
    });

    await step('[알림 보내기]를 누르면 메시지 화면이 열리고 그 반려동물·예약 확인·날짜·시간이 채워진다', async () => {
      await openTask(page, taskA, today);
      await page.click('#taskDetailNotify');
      await page.waitForSelector('#messaging.active', { state: 'visible', timeout: 10000 });
      await page.waitForFunction((id) => msgPetId === id && msgType === 'reservation', petA.petId, { timeout: 15000 });
      assert.strictEqual(await page.inputValue('#msgDueDate'), today);
      assert.strictEqual(await page.inputValue('#msgTime'), '10:30');
      await page.waitForFunction(() => document.querySelector('#msgText').value.includes('예약이 확인되었습니다'), null, { timeout: 10000 });
      const text = await page.inputValue('#msgText');
      assert.ok(text.includes(baseName(petA.label)));
      assert.ok(text.includes(Core.formatDueDate(today, today)) && text.includes('오전 10시 30분'));
    });

    await step('[알림 보내기]에서 반려동물이 목록에 아직 없어도(새로 만든 경우 등) 목록을 다시 읽어 찾는다', async () => {
      await page.evaluate((label) => salePetDirectory.delete(label), petA.label); // 목록에 아직 없는 반려동물 상황
      await page.click('.sidebar [data-view="tasks"]');
      await page.waitForSelector('#ownerTaskForm', { state: 'visible' });
      await openTask(page, taskA, today);
      await page.click('#taskDetailNotify');
      await page.waitForSelector('#messaging.active', { state: 'visible', timeout: 10000 });
      await page.waitForFunction((label) => salePetDirectory.has(label), petA.label, { timeout: 15000 }); // 목록을 다시 읽어 와야 한다
      await page.waitForFunction((id) => msgPetId === id && msgType === 'reservation', petA.petId, { timeout: 15000 });
    });

    await step('끝내 찾지 못하는 반려동물이면 이전에 선택돼 있던 반려동물·번호·QR이 남지 않는다', async () => {
      await page.evaluate(() => msgOpenWith({ petId: 987654321, type: 'reservation', dueDate: null, time: '' }));
      assert.strictEqual(await page.evaluate(() => msgPetId), null);
      assert.strictEqual(await page.inputValue('#msgPetSearch'), '');
      assert.strictEqual(await page.inputValue('#msgPhone'), '');
      assert.ok((await page.textContent('#msgQrHint')).includes('찾지 못했어요'));
      assert.strictEqual(await page.getAttribute('#msgQr', 'data-payload'), null);
    });

    await step('이미 다른 반려동물이 선택돼 있어도, 시간이 없는 업무여도 이 업무의 값으로 채워지고 옛 값이 남지 않는다', async () => {
      await page.click('.sidebar [data-view="tasks"]');
      await page.waitForSelector('#ownerTaskForm', { state: 'visible' });
      const tomorrow = otherDayThisMonth();
      petB = await createTask(page, { title: '[시험] 연결 업무 B', date: tomorrow, time: '', petIndex: 0, avoidName: baseName(petA.label) });
      taskB = [...createdTaskIds].pop();
      await page.waitForSelector('#taskCalendar .task-day', { state: 'visible' });
      await openTask(page, taskB, tomorrow);
      await page.click('#taskDetailNotify');
      await page.waitForSelector('#messaging.active', { state: 'visible', timeout: 10000 });
      await page.waitForFunction((id) => msgPetId === id, petB.petId, { timeout: 15000 });
      await page.waitForFunction(() => document.querySelector('#msgText').value.includes('예약이 확인되었습니다'), null, { timeout: 10000 });
      assert.strictEqual(await page.inputValue('#msgDueDate'), tomorrow);
      const text = await page.inputValue('#msgText');
      assert.ok(text.includes(baseName(petB.label)) && !text.includes(baseName(petA.label)), '이전 반려동물 이름이 남으면 안 된다');
      assert.ok(text.includes(Core.formatDueDate(tomorrow, today)) && !text.includes('오전') && !text.includes('오후'), '시간이 없는 업무는 문구에 시간이 없어야 한다');
    });

    if (staff) {
      await step('직원(staff) 계정은 업무 상세에서 반려동물은 보지만 [알림 보내기]는 보이지 않는다', async () => {
        const context2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const page2 = await context2.newPage();
        await login(page2, staff);
        await page2.click('.sidebar [data-view="tasks"]');
        await page2.waitForSelector('#taskCalendar .task-day', { state: 'visible', timeout: 15000 });
        await page2.evaluate((d) => [...document.querySelectorAll('#taskCalendar .task-day')].find((b) => (b.getAttribute('aria-label') || '').startsWith(d)).click(), today);
        await page2.locator(`#taskDayList button[data-task-id="${taskA}"]`).click();
        await page2.waitForSelector('#taskDetailPet', { state: 'visible', timeout: 10000 });
        assert.ok((await page2.textContent('#taskDetailPet')).includes(baseName(petA.label)));
        assert.strictEqual(await page2.locator('#taskDetailNotify').isVisible(), false);
        await context2.close();
      });
    } else console.log('SKIP staff 계정이 없어 직원 확인을 건너뜀');

    for (const [name, width, height] of [['데스크톱', 1440, 900], ['태블릿', 768, 1024], ['모바일', 390, 844]]) {
      await step(`${name}(${width}px): 업무 화면에 가로 넘침·겹침이 없다`, async () => {
        await page.setViewportSize({ width, height });
        await page.click('.sidebar [data-view="tasks"]');
        await page.waitForSelector('#ownerTaskForm', { state: 'visible' });
        await openTask(page, taskA, today);
        await page.waitForTimeout(300);
        const layout = await page.evaluate(() => {
          const boxes = [...document.querySelectorAll('#tasks button, #tasks input, #tasks select')].filter((b) => b.offsetParent).map((b) => b.getBoundingClientRect());
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

    await step('콘솔 오류가 없다', async () => { assert.deepStrictEqual(consoleErrors, []); });
  } finally {
    if (mainPage && !mainPage.isClosed()) {
      try {
        await Promise.all(idCollectors);
        if (createdTaskIds.size) {
          const ids = [...createdTaskIds].join(',');
          const deleted = await callApi(mainPage, `action_tasks?id=in.(${ids})`, { method: 'DELETE' });
          const left = await callApi(mainPage, `action_tasks?select=id&id=in.(${ids})`);
          if (!deleted.ok || !left.ok || (left.body || []).length) console.log(`WARN 시험이 만든 업무 ${(left.body || []).length || createdTaskIds.size}건을 지우지 못했습니다. 공유 업무에서 [시험] 업무를 확인해 주세요.`);
        }
      } catch { console.log('WARN 시험이 만든 업무를 지우지 못했습니다. 공유 업무에서 [시험] 업무를 확인해 주세요.'); }
    }
    await browser.close();
    server.kill();
    spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { shell: true, stdio: 'ignore' });
  }
  const failed = results.filter(([, ok]) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} 통과${consoleErrors.length ? ` · 콘솔 오류 ${consoleErrors.length}건` : ''}`);
  process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(error.message); process.exit(1); });
