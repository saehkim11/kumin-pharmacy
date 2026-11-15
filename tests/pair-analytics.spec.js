const { test } = require('@playwright/test');
const { runAnalyticsComplaints } = require('./pair-analytics.cjs');
test('ERP 고객 불만: 과거 연도 연결·자료 범위·판매 후 분석 갱신', async () => {
  test.setTimeout(120000);
  await runAnalyticsComplaints();
});
