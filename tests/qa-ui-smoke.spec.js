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
