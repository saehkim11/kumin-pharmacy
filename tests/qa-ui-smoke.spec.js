const { test, expect } = require('@playwright/test');

test('로그인 전 화면은 안전하게 열리고 뉴스와 업무 데이터가 노출되지 않는다', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await expect(page.locator('#loginDialog')).toBeAttached();
  await expect(page.locator('.nav-button').first()).toBeVisible();
  await expect(page.locator('#dashboardNews')).toBeHidden();
  await expect(page.locator('#dashboardNewsList a')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('판매 상품을 마이크로 말하면 추천 목록을 보여 준다', async ({ page }) => {
  await page.addInitScript(() => {
    class FakeSpeechRecognition extends EventTarget {
      start() {
        const event = new Event('result');
        Object.defineProperty(event, 'results', { value: [[{ transcript: '검수 상품' }]] });
        this.dispatchEvent(event);
        this.dispatchEvent(new Event('end'));
      }
    }
    window.SpeechRecognition = FakeSpeechRecognition;
  });
  await page.goto('/');
  await page.locator('[data-view="sales"]').click();
  await page.evaluate(() => {
    products = [{ id: 'qa-product', code: 'QA-001', name: '검수 상품', sale_price: 12000, product_stock: [{ quantity: 3 }] }];
    prepareSales();
  });

  await expect(page.locator('#saleProductMicButton')).toBeEnabled();
  await expect(page.locator('#saleProductMicButton')).toHaveText('🎤');
  await expect(page.locator('#saleProductMicButton')).toBeVisible();
  await page.locator('#saleProductMicButton').click();
  await expect(page.locator('#saleProductSearch')).toHaveValue('검수 상품');
  await expect(page.locator('#saleProductSuggestions .product-suggestion')).toContainText('검수 상품');
});
