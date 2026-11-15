// Customer complaints: selecting B must keep B's details; failed history is not an empty history.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

async function runPetComplaintReview() {
  let accounts;
  const accountsFile = process.env.TEST_ACCOUNTS_FILE || path.join(process.cwd(), 'test-accounts.local.json');
  const baseUrl = process.env.TEST_BASE_URL || 'http://127.0.0.1:4173';
  try { accounts = JSON.parse(fs.readFileSync(accountsFile, 'utf8')).accounts; }
  catch { throw new Error('Test accounts unavailable (contents omitted).'); }
  const browser = await chromium.launch();
  const A = '00000000-0000-0000-0000-0000000000a1';
  const B = '00000000-0000-0000-0000-0000000000b2';
  try {
    for (const role of ['admin', 'staff']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Seoul' });
      let pageErrors = 0;
      let blockedWrites = 0;
      let historyFailure = false;
      let emptyHistory = false;
      let detailFailureA = false;
      let visitFailure = false;
      page.on('pageerror', () => { pageErrors += 1; });
      await page.route('**/rest/v1/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        const resource = url.pathname.split('/').at(-1);
        if (resource === 'rpc_get_pet_detail') {
          const id = request.postDataJSON().p_pet_id;
          await new Promise(resolve => setTimeout(resolve, id === A ? 750 : 30));
          if (detailFailureA && id === A) return route.fulfill({ status: 503, json: {} });
          return route.fulfill({ json: [{ pet_id: id, pet_name: id === A ? '검수 하나' : '검수 둘', owner_name: '검수 보호자', owner_phone: id === B ? '1012345678' : '0212345678', species: 'dog', notes: '' }] });
        }
        if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method())) {
          blockedWrites += 1;
          return route.fulfill({ status: 451, json: {} });
        }
        if (resource === 'pets') return route.fulfill({ json: [
          { id: A, name: '검수 하나', species: 'dog', owner: { name: '검수 보호자' } },
          { id: B, name: '검수 둘', species: 'dog', owner: { name: '검수 보호자' } },
        ] });
        if (resource === 'pet_visits') return route.fulfill(visitFailure ? { status: 503, json: {} } : { json: [
          { visit_date: '2026-11-14', record: '피부 진료', detail: '경과 관찰' },
          { visit_date: '2026-11-13', record: '종합백신 접종', detail: '' },
        ] });
        if (resource === 'sale_items' && url.searchParams.has('pet_id')) {
          if (historyFailure) return route.fulfill({ status: 503, json: {} });
          if (emptyHistory) return route.fulfill({ json: [] });
          const first = url.searchParams.get('pet_id') === `eq.${A}`;
          return route.fulfill({ json: [{ quantity: 1, amount: 1200, products: { name: first ? 'A 검수 구매품' : 'B 검수 구매품' }, sales: { sold_at: '2026-11-14T00:00:00Z' } }] });
        }
        return route.continue();
      });
      try {
        const account = accounts.find(a => a.role === role);
        await page.goto(`${baseUrl}/`);
        await page.locator('#loginButton').click();
        await page.locator('#email').fill(account.email);
        await page.locator('#password').fill(account.password);
        await page.locator('#loginForm button[type=submit]').click();
        await page.waitForFunction(() => document.querySelector('#loginButton').textContent === '로그아웃');
      } catch { throw new Error(`${role} login failed (credentials omitted).`); }
      await page.locator('.sidebar [data-view=pets]').click();
      const choose = async name => {
        await page.locator('#petSearchInput').fill(name);
        await page.locator('#petSearchButton').click();
        await page.locator('#petCandidateRows .pet-candidate-select').click();
      };
      await choose('검수 하나');
      assert.equal(await page.locator('#petDetailPanel').isHidden(), true, 'Old details must be hidden while another pet is loading');
      await choose('검수 둘');
      await page.waitForFunction(() => document.querySelector('#petDetailName').textContent.includes('검수 둘'));
      await page.waitForTimeout(900);
      assert.match(await page.locator('#petDetailName').textContent(), /검수 둘/);
      assert.match(await page.locator('#petPurchaseRows').textContent(), /B 검수 구매품/);
      assert.doesNotMatch(await page.locator('#petPurchaseRows').textContent(), /A 검수 구매품/);
      assert.match(await page.locator('#petDetailInfo').textContent(), /010-1234-5678/, '숫자만 저장된 휴대전화는 보기 좋게 표시한다');
      assert.equal(await page.locator('#petTimeline tr').count(), 2);
      const timelineAlignment = await page.locator('#petTimeline tr').evaluateAll((rows) => rows.map((row) => [...row.cells].map((cell) => ({ text: cell.textContent, align: getComputedStyle(cell).textAlign }))));
      assert.equal(timelineAlignment[0][0].align, 'center', '날짜는 가운데 정렬한다');
      assert.equal(timelineAlignment[0][1].align, 'left', '내용이 있는 진료 기록은 좌측 정렬한다');
      assert.equal(timelineAlignment[0][2].align, 'center', '없는 접종 기록의 대시는 가운데 정렬한다');
      assert.equal(timelineAlignment[1][1].align, 'center', '없는 진료 기록의 대시는 가운데 정렬한다');
      assert.equal(timelineAlignment[1][2].align, 'left', '내용이 있는 접종 기록은 좌측 정렬한다');
      assert.equal(await page.evaluate(id => selectedPetId === id, B), true);

      await choose('검수 하나');
      await page.locator('#petSearchInput').fill('검수 둘');
      await page.locator('#petSearchButton').click();
      await page.waitForTimeout(900);
      assert.equal(await page.locator('#petDetailPanel').isHidden(), true, 'A late detail must not reappear after a new search');
      assert.match(await page.locator('#petCandidateRows').textContent(), /검수 둘/);
      assert.equal(await page.evaluate(() => selectedPetId), null);

      detailFailureA = true;
      await choose('검수 하나');
      await choose('검수 둘');
      await page.waitForTimeout(900);
      assert.match(await page.locator('#petDetailName').textContent(), /검수 둘/);
      assert.equal(await page.locator('#petDetailPanel').isVisible(), true);
      assert.equal(await page.locator('#petSearchMessage').textContent(), '', 'Obsolete A failure must not overwrite B');

      historyFailure = true;
      await choose('검수 둘');
      await page.waitForFunction(() => document.querySelector('#petSearchMessage').textContent.includes('구매 이력을 불러오지 못했습니다'));
      assert.match(await page.locator('#petPurchaseEmpty').textContent(), /불러오지 못했습니다/);
      assert.doesNotMatch(await page.locator('#petPurchaseEmpty').textContent(), /^구매 이력이 없습니다/);
      assert.equal(await page.locator('#petPurchaseRows tr').count(), 0);

      historyFailure = false;
      emptyHistory = true;
      await choose('검수 둘');
      await page.waitForFunction(() => document.querySelector('#petDetailPanel').hidden === false && document.querySelector('#petSearchMessage').textContent === '');
      assert.match(await page.locator('#petPurchaseEmpty').textContent(), /^구매 이력이 없습니다/);
      assert.equal(await page.locator('#petPurchaseEmpty').isVisible(), true);
      visitFailure = true;
      await choose('검수 둘');
      await page.waitForFunction(() => document.querySelector('#petSearchMessage').textContent.includes('방문 기록'));
      assert.match(await page.locator('#petTimelineEmpty').textContent(), /불러오지 못했습니다/);
      visitFailure = false;
      await choose('검수 둘');
      await page.waitForFunction(() => document.querySelector('#petDetailPanel').hidden === false && document.querySelector('#petSearchMessage').textContent === '');
      assert.equal(await page.locator('#petTimelineEmpty').textContent(), '진료 기록이 없습니다.');
      assert.equal(pageErrors, 0);
      assert.equal(blockedWrites, 0);
      await page.close();
    }
  } finally { await browser.close(); }
  console.log('Pet complaint review passed: admin/staff actual clicks, latest selected detail, obsolete failure, failed vs empty history; business writes 0.');
}
module.exports = { runPetComplaintReview };
if (require.main === module) runPetComplaintReview().catch(error => { console.error(error.message); process.exitCode = 1; });
