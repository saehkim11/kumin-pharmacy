// messaging-core.js 단위 시험. 실행: node tests/messaging-core.test.cjs
const assert = require('node:assert/strict');
const Core = require('../messaging-core.js');

let count = 0;
function check(name, fn) {
  try { fn(); count += 1; } catch (error) { console.error(`FAIL: ${name}\n${error.message}`); process.exitCode = 1; }
}
const TODAY = '2026-11-22'; // 일요일

check('normalizeMobile: 하이픈·공백·국가번호·8자리를 같은 형식으로 정리', () => {
  assert.equal(Core.normalizeMobile('010-1234-5678'), '01012345678');
  assert.equal(Core.normalizeMobile('+82 10-1234-5678'), '01012345678');
  assert.equal(Core.normalizeMobile('821012345678'), '01012345678');
  assert.equal(Core.normalizeMobile('+82 (0)10-1234-5678'), '01012345678');
  assert.equal(Core.normalizeMobile('12345678'), '01012345678');
  assert.equal(Core.normalizeMobile('0111234567'), '0111234567'); // 10자리 옛 번호
});
check('normalizeMobile: 휴대전화가 아니거나 비어 있으면 null', () => {
  for (const bad of ['', null, undefined, '02-123-4567', '0101234', '031-123-4567', 'abc', '010-1234-56789']) {
    assert.equal(Core.normalizeMobile(bad), null, String(bad));
  }
});

check('normalizeMobile: 82로 시작하는 8자리 번호는 국가번호가 아니라 010 앞자리 생략 번호', () => {
  assert.equal(Core.normalizeMobile('82345678'), '01082345678');
  assert.equal(Core.normalizeMobile('821012345678'), '01012345678');
});

check('addYears: 같은 월일, 윤일은 2월 28일로 맞춤(1년 후 버튼)', () => {
  assert.equal(Core.addYears('2026-11-22', 1), '2027-11-22');
  assert.equal(Core.addYears('2027-03-01', 1), '2028-03-01'); // 365일 뒤면 2028-02-29가 되던 경우
  assert.equal(Core.addYears('2028-02-29', 1), '2029-02-28');
  assert.equal(Core.addYears('2028-02-29', 4), '2032-02-29');
});

check('addDays: 일반·윤년·연말', () => {
  assert.equal(Core.addDays('2026-11-22', 21), '2026-12-13');
  assert.equal(Core.addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(Core.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(Core.addDays('2026-11-22', 365), '2027-11-22');
});

check('formatDueDate: 같은 해는 월일+요일, 다른 해는 연도 포함', () => {
  assert.equal(Core.formatDueDate('2026-11-25', TODAY), '11월 25일(수)');
  assert.equal(Core.formatDueDate('2027-01-10', TODAY), '2027년 1월 10일(일)');
});
check('isPast: 어제는 지난 날짜, 오늘은 아님', () => {
  assert.equal(Core.isPast('2026-11-21', TODAY), true);
  assert.equal(Core.isPast('2026-11-22', TODAY), false);
  assert.equal(Core.isPast('2026-11-23', TODAY), false);
});

check('formatTime', () => {
  assert.equal(Core.formatTime('10:00'), '오전 10시');
  assert.equal(Core.formatTime('14:30'), '오후 2시 30분');
  assert.equal(Core.formatTime('12:00'), '오후 12시');
  assert.equal(Core.formatTime('00:00'), '오전 12시');
  assert.equal(Core.formatTime(''), '');
});

check('상수: 종류·접종 종류·날짜 버튼', () => {
  assert.deepEqual(Core.MESSAGE_TYPES.map((t) => t.id), ['vaccine', 'reservation', 'aftercare', 'custom']);
  assert.deepEqual(Core.MESSAGE_TYPES.map((t) => t.label), ['접종 안내', '예약 확인', '진료 후 안내', '직접 쓰기']);
  assert.deepEqual(Core.VACCINE_CHOICES, ['종합백신', '광견병', '켄넬코프', '코로나', '심장사상충 예방']);
  assert.deepEqual(Core.DUE_QUICK_CHOICES, [{ label: '3주 후', days: 21 }, { label: '4주 후', days: 28 }, { label: '1년 후', years: 1 }]);
  assert.deepEqual(Core.TOKEN_LABELS, ['[반려견 이름]', '[날짜]', '[병원 이름]']);
});

check('CLINIC: 문구에 고정으로 들어가는 병원 정보', () => {
  assert.deepEqual(Core.CLINIC, { name: '구민동물병원', phone: '02-543-1945' });
});

const base = { clinicName: '병원이름', clinicPhone: '02-1234-5678', petName: '보리', today: TODAY };
check('buildMessageText: 접종 안내', () => {
  assert.equal(Core.buildMessageText({ ...base, type: 'vaccine', vaccineName: '종합백신', dueDate: '2026-11-25' }),
    '[병원이름] 보리 보호자님, 보리의 종합백신 접종일이 11월 25일(수)입니다. 문의: 02-1234-5678');
  assert.equal(Core.buildMessageText({ ...base, type: 'vaccine', dueDate: '2026-11-25' }),
    '[병원이름] 보리 보호자님, 보리의 접종일이 11월 25일(수)입니다. 문의: 02-1234-5678');
});
check('buildMessageText: 예약 확인', () => {
  assert.equal(Core.buildMessageText({ ...base, type: 'reservation', dueDate: '2026-11-25', time: '10:00' }),
    '[병원이름] 보리 보호자님, 11월 25일(수) 오전 10시 예약이 확인되었습니다. 문의: 02-1234-5678');
  assert.equal(Core.buildMessageText({ ...base, type: 'reservation', dueDate: '2026-11-25' }),
    '[병원이름] 보리 보호자님, 11월 25일(수) 예약이 확인되었습니다. 문의: 02-1234-5678');
});
check('buildMessageText: 진료 후 안내', () => {
  assert.equal(Core.buildMessageText({ ...base, type: 'aftercare' }),
    '[병원이름] 보리 보호자님, 오늘 진료받은 보리의 상태를 잘 살펴봐 주세요. 이상이 있으면 연락 주세요. 문의: 02-1234-5678');
});
check('buildMessageText: 병원 이름·전화가 없으면 해당 부분을 뺀다', () => {
  assert.equal(Core.buildMessageText({ type: 'aftercare', petName: '보리', today: TODAY }),
    '보리 보호자님, 오늘 진료받은 보리의 상태를 잘 살펴봐 주세요. 이상이 있으면 연락 주세요.');
  assert.equal(Core.buildMessageText({ type: 'vaccine', petName: '보리', vaccineName: '광견병', dueDate: '2027-01-10', today: TODAY }),
    '보리 보호자님, 보리의 광견병 접종일이 2027년 1월 10일(일)입니다.');
});
check('buildMessageText: 직접 쓰기는 빈 문구, 필요한 값이 없으면 빈 문구', () => {
  assert.equal(Core.buildMessageText({ ...base, type: 'custom' }), '');
  assert.equal(Core.buildMessageText({ ...base, type: 'vaccine' }), '');
  assert.equal(Core.buildMessageText({ ...base, type: 'reservation' }), '');
  assert.equal(Core.buildMessageText({ ...base, petName: '', type: 'aftercare' }), '');
});

check('insertToken: 선택 구간을 토큰으로 바꾸고 커서 위치를 돌려준다', () => {
  assert.deepEqual(Core.insertToken('안녕하세요', 2, 2, '[날짜]'), { text: '안녕[날짜]하세요', caret: 6 });
  assert.deepEqual(Core.insertToken('안녕하세요', 0, 2, '[반려견 이름]'), { text: '[반려견 이름]하세요', caret: 8 });
  assert.deepEqual(Core.insertToken('', 0, 0, '[병원 이름]'), { text: '[병원 이름]', caret: 7 });
});

check('fillTokens: 토큰 치환, 값이 없는 토큰은 그대로, 여러 번도 치환', () => {
  const values = { petName: '보리', dueDate: '2026-11-25', clinicName: '병원이름', today: TODAY };
  assert.equal(Core.fillTokens('[반려견 이름] 보호자님 [날짜] 방문. [병원 이름]', values), '보리 보호자님 11월 25일(수) 방문. 병원이름');
  assert.equal(Core.fillTokens('[반려견 이름], [반려견 이름]!', values), '보리, 보리!');
  assert.equal(Core.fillTokens('[날짜] [병원 이름]', { petName: '보리', today: TODAY }), '[날짜] [병원 이름]');
});

check('findUnfilledTokens: 남은 토큰을 한 번씩만, 정해진 순서로 알려준다', () => {
  assert.deepEqual(Core.findUnfilledTokens('[날짜] 방문 [병원 이름] [날짜]'), ['[날짜]', '[병원 이름]']);
  assert.deepEqual(Core.findUnfilledTokens('[반려견 이름] [날짜]'), ['[반려견 이름]', '[날짜]']);
  assert.deepEqual(Core.findUnfilledTokens('보리 보호자님 11월 25일'), []);
});

check('tokenize: 만들어진 문구 속 이름·날짜를 토큰으로 되돌린다(직접 쓰기로 바꿀 때)', () => {
  const values = { petName: '보리', dueDate: '2026-11-25', today: TODAY };
  assert.equal(Core.tokenize('[병원이름] 보리 보호자님, 보리의 종합백신 접종일이 11월 25일(수)입니다.', values),
    '[병원이름] [반려견 이름] 보호자님, [반려견 이름]의 종합백신 접종일이 [날짜]입니다.');
  assert.equal(Core.tokenize('안녕하세요', { today: TODAY }), '안녕하세요');
  assert.equal(Core.fillTokens(Core.tokenize('보리 11월 25일(수)', values), { petName: '콩이', dueDate: '2026-12-01', today: TODAY }), '콩이 12월 1일(화)');
});

check('toQrText: SMSTO 형식, 줄바꿈은 공백 하나', () => {
  assert.equal(Core.toQrText('01012345678', '가\n나'), 'SMSTO:01012345678:가 나');
  assert.equal(Core.toQrText('01012345678', '가\r\n나\r다'), 'SMSTO:01012345678:가 나 다');
  assert.equal(Core.toQrText('01012345678', '문의: 02-1234'), 'SMSTO:01012345678:문의: 02-1234');
});

check('checkQr: 번호·문구·길이 판정과 213/214바이트 경계', () => {
  const phone = '010-1234-5678';
  assert.deepEqual(Core.checkQr(phone, '안녕'), { ok: true, reason: 'ok', bytes: 18 + 6, maxBytes: 213 });
  assert.equal(Core.checkQr('', '안녕').reason, 'bad-phone');
  assert.equal(Core.checkQr(null, '안녕').ok, false);
  assert.equal(Core.checkQr(phone, '   ').reason, 'empty-text');
  assert.equal(Core.checkQr(phone, '').reason, 'empty-text');
  const at213 = Core.checkQr(phone, 'a'.repeat(195));
  assert.equal(at213.bytes, 213); assert.equal(at213.ok, true);
  const at214 = Core.checkQr(phone, 'a'.repeat(196));
  assert.equal(at214.bytes, 214); assert.equal(at214.ok, false); assert.equal(at214.reason, 'too-long');
  assert.equal(Core.checkQr(phone, '😀'.repeat(48)).bytes, 18 + 192); // 이모지는 4바이트
  assert.equal(Core.checkQr(phone, '😀'.repeat(49)).reason, 'too-long');
});

// ---- 알림 이력용 함수 ----
const mk = (id, createdAt, over = {}) => ({ id, created_at: createdAt, kind: 'manual', ref_key: 'vaccine', due_on: '2026-12-13', status: 'sent', message_text: '문구', pet_id: 1, pet: { id: 1, name: '보리', owner: { name: '김현주' } }, ...over });
const contains = (text, keyword) => text.includes(keyword);

check('toKstDate/toKstTime: 한국 시간 기준(UTC+9), 마이크로초·오프셋 표기도 처리', () => {
  assert.equal(Core.toKstDate('2026-11-21T16:30:00Z'), '2026-11-22');
  assert.equal(Core.toKstTime('2026-11-21T16:30:00Z'), '01:30');
  assert.equal(Core.toKstDate('2026-11-22T14:59:59Z'), '2026-11-22');
  assert.equal(Core.toKstTime('2026-11-22T14:59:59Z'), '23:59');
  assert.equal(Core.toKstDate('2026-11-22T15:00:00Z'), '2026-11-23');
  assert.equal(Core.toKstTime('2026-11-22T15:00:00Z'), '00:00');
  assert.equal(Core.toKstDate('2026-11-22T06:05:00.123456+00:00'), '2026-11-22');
  assert.equal(Core.toKstTime('2026-11-22T06:05:00.123456+00:00'), '15:05');
});

check('historyStartDate: 기간 버튼의 시작 날짜', () => {
  assert.equal(Core.historyStartDate('today', TODAY), '2026-11-22');
  assert.equal(Core.historyStartDate('7d', TODAY), '2026-11-16');
  assert.equal(Core.historyStartDate('30d', TODAY), '2026-10-24');
  assert.equal(Core.historyStartDate('all', TODAY), null);
  assert.deepEqual(Core.HISTORY_RANGES.map((r) => r.label), ['오늘', '7일', '30일', '전체']);
});

check('filterHistory: 기간(한국 날짜)·상태·키워드, 삭제된 반려동물, 입력 불변', () => {
  const rows = [
    mk(1, '2026-11-22T00:00:00+09:00'), // 오늘 00:00 (KST)
    mk(2, '2026-11-21T23:59:00+09:00'), // 어제
    mk(3, '2026-11-20T10:00:00+09:00', { status: 'void' }),
    mk(4, '2026-11-18T10:00:00+09:00', { status: 'skip', pet: { id: 2, name: '콩이', owner: { name: '박소영' } }, pet_id: 2 }),
    mk(5, '2026-11-22T09:00:00+09:00', { pet: null, pet_id: null })
  ];
  const copy = JSON.stringify(rows);
  const ids = (opts) => Core.filterHistory(rows, { range: 'all', status: 'all', keyword: '', today: TODAY, matches: contains, ...opts }).map((r) => r.id);
  assert.deepEqual(ids({}), [1, 2, 3, 4, 5]);
  assert.deepEqual(ids({ range: 'today' }), [1, 5]);
  assert.deepEqual(ids({ range: '7d' }), [1, 2, 3, 4, 5]);
  assert.deepEqual(ids({ range: '7d', today: '2026-11-30' }), []);
  assert.deepEqual(ids({ status: 'sent' }), [1, 2, 5]);
  assert.deepEqual(ids({ status: 'skip' }), [4]);
  assert.deepEqual(ids({ keyword: '콩이' }), [4]);
  assert.deepEqual(ids({ keyword: '김현주' }), [1, 2, 3]); // pet이 null인 행은 키워드가 있으면 제외
  assert.deepEqual(ids({ keyword: '' }), [1, 2, 3, 4, 5]);
  assert.equal(JSON.stringify(rows), copy);
});

check('groupHistoryByDate: 한국 날짜별로 묶고 최신순', () => {
  const rows = [
    mk(1, '2026-11-21T10:00:00+09:00'), mk(2, '2026-11-22T09:00:00+09:00'), mk(3, '2026-11-22T15:05:00+09:00'), mk(4, '2026-11-20T10:00:00+09:00')
  ];
  const groups = Core.groupHistoryByDate(rows);
  assert.deepEqual(groups.map((g) => g.date), ['2026-11-22', '2026-11-21', '2026-11-20']);
  assert.deepEqual(groups[0].rows.map((r) => r.id), [3, 2]);
  assert.deepEqual(Core.groupHistoryByDate([]), []);
});

check('findSameSend: 같은 반려동물·종류·예정일(또는 날짜 없는 종류는 오늘)만 같은 건', () => {
  const rows = [
    mk(1, '2026-11-10T10:00:00+09:00', { ref_key: 'vaccine', due_on: '2026-11-25' }),
    mk(2, '2026-11-22T10:00:00+09:00', { ref_key: 'aftercare', due_on: null }),
    mk(3, '2026-11-21T10:00:00+09:00', { ref_key: 'aftercare', due_on: null }),
    mk(4, '2026-11-22T11:00:00+09:00', { ref_key: 'vaccine', due_on: '2026-12-13', status: 'void' }),
    mk(5, '2026-11-22T12:00:00+09:00', { ref_key: 'vaccine', due_on: '2026-12-13', status: 'skip' }),
    mk(6, '2026-11-22T13:00:00+09:00', { ref_key: 'vaccine', due_on: '2026-12-13', pet: { id: 2, name: '콩이', owner: null }, pet_id: 2 })
  ];
  const find = (q) => Core.findSameSend(rows, { today: TODAY, ...q });
  assert.equal(find({ petId: 1, refKey: 'vaccine', dueOn: '2026-11-25' }).id, 1);
  assert.equal(find({ petId: 1, refKey: 'vaccine', dueOn: '2026-12-09' }), null); // 예정일이 다르면 새 건(주기가 짧아도 안내하지 않음)
  assert.equal(find({ petId: 1, refKey: 'aftercare', dueOn: null }).id, 2); // 오늘 보낸 것
  assert.equal(find({ petId: 1, refKey: 'custom', dueOn: null }), null); // 다른 종류
  assert.equal(find({ petId: 1, refKey: 'vaccine', dueOn: '2026-12-13' }), null); // void·skip은 보낸 것이 아님
  assert.equal(find({ petId: 2, refKey: 'vaccine', dueOn: '2026-12-13' }).id, 6);
  assert.equal(find({ petId: 3, refKey: 'vaccine', dueOn: '2026-11-25' }), null);
  assert.equal(find({ petId: 1, refKey: 'aftercare', dueOn: null, today: '2026-11-23' }), null); // 어제 보낸 진료 후 안내는 오늘 안내하지 않음
  const twice = [mk(7, '2026-11-20T10:00:00+09:00', { due_on: '2026-12-13' }), mk(8, '2026-11-22T10:00:00+09:00', { due_on: '2026-12-13' })];
  assert.equal(Core.findSameSend(twice, { petId: 1, refKey: 'vaccine', dueOn: '2026-12-13', today: TODAY }).id, 8);
});

check('kindLabel/statusLabel/prefLabel', () => {
  assert.equal(Core.kindLabel('manual', 'vaccine'), '접종 안내');
  assert.equal(Core.kindLabel('manual', 'reservation'), '예약 확인');
  assert.equal(Core.kindLabel('manual', 'aftercare'), '진료 후 안내');
  assert.equal(Core.kindLabel('manual', 'custom'), '직접 쓴 문구');
  assert.equal(Core.kindLabel('manual', 'zzz'), '문자');
  assert.equal(Core.kindLabel('vaccine', null), '접종 안내');
  assert.equal(Core.kindLabel('rebuy', null), '재구매 안내');
  assert.equal(Core.kindLabel('task', null), '일정 알림');
  assert.equal(Core.prefLabel(null), '아직 확인하지 않았어요');
  assert.equal(Core.prefLabel({ status: 'optout', status_on: '2026-11-22', method: '구두' }), '문자를 원하지 않는 분이에요');
  assert.equal(Core.prefLabel({ status: 'consented', status_on: '2026-11-22', method: '구두' }), '안내 받기로 한 분 (11월 22일 · 구두)');
  assert.equal(Core.prefLabel({ status: 'consented', status_on: '2026-11-22', method: null }), '안내 받기로 한 분 (11월 22일)');
  assert.equal(Core.prefLabel({ status: 'consented', status_on: null, method: '서면' }), '안내 받기로 한 분 (서면)');
  assert.equal(Core.prefLabel({ status: 'consented', status_on: null, method: null }), '안내 받기로 한 분');
});

// ---- 알림 이력 개편: 쉬운 상태 이름, 보호자별 묶기, 요약 ----
check('상태 이름은 쉬운 말: 보냈어요 / 건너뜀 / 되돌림, 상태 보기는 "보낸 문자"와 "되돌린 것까지"', () => {
  assert.deepEqual(['sent', 'skip', 'void'].map(Core.statusLabel), ['보냈어요', '건너뜀', '되돌림']);
  assert.deepEqual(Core.HISTORY_STATUSES, [{ id: 'sent', label: '보낸 문자' }, { id: 'all', label: '되돌린 것까지' }]);
});

const mkOwner = (id, createdAt, ownerId, ownerName, petId, petName, over = {}) => ({
  id, created_at: createdAt, kind: 'manual', ref_key: 'vaccine', due_on: null, status: 'sent', message_text: '문구',
  pet_id: petId, pet: { id: petId, name: petName, owner_id: ownerId, owner: { id: ownerId, name: ownerName } }, ...over
});

check('groupHistoryByOwner: 보호자별로 묶고 반려동물별 건수·마지막 시각을 알려 주며 최근 순으로 정렬', () => {
  const rows = [
    mkOwner(1, '2026-11-20T10:00:00+09:00', 10, '김현주', 1, '보리'),
    mkOwner(2, '2026-11-22T09:00:00+09:00', 10, '김현주', 2, '초코'),
    mkOwner(3, '2026-11-21T09:00:00+09:00', 11, '홍고은', 3, '콩이'),
    mkOwner(4, '2026-11-22T11:00:00+09:00', 10, '김현주', 1, '보리', { status: 'void' }),
    mkOwner(5, '2026-11-19T09:00:00+09:00', 12, '김현주', 4, '별이'), // 이름이 같아도 보호자 번호가 다르면 다른 사람
    { id: 6, created_at: '2026-11-18T09:00:00+09:00', kind: 'manual', ref_key: 'custom', due_on: null, status: 'sent', message_text: 'x', pet_id: null, pet: null }
  ];
  const groups = Core.groupHistoryByOwner(rows);
  assert.deepEqual(groups.map((g) => g.key), ['o10', 'o11', 'o12', 'none']);
  const first = groups[0];
  assert.equal(first.ownerName, '김현주');
  assert.equal(first.sentCount, 2);
  assert.equal(first.voidCount, 1);
  assert.deepEqual(first.pets.map((p) => [p.name, p.count]), [['초코', 1], ['보리', 1]]); // 보낸 건수, 최근 보낸 순
  assert.equal(first.lastAt, '2026-11-22T11:00:00+09:00');
  assert.deepEqual(first.rows.map((r) => r.id), [4, 2, 1]);
  assert.equal(groups[3].ownerName, '보호자 정보 없음');
  assert.deepEqual(Core.groupHistoryByOwner([]), []);
});

check('summarizeHistory: 오늘·이번 달 보낸 건수와 보낸 보호자 수(되돌린 것은 세지 않음)', () => {
  const rows = [
    mkOwner(1, '2026-11-22T09:00:00+09:00', 10, '김현주', 1, '보리'),
    mkOwner(2, '2026-11-22T10:00:00+09:00', 10, '김현주', 2, '초코', { status: 'void' }),
    mkOwner(3, '2026-11-05T10:00:00+09:00', 11, '홍고은', 3, '콩이'),
    mkOwner(4, '2026-10-30T10:00:00+09:00', 12, '박소영', 4, '별이')
  ];
  assert.deepEqual(Core.summarizeHistory(rows, TODAY), { todaySent: 1, monthSent: 2, ownerCount: 3 });
  assert.deepEqual(Core.summarizeHistory([], TODAY), { todaySent: 0, monthSent: 0, ownerCount: 0 });
});

check('문의 전화번호 넣기: 켜면 문구 끝에 들어가고, 끄면(기본) 병원 이름만 들어간다', () => {
  const input = { type: 'aftercare', petName: '보리', today: TODAY, clinicName: '병원이름' };
  assert.equal(Core.buildMessageText({ ...input, clinicPhone: '' }), '[병원이름] 보리 보호자님, 오늘 진료받은 보리의 상태를 잘 살펴봐 주세요. 이상이 있으면 연락 주세요.');
  assert.ok(Core.buildMessageText({ ...input, clinicPhone: '02-1' }).endsWith(' 문의: 02-1'));
});

// ---- 1단계: 공유 업무 → 메시지 화면 채우기 ----
check('reservationFromTask: 업무의 반려동물·날짜·시간을 예약 확인 문구용 값으로 바꾼다', () => {
  assert.deepEqual(Core.reservationFromTask({ pet_id: 5, due_date: '2026-11-25', scheduled_time: '10:00:00' }),
    { petId: 5, type: 'reservation', dueDate: '2026-11-25', time: '10:00' });
  assert.deepEqual(Core.reservationFromTask({ pet_id: 5, due_date: '2026-11-25', scheduled_time: '09:05' }),
    { petId: 5, type: 'reservation', dueDate: '2026-11-25', time: '09:05' });
  assert.deepEqual(Core.reservationFromTask({ pet_id: 5, due_date: '2026-11-25', scheduled_time: null }),
    { petId: 5, type: 'reservation', dueDate: '2026-11-25', time: '' });
  assert.deepEqual(Core.reservationFromTask({ pet_id: 5, due_date: null, scheduled_time: '10:00:00' }),
    { petId: 5, type: 'reservation', dueDate: null, time: '10:00' });
  assert.equal(Core.reservationFromTask({ pet_id: null, due_date: '2026-11-25', scheduled_time: null }), null);
  assert.equal(Core.reservationFromTask({ due_date: '2026-11-25', scheduled_time: null }), null);
});

check('plainPetLabel: 같은 이름 구분용 꼬리표(#번호)만 떼어 낸다', () => {
  assert.equal(Core.plainPetLabel('보리 (김현주) #12'), '보리 (김현주)');
  assert.equal(Core.plainPetLabel('보리 (김현주)'), '보리 (김현주)');
  assert.equal(Core.plainPetLabel('콩 (박) #3 '), '콩 (박)');
  assert.equal(Core.plainPetLabel('#1호 (이)'), '#1호 (이)');
});

// ---- 2단계: 알림 주기 설정 ----
check('RULE_KINDS·DEFAULT_LEAD_DAYS', () => {
  assert.deepEqual(Core.RULE_KINDS, [{ id: 'vaccine', label: '접종 안내' }, { id: 'rebuy', label: '재구매 안내' }]);
  assert.equal(Core.DEFAULT_LEAD_DAYS, 7);
});

check('parseRuleInput: 정상 값(공백·전각 숫자 허용)과 빈 lead는 기본값 7', () => {
  assert.deepEqual(Core.parseRuleInput({ intervalText: '30', leadText: '7' }), { ok: true, intervalDays: 30, leadDays: 7 });
  assert.deepEqual(Core.parseRuleInput({ intervalText: ' 30 ', leadText: '' }), { ok: true, intervalDays: 30, leadDays: 7 });
  assert.deepEqual(Core.parseRuleInput({ intervalText: '３０', leadText: '３' }), { ok: true, intervalDays: 30, leadDays: 3 });
  assert.deepEqual(Core.parseRuleInput({ intervalText: '3650', leadText: '365' }), { ok: true, intervalDays: 3650, leadDays: 365 });
  assert.deepEqual(Core.parseRuleInput({ intervalText: '1', leadText: '0' }), { ok: true, intervalDays: 1, leadDays: 0 });
});

check('parseRuleInput: 기간이 비어 있으면 "알림 안 함"(규칙 지우기)', () => {
  assert.deepEqual(Core.parseRuleInput({ intervalText: '', leadText: '7' }), { ok: true, intervalDays: null, leadDays: 7 });
  assert.deepEqual(Core.parseRuleInput({ intervalText: '   ', leadText: '7' }), { ok: true, intervalDays: null, leadDays: 7 });
});

check('parseRuleInput: 이상한 기간은 쉬운 말로 거절', () => {
  for (const bad of ['0', '-5', '3.5', 'abc', '3651', '1e3', '１２３４５', '30일']) {
    const result = Core.parseRuleInput({ intervalText: bad, leadText: '7' });
    assert.equal(result.ok, false, bad);
    assert.ok(result.error && result.error.includes('며칠마다'), bad);
  }
});

check('parseRuleInput: 이상한 며칠 전부터 값은 쉬운 말로 거절', () => {
  for (const bad of ['366', '-1', '1.5', 'x', '7일']) {
    const result = Core.parseRuleInput({ intervalText: '30', leadText: bad });
    assert.equal(result.ok, false, bad);
    assert.ok(result.error && result.error.includes('며칠 전부터'), bad);
  }
});

check('describeRule: 접종 안내와 재구매 안내를 쉬운 말로 설명', () => {
  assert.equal(Core.describeRule({ kind: 'vaccine', interval_days: 365, lead_days: 7 }), '접종 안내 · 365일마다 · 7일 전부터 알려요');
  assert.equal(Core.describeRule({ kind: 'rebuy', interval_days: 30, lead_days: 7 }), '재구매 안내 · 1개당 30일 · 여러 개 사면 기간도 곱해요 · 7일 전부터 알려요');
  assert.equal(Core.describeRule({ kind: 'rebuy', interval_days: 90, lead_days: 0 }), '재구매 안내 · 1개당 90일 · 여러 개 사면 기간도 곱해요 · 0일 전부터 알려요');
});

// ---- 3단계: 판매 때 다음 알림일 ----
check('UNIT_DAY_PRESETS·FIXED_PRESETS·MAX_NEXT_DUE_DAYS', () => {
  assert.deepEqual(Core.UNIT_DAY_PRESETS, [7, 14, 30, 60, 90]);
  assert.deepEqual(Core.FIXED_PRESETS, [{ label: '3주', days: 21 }, { label: '4주', days: 28 }, { label: '1년', days: 365 }]);
  assert.equal(Core.MAX_NEXT_DUE_DAYS, 3650);
});

check('calcNextDue: 재구매는 1개당 일수 × 수량, 접종은 정해진 간격(수량 곱하지 않음)', () => {
  assert.deepEqual(Core.calcNextDue({ kind: 'rebuy', intervalDays: 30, quantity: 3, soldOn: '2026-11-22' }), { ok: true, days: 90, dueOn: '2027-02-20' });
  assert.deepEqual(Core.calcNextDue({ kind: 'vaccine', intervalDays: 365, quantity: 5, soldOn: '2026-11-22' }), { ok: true, days: 365, dueOn: '2027-11-22' });
  assert.deepEqual(Core.calcNextDue({ kind: 'rebuy', intervalDays: 30, quantity: 0.5, soldOn: '2026-11-22' }), { ok: true, days: 15, dueOn: '2026-12-07' });
});

check('calcNextDue: 월말·윤년·경계값', () => {
  assert.equal(Core.calcNextDue({ kind: 'rebuy', intervalDays: 30, quantity: 1, soldOn: '2026-01-31' }).dueOn, '2026-03-02');
  assert.equal(Core.calcNextDue({ kind: 'rebuy', intervalDays: 1, quantity: 1, soldOn: '2028-02-28' }).dueOn, '2028-02-29');
  assert.equal(Core.calcNextDue({ kind: 'rebuy', intervalDays: 365, quantity: 10, soldOn: '2026-11-22' }).ok, true); // 3650일 정확히는 허용
});

check('calcNextDue: 이상한 입력과 너무 먼 날짜는 거절', () => {
  const base = { kind: 'rebuy', intervalDays: 30, quantity: 1, soldOn: '2026-11-22' };
  assert.deepEqual(Core.calcNextDue({ ...base, quantity: 200 }), { ok: false, reason: 'too-far' });
  assert.deepEqual(Core.calcNextDue({ ...base, intervalDays: 3651 }), { ok: false, reason: 'too-far' });
  for (const bad of [{ quantity: 0 }, { quantity: -1 }, { quantity: NaN }, { intervalDays: 0 }, { intervalDays: 1.5 }, { soldOn: '2026/11/22' }, { soldOn: '' }, { kind: 'zzz' }, { quantity: 0.01 }]) {
    assert.deepEqual(Core.calcNextDue({ ...base, ...bad }), { ok: false, reason: 'invalid' }, JSON.stringify(bad));
  }
});

check('nextDueText: 쉬운 문장, 수량이 소수면 그대로, 계산이 안 되면 빈 문자열', () => {
  assert.equal(Core.nextDueText({ kind: 'rebuy', intervalDays: 30, quantity: 3, soldOn: '2026-11-22' }), '3개 × 30일 = 90일 뒤 · 2027-02-20');
  assert.equal(Core.nextDueText({ kind: 'vaccine', intervalDays: 365, quantity: 1, soldOn: '2026-11-22' }), '365일 뒤 · 2027-11-22');
  assert.equal(Core.nextDueText({ kind: 'rebuy', intervalDays: 30, quantity: 0.5, soldOn: '2026-11-22' }), '0.5개 × 30일 = 15일 뒤 · 2026-12-07');
  assert.equal(Core.nextDueText({ kind: 'rebuy', intervalDays: 30, quantity: 200, soldOn: '2026-11-22' }), '');
});

check('sumQuantity: (반려동물, 상품)별 수량 합계, 반려동물 없는 줄은 제외', () => {
  const sums = Core.sumQuantity([
    { productId: 5, petId: 1, quantity: 2 }, { productId: 5, petId: 1, quantity: 3 }, // 가격이 달라 두 줄이 된 경우
    { productId: 5, petId: 2, quantity: 1 }, { productId: 6, petId: 1, quantity: 4 },
    { productId: 7, petId: null, quantity: 9 }, { productId: 8, quantity: 1 }
  ]);
  assert.equal(sums.get('1:5'), 5);
  assert.equal(sums.get('2:5'), 1);
  assert.equal(sums.get('1:6'), 4);
  assert.equal(sums.size, 3);
  assert.equal(Core.sumQuantity([]).size, 0);
});

// ---- 4단계: 알림 후보 계산 ----
const candBase = () => ({
  today: '2026-11-22',
  dueRows: [{ pet_id: 1, product_id: 10, due_on: '2026-11-29', sold_on: '2026-11-22' }],
  rules: [{ product_id: 10, kind: 'rebuy', lead_days: 7 }],
  pets: [{ id: 1, name: '초코', owner_id: 100 }],
  prefs: [],
  logs: [],
  validPurchases: new Set(['1:10:2026-11-22']),
  productNames: new Map([[10, '심장사상충약']])
});
const build = (patch = {}) => Core.buildCandidates({ ...candBase(), ...patch });

check('buildCandidates: 기본 재구매 후보(알림 시작일 도래)', () => {
  const [c] = build();
  assert.deepEqual({ ...c }, { key: '1:10', petId: 1, petName: '초코', ownerId: 100, productId: 10, productName: '심장사상충약', kind: 'rebuy', refKey: 'p10', dueOn: '2026-11-29', startOn: '2026-11-22', showOn: '2026-11-29', overdue: false, ready: true });
});

check('buildCandidates: 시작일 전이면 ready=false로 남는다', () => {
  const [c] = build({ today: '2026-11-21' });
  assert.equal(c.ready, false);
  assert.equal(c.startOn, '2026-11-22');
});

check('buildCandidates: 규칙 없음·구매 취소·수신거부는 제외', () => {
  assert.equal(build({ rules: [] }).length, 0);
  assert.equal(build({ validPurchases: new Set() }).length, 0);
  assert.equal(build({ prefs: [{ owner_id: 100, status: 'optout' }] }).length, 0);
  assert.equal(build({ prefs: [{ owner_id: 100, status: 'consented' }] }).length, 1);
});

check('buildCandidates: 이미 보냄·넘김 기록이 같은 건이면 제외, 다른 예정일·되돌림은 남는다', () => {
  const log = (patch) => ({ pet_id: 1, kind: 'rebuy', ref_key: 'p10', due_on: '2026-11-29', status: 'sent', ...patch });
  assert.equal(build({ logs: [log({})] }).length, 0);
  assert.equal(build({ logs: [log({ status: 'skip' })] }).length, 0);
  assert.equal(build({ logs: [log({ status: 'void' })] }).length, 1);
  assert.equal(build({ logs: [log({ due_on: '2026-12-29' })] }).length, 1);
  assert.equal(build({ logs: [log({ kind: 'vaccine' })] }).length, 0); // 규칙 종류를 나중에 바꿔도 같은 건은 다시 제안하지 않는다
});

check('buildCandidates: 재구매는 기한이 지나면 제외, 접종은 7일까지 유예(overdue, 오늘 칸)', () => {
  assert.equal(build({ today: '2026-11-30' }).length, 0);
  const vaccine = { rules: [{ product_id: 10, kind: 'vaccine', lead_days: 7 }] };
  const [late] = build({ ...vaccine, today: '2026-12-02' });
  assert.equal(late.overdue, true);
  assert.equal(late.showOn, '2026-12-02');
  assert.equal(late.ready, true);
  assert.equal(build({ ...vaccine, today: '2026-12-06' }).length, 1); // 예정일 +7일
  assert.equal(build({ ...vaccine, today: '2026-12-07' }).length, 0);
});

check('buildCandidates: 재구매는 마지막 구매가 6개월(183일)을 넘으면 동의한 보호자만', () => {
  const old = { dueRows: [{ pet_id: 1, product_id: 10, due_on: '2026-11-29', sold_on: '2026-05-01' }], validPurchases: new Set(['1:10:2026-05-01']) };
  assert.equal(build(old).length, 0);
  assert.equal(build({ ...old, prefs: [{ owner_id: 100, status: 'consented' }] }).length, 1);
  const edge = { dueRows: [{ pet_id: 1, product_id: 10, due_on: '2026-11-29', sold_on: '2026-05-23' }], validPurchases: new Set(['1:10:2026-05-23']) };
  assert.equal(build(edge).length, 1); // 183일째까지는 허용
  const over = { dueRows: [{ pet_id: 1, product_id: 10, due_on: '2026-11-29', sold_on: '2026-05-22' }], validPurchases: new Set(['1:10:2026-05-22']) };
  assert.equal(build(over).length, 0);
});

check('buildCandidates: 접종 안내는 6개월 제한이 없다', () => {
  const [c] = build({ rules: [{ product_id: 10, kind: 'vaccine', lead_days: 7 }], dueRows: [{ pet_id: 1, product_id: 10, due_on: '2026-11-29', sold_on: '2025-11-29' }], validPurchases: new Set(['1:10:2025-11-29']) });
  assert.equal(c.kind, 'vaccine');
});

check('buildCandidates: 반려동물이 없거나 상품 이름이 없어도 죽지 않고 정렬된다', () => {
  const rows = build({
    dueRows: [
      { pet_id: 1, product_id: 10, due_on: '2026-11-30', sold_on: '2026-11-22' },
      { pet_id: 2, product_id: 10, due_on: '2026-11-25', sold_on: '2026-11-22' },
      { pet_id: 3, product_id: 10, due_on: '2026-11-24', sold_on: '2026-11-22' }
    ],
    pets: [{ id: 1, name: '초코', owner_id: 100 }, { id: 2, name: '보리', owner_id: 101 }],
    validPurchases: new Set(['1:10:2026-11-22', '2:10:2026-11-22', '3:10:2026-11-22']),
    productNames: new Map()
  });
  assert.deepEqual(rows.map((c) => c.petId), [2, 1]); // 3번은 반려동물 정보가 없어 제외, 나머지는 날짜순
  assert.equal(rows[0].productName, '상품');
});

check('candidatesByDay: 7일 칸에 날짜별로 담고 범위 밖은 뺀다', () => {
  const cands = build({
    dueRows: [
      { pet_id: 1, product_id: 10, due_on: '2026-11-29', sold_on: '2026-11-22' },
      { pet_id: 1, product_id: 11, due_on: '2026-12-10', sold_on: '2026-11-22' }
    ],
    rules: [{ product_id: 10, kind: 'rebuy', lead_days: 7 }, { product_id: 11, kind: 'rebuy', lead_days: 30 }],
    validPurchases: new Set(['1:10:2026-11-22', '1:11:2026-11-22']),
    productNames: new Map([[10, 'A'], [11, 'B']])
  });
  const byDay = Core.candidatesByDay(cands, '2026-11-22', 7);
  assert.equal(byDay.size, 7);
  assert.deepEqual([...byDay.keys()][0], '2026-11-22');
  assert.equal(byDay.get('2026-11-28').length, 0);
  assert.equal(byDay.get('2026-11-29')?.length ?? 0, 0); // 7일 칸은 22~28일
  const next = Core.candidatesByDay(cands, '2026-11-25', 7);
  assert.equal(next.get('2026-11-29').length, 1);
  assert.equal(next.get('2026-12-01').length, 0);
});

check('rebuyText: 광고 표시·수신거부 안내·병원 정보가 들어가고 QR에 들어갈 만큼 짧다', () => {
  const text = Core.rebuyText({ petName: '초코', productName: '심장사상충약' });
  assert.ok(text.startsWith('(광고) '));
  assert.ok(text.includes('수신거부'));
  assert.ok(text.includes('구민동물병원') && text.includes('02-543-1945'));
  assert.ok(text.includes('초코') && text.includes('심장사상충약'));
  assert.equal(Core.checkQr('01012345678', text).ok, true);
  const long = Core.rebuyText({ petName: '아주아주긴반려동물이름입니다', productName: '아주 긴 상품 이름'.repeat(8) });
  assert.equal(Core.checkQr('01012345678', long).ok, true);
  assert.ok(long.startsWith('(광고) ') && long.includes('수신거부'));
});


check('buildCandidates: 메시지 화면에서 직접 보낸 같은 반려동물·같은 예정일 접종 안내도 처리된 것으로 본다', () => {
  const vaccine = { rules: [{ product_id: 10, kind: 'vaccine', lead_days: 7 }] };
  const manual = { pet_id: 1, kind: 'manual', ref_key: 'vaccine', due_on: '2026-11-29', status: 'sent' };
  assert.equal(build({ ...vaccine, logs: [manual] }).length, 0);
  assert.equal(build({ ...vaccine, logs: [{ ...manual, due_on: '2026-12-29' }] }).length, 1);
  assert.equal(build({ ...vaccine, logs: [{ ...manual, ref_key: 'custom' }] }).length, 1);
  assert.equal(build({ logs: [manual] }).length, 1); // 재구매 후보는 접종 수동 발송과 무관
});

check('rebuyText: 설정에서 바꾼 병원 이름·전화번호를 따르고, 전화번호를 끄면 넣지 않는다', () => {
  const custom = Core.rebuyText({ petName: '초코', productName: '약', clinicName: '새병원', clinicPhone: '031-111-2222' });
  assert.ok(custom.includes('[새병원]') && custom.includes('031-111-2222') && !custom.includes('02-543-1945'));
  const noPhone = Core.rebuyText({ petName: '초코', productName: '약', clinicName: '새병원', clinicPhone: '' });
  assert.ok(!noPhone.includes('문의:') && noPhone.includes('수신거부'));
});

console.log(process.exitCode ? 'messaging-core: 실패 있음' : `messaging-core: ${count}개 통과`);
