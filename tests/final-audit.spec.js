const { test } = require('@playwright/test');
const { runAudit } = require('./final-audit.cjs');

test('최종 검수: 매출 탭·가독성·역할별 화면·공유 업무', async () => {
  test.setTimeout(240000);
  await runAudit();
});
