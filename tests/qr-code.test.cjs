// qr-code.js 단위 시험. 기준 행렬(tests/fixtures/qr-reference.json)은 segno로 만든 것이며,
// 우리가 직접 구현한 QR 인코더가 칸 하나까지 같은 결과를 내는지 확인한다. 실행: node tests/qr-code.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const QrCode = require('../qr-code.js');

const reference = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'qr-reference.json'), 'utf-8'));
const toRows = (modules) => modules.map((row) => row.map((cell) => (cell ? '1' : '0')).join(''));
let count = 0;
function check(name, fn) {
  try { fn(); count += 1; } catch (error) { console.error(`FAIL: ${name}\n${error.message}`); process.exitCode = 1; }
}

for (const item of reference) {
  const label = `v${item.version} mask${item.mask}${item.auto ? '(auto)' : ''} ${Buffer.byteLength(item.text)}B`;
  check(`기준 행렬 일치 — ${label}`, () => {
    const result = item.auto ? QrCode.encode(item.text) : QrCode.encode(item.text, { mask: item.mask });
    assert.equal(result.version, item.version, '버전');
    assert.equal(result.size, item.version * 4 + 17, '한 변 칸 수');
    assert.deepEqual(toRows(result.modules), item.modules);
  });
}

check('byteLength는 UTF-8 바이트 수', () => {
  assert.equal(QrCode.byteLength('a'), 1);
  assert.equal(QrCode.byteLength('가'), 3);
  assert.equal(QrCode.byteLength('😀'), 4);
});

check('213바이트는 만들어지고 214바이트는 TOO_LONG', () => {
  assert.equal(QrCode.MAX_BYTES, 213);
  assert.equal(QrCode.encode('a'.repeat(213)).version, 10);
  assert.throws(() => QrCode.encode('a'.repeat(214)), (error) => error.code === 'TOO_LONG');
  assert.throws(() => QrCode.encode('가'.repeat(72)), (error) => error.code === 'TOO_LONG');
});

check('toSvg는 검은 칸만큼 사각형을 그린다', () => {
  const modules = QrCode.encode('HELLO').modules;
  const dark = modules.flat().filter(Boolean).length;
  const svg = QrCode.toSvg(modules);
  assert.ok(svg.startsWith('<svg'));
  assert.equal((svg.match(/<rect /g) || []).length - 1, dark); // 첫 rect는 흰 배경
  assert.ok(svg.includes(`viewBox="0 0 ${modules.length + 8} ${modules.length + 8}"`));
});

console.log(process.exitCode ? 'qr-code: 실패 있음' : `qr-code: ${count}개 통과`);
