// 메시지 발송 화면(QR 문자) 확인. @playwright/test 러너가 숨김 폴더를 만들지 못하는 샌드박스 제약 때문에
// playwright 저수준 API로 직접 실행한다(tests/run-sales-pet-link.js와 같은 방식). 실행: node tests/run-messaging-qr.js
// 보호자 이름·전화번호·QR 내용은 출력하지 않는다. 결과(통과/실패)만 출력한다.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const http = require('http');
const QrCode = require('../qr-code.js');
const Core = require('../messaging-core.js');

const accountFiles = [process.env.TEST_ACCOUNTS_PATH, 'test-accounts.local.json', path.join('..', '..', 'kumin-pharmacy', 'test-accounts.local.json')].filter(Boolean);
const accountFile = accountFiles.find((file) => fs.existsSync(file));
if (!accountFile) throw new Error('테스트 계정 파일을 찾지 못했습니다. TEST_ACCOUNTS_PATH로 위치를 알려주세요.');
const accounts = JSON.parse(fs.readFileSync(accountFile, 'utf-8')).accounts;
const admin = accounts.find((a) => a.role === 'admin');
const staff = accounts.find((a) => a.role === 'staff');
const BASE_URL = 'http://127.0.0.1:4177';

function localDate(offsetDays = 0) {
  const now = new Date(Date.now() + offsetDays * 86400000);
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
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
  // 페이지 초기화가 끝나기 전에 누르면 로그인 창이 다시 닫힐 수 있어, 창이 보일 때까지 눌러 본다.
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
    await page.waitForFunction(() => document.querySelector('#loginButton')?.textContent === '로그아웃', { timeout: 60000 });
  } catch {
    throw new Error(`로그인하지 못했습니다: ${stage} 단계(계정 값은 출력하지 않습니다).`);
  }
}
const results = [];
async function step(name, fn) {
  try { await fn(); results.push([name, true]); console.log(`PASS ${name}`); }
  catch (error) { results.push([name, false]); console.log(`FAIL ${name}\n     ${String(error.message).split('\n')[0]}`); }
}
const FAKE_SPEECH = () => {
  // 기존 상품 음성 검색도 같은 객체를 쓰므로 이벤트 대상(addEventListener)을 갖춘 가짜를 쓴다.
  window.SpeechRecognition = class extends EventTarget { start() { window.__rec = this; } stop() { if (this.onend) this.onend(); } };
  window.webkitSpeechRecognition = window.SpeechRecognition;
};
const NO_SPEECH = () => {
  Object.defineProperty(window, 'SpeechRecognition', { value: undefined });
  Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined });
};
const baseName = (label) => label.replace(/ #\d+$/, '').split(' (')[0];

async function openSuggestions(page) {
  for (let i = 0; i < 40; i += 1) {
    // 검색칸에서 포커스를 뺐다가(목록 닫기 타이머 0.12초가 끝난 뒤) 다시 넣어야 목록이 새로 열린다. 이미 포커스가 있는 칸을 다시 눌러서는 열리지 않는다.
    await page.evaluate(() => { const el = document.querySelector('#msgPetSearch'); el.value = ''; el.blur(); });
    await page.waitForTimeout(250);
    await page.evaluate(() => document.querySelector('#msgPetSearch').focus());
    if (await page.locator('#msgPetSuggestions').isVisible() && await page.locator('#msgPetSuggestions .product-suggestion').count()) return;
    await page.waitForTimeout(500);
  }
  throw new Error('반려동물 목록이 나타나지 않았습니다.');
}
async function pickPetWithPhone(page) {
  const labels = await page.locator('#msgPetSuggestions .product-suggestion').allTextContents();
  for (let i = 0; i < labels.length; i += 1) {
    await openSuggestions(page);
    await page.locator('#msgPetSuggestions .product-suggestion').nth(i).click();
    try {
      await page.waitForFunction(() => document.querySelector('#msgPhone').value !== '', { timeout: 6000 });
      return labels[i];
    } catch { /* 연락처가 없는 반려동물이면 다음 카드로 */ }
  }
  throw new Error('연락처가 있는 반려동물을 찾지 못했습니다.');
}

// 이름이 다르고 연락처가 있는 반려동물을 카드에서 골라 그 라벨을 돌려준다.
async function pickDifferentPetWithPhone(page, avoidName) {
  await openSuggestions(page);
  const labels = await page.locator('#msgPetSuggestions .product-suggestion').allTextContents();
  for (let i = 0; i < labels.length; i += 1) {
    if (baseName(labels[i]) === avoidName) continue;
    await openSuggestions(page);
    try { await page.locator('#msgPetSuggestions .product-suggestion').nth(i).click({ timeout: 8000 }); } catch (error) {
      console.log('DEBUG', JSON.stringify(await page.evaluate((idx) => {
        const box = document.querySelector('#msgPetSuggestions'); const opt = box.querySelectorAll('.product-suggestion')[idx];
        const rect = opt && opt.getBoundingClientRect(); const top = rect && document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return { idx, boxHidden: box.hidden, count: box.querySelectorAll('.product-suggestion').length, rect: rect && [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)], top: top && (top.id || top.className || top.tagName), scrollY: window.scrollY, vh: window.innerHeight };
      }, i)));
      throw error;
    }
    try { await page.waitForFunction(() => document.querySelector('#msgPhone').value !== '', { timeout: 6000 }); return labels[i]; } catch { /* 연락처 없으면 다음 */ }
  }
  throw new Error('이름이 다르고 연락처가 있는 반려동물을 찾지 못했습니다.');
}

// ---- 알림 0단계(DB) 시험 도우미: 화면의 api()로 서버를 읽고 쓴다. 이름·번호·문구는 출력하지 않는다. ----
const idCollectors = []; // 응답에서 번호를 모으는 작업들(조회 전에 모두 끝나기를 기다린다)
const createdIds = new Set(); // 이 시험이 만든 reminder_log 번호(rpc_log_reminder 응답에서 모은다). 정리할 때 이것만 되돌린다.
let mainPage = null;
const prefBackup = new Map(); // ownerId -> 시험 전 수신 상태(없으면 null)

async function callApi(page, apiPath, options) {
  return page.evaluate(async ([p, o]) => {
    const response = await api(p, o || {});
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    return { ok: response.ok, status: response.status, body };
  }, [apiPath, options]);
}
async function newLogRows(page) {
  await Promise.all(idCollectors);
  if (!createdIds.size) return [];
  const result = await callApi(page, `reminder_log?select=id,pet_id,kind,ref_key,due_on,status,message_text&id=in.(${[...createdIds].join(',')})&order=id.asc`);
  return result.body || [];
}
async function serverPref(page, ownerId) {
  const result = await callApi(page, `owner_reminder_pref?select=status,status_on,method&owner_id=eq.${ownerId}`);
  return (result.body && result.body[0]) || null;
}
async function rememberPref(page, ownerId) {
  if (!prefBackup.has(ownerId)) prefBackup.set(ownerId, await serverPref(page, ownerId));
}
async function selectPetByLabel(page, label) {
  await openSuggestions(page);
  const labels = await page.locator('#msgPetSuggestions .product-suggestion').allTextContents();
  const index = labels.indexOf(label);
  if (index < 0) throw new Error('고른 반려동물이 목록 첫 8개 안에 없습니다.');
  await page.locator('#msgPetSuggestions .product-suggestion').nth(index).click();
  await page.waitForFunction(() => document.querySelector('#msgPhone').value !== '', null, { timeout: 8000 });
}
async function cleanupTestData(page) {
  for (const row of await newLogRows(page)) {
    if (row.status !== 'void') await callApi(page, 'rpc/rpc_void_reminder', { method: 'POST', body: JSON.stringify({ p_id: row.id }) });
  }
  for (const [ownerId, pref] of prefBackup) {
    await callApi(page, 'rpc/rpc_set_reminder_pref', { method: 'POST', body: JSON.stringify({ p_owner_id: ownerId, p_status: pref ? pref.status : null, p_method: pref ? pref.method : null, p_note: null }) });
  }
}

(async () => {
  const server = spawn('npx', ['http-server', '-p', '4177', '-c-1', '.'], { shell: true, stdio: 'ignore' });
  const browser = await chromium.launch();
  const consoleErrors = [];
  try {
    await waitForServer(BASE_URL + '/index.html', 20000);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(FAKE_SPEECH);
    const page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 120)); });
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e.message).slice(0, 120)}`));

    await login(page, admin);
    await page.waitForSelector('#messagingNav', { state: 'visible', timeout: 15000 });
    await page.click('#messagingNav');
    let petLabel = '';
    let currentPet = '';
    mainPage = page;
    page.on('response', (response) => {
      if (!response.url().includes('rpc/rpc_log_reminder') || !response.ok()) return;
      idCollectors.push((async () => {
        try { const id = await response.json(); if (Number.isInteger(id)) createdIds.add(id); } catch { /* 본문이 없으면 무시 */ }
      })());
    });

    await step('반려동물을 카드로 고르면 받는 번호가 자동으로 채워진다', async () => {
      await openSuggestions(page);
      petLabel = await pickPetWithPhone(page);
      assert.ok((await page.inputValue('#msgPhone')).length > 0);
    });

    await step('종류 버튼·4주 후 버튼으로 문구와 QR이 만들어진다', async () => {
      await page.click('#msgDueQuick >> text=4주 후');
      assert.strictEqual(await page.inputValue('#msgDueDate'), localDate(28));
      const text = await page.inputValue('#msgText');
      assert.ok(text.includes(baseName(petLabel)) && text.includes('종합백신'));
      const payload = await page.getAttribute('#msgQr', 'data-payload');
      assert.ok(payload && payload.startsWith('SMSTO:'));
      const dark = QrCode.encode(payload).modules.flat().filter(Boolean).length;
      assert.strictEqual(await page.locator('#msgQr svg rect').count() - 1, dark);
      assert.strictEqual(payload.split(':')[1], Core.normalizeMobile(await page.inputValue('#msgPhone')));
    });

    await step('문구가 길면 QR이 사라지고 안내가 뜨며, 줄이면 돌아온다', async () => {
      await page.fill('#msgText', '가'.repeat(80));
      assert.strictEqual(await page.getAttribute('#msgQr', 'data-payload'), null);
      assert.ok((await page.textContent('#msgQrHint')).includes('길어서'));
      await page.fill('#msgText', '가'.repeat(60));
      assert.ok(await page.getAttribute('#msgQr', 'data-payload'));
    });

    await step('받는 번호가 잘못되면 QR 대신 안내가 뜬다', async () => {
      const original = await page.inputValue('#msgPhone');
      await page.fill('#msgPhone', '02-123-4567');
      assert.strictEqual(await page.getAttribute('#msgQr', 'data-payload'), null);
      assert.ok((await page.textContent('#msgQrHint')).includes('번호'));
      assert.strictEqual(await page.locator('#msgSent').isVisible(), false, 'QR이 없으면 [폰에서 보냈어요]도 보이지 않아야 한다');
      await page.fill('#msgPhone', original);
      assert.ok(await page.getAttribute('#msgQr', 'data-payload'));
    });

    await step('지난 날짜는 경고만 보이고 QR은 유지된다', async () => {
      await page.click('#msgTypeChoices >> text=접종 안내');
      await page.fill('#msgDueDate', localDate(-1));
      await page.waitForSelector('#msgPastWarning', { state: 'visible' });
      assert.ok(await page.getAttribute('#msgQr', 'data-payload'));
      await page.fill('#msgDueDate', localDate(28));
      await page.waitForSelector('#msgPastWarning', { state: 'hidden' });
    });

    await step('예약 확인은 시간 칸이 보이고 문구에 날짜·시간이 들어간다', async () => {
      await page.click('#msgTypeChoices >> text=예약 확인');
      await page.waitForSelector('#msgTimeStep', { state: 'visible' });
      const text = await page.inputValue('#msgText');
      assert.ok(text.includes('예약이 확인되었습니다') && text.includes('오전 10시'));
      assert.ok(await page.getAttribute('#msgQr', 'data-payload'));
    });

    await step('직접 쓰기: 이름 버튼은 문구 칸에 토큰으로 들어가고 QR에는 실제 이름이 들어간다', async () => {
      await page.click('#msgTypeChoices >> text=직접 쓰기');
      await page.fill('#msgText', '');
      await page.click('#msgTokenButtons >> text=[반려견 이름]');
      assert.ok((await page.inputValue('#msgText')).includes('[반려견 이름]'));
      const payload = await page.getAttribute('#msgQr', 'data-payload');
      assert.ok(payload && payload.includes(baseName(petLabel)) && !payload.includes('[반려견 이름]'));
    });

    await step('직접 쓰기: 채워지지 않은 [날짜]가 남으면 QR을 만들지 않는다', async () => {
      await page.fill('#msgDueDate', '');
      await page.click('#msgTokenButtons >> text=[날짜]');
      assert.strictEqual(await page.getAttribute('#msgQr', 'data-payload'), null);
      assert.ok((await page.textContent('#msgQrHint')).includes('[날짜]'));
      await page.fill('#msgDueDate', localDate(21));
      assert.ok(await page.getAttribute('#msgQr', 'data-payload'));
    });

    await step('자주 쓰는 문구를 저장하면 다시 열어도 남아 있고, 지우면 사라진다', async () => {
      await page.fill('#msgText', '시험용 문구입니다');
      await page.click('#msgSavePhrase');
      assert.strictEqual(await page.locator('#msgSavedPhrases .msg-saved-item').count(), 1);
      const page2 = await context.newPage();
      await login(page2, admin);
      await page2.waitForSelector('#messagingNav', { state: 'visible', timeout: 15000 });
      await page2.click('#messagingNav');
      await page2.click('#msgTypeChoices >> text=직접 쓰기');
      assert.strictEqual(await page2.locator('#msgSavedPhrases .msg-saved-item').count(), 1);
      await page2.click('#msgSavedPhrases .msg-remove');
      assert.strictEqual(await page2.locator('#msgSavedPhrases .msg-saved-item').count(), 0);
      await page2.close();
    });

    await step('말하기 버튼: 받아 적은 말이 문구 칸에 이어 붙고 다시 누르면 멈춘다', async () => {
      await page.fill('#msgText', '안녕하세요.');
      await page.waitForSelector('#msgSpeak', { state: 'visible' });
      await page.click('#msgSpeak');
      assert.ok((await page.textContent('#msgSpeak')).includes('듣는 중'));
      await page.evaluate(() => window.__rec.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: '가짜 음성 결과' }], { isFinal: true })] }));
      assert.ok((await page.inputValue('#msgText')).includes('가짜 음성 결과'));
      await page.click('#msgSpeak');
      assert.ok((await page.textContent('#msgSpeak')).includes('말하기'));
    });

    await step('접종 안내 문구를 직접 쓰기로 바꾼 뒤 다른 반려동물을 골라도 옛 이름·날짜가 QR에 나가지 않는다', async () => {
      await page.click('#msgTypeChoices >> text=접종 안내');
      assert.ok((await page.inputValue('#msgText')).includes(baseName(petLabel)));
      await page.click('#msgTypeChoices >> text=직접 쓰기');
      const tokenized = await page.inputValue('#msgText');
      assert.ok(tokenized.includes('[반려견 이름]') && tokenized.includes('[날짜]') && !tokenized.includes(baseName(petLabel)));
      const other = await pickDifferentPetWithPhone(page, baseName(petLabel));
      currentPet = other;
      assert.strictEqual(await page.inputValue('#msgDueDate'), '', '다른 반려동물을 고르면 날짜는 다시 고르게 비워져야 합니다.');
      assert.strictEqual(await page.getAttribute('#msgQr', 'data-payload'), null);
      await page.click('#msgDueQuick >> text=4주 후');
      const payload = await page.getAttribute('#msgQr', 'data-payload');
      assert.ok(payload && payload.includes(baseName(other)) && !payload.includes(baseName(petLabel)));
    });

    await step('직접 쓴 문구에 옛 반려동물 이름이 남은 채 다른 반려동물을 고르면 QR을 만들지 않는다', async () => {
      await page.fill('#msgText', `${baseName(currentPet)} 보호자님 안녕하세요`);
      assert.ok(await page.getAttribute('#msgQr', 'data-payload'));
      const next = await pickDifferentPetWithPhone(page, baseName(currentPet));
      assert.strictEqual(await page.getAttribute('#msgQr', 'data-payload'), null);
      assert.ok((await page.textContent('#msgQrHint')).includes('이전 반려동물'));
      await page.fill('#msgText', '[반려견 이름] 보호자님 안녕하세요');
      const payload = await page.getAttribute('#msgQr', 'data-payload');
      assert.ok(payload && payload.includes(baseName(next)) && !payload.includes(baseName(currentPet)));
      currentPet = next;
    });

    await step('병원 이름은 문구 앞에, 문의 전화번호는 문구 끝에 기본으로 들어가고, 스위치로 뺄 수 있다', async () => {
      await page.click('#msgTypeChoices >> text=접종 안내');
      await page.click('#msgDueQuick >> text=3주 후');
      assert.strictEqual(await page.inputValue('#msgClinicName'), Core.CLINIC.name);
      assert.strictEqual(await page.inputValue('#msgClinicPhone'), Core.CLINIC.phone);
      assert.strictEqual(await page.locator('#msgClinicPhoneOn').isChecked(), true, '문의 전화번호는 기본으로 넣는다');
      let text = await page.inputValue('#msgText');
      assert.ok(text.startsWith(`[${Core.CLINIC.name}] `) && text.endsWith(`문의: ${Core.CLINIC.phone}`));
      await page.uncheck('#msgClinicPhoneOn');
      assert.ok(!(await page.inputValue('#msgText')).includes('문의:'));
      await page.check('#msgClinicPhoneOn');
      assert.ok((await page.inputValue('#msgText')).endsWith(`문의: ${Core.CLINIC.phone}`));
    });

    await step('병원 전화번호를 고쳐도 직접 고친 문구는 지워지지 않고, 날짜를 바꾸면 새 번호로 다시 만들어진다', async () => {
      await page.fill('#msgText', `${await page.inputValue('#msgText')} 오전에 오세요`);
      await page.fill('#msgClinicPhone', '02-111-2222');
      assert.ok((await page.inputValue('#msgText')).includes('오전에 오세요'));
      await page.click('#msgDueQuick >> text=4주 후');
      const text = await page.inputValue('#msgText');
      assert.ok(!text.includes('오전에 오세요') && text.endsWith('문의: 02-111-2222'));
    });

    await step('1년 후 버튼은 같은 월일로 계산된다', async () => {
      await page.click('#msgDueQuick >> text=1년 후');
      assert.strictEqual(await page.inputValue('#msgDueDate'), Core.addYears(localDate(0), 1));
    });

    await step('말하기 버튼은 접종 안내처럼 직접 쓰기가 아닌 종류에서도 보이고 문구 칸에 받아 적는다', async () => {
      await page.click('#msgTypeChoices >> text=접종 안내');
      await page.waitForSelector('#msgSpeak', { state: 'visible' });
      await page.click('#msgSpeak');
      await page.evaluate(() => window.__rec.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: '말로 덧붙인 문장' }], { isFinal: true })] }));
      assert.ok((await page.inputValue('#msgText')).includes('말로 덧붙인 문장'));
      await page.click('#msgSpeak');
      assert.ok((await page.textContent('#msgSpeak')).includes('말하기'));
      await page.click('#msgTypeChoices >> text=직접 쓰기');
    });

    await step('🎤 말로 찾기: 이름을 말하면 검색칸에 들어가 추천 목록이 뜨고, 다시 누르면 멈춘다', async () => {
      await page.evaluate(() => { const el = document.querySelector('#msgPetSearch'); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); el.blur(); });
      await page.waitForSelector('#msgPetSpeak', { state: 'visible' });
      await page.click('#msgPetSpeak');
      assert.ok((await page.textContent('#msgPetSpeak')).includes('듣는 중'));
      const spoken = baseName(petLabel);
      await page.evaluate((name) => window.__rec.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: `${name}.` }], { isFinal: true })] }), spoken);
      assert.strictEqual(await page.inputValue('#msgPetSearch'), spoken); // 끝의 마침표는 빠진다
      await page.waitForSelector('#msgPetSuggestions .product-suggestion', { state: 'visible', timeout: 10000 });
      assert.ok((await page.locator('#msgPetSuggestions .product-suggestion').allTextContents()).some((text) => text.includes(spoken)));
      await page.evaluate(() => window.__rec.onend && window.__rec.onend());
      assert.ok((await page.textContent('#msgPetSpeak')).includes('말로 찾기'));
      await page.locator('#msgPetSuggestions .product-suggestion', { hasText: petLabel }).first().click(); // 뒤 단계가 같은 반려동물로 이어지게 다시 고른다
      await page.waitForFunction((label) => document.querySelector('#msgPetSearch').value === label, petLabel);
    });

    await step('말하기 오류(마이크 없음)는 쉬운 말로 알려 준다', async () => {
      await page.click('#msgPetSpeak');
      await page.evaluate(() => window.__rec.onerror({ error: 'not-allowed' }));
      assert.ok((await page.textContent('#msgPetSpeakHint')).includes('마이크'));
      await page.click('#msgPetSpeak'); // 멈춤
    });

    await step('음성 인식이 없는 브라우저에서는 말하기 버튼이 보이지 않는다', async () => {
      const context2 = await browser.newContext();
      await context2.addInitScript(NO_SPEECH);
      const page3 = await context2.newPage();
      await login(page3, admin);
      await page3.waitForSelector('#messagingNav', { state: 'visible', timeout: 15000 });
      await page3.click('#messagingNav');
      await page3.click('#msgTypeChoices >> text=직접 쓰기');
      assert.strictEqual(await page3.locator('#msgSpeak').isVisible(), false);
      assert.strictEqual(await page3.locator('#msgPetSpeak').isVisible(), false);
      await context2.close();
    });

    await step('반려동물을 빠르게 바꿔도 마지막 선택의 값만 남고 옛 번호는 즉시 지워진다', async () => {
      await page.click('#msgTypeChoices >> text=진료 후 안내');
      await openSuggestions(page);
      const labels = await page.locator('#msgPetSuggestions .product-suggestion').allTextContents();
      const a = labels[0];
      const b = labels.find((label) => baseName(label) !== baseName(a));
      assert.ok(b, '이름이 서로 다른 반려동물 2마리가 필요합니다.');
      const immediate = await page.evaluate(([la, lb]) => {
        const click = (label) => [...document.querySelectorAll('#msgPetSuggestions .product-suggestion')].find((o) => o.textContent === label).click();
        click(la);
        document.querySelector('#msgPetSearch').value = '';
        document.querySelector('#msgPetSearch').dispatchEvent(new Event('focus'));
        click(lb);
        return { phone: document.querySelector('#msgPhone').value, payload: document.querySelector('#msgQr').dataset.payload || null };
      }, [a, b]);
      assert.strictEqual(immediate.phone, '');
      assert.strictEqual(immediate.payload, null);
      // 마지막으로 고른 반려동물의 정보가 도착하면 문구에 그 이름이 들어가고, 먼저 고른 쪽 이름은 남지 않아야 한다.
      await page.waitForFunction((name) => document.querySelector('#msgText').value.includes(name), baseName(b), { timeout: 10000 });
      await page.waitForTimeout(1500);
      const text = await page.inputValue('#msgText');
      assert.ok(text.includes(baseName(b)) && !text.includes(baseName(a)));
    });

    // ===== 알림 0단계: 보낸 문자 기록·수신 상태·이력 (DB 필요) =====
    let petA = null;
    let petB = null;
    let petC = null;
    let petD = null;

    await step('[폰에서 보냈어요]: 두 번 눌러도, 같은 키로 다시 불러도 기록은 1건이고 문구·종류·반려동물이 그대로 남는다', async () => {
      await page.click('#msgTypeChoices >> text=직접 쓰기');
      const label = await pickDifferentPetWithPhone(page, '');
      petA = { label, id: await page.evaluate(() => msgPetId) };
      // 앞선 단계에서 반려동물을 바꾸며 쌓인 "보냈나요?" 확인(여러 건이면 차례로 묻는 것이 정상 동작)을, 위 선택까지 반영된 뒤 모두 "안 보냈어요"로 치운다.
      while (await page.locator('#msgUnsentPrompt').isVisible()) await page.click('#msgUnsentNo');
      await page.fill('#msgText', '[시험] 기록 확인');
      await page.waitForFunction(() => document.querySelector('#msgQr').dataset.payload, null, { timeout: 10000 });
      await page.evaluate(() => { const b = document.querySelector('#msgSent'); b.click(); b.click(); });
      await page.waitForFunction(() => document.querySelector('#msgSentNote').textContent.includes('기록했어요'), null, { timeout: 10000 });
      const key = await page.evaluate(() => msgPending.clientKey);
      await callApi(page, 'rpc/rpc_log_reminder', { method: 'POST', body: JSON.stringify({ p_client_key: key, p_pet_id: petA.id, p_kind: 'manual', p_ref_key: 'custom', p_due_on: null, p_status: 'sent', p_message_text: '[시험] 기록 확인' }) });
      const rows = (await newLogRows(page)).filter((r) => r.message_text === '[시험] 기록 확인');
      assert.strictEqual(rows.length, 1);
      assert.deepStrictEqual([rows[0].kind, rows[0].ref_key, rows[0].status, rows[0].pet_id], ['manual', 'custom', 'sent', petA.id]);
      assert.strictEqual(await page.locator('#msgSent').isDisabled(), true);
    });

    await step('문구를 고쳐 QR이 바뀌면 [폰에서 보냈어요]를 다시 누를 수 있다', async () => {
      await page.fill('#msgText', '[시험] 기록 확인 2');
      assert.strictEqual(await page.locator('#msgSent').isDisabled(), false);
    });

    await step('기록하지 않고 다른 반려동물을 고르면 확인 창이 뜨고, [보냈어요]를 누르면 이전 문구가 이전 반려동물로 기록된다', async () => {
      await page.waitForTimeout(3300); // 잠깐 본 QR은 묻지 않는다(3초 이상 보여 준 문자만 확인 대상)
      const label = await pickDifferentPetWithPhone(page, baseName(petA.label));
      petB = { label, id: await page.evaluate(() => msgPetId) };
      await page.waitForSelector('#msgUnsentPrompt', { state: 'visible' });
      await page.click('#msgUnsentYes');
      await page.waitForSelector('#msgUnsentPrompt', { state: 'hidden' });
      const rows = (await newLogRows(page)).filter((r) => r.message_text === '[시험] 기록 확인 2');
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].pet_id, petA.id);
    });

    await step('[안 보냈어요]를 누르면 아무것도 기록되지 않는다', async () => {
      await page.fill('#msgText', '[시험] 안 보냄');
      await page.waitForTimeout(3300);
      await page.waitForFunction(() => document.querySelector('#msgQr').dataset.payload, null, { timeout: 10000 });
      const label = await pickDifferentPetWithPhone(page, baseName(petB.label));
      petC = { label, id: await page.evaluate(() => msgPetId) };
      await page.waitForSelector('#msgUnsentPrompt', { state: 'visible' });
      await page.click('#msgUnsentNo');
      await page.waitForSelector('#msgUnsentPrompt', { state: 'hidden' });
      assert.strictEqual((await newLogRows(page)).filter((r) => r.message_text === '[시험] 안 보냄').length, 0);
    });

    await step('"이미 보냈어요"는 같은 건(같은 반려동물·종류·날짜)일 때만 뜨고, 되돌리면 사라진다', async () => {
      await page.click('#msgTypeChoices >> text=접종 안내');
      await page.click('#msgDueQuick >> text=4주 후');
      await page.waitForFunction(() => document.querySelector('#msgQr').dataset.payload, null, { timeout: 10000 });
      assert.strictEqual(await page.locator('#msgDupHint').isVisible(), false);
      await page.click('#msgSent');
      await page.waitForFunction(() => document.querySelector('#msgSentNote').textContent.includes('기록했어요'), null, { timeout: 10000 });
      assert.strictEqual(await page.locator('#msgDupHint').isVisible(), false, '방금 기록한 직후에는 안내하지 않는다');
      await page.click('#msgDueQuick >> text=3주 후');
      assert.strictEqual(await page.locator('#msgDupHint').isVisible(), false, '날짜가 다르면 다른 건');
      await page.click('#msgDueQuick >> text=4주 후');
      await page.waitForSelector('#msgDupHint', { state: 'visible' });
      assert.ok((await page.textContent('#msgDupHint')).includes('이미 보냈어요'));
      assert.ok(await page.getAttribute('#msgQr', 'data-payload'), '안내만 하고 QR은 막지 않는다');
      const row = (await newLogRows(page)).find((r) => r.ref_key === 'vaccine' && r.pet_id === petC.id && r.status === 'sent');
      assert.ok(row);
      const card = page.locator(`#msgHistoryList .msg-history-card[data-id="${row.id}"]`);
      await card.waitFor({ state: 'visible', timeout: 10000 });
      await card.locator('.msg-history-void').click();
      await page.waitForFunction(() => document.querySelector('#msgDupHint').hidden, null, { timeout: 10000 });
      assert.strictEqual(await page.locator('#msgDupHint').isVisible(), false, '되돌린 기록은 보낸 것으로 치지 않는다');
    });

    await step('진료 후 안내처럼 날짜가 없는 종류는 오늘 이미 보낸 경우에만 "이미 보냈어요"가 뜬다', async () => {
      await page.click('#msgTypeChoices >> text=진료 후 안내');
      await page.waitForFunction(() => document.querySelector('#msgQr').dataset.payload, null, { timeout: 10000 });
      assert.strictEqual(await page.locator('#msgDupHint').isVisible(), false);
      await page.click('#msgSent');
      await page.waitForFunction(() => document.querySelector('#msgSentNote').textContent.includes('기록했어요'), null, { timeout: 10000 });
      await page.click('#msgTypeChoices >> text=예약 확인');
      await page.click('#msgTypeChoices >> text=진료 후 안내');
      await page.waitForSelector('#msgDupHint', { state: 'visible' });
    });

    await step('"보냈나요?" 확인에서 [보냈어요]를 빠르게 두 번 눌러도 처음 물은 문자만 기록되고 다음 문자는 그대로 남는다', async () => {
      await page.click('#msgTypeChoices >> text=직접 쓰기');
      const p1 = await pickDifferentPetWithPhone(page, '');
      while (await page.locator('#msgUnsentPrompt').isVisible()) await page.click('#msgUnsentNo');
      const id1 = await page.evaluate(() => msgPetId);
      await page.fill('#msgText', '[시험] 연타 확인');
      await page.waitForTimeout(3300);
      const p2 = await pickDifferentPetWithPhone(page, baseName(p1));
      await page.waitForTimeout(3300);
      await pickDifferentPetWithPhone(page, baseName(p2));
      await page.waitForSelector('#msgUnsentPrompt', { state: 'visible' });
      assert.ok((await page.textContent('#msgUnsentText')).includes('남은'), '대기 중인 확인이 더 있음을 알려야 한다');
      await page.evaluate(() => { document.querySelector('#msgUnsentYes').click(); document.querySelector('#msgUnsentYes').click(); });
      await page.waitForFunction(() => msgUnsentQueue.length === 1, null, { timeout: 10000 });
      await page.waitForTimeout(1000);
      const rows = (await newLogRows(page)).filter((r) => r.message_text === '[시험] 연타 확인');
      assert.strictEqual(rows.length, 1, '두 번째 문자는 아직 묻지 않았으므로 기록되면 안 된다');
      assert.strictEqual(rows[0].pet_id, id1);
      assert.strictEqual(await page.locator('#msgUnsentPrompt').isVisible(), true);
      await page.click('#msgUnsentNo');
      await page.waitForSelector('#msgUnsentPrompt', { state: 'hidden' });
    });

    await step('같은 반려동물을 다시 골라도 확인 창이 뜨지 않고 기록 대상이 둘로 늘지 않는다', async () => {
      const label = await pickDifferentPetWithPhone(page, '');
      while (await page.locator('#msgUnsentPrompt').isVisible()) await page.click('#msgUnsentNo');
      await page.fill('#msgText', '[시험] 다시 선택');
      await page.waitForTimeout(3300);
      await selectPetByLabel(page, label);
      assert.strictEqual(await page.locator('#msgUnsentPrompt').isVisible(), false);
      await page.click('#msgSent');
      await page.waitForFunction(() => document.querySelector('#msgSentNote').textContent.includes('기록했어요'), null, { timeout: 10000 });
      await selectPetByLabel(page, label);
      assert.strictEqual(await page.locator('#msgUnsentPrompt').isVisible(), false);
      assert.strictEqual(await page.locator('#msgSent').isDisabled(), true);
      assert.strictEqual((await newLogRows(page)).filter((r) => r.message_text === '[시험] 다시 선택').length, 1);
    });

    await step('받는 번호를 바꾸면 다른 문자로 보고 다시 기록할 수 있다', async () => {
      await page.fill('#msgText', '[시험] 번호 변경');
      await page.click('#msgSent');
      await page.waitForFunction(() => document.querySelector('#msgSentNote').textContent.includes('기록했어요'), null, { timeout: 10000 });
      assert.strictEqual(await page.locator('#msgSent').isDisabled(), true);
      await page.fill('#msgPhone', '010-0000-0000');
      assert.strictEqual(await page.locator('#msgSent').isDisabled(), false);
    });

    await step('둘러보기만 하면 "보냈나요?"가 쌓이지 않는다(잠깐 본 QR은 묻지 않음)', async () => {
      await page.fill('#msgText', '[시험] 둘러보기');
      let avoid = '';
      const first = await pickDifferentPetWithPhone(page, avoid);
      avoid = baseName(first);
      while (await page.locator('#msgUnsentPrompt').isVisible()) await page.click('#msgUnsentNo');
      for (let i = 0; i < 2; i += 1) {
        const label = await pickDifferentPetWithPhone(page, avoid);
        avoid = baseName(label);
        assert.strictEqual(await page.locator('#msgUnsentPrompt').isVisible(), false, '잠깐 본 QR에 대해 묻지 않아야 한다');
      }
    });

    await step('되돌린 기록이 지금 화면의 QR이면 [폰에서 보냈어요]를 다시 누를 수 있다', async () => {
      await page.fill('#msgText', '[시험] 되돌리고 다시');
      await page.click('#msgSent');
      await page.waitForFunction(() => document.querySelector('#msgSentNote').textContent.includes('기록했어요'), null, { timeout: 10000 });
      const row = (await newLogRows(page)).find((r) => r.message_text === '[시험] 되돌리고 다시');
      const card = page.locator(`#msgHistoryList .msg-history-card[data-id="${row.id}"]`);
      await card.waitFor({ state: 'visible', timeout: 10000 });
      await card.locator('.msg-history-void').click();
      await page.waitForFunction(() => !document.querySelector('#msgSent').disabled, null, { timeout: 10000 });
      assert.ok(!(await page.textContent('#msgSentNote')).includes('기록했어요'));
      await page.click('#msgSent');
      await page.waitForFunction(() => document.querySelector('#msgSentNote').textContent.includes('기록했어요'), null, { timeout: 10000 });
      const rows = (await newLogRows(page)).filter((r) => r.message_text === '[시험] 되돌리고 다시');
      assert.deepStrictEqual(rows.map((r) => r.status).sort(), ['sent', 'void']);
    });

    await step('안내 수신 상태: 보기·동의·거부·표시 지우기가 되고 서버 값과 같다', async () => {
      const label = await pickDifferentPetWithPhone(page, baseName(petC.label));
      petD = { label, id: await page.evaluate(() => msgPetId) };
      if (await page.locator('#msgUnsentPrompt').isVisible()) await page.click('#msgUnsentNo');
      await page.waitForSelector('#msgPref', { state: 'visible' });
      await page.waitForFunction(() => msgOwnerId !== null);
      const ownerId = await page.evaluate(() => msgOwnerId);
      await rememberPref(page, ownerId);
      await page.click('#msgPrefConsent');
      await page.waitForFunction(() => document.querySelector('#msgPrefStatus').textContent.includes('안내 받기로 한 분'));
      assert.strictEqual((await serverPref(page, ownerId))?.status, 'consented');
      await page.click('#msgTypeChoices >> text=접종 안내');
      await page.click('#msgDueQuick >> text=4주 후');
      await page.click('#msgPrefOptout');
      await page.waitForSelector('#msgPrefWarning', { state: 'visible' });
      assert.strictEqual((await serverPref(page, ownerId))?.status, 'optout');
      assert.ok(await page.getAttribute('#msgQr', 'data-payload'), '거부 상태여도 QR은 막지 않고 경고만 한다');
      await page.click('#msgPrefConsent');
      await page.waitForSelector('#msgPrefConfirm', { state: 'visible' });
      await page.click('#msgPrefConfirmNo');
      assert.strictEqual(await page.locator('#msgPrefWarning').isVisible(), true);
      assert.strictEqual((await serverPref(page, ownerId))?.status, 'optout');
      await page.click('#msgPrefClear');
      await page.waitForSelector('#msgPrefConfirm', { state: 'visible' }); // 거부 표시를 지울 때는 확인을 거친다
      await page.click('#msgPrefConfirmYes');
      await page.waitForFunction(() => document.querySelector('#msgPrefStatus').textContent.includes('아직 확인하지 않았어요'));
      assert.strictEqual(await serverPref(page, ownerId), null);
      assert.strictEqual(await page.locator('#msgPrefWarning').isVisible(), false);
    });

    await step('다른 보호자로 바꾸면 거부 경고가 즉시 사라지고, 빠르게 두 번 바꿔도 마지막 보호자의 상태만 보인다', async () => {
      const ownerA = await page.evaluate(() => msgOwnerId);
      await page.click('#msgPrefOptout');
      await page.waitForSelector('#msgPrefWarning', { state: 'visible' });
      await openSuggestions(page);
      const labels = await page.locator('#msgPetSuggestions .product-suggestion').allTextContents();
      const others = labels.filter((l) => baseName(l) !== baseName(petD.label));
      assert.ok(others.length >= 2, '서로 다른 반려동물 2마리가 더 필요합니다.');
      const immediate = await page.evaluate(([b, c]) => {
        const click = (label) => [...document.querySelectorAll('#msgPetSuggestions .product-suggestion')].find((o) => o.textContent === label).click();
        click(b);
        const afterFirst = document.querySelector('#msgPrefWarning').hidden;
        document.querySelector('#msgPetSearch').value = '';
        document.querySelector('#msgPetSearch').dispatchEvent(new Event('focus'));
        click(c);
        return { afterFirst, afterSecond: document.querySelector('#msgPrefWarning').hidden };
      }, [others[0], others[1]]);
      assert.strictEqual(immediate.afterFirst, true);
      assert.strictEqual(immediate.afterSecond, true);
      await page.waitForFunction(() => msgOwnerId !== null && document.querySelector('#msgPhone').value !== '', null, { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const ownerC = await page.evaluate(() => msgOwnerId);
      if (ownerC !== null) {
        const expected = Core.prefLabel(await serverPref(page, ownerC));
        assert.strictEqual((await page.textContent('#msgPrefStatus')).trim(), expected);
      }
      assert.notStrictEqual(ownerC, ownerA);
      await callApi(page, 'rpc/rpc_set_reminder_pref', { method: 'POST', body: JSON.stringify({ p_owner_id: ownerA, p_status: null, p_method: null, p_note: null }) });
    });

    await step('알림 이력: 화면 아래쪽(알림 주기 설정 바로 앞)에 있고 기본 기간·상태가 눌려 있으며 카드에 시각·종류·상태가 보이고 연락처는 보이지 않는다', async () => {
      await page.waitForSelector('#msgHistory', { state: 'visible' });
      const order = await page.evaluate(() => {
        const history = document.querySelector('#msgHistory').getBoundingClientRect().top + window.scrollY;
        const qr = document.querySelector('#msgQr').getBoundingClientRect().bottom + window.scrollY;
        const lastChild = document.querySelector('#messaging').lastElementChild;
        return { below: history > qr, isLast: lastChild.id === 'msgRules' && lastChild.previousElementSibling.id === 'msgHistory' }; // 이력 바로 뒤가 맨 아래의 알림 주기 설정
      });
      assert.deepStrictEqual(order, { below: true, isLast: true });
      assert.strictEqual(await page.getAttribute('#msgHistoryRange .msg-choice[data-range="30d"]', 'aria-pressed'), 'true');
      assert.strictEqual(await page.getAttribute('#msgHistoryStatus .msg-choice[data-status="sent"]', 'aria-pressed'), 'true');
      const mine = (await newLogRows(page)).filter((r) => r.message_text === '[시험] 기록 확인 2');
      assert.strictEqual(mine.length, 1);
      const card = page.locator(`#msgHistoryList .msg-history-card[data-id="${mine[0].id}"]`);
      await card.waitFor({ state: 'visible', timeout: 10000 });
      const cardText = await card.innerText();
      assert.ok(/\d{2}:\d{2}/.test(cardText) && cardText.includes('직접 쓴 문구') && cardText.includes('보냈어요'));
      const listText = await page.locator('#msgHistory').innerText();
      assert.ok(!/01[016789][-\s]?\d{3,4}[-\s]?\d{4}/.test(listText), '이력에 휴대전화 번호가 보임');
    });

    await step('[문구 보기]로 보낸 문구를 펼치고 접을 수 있다', async () => {
      const mine = (await newLogRows(page)).find((r) => r.message_text === '[시험] 기록 확인 2');
      const card = page.locator(`#msgHistoryList .msg-history-card[data-id="${mine.id}"]`);
      const toggle = card.locator('.msg-history-toggle');
      assert.strictEqual(await toggle.getAttribute('aria-expanded'), 'false');
      await toggle.click();
      assert.strictEqual(await toggle.getAttribute('aria-expanded'), 'true');
      assert.strictEqual((await card.locator('.msg-history-text').textContent()).trim(), '[시험] 기록 확인 2');
      assert.strictEqual(await card.locator('.msg-history-text').isVisible(), true);
      await toggle.click();
      assert.strictEqual(await card.locator('.msg-history-text').isVisible(), false);
    });

    await step('[되돌리기]: 카드가 "되돌림"(흐림)이 되고 "보낸 문자"에서는 빠지며 "되돌린 것까지"에서는 남는다', async () => {
      const mine = (await newLogRows(page)).find((r) => r.message_text === '[시험] 기록 확인 2');
      const card = () => page.locator(`#msgHistoryList .msg-history-card[data-id="${mine.id}"]`);
      await page.click('#msgHistoryStatus .msg-choice[data-status="all"]'); // 되돌린 것까지 보이게 해 두고 되돌린다
      await card().locator('.msg-history-void').click();
      await page.waitForFunction((id) => document.querySelector(`#msgHistoryList .msg-history-card[data-id="${id}"]`)?.dataset.status === 'void', mine.id, { timeout: 10000 });
      assert.ok((await card().innerText()).includes('되돌림'));
      await page.click('#msgHistoryStatus .msg-choice[data-status="sent"]');
      assert.strictEqual(await card().count(), 0);
      await page.click('#msgHistoryStatus .msg-choice[data-status="all"]');
      assert.strictEqual(await card().count(), 1);
      await page.click('#msgHistoryStatus .msg-choice[data-status="sent"]');
    });

    await step('기간 버튼은 하나만 눌리고, 반려동물 이름으로 찾으면 해당 카드만 남으며, 없으면 안내가 뜬다', async () => {
      for (const range of ['today', '7d', '30d', 'all']) {
        await page.click(`#msgHistoryRange .msg-choice[data-range="${range}"]`);
        const pressed = await page.locator('#msgHistoryRange .msg-choice[aria-pressed="true"]').count();
        assert.strictEqual(pressed, 1);
      }
      await page.click('#msgHistoryRange .msg-choice[data-range="30d"]');
      await page.fill('#msgHistorySearch', baseName(petA.label));
      const names = await page.locator('#msgHistoryList .msg-history-card').allInnerTexts();
      assert.ok(names.length >= 1 && names.every((t) => t.includes(baseName(petA.label))));
      await page.fill('#msgHistorySearch', 'ㅋㅋㅋㅋㅋㅋ');
      assert.strictEqual(await page.locator('#msgHistoryList .msg-history-card').count(), 0);
      assert.strictEqual(await page.locator('#msgHistoryEmpty').isVisible(), true);
      await page.fill('#msgHistorySearch', '');
    });

    await step('이력 맨 위 요약과 쉬운 상태 이름·설명이 보이고, 보는 방법은 기본이 "날짜별"이다', async () => {
      const summary = await page.textContent('#msgHistorySummary');
      assert.ok(summary.includes('오늘') && summary.includes('이번 달') && summary.includes('건'));
      assert.deepStrictEqual((await page.locator('#msgHistoryStatus .msg-choice').allTextContents()).map((t) => t.trim()), ['보낸 문자', '되돌린 것까지']);
      assert.ok((await page.textContent('#msgHistoryStatusHelp')).includes('폰에서 보냈어요'));
      assert.deepStrictEqual((await page.locator('#msgHistoryView .msg-choice').allTextContents()).map((t) => t.trim()), ['날짜별', '보호자·반려동물별']);
      assert.strictEqual(await page.getAttribute('#msgHistoryView .msg-choice[data-view="date"]', 'aria-pressed'), 'true');
      assert.ok((await page.locator('#msgHistoryList .msg-history-date').first().innerText()).includes('건'), '날짜 머리글에 그날 건수가 보인다');
    });

    await step('보호자·반려동물별 보기: 보호자마다 한 묶음으로 반려동물별 건수·마지막 날짜가 보이고 펼치면 문자가 나온다', async () => {
      await page.click('#msgHistoryView .msg-choice[data-view="owner"]');
      await page.waitForSelector('#msgHistoryList .msg-owner-card', { state: 'visible', timeout: 10000 });
      assert.strictEqual(await page.getAttribute('#msgHistoryView .msg-choice[data-view="owner"]', 'aria-pressed'), 'true');
      const first = page.locator('#msgHistoryList .msg-owner-card').first();
      const summaryText = await first.locator('summary').innerText();
      assert.ok(summaryText.includes('보낸 문자') && summaryText.includes('건') && summaryText.includes('마지막'));
      assert.strictEqual(await first.evaluate((el) => el.open), true, '첫 보호자는 펼쳐져 있다');
      assert.ok(await first.locator('.msg-history-card').count() >= 1);
      assert.ok(!/01[016789][-\s]?\d{3,4}[-\s]?\d{4}/.test(await page.locator('#msgHistory').innerText()), '이력에 휴대전화 번호가 보임');
      const mine = (await newLogRows(page)).find((r) => r.status === 'sent');
      assert.ok(await page.locator(`#msgHistoryList .msg-owner-card .msg-history-card[data-id="${mine.id}"]`).count() === 1);
      const petName = baseName(petA.label);
      await page.fill('#msgHistorySearch', petName);
      const texts = await page.locator('#msgHistoryList .msg-history-card').allInnerTexts();
      assert.ok(texts.length >= 1 && texts.every((t) => t.includes(petName)));
      await page.fill('#msgHistorySearch', '');
      await page.click('#msgHistoryView .msg-choice[data-view="date"]');
      await page.waitForSelector('#msgHistoryList .msg-history-date', { state: 'visible' });
    });

    await step('수신 상태 목록: 동의한 보호자가 보이고 [지우기]로 사라진다', async () => {
      const ownerId = await page.evaluate(() => msgOwnerId);
      assert.ok(ownerId !== null);
      await rememberPref(page, ownerId);
      await page.click('#msgPrefConsent');
      const row = page.locator(`#msgPrefList .msg-pref-row[data-owner-id="${ownerId}"]`);
      await row.waitFor({ state: 'visible', timeout: 10000 });
      await row.locator('.msg-pref-row-clear').click();
      await page.waitForFunction((id) => !document.querySelector(`#msgPrefList .msg-pref-row[data-owner-id="${id}"]`), ownerId, { timeout: 10000 });
      assert.strictEqual(await serverPref(page, ownerId), null);
    });

    await step('수신거부 표시는 한 번 눌러서는 지워지지 않는다(확인을 거친다)', async () => {
      const ownerId = await page.evaluate(() => msgOwnerId);
      assert.ok(ownerId !== null);
      await rememberPref(page, ownerId);
      await page.click('#msgPrefOptout');
      await page.waitForSelector('#msgPrefWarning', { state: 'visible' });
      await page.click('#msgPrefClear');
      await page.waitForSelector('#msgPrefConfirm', { state: 'visible' });
      assert.strictEqual((await serverPref(page, ownerId))?.status, 'optout');
      await page.click('#msgPrefConfirmNo');
      assert.strictEqual((await serverPref(page, ownerId))?.status, 'optout');
      const row = page.locator(`#msgPrefList .msg-pref-row[data-owner-id="${ownerId}"]`);
      await row.waitFor({ state: 'visible', timeout: 10000 });
      await row.locator('.msg-pref-row-clear').click();
      assert.strictEqual(await row.count(), 1, '목록에서도 한 번 눌러서는 지워지지 않아야 한다');
      assert.strictEqual((await serverPref(page, ownerId))?.status, 'optout');
      await row.locator('.msg-pref-row-clear').click();
      await page.waitForFunction((id) => !document.querySelector(`#msgPrefList .msg-pref-row[data-owner-id="${id}"]`), ownerId, { timeout: 10000 });
      assert.strictEqual(await serverPref(page, ownerId), null);
    });

    for (const [name, width, height] of [['데스크톱', 1440, 900], ['태블릿', 768, 1024], ['모바일', 390, 844]]) {
      await step(`${name}(${width}px): 가로 넘침·겹침이 없다`, async () => {
        await page.setViewportSize({ width, height });
        await page.click('#msgTypeChoices >> text=접종 안내');
        await page.waitForTimeout(300);
        const layout = await page.evaluate(() => {
          const boxes = [...document.querySelectorAll('#messaging button')].filter((b) => b.offsetParent).map((b) => b.getBoundingClientRect());
          let overlaps = 0;
          boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => {
            if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlaps += 1;
          }));
          const qr = document.querySelector('#msgQr svg')?.getBoundingClientRect();
          return { overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, overlaps, qrFits: !qr || (qr.right <= window.innerWidth && qr.left >= 0) };
        });
        assert.strictEqual(layout.overflow, false, '가로 스크롤');
        assert.strictEqual(layout.overlaps, 0, '버튼 겹침');
        assert.strictEqual(layout.qrFits, true, 'QR이 화면 밖으로 나감');
      });
    }

    await step('콘솔 오류가 없다', async () => { assert.deepStrictEqual(consoleErrors, []); });

    if (staff) {
      await step('직원(staff) 계정에는 메시지 발송 메뉴가 보이지 않는다', async () => {
        const context3 = await browser.newContext();
        const page4 = await context3.newPage();
        await login(page4, staff);
        await page4.waitForTimeout(1500);
        assert.strictEqual(await page4.locator('#messagingNav').isVisible(), false);
        await context3.close();
      });
    } else console.log('SKIP staff 계정이 없어 메뉴 숨김 확인을 건너뜀');
  } finally {
    if (mainPage && !mainPage.isClosed()) { try { await cleanupTestData(mainPage); } catch { console.log('WARN 시험 데이터 정리에 실패했습니다. 이력에서 [시험] 문구를 확인해 주세요.'); } }
    await browser.close();
    server.kill();
    spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { shell: true, stdio: 'ignore' });
  }
  const failed = results.filter(([, ok]) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} 통과${consoleErrors.length ? ` · 콘솔 오류 ${consoleErrors.length}건` : ''}`);
  process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(error.message); process.exit(1); });
