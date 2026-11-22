// 메시지 발송 화면용 순수 함수 모음: 번호 정리, 날짜·시간 표기, 문구 만들기, QR에 넣을 내용 만들기.
// 화면(app.js)과 Node 시험(tests/messaging-core.test.cjs)이 함께 쓴다.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./qr-code.js'));
  else root.MessagingCore = factory(root.QrCode);
})(typeof self !== 'undefined' ? self : this, function (QrCode) {
  'use strict';

  const MESSAGE_TYPES = [
    { id: 'vaccine', label: '접종 안내' },
    { id: 'reservation', label: '예약 확인' },
    { id: 'aftercare', label: '진료 후 안내' },
    { id: 'custom', label: '직접 쓰기' }
  ];
  const VACCINE_CHOICES = ['종합백신', '광견병', '켄넬코프', '코로나', '심장사상충 예방'];
  const DUE_QUICK_CHOICES = [{ label: '3주 후', days: 21 }, { label: '4주 후', days: 28 }, { label: '1년 후', years: 1 }];
  const TOKEN_LABELS = ['[반려견 이름]', '[날짜]', '[병원 이름]'];
  // 문구 맨 앞과 끝에 고정으로 들어가는 병원 정보. 바꿀 일이 생기면 여기만 고치면 된다.
  const CLINIC = { name: '구민동물병원', phone: '02-543-1945' };
  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

  // 문구 초안은 여기 한 곳에서만 고치면 된다. 각 함수는 병원 이름·문의 전화를 뺀 본문만 돌려준다.
  // 반려동물 이름은 받침 유무에 따라 어울리는 조사가 달라지므로 "가/이", "는/은" 같은 조사는 쓰지 않고 "의"만 쓴다.
  const TEMPLATES = {
    vaccine: ({ petName, vaccineName, dateText }) => `${petName} 보호자님, ${petName}의 ${vaccineName ? `${vaccineName} ` : ''}접종일이 ${dateText}입니다.`,
    reservation: ({ petName, dateText, timeText }) => `${petName} 보호자님, ${dateText}${timeText ? ` ${timeText}` : ''} 예약이 확인되었습니다.`,
    aftercare: ({ petName }) => `${petName} 보호자님, 오늘 진료받은 ${petName}의 상태를 잘 살펴봐 주세요. 이상이 있으면 연락 주세요.`
  };

  function normalizeMobile(phone) {
    let digits = String(phone ?? '').replace(/\D/g, '');
    if (digits.length === 8) {
      digits = `010${digits}`; // 010을 빼고 저장된 번호(가운데 번호가 82로 시작해도 국가번호가 아님)
    } else if (digits.startsWith('82')) {
      const rest = digits.slice(2);
      digits = rest.startsWith('0') ? rest : `0${rest}`;
    }
    return /^01[016789]\d{7,8}$/.test(digits) ? digits : null;
  }

  function parseIso(isoDate) {
    const [year, month, day] = String(isoDate).split('-').map(Number);
    return { year, month, day };
  }
  function toIso(date) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  }
  function addDays(isoDate, days) {
    const { year, month, day } = parseIso(isoDate);
    return toIso(new Date(Date.UTC(year, month - 1, day + days)));
  }
  // 1년 후 같은 달력 날짜. 윤일(2/29)은 다음 해에 없으면 2/28로 맞춘다(365일을 더하면 윤년 전후로 하루 틀어진다).
  function addYears(isoDate, years) {
    const { year, month, day } = parseIso(isoDate);
    const target = year + years;
    const isLeap = (target % 4 === 0 && target % 100 !== 0) || target % 400 === 0;
    return toIso(new Date(Date.UTC(target, month - 1, month === 2 && day === 29 && !isLeap ? 28 : day)));
  }
  function formatDueDate(isoDate, todayIso) {
    const { year, month, day } = parseIso(isoDate);
    const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
    const prefix = year === parseIso(todayIso).year ? '' : `${year}년 `;
    return `${prefix}${month}월 ${day}일(${weekday})`;
  }
  function isPast(isoDate, todayIso) { return isoDate < todayIso; }

  function formatTime(hhmm) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? ''));
    if (!match) return '';
    const hour = Number(match[1]); const minute = Number(match[2]);
    const period = hour < 12 ? '오전' : '오후';
    const hour12 = hour % 12 === 0 ? 12 : hour % 12;
    return `${period} ${hour12}시${minute ? ` ${minute}분` : ''}`;
  }

  function buildMessageText({ type, clinicName, clinicPhone, petName, vaccineName, dueDate, time, today }) {
    const template = TEMPLATES[type];
    if (!template || !petName) return '';
    if ((type === 'vaccine' || type === 'reservation') && !dueDate) return '';
    const body = template({
      petName, vaccineName,
      dateText: dueDate ? formatDueDate(dueDate, today) : '',
      timeText: formatTime(time)
    });
    return `${clinicName ? `[${clinicName}] ` : ''}${body}${clinicPhone ? ` 문의: ${clinicPhone}` : ''}`;
  }

  function insertToken(text, selectionStart, selectionEnd, token) {
    return { text: text.slice(0, selectionStart) + token + text.slice(selectionEnd), caret: selectionStart + token.length };
  }

  function fillTokens(text, { petName, dueDate, clinicName, today }) {
    let result = text;
    if (petName) result = result.split('[반려견 이름]').join(petName);
    if (dueDate) result = result.split('[날짜]').join(formatDueDate(dueDate, today));
    if (clinicName) result = result.split('[병원 이름]').join(clinicName);
    return result;
  }

  // 만들어진 문구를 직접 쓰기로 넘길 때, 문구 속 반려동물 이름과 날짜를 토큰으로 되돌려
  // 반려동물·날짜를 바꿔도 옛 이름·날짜가 문구에 남지 않게 한다.
  function tokenize(text, { petName, dueDate, today }) {
    let result = text;
    if (dueDate) result = result.split(formatDueDate(dueDate, today)).join('[날짜]');
    if (petName) result = result.split(petName).join('[반려견 이름]');
    return result;
  }

  // 값을 채우지 못해 문구에 그대로 남은 [날짜] 같은 토큰. 이런 문구는 보호자에게 보내면 안 된다.
  function findUnfilledTokens(text) {
    return TOKEN_LABELS.filter((token) => String(text).includes(token));
  }

  // 문자 앱은 줄바꿈을 QR로 안정적으로 받지 못하는 경우가 있어 공백 하나로 바꿔 넣는다.
  function toQrText(phoneDigits, text) {
    return `SMSTO:${phoneDigits}:${String(text).replace(/\r\n|\r|\n/g, ' ')}`;
  }

  function checkQr(phone, text) {
    const digits = normalizeMobile(phone);
    const bytes = QrCode.byteLength(toQrText(digits || '', text));
    const base = { bytes, maxBytes: QrCode.MAX_BYTES };
    if (!digits) return { ok: false, reason: 'bad-phone', ...base };
    if (!String(text).trim()) return { ok: false, reason: 'empty-text', ...base };
    if (bytes > QrCode.MAX_BYTES) return { ok: false, reason: 'too-long', ...base };
    return { ok: true, reason: 'ok', ...base };
  }

  // ---- 알림 주기 설정 ----
  // 규칙의 종류: 접종 안내(정해진 간격, 정보성) / 재구매 안내(판매 단위 1개당 일수 × 수량, 광고로 볼 소지가 있음).
  // 실제 상품 분류에 접종 분류가 없어서 분류가 아니라 규칙마다 종류를 고른다.
  const RULE_KINDS = [{ id: 'vaccine', label: '접종 안내' }, { id: 'rebuy', label: '재구매 안내' }];
  const DEFAULT_LEAD_DAYS = 7;

  // 전각 숫자('３０')를 반각으로 바꾸고 숫자만(부호·소수점·지수 표기 없이) 받는다.
  function parseWholeNumber(text) {
    const half = String(text ?? '').trim().replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
    return /^\d+$/.test(half) ? Number(half) : null;
  }

  // 입력 칸의 글자를 검사한다. 기간이 비어 있으면 "알림 안 함"(규칙 지우기)이다.
  function parseRuleInput({ intervalText, leadText }) {
    const intervalEmpty = String(intervalText ?? '').trim() === '';
    const leadEmpty = String(leadText ?? '').trim() === '';
    let intervalDays = null;
    if (!intervalEmpty) {
      intervalDays = parseWholeNumber(intervalText);
      if (intervalDays === null || intervalDays < 1 || intervalDays > 3650) {
        return { ok: false, error: '며칠마다인지 1에서 3650 사이 숫자로 넣어 주세요.' };
      }
    }
    let leadDays = DEFAULT_LEAD_DAYS;
    if (!leadEmpty && !intervalEmpty) {
      leadDays = parseWholeNumber(leadText);
      if (leadDays === null || leadDays > 365) {
        return { ok: false, error: '며칠 전부터인지 0에서 365 사이 숫자로 넣어 주세요.' };
      }
    } else if (!leadEmpty) {
      leadDays = parseWholeNumber(leadText) ?? DEFAULT_LEAD_DAYS;
    }
    return { ok: true, intervalDays, leadDays };
  }

  function describeRule(rule) {
    const lead = `${rule.lead_days}일 전부터 알려요`;
    return rule.kind === 'vaccine'
      ? `접종 안내 · ${rule.interval_days}일마다 · ${lead}`
      : `재구매 안내 · 1개당 ${rule.interval_days}일 · 여러 개 사면 기간도 곱해요 · ${lead}`;
  }

  // ---- 판매 화면: 다음 알림일 ----
  const UNIT_DAY_PRESETS = [7, 14, 30, 60, 90]; // "이 상품 1개로 며칠 쓰나요?" 버튼
  const FIXED_PRESETS = [{ label: '3주', days: 21 }, { label: '4주', days: 28 }, { label: '1년', days: 365 }]; // 접종처럼 정해진 간격 버튼
  const MAX_NEXT_DUE_DAYS = 3650;

  // 다음 알림일 계산. 재구매 안내는 판매 단위 1개당 일수 × 수량, 접종 안내는 정해진 간격(수량을 곱하지 않음).
  function calcNextDue({ kind, intervalDays, quantity, soldOn }) {
    if (kind !== 'rebuy' && kind !== 'vaccine') return { ok: false, reason: 'invalid' };
    if (!Number.isInteger(intervalDays) || intervalDays < 1) return { ok: false, reason: 'invalid' };
    if (!Number.isFinite(quantity) || quantity <= 0) return { ok: false, reason: 'invalid' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(soldOn))) return { ok: false, reason: 'invalid' };
    const days = kind === 'rebuy' ? Math.round(intervalDays * quantity) : intervalDays;
    if (days < 1) return { ok: false, reason: 'invalid' };
    if (days > MAX_NEXT_DUE_DAYS) return { ok: false, reason: 'too-far' };
    return { ok: true, days, dueOn: addDays(soldOn, days) };
  }

  function nextDueText({ kind, intervalDays, quantity, soldOn }) {
    const result = calcNextDue({ kind, intervalDays, quantity, soldOn });
    if (!result.ok) return '';
    return kind === 'rebuy'
      ? `${quantity}개 × ${intervalDays}일 = ${result.days}일 뒤 · ${result.dueOn}`
      : `${result.days}일 뒤 · ${result.dueOn}`;
  }

  // (반려동물, 상품)별 수량 합계. 같은 상품·같은 반려동물이 가격 때문에 여러 줄이어도 한 번만 계산하려고 쓴다.
  function sumQuantity(items) {
    const sums = new Map();
    items.forEach((item) => {
      if (item.petId === null || item.petId === undefined) return;
      const key = `${item.petId}:${item.productId}`;
      sums.set(key, (sums.get(key) || 0) + item.quantity);
    });
    return sums;
  }

  // ---- 알림 후보 계산(4단계) ----
  const REBUY_WINDOW_DAYS = 183; // 마지막 구매가 이 기간 안이거나 보호자가 동의했을 때만 재구매 안내를 제안한다(약 6개월)
  const VACCINE_GRACE_DAYS = 7; // 접종 안내는 예정일이 지나도 이 기간까지만 "지났어요"로 남긴다

  function daysBetween(fromIso, toIso) {
    const from = parseIso(fromIso);
    const to = parseIso(toIso);
    return Math.round((Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) / 86400000);
  }

  // 저장된 다음 알림일(pet_next_due)에서 "알림 보낼 때예요" 후보를 만든다. 화면과 무관한 순수 계산이다.
  //  dueRows: [{ pet_id, product_id, due_on, sold_on }], rules: [{ product_id, kind, lead_days }],
  //  pets: [{ id, name, owner_id }], prefs: [{ owner_id, status }], logs: [{ pet_id, kind, ref_key, due_on, status }],
  //  validPurchases: Set("반려동물:상품:구매일") — 취소되지 않은 판매만 들어 있다, productNames: Map(상품 번호 -> 이름)
  function buildCandidates({ today, dueRows, rules, pets, prefs, logs, validPurchases, productNames }) {
    const ruleOf = new Map(rules.map((rule) => [rule.product_id, rule]));
    const petOf = new Map(pets.map((pet) => [pet.id, pet]));
    const prefOf = new Map(prefs.map((pref) => [pref.owner_id, pref.status]));
    const handled = new Set(logs.filter((log) => log.status === 'sent' || log.status === 'skip').map((log) => `${log.pet_id}:${log.ref_key}:${log.due_on}`)); // 종류는 보지 않는다: 규칙 종류를 나중에 바꿔도 같은 건을 다시 제안하지 않는다
    const manualVaccine = new Set(logs.filter((log) => (log.status === 'sent' || log.status === 'skip') && log.kind === 'manual' && log.ref_key === 'vaccine').map((log) => `${log.pet_id}:${log.due_on}`));
    const result = [];
    dueRows.forEach((row) => {
      const rule = ruleOf.get(row.product_id);
      const pet = petOf.get(row.pet_id);
      if (!rule || !pet) return;
      if (!validPurchases.has(`${row.pet_id}:${row.product_id}:${row.sold_on}`)) return; // 취소된 판매
      const status = prefOf.get(pet.owner_id);
      if (status === 'optout') return;
      const refKey = `p${row.product_id}`;
      if (handled.has(`${row.pet_id}:${refKey}:${row.due_on}`)) return;
      if (rule.kind === 'vaccine' && manualVaccine.has(`${row.pet_id}:${row.due_on}`)) return; // 메시지 화면에서 직접 보낸 같은 날짜 접종 안내
      const lateDays = daysBetween(row.due_on, today);
      if (rule.kind === 'rebuy') {
        if (lateDays > 0) return; // 기한이 지난 재구매는 제안하지 않는다(다른 곳에서 샀거나 방문 의사가 없을 수 있다)
        if (daysBetween(row.sold_on, today) > REBUY_WINDOW_DAYS && status !== 'consented') return;
      } else if (lateDays > VACCINE_GRACE_DAYS) return;
      const overdue = lateDays > 0;
      const startOn = addDays(row.due_on, -(rule.lead_days ?? DEFAULT_LEAD_DAYS));
      result.push({
        key: `${row.pet_id}:${row.product_id}`, petId: row.pet_id, petName: pet.name, ownerId: pet.owner_id,
        productId: row.product_id, productName: productNames.get(row.product_id) || '상품', kind: rule.kind, refKey,
        dueOn: row.due_on, startOn, showOn: overdue ? today : row.due_on, overdue, ready: today >= startOn
      });
    });
    return result.sort((a, b) => a.showOn.localeCompare(b.showOn) || a.petName.localeCompare(b.petName, 'ko'));
  }

  // 오늘부터 N일을 날짜별 칸으로 나눈다(범위 밖 후보는 뺀다). 키는 날짜(YYYY-MM-DD)이고 후보가 없는 날도 빈 배열로 넣는다.
  function candidatesByDay(candidates, todayIso, dayCount) {
    const byDay = new Map();
    for (let i = 0; i < dayCount; i += 1) byDay.set(addDays(todayIso, i), []);
    candidates.forEach((candidate) => { if (byDay.has(candidate.showOn)) byDay.get(candidate.showOn).push(candidate); });
    return byDay;
  }

  // 재구매 안내 문구: 광고로 볼 소지가 있어 맨 앞에 (광고)를 붙이고 수신거부 방법을 넣는다. QR에 안 들어갈 만큼 길면 상품 이름을 줄인다.
  function rebuyText({ petName, productName, clinicName = CLINIC.name, clinicPhone = CLINIC.phone }) {
    const make = (pet, product) => `(광고) ${clinicName ? `[${clinicName}] ` : ''}${pet}${product ? ` ${product}` : ''} 다시 필요할 때예요.${clinicPhone ? ` 문의: ${clinicPhone}` : ''} 수신거부: 병원에 말씀해 주세요`;
    const fits = (text) => checkQr('01000000000', text).ok;
    let pet = String(petName || '').trim();
    let name = String(productName || '').trim();
    let text = make(pet, name);
    while (!fits(text) && name.length > 0) {
      name = name.length > 4 ? `${name.slice(0, Math.max(2, name.length - 4))}…` : '';
      text = make(pet, name);
    }
    while (!fits(text) && pet.length > 2) { pet = pet.slice(0, -1); text = make(pet, name); } // 아주 긴 이름은 마지막 수단으로 줄인다
    return text;
  }

  // ---- 공유 업무 → 메시지 화면 ----
  // 반려동물이 연결된 업무를 "예약 확인" 문구로 채울 값으로 바꾼다. 반려동물이 없으면 null.
  function reservationFromTask(task) {
    if (!task || task.pet_id === null || task.pet_id === undefined) return null;
    return {
      petId: task.pet_id,
      type: 'reservation',
      dueDate: task.due_date || null,
      time: task.scheduled_time ? String(task.scheduled_time).slice(0, 5) : ''
    };
  }

  // 반려동물 목록의 같은 이름 구분용 꼬리표(" #12")를 떼어 낸다(제목 등에 넣을 때 쓴다).
  function plainPetLabel(label) {
    return String(label).replace(/\s*#\d+\s*$/, '').trim();
  }

  // ---- 알림 이력(보낸 문자 기록) ----
  const HISTORY_RANGES = [{ id: 'today', label: '오늘' }, { id: '7d', label: '7일' }, { id: '30d', label: '30일' }, { id: 'all', label: '전체' }];
  // 상태 보기는 두 가지만 둔다: 보낸 문자(기본) / 되돌린 것까지. '건너뜀'(skip)은 4단계 추천 카드에서 쓰게 되면 그때 보기에 추가한다.
  const HISTORY_STATUSES = [{ id: 'sent', label: '보낸 문자' }, { id: 'all', label: '되돌린 것까지' }];
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

  // 시각 문자열을 한국 시간(UTC+9) 기준으로 본다. 브라우저 시간대 설정에 영향받지 않는다.
  function kstParts(isoTimestamp) {
    const shifted = new Date(new Date(isoTimestamp).getTime() + KST_OFFSET_MS);
    return { date: toIso(shifted), time: `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}` };
  }
  function toKstDate(isoTimestamp) { return kstParts(isoTimestamp).date; }
  function toKstTime(isoTimestamp) { return kstParts(isoTimestamp).time; }

  function historyStartDate(rangeId, todayIso) {
    if (rangeId === 'today') return todayIso;
    if (rangeId === '7d') return addDays(todayIso, -6);
    if (rangeId === '30d') return addDays(todayIso, -29);
    return null;
  }

  function historyPetText(row) {
    return row.pet ? `${row.pet.name || ''} ${row.pet.owner && row.pet.owner.name ? row.pet.owner.name : ''}` : '';
  }
  function filterHistory(rows, { range, status, keyword, today, matches }) {
    const start = historyStartDate(range, today);
    const word = String(keyword || '').trim();
    return rows.filter((row) => {
      const date = toKstDate(row.created_at);
      if (start && (date < start || date > today)) return false;
      if (status && status !== 'all' && row.status !== status) return false;
      if (word && (!row.pet || !matches(historyPetText(row), word))) return false;
      return true;
    });
  }

  function groupHistoryByDate(rows) {
    const sorted = [...rows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const groups = [];
    sorted.forEach((row) => {
      const date = toKstDate(row.created_at);
      const last = groups[groups.length - 1];
      if (last && last.date === date) last.rows.push(row);
      else groups.push({ date, rows: [row] });
    });
    return groups;
  }

  // "이미 보냈어요" 안내용: 같은 반려동물·같은 종류·같은 예정일(날짜가 없는 종류는 오늘 보낸 것)만 같은 건으로 본다.
  // 기간을 정해 두고 보지 않는다 — 주기가 짧은 약·2~3주 간격 접종이 매번 "이미 보냈어요"로 뜨지 않게.
  function findSameSend(rows, { petId, refKey, dueOn, today }) {
    const matched = rows.filter((row) => {
      if (row.status !== 'sent' || row.ref_key !== refKey) return false;
      if ((row.pet ? row.pet.id : row.pet_id) !== petId) return false;
      return dueOn ? row.due_on === dueOn : toKstDate(row.created_at) === today;
    });
    matched.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return matched[0] || null;
  }

  // 보호자별 보기: 같은 보호자의 반려동물·문자를 한곳에 모은다. 이름이 같아도 보호자 번호가 다르면 다른 사람이다.
  function historyOwnerKey(row) {
    if (row.pet && row.pet.owner && row.pet.owner.id != null) return `o${row.pet.owner.id}`;
    if (row.pet && row.pet.owner_id != null) return `o${row.pet.owner_id}`;
    return 'none';
  }
  function groupHistoryByOwner(rows) {
    const byKey = new Map();
    rows.forEach((row) => {
      const key = historyOwnerKey(row);
      if (!byKey.has(key)) byKey.set(key, { key, ownerName: key === 'none' ? '보호자 정보 없음' : ((row.pet.owner && row.pet.owner.name) || '보호자'), sentCount: 0, voidCount: 0, lastAt: row.created_at, rows: [], petMap: new Map() });
      const group = byKey.get(key);
      group.rows.push(row);
      if (new Date(row.created_at) > new Date(group.lastAt)) group.lastAt = row.created_at;
      if (row.status === 'sent') {
        group.sentCount += 1;
        if (row.pet) {
          const pet = group.petMap.get(row.pet.id) || { id: row.pet.id, name: row.pet.name, count: 0, lastAt: row.created_at };
          pet.count += 1;
          if (new Date(row.created_at) > new Date(pet.lastAt)) pet.lastAt = row.created_at;
          group.petMap.set(row.pet.id, pet);
        }
      }
      if (row.status === 'void') group.voidCount += 1;
    });
    return [...byKey.values()].map((group) => {
      group.rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      const pets = [...group.petMap.values()].sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt)).map(({ id, name, count }) => ({ id, name, count }));
      const { petMap, ...rest } = group;
      return { ...rest, pets };
    }).sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
  }

  // 이력 맨 위 요약: 오늘·이번 달 보낸 건수, 보낸 보호자 수(보낸 것만 센다).
  function summarizeHistory(rows, todayIso) {
    const sent = rows.filter((row) => row.status === 'sent');
    const month = todayIso.slice(0, 7);
    return {
      todaySent: sent.filter((row) => toKstDate(row.created_at) === todayIso).length,
      monthSent: sent.filter((row) => toKstDate(row.created_at).slice(0, 7) === month).length,
      ownerCount: new Set(sent.map(historyOwnerKey).filter((key) => key !== 'none')).size
    };
  }

  const MANUAL_LABELS = { vaccine: '접종 안내', reservation: '예약 확인', aftercare: '진료 후 안내', custom: '직접 쓴 문구' };
  const KIND_LABELS = { vaccine: '접종 안내', rebuy: '재구매 안내', task: '일정 알림' };
  function kindLabel(kind, refKey) {
    if (kind === 'manual') return MANUAL_LABELS[refKey] || '문자';
    return KIND_LABELS[kind] || '문자';
  }
  function statusLabel(status) { return { sent: '보냈어요', skip: '건너뜀', void: '되돌림' }[status] || ''; }
  function prefLabel(pref) {
    if (!pref) return '아직 확인하지 않았어요';
    if (pref.status === 'optout') return '문자를 원하지 않는 분이에요';
    const parts = [];
    if (pref.status_on) { const { month, day } = parseIso(pref.status_on); parts.push(`${month}월 ${day}일`); }
    if (pref.method) parts.push(pref.method);
    return `안내 받기로 한 분${parts.length ? ` (${parts.join(' · ')})` : ''}`;
  }

  return {
    REBUY_WINDOW_DAYS, VACCINE_GRACE_DAYS, daysBetween, buildCandidates, candidatesByDay, rebuyText, UNIT_DAY_PRESETS, FIXED_PRESETS, MAX_NEXT_DUE_DAYS, calcNextDue, nextDueText, sumQuantity, RULE_KINDS, DEFAULT_LEAD_DAYS, parseRuleInput, describeRule, reservationFromTask, plainPetLabel, HISTORY_RANGES, HISTORY_STATUSES, toKstDate, toKstTime, historyStartDate, filterHistory, groupHistoryByDate, groupHistoryByOwner, summarizeHistory, findSameSend, kindLabel, statusLabel, prefLabel,
    CLINIC, MESSAGE_TYPES, VACCINE_CHOICES, DUE_QUICK_CHOICES, TOKEN_LABELS,
    normalizeMobile, addDays, addYears, formatDueDate, isPast, formatTime,
    buildMessageText, insertToken, fillTokens, tokenize, findUnfilledTokens, toQrText, checkQr
  };
});
