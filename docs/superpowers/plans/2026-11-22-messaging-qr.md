# 메시지 발송(QR 문자) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ERP 모니터에서 접종 안내 문구를 만들면 QR이 뜨고, 사장님이 안드로이드 폰 카메라로 비춰 문자 앱에서 [전송]만 누르게 한다.

**Architecture:** 서버·외부 업체·DB 변경 없이 브라우저 안에서만 동작한다. 문구·번호 가공은 순수 함수 파일(`messaging-core.js`), QR 생성은 직접 구현한 인코더(`qr-code.js`)가 맡고, 화면 연결은 기존 `app.js`의 메시지 발송 화면에 작게 붙인다. QR 내용은 `SMSTO:<번호>:<문구>`이며 폰 카메라가 문자 앱을 열어 준다.

**Tech Stack:** 순수 HTML/CSS/JavaScript, Supabase REST(읽기 전용: `pets`, `rpc_get_pet_detail`, `pet_visits`), Node 내장 `assert`(단위 시험), Playwright 저수준 API(화면 시험).

**Spec:** 별도 스펙 문서 없음. 아래 "결정 사항"이 스펙이며 2026-11-22 대화에서 사용자가 합의했다.

## 결정 사항 (스펙)

- 발송 방식: QR 방식(B: `SMSTO:`). 직원이 폰에서 [전송]을 직접 누른다. 알리고·알림톡·서버 발송은 이번 범위가 아니다.
- 시험 결과: 안드로이드 폰에서 `sms:?body=`, `SMSTO:` 긴 문구, `SMSTO:` 짧은 문구 3종 모두 정상 동작 확인됨.
- 사용자: 어르신 사장님 1명(admin). 지금은 개인폰으로 직접 타이핑해 보내는 중.
- DB에 "다음 접종일" 컬럼이 없다. 그래서 접종일은 화면에서 직원이 고른다(저장하지 않는다).
- 수신 동의·발송 이력은 만들지 않는다. 지금처럼 사장님 개인폰에서 직접 보내는 방식이라 달라지는 것이 없다.
- 문구 종류: `접종 안내 / 예약 확인 / 진료 후 안내 / 직접 쓰기`. 직접 쓰기에서는 `[반려견 이름] [날짜] [병원 이름]` 버튼으로 값을 넣고, 마음에 드는 문구는 이 컴퓨터 브라우저에 "자주 쓰는 문구"로 저장한다(DB 사용 안 함). 직접 쓰기 문구 칸 옆에 [말하기] 버튼(브라우저 내장 음성 인식 `ko-KR`, 새 라이브러리 없음)을 둔다. 브라우저가 지원하지 않으면 버튼을 숨긴다. 음성 내용은 크롬이 구글 서버로 보내 글자로 바꾸므로 보호자 이름·번호는 말하지 않고 버튼으로 넣도록 안내한다.
- 병원 정보는 입력 칸 없이 고정: 병원 이름 `구민동물병원`, 문의 전화 `02-543-1945`(`messaging-core.js`의 `CLINIC` 상수). 2026-11-22 사용자가 지정.
- 확인이 필요한 기본값(사용자 검토 때 바꿀 수 있게 상수 하나로 둔다): 접종 종류 버튼 `종합백신 / 광견병 / 켄넬코프 / 코로나 / 심장사상충 예방`, 날짜 단축 버튼 `3주 후 / 4주 후 / 1년 후`.

## Global Constraints

- 기존 Supabase DB 스키마·RLS·인증·권한 규칙을 수정하지 않는다. DB에는 읽기만 한다.
- 새 라이브러리·프레임워크를 추가하지 않는다. QR 생성도 직접 구현한다. (대안인 작은 MIT 라이선스 QR 라이브러리는 규칙 예외 승인이 필요해 쓰지 않는다.)
- 보호자 이름·전화번호를 콘솔·테스트 로그·답변에 출력하지 않는다. QR은 브라우저 안에서만 만들고 외부 QR 서비스나 네트워크로 번호·문구를 보내지 않는다.
- `config.js`, `.env`, `test-accounts.local.json` 값은 출력하지 않는다.
- 화면 문구는 쉬운 말로 쓴다. 개발자 용어(QR 단계, 바이트, SMSTO 등)를 화면에 노출하지 않는다.
- 타이핑을 최소화한다: 반려동물은 초성 검색 + 카드 클릭, 번호·날짜는 자동으로 채우거나 버튼으로 고른다. 병원 이름·전화는 한 번 입력하면 기억한다.
- 메시지 발송 메뉴는 기존대로 admin에게만 보인다(`#messagingNav`, `app.js:3340`).
- 데스크톱(1440px)·태블릿(768px)·모바일(390px)에서 가로 넘침·겹침이 없어야 한다.
- Git commit/push는 사용자가 요청할 때만 한다. 이 계획에는 commit 단계가 없다.
- QR 인코더 사양: 바이트 모드, UTF-8, 오류정정 M, 버전 1~10, ECI 없음. 최대 213바이트(버전 10-M). 기존 시험 QR(segno 기본 설정으로 생성)과 같은 방식이다.

## Review Focus

1. **연락처 없음·이상한 형식** (비었거나 8자리·하이픈·`+82` 접두): 번호를 정리해 보여 주고, 유효하지 않으면 QR을 숨기고 "연락처를 확인해 주세요"라고 안내한다. (Task 2, 3)
2. **문구가 QR 한도를 넘는 경우** (213바이트 경계): 글자 수 안내와 함께 QR을 숨기고 "문구를 줄여 주세요"라고 안내한다. 경계 값 213/214에서 정확히 갈린다. (Task 1, 2)
3. **같은 이름의 반려동물 여러 마리 / 선택 바꿀 때 옛 번호가 남는 경우**: 선택을 바꾸면 번호·QR이 즉시 비워지고, 늦게 도착한 이전 응답이 덮어쓰지 못한다. (Task 3, 4)
4. **지난 날짜·다른 해 날짜 선택**: 지난 날짜면 "이미 지난 날짜예요"를 보여 주되 막지는 않고, 다른 해면 문구에 연도를 넣는다. (Task 2, 3)
5. **문구 편집 중 줄바꿈·이모지·콜론**: 줄바꿈은 공백으로 바꿔 QR에 넣고, 4바이트 글자(이모지)도 바이트 수가 정확히 계산된다. (Task 1, 2)

---

## File Structure

- Create `qr-code.js` — QR 인코더. 브라우저(`window.QrCode`)와 Node(`module.exports`) 모두에서 쓰는 순수 파일.
- Create `messaging-core.js` — 번호 정리·날짜 표기·문구 생성·QR 내용 생성. 같은 방식으로 양쪽에서 쓰는 순수 파일.
- Create `tools/make-qr-fixtures.py` — segno로 기준 QR 행렬을 만들어 `tests/fixtures/qr-reference.json`에 저장(한 번만 실행, 결과 파일을 보관).
- Create `tests/qr-code.test.cjs`, `tests/messaging-core.test.cjs` — Node 단위 시험.
- Create `tests/run-messaging-qr.js` — 화면 시험(Playwright 저수준 API, `tests/run-sales-pet-link.js`와 같은 방식).
- Modify `index.html:294-316` — 메시지 발송 화면 교체, 스크립트 태그 2개 추가(`:383-384`).
- Modify `app.js` — 메시지 발송 화면 동작 추가(새 구역 하나), `#messagingNav` 문구에서 "(검토 중)" 제거.
- Modify `styles.css:306-307` — 안 쓰게 되는 `.messaging-mock*` 규칙을 새 화면 규칙으로 교체.
- Modify `package.json` — `qa:unit` 추가 및 `qa:static`·`qa:ci`에 연결.
- Modify `docs/final-acceptance.md:44` — 메시지 발송이 더 이상 "검토용 화면"이 아님을 반영.

---

### Task 1: QR 인코더 (`qr-code.js`)

**Files:**
- Create: `qr-code.js`, `tools/make-qr-fixtures.py`, `tests/fixtures/qr-reference.json`
- Test: `tests/qr-code.test.cjs`

**Interfaces:**
- Produces:
  - `QrCode.MAX_BYTES: 213`
  - `QrCode.byteLength(text: string): number` — UTF-8 바이트 수.
  - `QrCode.encode(text: string, opts?: { mask?: 0|1|2|3|4|5|6|7 }): { version: number, size: number, modules: boolean[][] }` — `modules[row][col] === true`이 검은 칸. 213바이트 초과 시 `Error`를 던지며 `error.code === 'TOO_LONG'`. `opts.mask`는 시험용 고정 마스크(없으면 감점 규칙으로 자동 선택).
  - `QrCode.toSvg(modules: boolean[][], opts?: { scale?: number, border?: number }): string` — 기본 `scale=6`, `border=4`(조용한 여백 4칸), 흰 배경 위 검은 칸의 `<svg>` 문자열.

- [ ] **Step 1: 기준 행렬 만들기.** `tools/make-qr-fixtures.py`를 쓴다. 임시 폴더에 설치한 `segno`로 아래 입력마다 `segno.make(text, error='m', micro=False, boost_error=False)` 결과와 마스크 0~7을 각각 고정한 결과를 `tests/fixtures/qr-reference.json`(`[{ text, version, mask, modules: "0101..." 행 문자열 배열 }]`)에 저장한다. 입력: `"A"`, `"HELLO"`, ASCII 14바이트(버전 1 한계), ASCII 15바이트(버전 2), 한글 문장 약 60자(`SMSTO:01012345678:[시험] 보리 보호자님, 보리 종합백신 접종일이 11월 25일입니다. 문의: 병원 전화번호`), 버전 7 이상이 되는 약 130바이트 한글, 213바이트 딱 맞는 입력. 실행: `python tools/make-qr-fixtures.py` (segno가 없으면 `pip install --target <임시폴더> segno` 후 `sys.path`에 추가). 결과 파일은 보관하고 이후 Python은 필요 없다.
- [ ] **Step 2: 실패하는 시험 쓰기.** `tests/qr-code.test.cjs`에서 기준 파일의 모든 항목에 대해 `assert.deepStrictEqual`로 `QrCode.encode(text, { mask }).modules`가 기준과 같은지 확인하고, 마스크를 지정하지 않은 호출은 기준의 자동 선택 마스크 결과와 같은지 확인한다. 또 `byteLength('가') === 3`, `byteLength('😀') === 4`, 213바이트 입력은 성공, 214바이트 입력은 `error.code === 'TOO_LONG'`, `toSvg`가 `<svg`로 시작하고 검은 칸 수만큼 `<rect`(또는 하나의 `<path>`)를 포함하는지 확인한다.
- [ ] **Step 3: 실패 확인.** `node tests/qr-code.test.cjs` → `qr-code.js`가 없어 FAIL.
- [ ] **Step 4: `qr-code.js` 구현.** 바이트 모드 헤더(모드 `0100` + 길이 비트: 버전 1~9는 8비트, 10은 16비트)·종단 비트·패딩 `0xEC/0x11`, 버전 1~10의 M 등급 블록 구성표, GF(256) 리드솔로몬, 블록 인터리브, 찾기·타이밍·정렬 무늬, 형식 정보(BCH), 버전 7 이상의 버전 정보, 지그재그 배치, 8가지 마스크와 감점 규칙 N1~N4로 최소 감점 마스크 선택(동점이면 낮은 번호). UMD 래퍼로 `window.QrCode`와 `module.exports` 둘 다 내보낸다. 맨 끝 감점 규칙은 `tests`의 자동 선택 항목이 기준과 다르면 규칙 구현을 점검한다.
- [ ] **Step 5: 통과 확인.** `node tests/qr-code.test.cjs` → 모든 항목 PASS. 문서 규격과 맞는지 확인하려고 `tests/qr-code.test.cjs` 마지막에 "임의 입력 20개를 마스크 0~7 전체로 비교"하는 반복 시험도 넣고 PASS를 확인한다.
- [ ] **Step 6: 구문 검사.** `node --check qr-code.js` → 오류 없음.

---

### Task 2: 문구·번호 가공 (`messaging-core.js`)

**Files:**
- Create: `messaging-core.js`
- Test: `tests/messaging-core.test.cjs`

**Interfaces:**
- Consumes: `QrCode.byteLength`, `QrCode.MAX_BYTES` (Task 1)
- Produces (`MessagingCore`, 브라우저 `window.MessagingCore` / Node `module.exports`):
  - `VACCINE_CHOICES: string[]` = `['종합백신','광견병','켄넬코프','코로나','심장사상충 예방']`
  - `DUE_QUICK_CHOICES: { label: string, days: number }[]` = `[{label:'3주 후',days:21},{label:'4주 후',days:28},{label:'1년 후',days:365}]`
  - `normalizeMobile(phone: string | null | undefined): string | null` — 숫자만 남기고 `8210…`→`010…`, 8자리는 앞에 `010`을 붙인다(기존 `formatPhone`과 같은 규칙). 결과가 `01[016789]`로 시작하는 10~11자리가 아니면 `null`.
  - `addDays(isoDate: string, days: number): string` — `YYYY-MM-DD`. 시간대 영향 없이 달력 날짜로 계산.
  - `formatDueDate(isoDate: string, todayIso: string): string` — 같은 해면 `11월 25일(화)`, 다른 해면 `2027년 1월 10일(일)`.
  - `isPast(isoDate: string, todayIso: string): boolean` — 오늘보다 앞이면 `true`(오늘은 `false`).
  - `MESSAGE_TYPES: { id: 'vaccine'|'reservation'|'aftercare'|'custom', label: string }[]` = 접종 안내 / 예약 확인 / 진료 후 안내 / 직접 쓰기
  - `formatTime(hhmm: string): string` — `'10:00'`→`'오전 10시'`, `'14:30'`→`'오후 2시 30분'`, `'12:00'`→`'오후 12시'`, `'00:00'`→`'오전 12시'`.
  - `buildMessageText(input: { type: 'vaccine'|'reservation'|'aftercare'|'custom', clinicName?: string, clinicPhone?: string, petName: string, vaccineName?: string, dueDate?: string, time?: string, today: string }): string`
    - `vaccine`: `[병원이름] 보리 보호자님, 보리의 종합백신 접종일이 11월 25일(수)입니다. 문의: 02-1234-5678`
    - `reservation`: `[병원이름] 보리 보호자님, 11월 25일(수) 오전 10시 예약이 확인되었습니다. 문의: 02-1234-5678`
    - `aftercare`: `[병원이름] 보리 보호자님, 오늘 진료받은 보리가 편안히 지내는지 살펴봐 주세요. 이상이 있으면 연락 주세요. 문의: 02-1234-5678`
    - `custom`: 빈 문자열.
    - 병원 이름이 없으면 `[…] ` 부분을, 전화가 없으면 ` 문의: …` 부분을 뺀다. (문구 초안은 사용자 검토 때 고칠 수 있도록 상수 `TEMPLATES`로 한 곳에 둔다.)
  - `insertToken(text: string, selectionStart: number, selectionEnd: number, token: string): { text: string, caret: number }` — 선택 구간을 토큰으로 바꾸고 커서 위치를 돌려준다.
  - `fillTokens(text: string, values: { petName: string, dueDate?: string, clinicName?: string, today: string }): string` — 직접 쓴 문구 안의 `[반려견 이름]` `[날짜]` `[병원 이름]`을 실제 값으로 바꾼다(값이 없으면 토큰을 그대로 둔다). 날짜는 `formatDueDate` 형식.
  - `TOKEN_LABELS = ['[반려견 이름]','[날짜]','[병원 이름]']`
  - `toQrText(phoneDigits: string, text: string): string` — `SMSTO:${phoneDigits}:${text}`, 텍스트의 줄바꿈(`\r\n`, `\n`, `\r`)은 공백 하나로 바꾼다.
  - `checkQr(phone: string | null | undefined, text: string): { ok: boolean, reason: 'ok'|'bad-phone'|'empty-text'|'too-long', bytes: number, maxBytes: number }` — `bytes`는 `toQrText` 결과의 바이트 수.

- [ ] **Step 1: 실패하는 시험 쓰기.** `tests/messaging-core.test.cjs`에서 다음을 assert한다: `normalizeMobile('010-1234-5678')==='01012345678'`, `'+82 10-1234-5678'`, `'821012345678'`, `'12345678'`(→`01012345678`), `''`·`null`·`'02-123-4567'`·`'0101234'`는 `null`; `addDays('2026-11-22', 21)==='2026-12-13'`, 윤년 `addDays('2028-02-28',1)==='2028-02-29'`, 연말 `addDays('2026-12-31',1)==='2027-01-01'`; `formatDueDate('2026-11-25','2026-11-22')==='11월 25일(수)'`, 다른 해 `formatDueDate('2027-01-10','2026-11-22')==='2027년 1월 10일(일)'`; `isPast('2026-11-21','2026-11-22')===true`, 같은 날 `false`; `formatTime`의 네 값; `buildMessageText`가 종류 4가지 각각, 병원 이름·전화가 있을 때/없을 때 기대 문장과 정확히 같음(요일 값은 실행 때 계산해 기대 값에 넣는다); `insertToken`(선택 구간 교체·커서 위치); `fillTokens`(토큰 3종 치환, 값 없는 토큰 유지, 같은 토큰 여러 번); `toQrText('01012345678','가\n나')==='SMSTO:01012345678:가 나'`; `checkQr`가 정상은 `ok`, 번호 없음은 `bad-phone`, 빈 문구는 `empty-text`, 문구를 길게 만들어 `bytes===213`이면 `ok`·`214`이면 `too-long`, 이모지 포함 문구의 `bytes`가 UTF-8 기준과 같음.
- [ ] **Step 2: 실패 확인.** `node tests/messaging-core.test.cjs` → `messaging-core.js`가 없어 FAIL.
- [ ] **Step 3: `messaging-core.js` 구현.** 위 시그니처대로. 요일 표기는 `Intl` 없이 `['일','월','화','수','목','금','토']`로 UTC 기준 계산해 시간대에 영향받지 않게 한다. Node에서는 `require('./qr-code.js')`, 브라우저에서는 `window.QrCode`를 쓴다.
- [ ] **Step 4: 통과 확인.** `node tests/messaging-core.test.cjs` → 전부 PASS. `node --check messaging-core.js` → 오류 없음.

---

### Task 3: 메시지 발송 화면과 동작

**Files:**
- Modify: `index.html` (메시지 발송 `<section class="view" id="messaging">` 교체, 스크립트 태그 추가, 메뉴 버튼 문구), `app.js` (새 구역 추가), `styles.css:306-307`

**Interfaces:**
- Consumes: Task 1·2의 `QrCode`, `MessagingCore`; 기존 `salePetDirectory`(label→pet_id)·`loadSalePetOptions`·`matchesKoreanText`·`api`·`isVaccineText`·`getLocalDate`·`formatOwnerPhone`.
- Produces: 화면 요소(Task 4가 사용) — `#msgPetSearch`(입력), `#msgPetSuggestions`(클릭형 추천 목록, 기존 `#salePetSuggestions`와 같은 `.product-suggestion` 카드 방식), `#msgPhone`, `#msgLastVaccine`, `#msgTypeChoices`(문구 종류 버튼들, 각 `data-type`), `#msgTime`, `#msgTokenButtons`, `#msgSavePhrase`, `#msgSavedPhrases`, `#msgSpeak`, `#msgVaccineChoices`(버튼들, 각 `data-vaccine`), `#msgVaccineOther`, `#msgDueDate`(`type=date`), `#msgDueQuick`(버튼들), `#msgPastWarning`, `#msgText`(`textarea`), `#msgCounter`, `#msgQr`(QR이 그려지는 칸. 만들어지면 `data-payload`에 QR 내용을 넣고, 안 만들어지면 `data-payload`를 제거), `#msgQrHint`(상태·안내 문구), `#msgClinicName`, `#msgClinicPhone`(병원 정보, 접힌 `<details>` 안).

- [ ] **Step 1: HTML 교체.** 기존 설명문·예시 화면(`messaging-mock`)을 걷어내고, 위 요소들을 순서대로 넣는다. 위에서 아래로 "① 반려동물 고르기 → ② 받는 번호(자동) → ③ 접종 종류 → ④ 접종일 → ⑤ 문구(자동, 고칠 수 있음) → ⑥ QR + 안내". 안내 문구는 쉬운 말로: "폰 카메라로 이 QR을 비추면 문자 앱이 열려요. 내용을 확인하고 전송을 눌러 주세요." `<script src="qr-code.js?v=…">`와 `<script src="messaging-core.js?v=…">`를 `app.js` 앞에 추가하고, 세 파일의 `?v=` 값을 새 값으로 올린다. 메뉴 버튼 문구를 `메시지 발송`으로, `eyebrow`의 "검토 중 · 아직 만들지 않음"을 "접종 안내 문자 · 관리자 전용"으로 바꾼다.
- [ ] **Step 2: 반려동물 선택.** `#msgPetSearch`에 포커스·입력하면 `salePetDirectory`에서 `matchesKoreanText`로 걸러 최대 8개를 `#msgPetSuggestions`에 카드로 보이고, 카드를 누르면 선택된다(기존 `renderSalePetSuggestions` 패턴 재사용, 타이핑 없이 목록에서 고르기도 가능). 선택하면 `rpc/rpc_get_pet_detail`로 보호자 번호를, `pet_visits?select=visit_date,record&pet_id=eq.<id>&order=visit_date.desc.nullslast&limit=30`으로 최근 방문을 읽어 `isVaccineText`에 맞는 첫 항목을 `#msgLastVaccine`에 "마지막 접종 기록: 2025-10-01 종코켄 접종…" 형태로 보인다. 요청 번호(`requestVersion`)로 늦게 온 응답은 버린다. **선택이 바뀌는 즉시** `#msgPhone`·`#msgLastVaccine`·QR을 비운다.
- [ ] **Step 3: 입력 연결.** 접종 종류 버튼(`MessagingCore.VACCINE_CHOICES`) 중 하나를 누르면 선택 표시(`aria-pressed`)와 함께 문구가 갱신된다. 마지막 칸 "직접 입력"은 `#msgVaccineOther`로 받는다. 날짜 단축 버튼(`DUE_QUICK_CHOICES`)은 오늘 기준 `addDays`로 `#msgDueDate`를 채운다. 날짜가 지난 값이면 `#msgPastWarning`에 "이미 지난 날짜예요"를 보인다(막지는 않는다). 병원 이름·전화는 `localStorage` 키 `messagingClinicProfile`(JSON)에 저장하고 화면을 열 때 불러온다(읽기·쓰기는 모두 `try/catch`로 감싸 실패해도 동작). 병원 이름이 비어 있으면 안내 문구에 "병원 이름을 넣어 두면 받는 분이 누가 보냈는지 바로 알아요"를 보인다.
- [ ] **Step 3b: 문구 종류·직접 쓰기·말하기.** 접종 종류 버튼 위에 문구 종류 큰 버튼(`#msgTypeChoices`, `data-type`)을 둔다. 종류에 따라 필요한 입력만 보인다: 접종 안내=접종 종류+날짜, 예약 확인=날짜+시간(`#msgTime`, 기본 `10:00`), 진료 후 안내=추가 입력 없음, 직접 쓰기=문구 칸만. 직접 쓰기에서는 `#msgTokenButtons`(`TOKEN_LABELS`)를 누르면 `insertToken`으로 커서 위치에 넣고, QR을 만들 때 `fillTokens`로 값을 채운다(문구 칸에는 토큰이 보이고 QR에는 실제 값이 들어간다). `#msgSavePhrase`(자주 쓰는 문구로 저장)는 `localStorage` 키 `messagingSavedPhrases`(문자열 배열, 최대 10개)에 저장하고 `#msgSavedPhrases`에 버튼으로 보인다(누르면 문구 칸에 들어간다, 각 항목에 지우기 버튼). 저장소 접근은 모두 `try/catch`. `#msgSpeak`([🎤 말하기])는 `window.SpeechRecognition || window.webkitSpeechRecognition`이 있을 때만 보이고, 누르면 `lang='ko-KR'`로 인식을 시작해 결과를 문구 칸 커서 위치에 이어 붙인다. 다시 누르면 멈추고, 인식 중에는 버튼이 "듣는 중… (누르면 멈춤)"으로 바뀐다. 오류(마이크 거부 등)는 "마이크를 쓸 수 없어요. 글자로 입력해 주세요"로 보인다. 안내문: "보호자 이름·번호는 말하지 말고 위 버튼으로 넣어 주세요."
- [ ] **Step 4: 문구와 QR 갱신 함수.** 반려동물·종류·날짜·병원 정보가 바뀔 때마다 `buildMessageText`로 `#msgText`를 채우되, 직원이 문구를 직접 고친 뒤에는 입력 값(반려동물·종류·날짜)을 바꿀 때만 다시 채운다(직접 고친 내용을 입력 도중 덮어쓰지 않는다). 문구·번호가 바뀌면 `checkQr`로 상태를 판단해 `ok`면 `QrCode.encode(MessagingCore.toQrText(...))`의 결과를 `QrCode.toSvg`로 `#msgQr`에 그리고 `data-payload`를 설정한다. `bad-phone`은 "연락처를 확인해 주세요(번호 칸에서 고칠 수 있어요)", `empty-text`는 "문구를 입력해 주세요", `too-long`은 "문구가 길어서 QR을 만들 수 없어요. 조금 줄여 주세요"를 `#msgQrHint`에 보이고 QR은 비운다. `#msgCounter`는 "현재 N글자"처럼 쉬운 말로 남은 여유를 알린다(바이트·QR 용어 사용 금지). `#msgPhone`은 자동 채움 후 직접 고칠 수 있고 `formatOwnerPhone`으로 읽기 쉽게 표시하되 계산은 `normalizeMobile` 결과를 쓴다.
- [ ] **Step 5: 스타일.** `styles.css`의 `.messaging-mock*` 규칙을 지우고 새 화면용 규칙을 같은 파일에 추가한다: 본문 14~16px, 접종 종류·날짜 버튼은 눌러서 고르기 쉬운 큰 크기, QR은 한 변 최소 240px(좁은 화면에서는 화면 폭에 맞춰 줄이되 흰 여백 유지), 모바일에서 버튼이 줄바꿈되며 겹치지 않게 한다. 기존 CSS 변수(`--line`, `--paper`, `--muted` 등)를 재사용한다.
- [ ] **Step 6: 구문·정적 확인.** `node --check app.js` 오류 없음. `node tests/qr-code.test.cjs && node tests/messaging-core.test.cjs` 계속 PASS. 새 화면에서 개발자 용어(QR 버전, SMSTO, 바이트, RLS 등)가 보이는 곳이 없는지 `index.html`·`app.js` 문자열을 검색해 확인한다.

---

### Task 4: 화면 시험과 마무리

**Files:**
- Create: `tests/run-messaging-qr.js`
- Modify: `package.json`, `docs/final-acceptance.md:44`

**Interfaces:**
- Consumes: Task 3의 화면 요소 ID, `MessagingCore`·`QrCode`(Node에서 `require`해 기대 값 계산).
- Produces: `npm run qa:unit`(= `node tests/qr-code.test.cjs && node tests/messaging-core.test.cjs`).

- [ ] **Step 1: 화면 시험 쓰기.** `tests/run-sales-pet-link.js`와 같은 방식(정적 서버를 직접 띄우고 `playwright` 저수준 API 사용, 파일로 산출물을 쓰지 않음)으로 `tests/run-messaging-qr.js`를 쓴다. admin 로그인 후 메시지 발송 메뉴를 열고 아래를 assert한다.
  - 초성 일부(예: 실제 존재하는 반려동물 이름의 초성)로 `#msgPetSuggestions`에 카드가 뜨고, 카드를 누르면 `#msgPhone`이 비어 있지 않다(값은 출력하지 않는다).
  - 종류 버튼을 누르고 단축 버튼 `4주 후`를 누르면 `#msgDueDate`가 오늘+28일이고 `#msgText`에 반려동물 이름과 접종 종류가 들어 있다.
  - `#msgQr`의 `data-payload`가 `SMSTO:`로 시작하고, 그 값으로 `QrCode.encode`한 행렬이 화면 SVG의 검은 칸 개수와 일치한다(번호·문구는 로그에 출력하지 않는다).
  - 문구를 214바이트 이상으로 늘리면 `data-payload`가 없어지고 `#msgQrHint`에 안내가 뜬다. 다시 줄이면 QR이 돌아온다.
  - 다른 반려동물 카드를 누르는 순간 이전 번호·QR이 사라지고, 빠르게 두 번 바꿔도 마지막 선택의 값만 남는다.
  - 문구 종류를 `예약 확인`으로 바꾸면 시간 칸이 보이고 문구에 날짜·시간이 들어간다. `직접 쓰기`에서 `[반려견 이름]` 버튼을 누르면 문구 칸에 토큰이 들어가고 QR 내용(`data-payload`)에는 실제 반려견 이름이 들어 있다.
  - 문구를 저장하면 `#msgSavedPhrases`에 버튼이 생기고, 화면을 다시 열어도(새로고침 후) 남아 있다. 지우면 사라진다.
  - `#msgSpeak`는 음성 인식이 있는 브라우저에서만 보인다(시험은 `window.SpeechRecognition`을 가짜로 넣어 눌렀을 때 문구 칸에 가짜 결과가 이어 붙는지까지만 확인하고, 실제 마이크 인식은 확인하지 못한다고 보고한다).
  - 지난 날짜를 넣으면 `#msgPastWarning`이 보이고 QR은 유지된다.
  - 1440 / 768 / 390px에서 `document.documentElement.scrollWidth <= clientWidth`이고, QR이 잘리거나 버튼이 겹치지 않는다. 콘솔 오류가 0건이다.
  - staff 계정으로 로그인하면 메시지 발송 메뉴가 보이지 않는다.
- [ ] **Step 2: 실행.** `node tests/run-messaging-qr.js` → 모든 항목 PASS. (`npx playwright test`는 이 샌드박스에서 EPERM으로 막히므로 쓰지 않는다.) 실패하면 같은 시도를 반복하지 않고 원인을 먼저 찾는다.
- [ ] **Step 3: 기존 핵심 흐름 확인.** `node tests/run-sales-pet-link.js`, `node tests/run-nav-audit.js` → 이전과 같이 PASS(판매 등록·메뉴 이동이 깨지지 않았는지).
- [ ] **Step 4: 스크립트와 문서.** `package.json`에 `"qa:unit"`을 추가하고 `"qa:static"`을 `node --check app.js && node --check qr-code.js && node --check messaging-core.js && node tests/dashboard-news-safety.cjs`로, `"qa:ci"`를 `npm run qa:static && npm run qa:unit && npm run qa:smoke`로 바꾼다. `docs/final-acceptance.md`의 "메시지 발송은 기존의 검토용 화면입니다" 문장을 "메시지 발송은 접종 안내 문구를 만들고 QR로 폰 문자 앱에 넘기는 기능이며 실제 전송은 직원이 폰에서 누릅니다"로 고친다.
- [ ] **Step 5: 정적 검증.** `npm run qa:static && npm run qa:unit` → PASS.
- [ ] **Step 6: 사용자 실사용 확인(자동화 불가, 완료 보고에 안내).** 사장님이 실제 화면에서 **본인 번호로** 한 건 만들어 폰 카메라로 비추고, 문자 앱에 번호와 문구가 채워지는지 확인한다(전송은 누르지 않아도 된다). 완료 보고에는 이 확인이 사용자 몫임을 분명히 적는다.
