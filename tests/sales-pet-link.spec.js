// 판매관리에서 등록한 판매가 (1) 판매 내역과 (2) 반려동물 구매 이력에 실제로 반영되는지 확인하는 테스트.
// 이번 요청의 핵심 확인 사항: "판매관리 입력 -> 매출등록 + 반려동물관리 연동" 검증.
const { test, expect } = require('@playwright/test');
const fs = require('fs');

const accounts = JSON.parse(fs.readFileSync('test-accounts.local.json', 'utf-8')).accounts;
const admin = accounts.find((a) => a.role === 'admin');

async function login(page, account) {
  await page.goto('/');
  await page.click('#loginButton');
  await page.fill('#email', account.email);
  await page.fill('#password', account.password);
  await page.click('#loginForm button[type="submit"]');
  await expect(page.locator('#loginButton')).toHaveText('로그아웃', { timeout: 15000 });
}

test('판매 등록 -> 판매 내역 + 반려동물 구매 이력 연동', async ({ page }) => {
  const stamp = Date.now();
  const ownerName = `테스트보호자${stamp}`;
  const petName = `테스트펫${stamp}`;

  await login(page, admin);

  await page.click('[data-view="sales"]');
  await expect(page.locator('#sales.view.active')).toBeVisible();

  // 신규 반려동물 등록 (판매관리 화면에서 바로)
  await page.click('#salePetNewButton');
  await expect(page.locator('#newPetDialog')).toBeVisible();
  await page.fill('#newOwnerName', ownerName);
  await page.fill('#newPetName', petName);
  await page.click('#newPetForm button[type="submit"]');
  await expect(page.locator('#newPetDialog')).toBeHidden({ timeout: 10000 });
  await expect(page.locator('#salePetSearch')).toHaveValue(`${petName} (${ownerName})`);

  // 상품 검색 -> 추천 목록 첫 번째 클릭
  await page.fill('#saleProductSearch', 'B S K');
  await page.waitForTimeout(300);
  const firstSuggestion = page.locator('#saleProductSuggestions .product-suggestion').first();
  await expect(firstSuggestion).toBeVisible({ timeout: 5000 });
  const productName = await firstSuggestion.locator('b').textContent();
  await firstSuggestion.click();

  await page.fill('#saleQuantity', '2');
  const priceValue = await page.locator('#salePrice').inputValue();
  expect(Number(priceValue)).toBeGreaterThan(0); // 제안가격(공항가격) 자동 채움 확인
  await page.fill('#salePrice', '12345');

  await page.click('#addSaleItem');
  await expect(page.locator('#saleRows tr').first()).toContainText(productName.trim());
  await expect(page.locator('#saleRows tr').first()).toContainText('24,690'); // 12345 * 2

  await page.click('#submitSale');
  await expect(page.locator('#saleMessage')).toContainText('판매가 등록되었습니다', { timeout: 15000 });
  const saleMsg = await page.locator('#saleMessage').textContent();
  const saleIdMatch = saleMsg.match(/판매 번호:\s*(\S+)/);
  expect(saleIdMatch).not.toBeNull();

  // 월별 판매 내역에 반영됐는지 확인 (같은 화면 하단)
  await page.waitForTimeout(500);
  await expect(page.locator('#salesHistorySection')).toContainText(productName.trim(), { timeout: 10000 });

  // 고객/반려동물 관리에서 이 반려동물을 찾아 구매 이력 확인
  await page.click('[data-view="pets"]');
  await expect(page.locator('#pets.view.active')).toBeVisible();
  await page.fill('#petSearchInput', petName);
  await page.click('#petSearchButton');
  const detailButton = page.locator('#petCandidateRows .pet-candidate-select').first();
  await expect(detailButton).toBeVisible({ timeout: 5000 });
  await detailButton.click();
  await expect(page.locator('#petDetailPanel')).toBeVisible();
  await expect(page.locator('#petDetailName')).toContainText(petName);
  await expect(page.locator('#petPurchaseRows')).toContainText(productName.trim(), { timeout: 10000 });
  await expect(page.locator('#petPurchaseRows')).toContainText('24,690');
});
