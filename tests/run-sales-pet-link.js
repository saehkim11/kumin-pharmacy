// @playwright/test 러너가 숨김 폴더(.playwright-artifacts-*)를 만들지 못하는 샌드박스 제약을 피해서,
// playwright 저수준 API로 직접 시나리오를 실행하는 스크립트.
// 판매관리에서 등록한 판매가 (1) 판매 내역과 (2) 반려동물 구매 이력에 반영되는지 확인한다.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const assert = require('assert');
const http = require('http');

const accounts = JSON.parse(fs.readFileSync('test-accounts.local.json', 'utf-8')).accounts;
const admin = accounts.find((a) => a.role === 'admin');
const BASE_URL = 'http://127.0.0.1:4173';

function waitForServer(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      http.get(url, (res) => { res.resume(); resolve(); })
        .on('error', () => {
          if (Date.now() - start > timeoutMs) reject(new Error('server did not start in time'));
          else setTimeout(tryOnce, 300);
        });
    };
    tryOnce();
  });
}

async function login(page, account) {
  await page.goto(BASE_URL + '/');
  await page.click('#loginButton');
  await page.fill('#email', account.email);
  await page.fill('#password', account.password);
  await page.click('#loginForm button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#loginButton')?.textContent === '로그아웃', { timeout: 15000 });
}

(async () => {
  const server = spawn('npx', ['http-server', '-p', '4173', '-c-1', '.'], { shell: true, stdio: 'ignore' });
  await waitForServer(BASE_URL + '/index.html', 15000);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(`console: ${msg.text()}`); });

  try {
    const stamp = Date.now();
    const ownerName = `테스트보호자${stamp}`;
    const petName = `테스트펫${stamp}`;

    await login(page, admin);
    console.log('STEP login ok');

    await page.click('[data-view="sales"]');
    await page.waitForTimeout(300);

    await page.click('#salePetNewButton');
    await page.waitForSelector('#newPetDialog[open]', { timeout: 5000 });
    await page.fill('#newOwnerName', ownerName);
    await page.fill('#newPetName', petName);
    await page.click('#newPetForm button[type="submit"]');
    await page.waitForFunction(() => !document.querySelector('#newPetDialog').open, { timeout: 10000 });
    const petFieldValue = await page.inputValue('#salePetSearch');
    assert.strictEqual(petFieldValue, `${petName} (${ownerName})`, '반려동물 자동 선택 실패');
    console.log('STEP new pet created and auto-selected:', petFieldValue);

    await page.fill('#saleProductSearch', 'B S K');
    await page.waitForTimeout(400);
    const firstSuggestion = page.locator('#saleProductSuggestions .product-suggestion').first();
    await firstSuggestion.waitFor({ state: 'visible', timeout: 5000 });
    const productName = (await firstSuggestion.locator('b').textContent()).trim();
    await firstSuggestion.click();

    await page.fill('#saleQuantity', '2');
    const priceValue = await page.inputValue('#salePrice');
    assert.ok(Number(priceValue) > 0, '제안가격(공항가격) 자동 채움 실패: ' + priceValue);
    console.log('STEP suggested price auto-filled:', priceValue);
    await page.fill('#salePrice', '12345');

    await page.click('#addSaleItem');
    await page.waitForTimeout(300);
    const cartRowText = await page.locator('#saleRows tr').first().textContent();
    assert.ok(cartRowText.includes(productName), '장바구니에 상품명 없음');
    assert.ok(cartRowText.includes('24,690'), '장바구니 금액(12345*2) 불일치: ' + cartRowText);
    console.log('STEP cart row ok:', cartRowText.replace(/\s+/g, ' '));

    await page.click('#submitSale');
    await page.waitForFunction(() => document.querySelector('#saleMessage')?.textContent.includes('판매가 등록되었습니다'), { timeout: 15000 });
    const saleMsg = await page.locator('#saleMessage').textContent();
    console.log('STEP sale submitted:', saleMsg);

    await page.waitForTimeout(500);
    const historyText = await page.locator('#salesHistorySection').textContent();
    assert.ok(historyText.includes(productName), '월별 판매 내역에 상품 없음');
    console.log('STEP sales history contains product: OK');

    await page.click('[data-view="pets"]');
    await page.waitForTimeout(300);
    await page.fill('#petSearchInput', petName);
    await page.click('#petSearchButton');
    const detailButton = page.locator('#petCandidateRows .pet-candidate-select').first();
    await detailButton.waitFor({ state: 'visible', timeout: 5000 });
    await detailButton.click();
    await page.waitForTimeout(500);
    const petDetailName = await page.locator('#petDetailName').textContent();
    assert.ok(petDetailName.includes(petName), '반려동물 상세 이름 불일치');
    const purchaseRowsText = await page.locator('#petPurchaseRows').textContent();
    assert.ok(purchaseRowsText.includes(productName), '반려동물 구매 이력에 상품명 없음');
    assert.ok(purchaseRowsText.includes('24,690'), '반려동물 구매 이력 금액 불일치');
    console.log('STEP pet purchase history contains sale: OK');

    console.log('RESULT: PASS');
  } catch (error) {
    console.log('RESULT: FAIL -', error.message);
    await page.screenshot({ path: 'tests-output-failure.png', fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    console.log('CONSOLE_ERRORS=' + JSON.stringify(consoleErrors));
    await browser.close();
    server.kill();
  }
})();
