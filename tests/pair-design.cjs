// Design complaints D01-D03: real login, no production business writes.
const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');

async function runPairDesignReview() {
  let account;
  try { account = JSON.parse(fs.readFileSync('test-accounts.local.json', 'utf8')).accounts.find(a => a.role === 'admin'); }
  catch { throw new Error('Design test account unavailable (contents omitted).'); }
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Seoul' });
  let errors = 0;
  let unexpectedWrites = 0;
  const submissions = [];
  const report = [];
  const output = path.join(os.tmpdir(), 'kumin-pair-design');
  fs.mkdirSync(output, { recursive: true });
  page.on('pageerror', () => { errors += 1; });
  await page.route('**/rest/v1/**', route => {
    const request = route.request();
    if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(request.method())) {
      if (new URL(request.url()).pathname.endsWith('/rpc_create_pet')) {
        submissions.push(request.postDataJSON());
        return route.fulfill({ status: 400, json: { message: '검수용 저장 실패' } });
      }
      unexpectedWrites += 1;
      return route.fulfill({ status: 451, json: {} });
    }
    return route.continue();
  });
  try {
    try {
      await page.goto('http://127.0.0.1:4173/');
      await page.locator('#loginButton').click();
      await page.locator('#email').fill(account.email);
      await page.locator('#password').fill(account.password);
      await page.locator('#loginForm button[type=submit]').click();
      await page.waitForFunction(() => document.querySelector('#loginButton').textContent === '로그아웃');
    } catch { throw new Error('Design review login failed (credentials omitted).'); }
    await page.locator('.sidebar [data-view=sales]').click();
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
        await page.locator('#salePetNewButton').click();
        await page.evaluate(() => { document.querySelector('#newPetForm').reset(); document.querySelector('.pet-optional-details').open = false; });
        assert.equal(await page.locator('#newOwnerPhone').isVisible(), false);
        assert.equal(await page.locator('#newPetSpecies').isVisible(), true, 'Species must remain visible');
        const compact = await page.locator('#newPetDialog').evaluate(dialog => {
          const button = dialog.querySelector('button[type=submit]').getBoundingClientRect();
          const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(x => { x /= 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }).reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i], 0);
          const ratios = [...dialog.querySelectorAll('label,summary span,.close-button,.pet-registration-hint')].map(element => {
            let parent = element;
            while (parent.parentElement && getComputedStyle(parent).backgroundColor === 'rgba(0, 0, 0, 0)') parent = parent.parentElement;
            const fg = luminance(getComputedStyle(element).color), bg = luminance(getComputedStyle(parent).backgroundColor);
            return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
          });
          return { fits: dialog.scrollHeight <= dialog.clientHeight + 2, submitVisible: button.top >= 0 && button.bottom <= innerHeight, overflow: document.documentElement.scrollWidth > innerWidth + 1, scheme: getComputedStyle(dialog.querySelector('#newPetBirth')).colorScheme, minContrast: Math.min(...ratios) };
        });
        assert.ok(compact.fits, `${width}/${theme}: basic registration must fit without scrolling`);
        assert.ok(compact.submitVisible, `${width}/${theme}: save must be visible`);
        assert.equal(compact.overflow, false);
        assert.ok(compact.minContrast >= 4.5, `${width}/${theme}: dialog text contrast`);
        if (theme === 'dark') assert.equal(compact.scheme, 'dark');
        await page.locator('.pet-optional-details summary').focus();
        await page.keyboard.press('Enter');
        assert.ok(await page.locator('#newOwnerPhone').isVisible());
        await page.locator('#newOwnerPhone').fill('010-0000-0000');
        await page.locator('#newPetBirth').fill('2025-01-02');
        await page.locator('.pet-optional-details summary').click();
        assert.equal(await page.locator('#newOwnerPhone').inputValue(), '010-0000-0000');
        assert.equal(await page.locator('#newPetBirth').inputValue(), '2025-01-02');
        await page.screenshot({ path: path.join(output, `registration-${width}-${theme}.png`), fullPage: true });
        report.push({ width, theme, ...compact });
        await page.locator('#closeNewPetDialog').click();
      }
    }
    await page.setViewportSize({ width: 390, height: 900 });
    await page.locator('#salePetNewButton').click();
    await page.evaluate(() => { document.querySelector('#newPetForm').reset(); document.querySelector('.pet-optional-details').open = false; });
    await page.locator('#newPetForm button[type=submit]').click();
    assert.equal(submissions.length, 0, 'Empty names must fail native validation');
    await page.locator('#newOwnerName').fill('검수 보호자');
    await page.locator('#newPetForm button[type=submit]').click();
    assert.equal(submissions.length, 0, 'Pet name must be required');
    await page.locator('#newPetName').fill('검수 반려동물');
    await page.locator('#newPetSpecies').selectOption('cat');
    await page.locator('#newPetForm button[type=submit]').click();
    await page.waitForFunction(() => document.querySelector('#newPetFormMessage').textContent === '검수용 저장 실패');
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0].p_species, 'cat');
    assert.equal(submissions[0].p_owner_phone, null);
    await page.locator('.pet-optional-details summary').click();
    await page.locator('#newOwnerPhone').fill('010-0000-0000');
    await page.locator('#newPetBirth').fill('2025-01-02');
    await page.locator('.pet-optional-details summary').click();
    await page.locator('#newPetForm button[type=submit]').click();
    await page.waitForTimeout(200);
    assert.equal(submissions.length, 2);
    assert.equal(submissions[1].p_owner_phone, '010-0000-0000');
    assert.equal(submissions[1].p_birth_date, '2025-01-02');
    await page.locator('#closeNewPetDialog').click();
    await page.evaluate(() => {
      saleItems = [{ ...products[0], quantity: 10000, sale_price: 12345, petLabel: '검수 반려동물', petId: null }];
      renderSale();
    });
    assert.equal(await page.locator('#saleRows td').nth(1).evaluate(e => getComputedStyle(e).textAlign), 'right');
    assert.equal(await page.locator('#saleRows td').nth(1).textContent(), '10,000');
    assert.equal(await page.locator('#saleRows td').nth(2).evaluate(e => getComputedStyle(e).textAlign), 'right');
    assert.equal(await page.locator('#saleRows td').nth(3).evaluate(e => getComputedStyle(e).textAlign), 'left');
    await page.locator('.sidebar [data-view=purchases]').click();
    await page.locator('#purchaseProductSearch').fill('ㅂ');
    await page.locator('#purchaseProductSuggestions .product-suggestion').first().click();
    await page.locator('#purchaseQuantity').fill('10000');
    await page.locator('#purchaseUnitCost').fill('1234');
    await page.locator('#addPurchaseItem').click();
    assert.equal(await page.locator('#purchaseRows td').nth(1).textContent(), '10,000');
    for (const i of [1, 2, 3]) assert.equal(await page.locator('#purchaseRows td').nth(i).evaluate(e => getComputedStyle(e).textAlign), 'right');
    assert.equal(await page.locator('#purchaseRows td').first().evaluate(e => getComputedStyle(e).textAlign), 'left');
    assert.equal(errors, 0);
    assert.equal(unexpectedWrites, 0);
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ report, errors, actualBusinessWrites: 0, interceptedSubmissions: submissions.length }, null, 2));
    console.log('Design pair passed: 8 compact form cases, native required validation, collapsed optional payload, species visibility, dark color scheme, and sale/purchase quantity formatting and alignment; actual business writes 0.');
  } finally { await browser.close(); }
}
module.exports = { runPairDesignReview };
if (require.main === module) runPairDesignReview().catch(error => { console.error(error.message); process.exitCode = 1; });
