const { chromium } = require('playwright');
const fs = require('fs');
const assert = require('node:assert/strict');

const accounts = JSON.parse(fs.readFileSync('test-accounts.local.json', 'utf8')).accounts;

async function run() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto('http://127.0.0.1:4173/');
    assert.equal(await page.locator('#dashboardNews').isHidden(), true, '로그인 전 뉴스는 숨겨야 합니다.');
    const staff = accounts.find((account) => account.role === 'staff');
    await page.locator('#loginButton').click();
    await page.locator('#email').fill(staff.email);
    await page.locator('#password').fill(staff.password);
    await page.locator('#loginForm button[type=submit]').click();
    await page.waitForFunction(() => document.querySelector('#loginButton').textContent === '로그아웃');
    await page.waitForFunction(() => document.querySelectorAll('#dashboardNews a').length === 5);
    assert.equal(await page.locator('#dashboardNews').isVisible(), true, '로그인 후 뉴스가 보여야 합니다.');
    const labels = await page.locator('#dashboardNews .dashboard-news-group h3').allTextContents();
    assert.deepEqual(labels, ['정책·복지 공지', '국내 반려동물·수의학 새 글']);
    const links = await page.locator('#dashboardNews a').evaluateAll((nodes) => nodes.map((node) => ({ href: node.href, download: node.hasAttribute('download') })));
    assert.equal(links.some((link) => link.download || /download|\.csv|\.xlsx?|\.pdf|\.zip/i.test(link.href)), false, '다운로드 링크는 허용되지 않습니다.');
    for (let index = 0; index < links.length; index += 1) {
      const link = links[index];
      const response = await page.context().request.get(link.href, { maxRedirects: 5 });
      const type = response.headers()['content-type'] || '';
      const disposition = response.headers()['content-disposition'] || '';
      assert.equal(response.ok(), true, `뉴스 원문 응답이 성공해야 합니다: ${new URL(link.href).origin}`);
      assert.match(type, /text\/html/i, '뉴스 원문은 HTML이어야 합니다.');
      assert.doesNotMatch(disposition, /attachment/i, '뉴스 원문은 다운로드 응답이 아니어야 합니다.');
      const download = page.waitForEvent('download', { timeout: 1500 }).then(() => true).catch(() => false);
      const popupEvent = page.waitForEvent('popup');
      await page.locator('#dashboardNews a').nth(index).click();
      const popup = await popupEvent;
      await popup.waitForLoadState('domcontentloaded');
      assert.equal(await download, false, '뉴스 클릭으로 파일을 내려받으면 안 됩니다.');
      assert.ok((await popup.title()).trim(), '뉴스 원문 탭이 열려야 합니다.');
      await popup.close();
    }
    console.log(`대시보드 뉴스 로그인·링크 안전 확인 통과: ${links.length}건`);
  } finally {
    await browser.close();
  }
}

run().catch((error) => { console.error(`대시보드 뉴스 검증 실패: ${error.message}`); process.exitCode = 1; });
