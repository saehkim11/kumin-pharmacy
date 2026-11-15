const { test } = require('@playwright/test');
const { runPairDesignReview } = require('./pair-design.cjs');
test('고객 디자인 불만: 간단 등록·다크 대비·숫자 정렬', async () => {
  test.setTimeout(120000);
  await runPairDesignReview();
});
