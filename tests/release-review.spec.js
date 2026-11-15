const { test } = require('@playwright/test');
const { runReleaseReview } = require('./release-review.cjs');

test('납품 회귀: 저장 복구·중복 방지·업무 응답 순서·연결 안내', async () => {
  test.setTimeout(240000);
  await runReleaseReview();
});
