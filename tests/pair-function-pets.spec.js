const { test } = require('@playwright/test');
const { runPetComplaintReview } = require('./pair-function-pets.cjs');
test('사용자 컴플레인: 반려동물 선택과 구매 이력 조회 실패', async () => {
  test.setTimeout(120000);
  await runPetComplaintReview();
});
