const { test } = require('@playwright/test');
const { runSalesHistoryReview } = require('./sales-history-legacy.cjs');
test('엑셀 판매 월별 연결과 판매단가·매입단가·수익 표시', async () => {
  test.setTimeout(120000);
  await runSalesHistoryReview();
});
