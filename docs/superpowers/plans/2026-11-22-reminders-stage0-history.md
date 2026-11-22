# 알림 0단계: 발송 이력·수신 상태 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 메시지 발송 화면에서 보낸 문자를 "보냈어요"로 기록하고, 화면 아래쪽에서 알림 이력을 읽기 쉽게 조회하며, 보호자별 안내 수신 상태(동의/거부)를 보고 고칠 수 있게 한다. 추천 기능 없이도 "보냈는지 아닌지"와 중복 발송 문제가 해결되는 첫 단계다.

**Architecture:** DB에 테이블 2개(`reminder_log`, `owner_reminder_pref`)와 관리자 전용 RPC 3개를 추가하고(적용은 사용자 승인 후), 화면 로직은 순수 함수(`messaging-core.js`, Node로 시험)와 기존 `app.js`의 `msg*` 구역 확장으로 나눈다. 읽기는 기존처럼 REST(`api()`), 쓰기는 RPC만 쓴다.

**Tech Stack:** 순수 HTML/CSS/JS, Supabase(PostgreSQL, REST, SECURITY DEFINER RPC), Node 내장 `assert`, Playwright 저수준 API.

**Spec:** `docs/superpowers/specs/2026-11-22-reminders-design.md` (사용자 승인 2026-11-22). 이 계획은 그 문서의 §6.1(테이블), §12~§14(법적 유의·횟수·이력 화면), §16(수신 상태)의 **0단계 범위**만 다룬다.

## Global Constraints

- DB 변경은 **추가만** 한다. 기존 테이블·열·정책·RPC는 바꾸지 않는다. **SQL은 사용자 승인 전에는 실행하지 않는다**(Task 2의 승인 단계에서 멈추고 묻는다).
- 새 라이브러리·서버·외부 서비스 없음. 순수 HTML/CSS/JS.
- 이력·수신 상태는 **관리자 전용**(`is_admin()`). 연락처는 이력에 저장·표시하지 않는다. 보호자·반려동물 이름·전화번호를 콘솔·테스트 로그·답변에 출력하지 않는다. `config.js`, `.env`, `test-accounts.local.json` 값은 출력하지 않는다.
- 장년층 사용자: 큰 글씨(본문 14~16px), 큰 버튼, 쉬운 말, 타이핑 최소(초성 검색 카드·버튼). RLS·RPC·kind 같은 개발 용어를 화면에 노출하지 않는다.
- 기존 판매 등록·재고·로그인·공유 업무·메시지 발송(QR) 동작을 유지한다. 데스크톱(1440)·태블릿(768)·모바일(390px)에서 가로 넘침·겹침 없음.
- Git commit/push는 사용자가 요청할 때만 한다(이 계획에는 commit 단계가 없다). git은 소유권 경고로 막혀 있어도 전역 설정을 바꾸지 않는다.
- 시험은 `npx playwright test`가 아니라 저수준 API 스크립트로 한다. 계정 파일은 임시로 복사해 쓰고 끝나면 지운다(`.gitignore`에 포함됨).
- `reminder_log.status`: `'sent'`(보냄) / `'skip'`(넘김) / `'void'`(되돌림, 후보·중복 경고에서 제외). `kind`: `'vaccine'|'rebuy'|'task'|'manual'`(0단계에서는 `'manual'`만 기록). 보호자 수신 상태: `'consented'|'optout'`(행 없음 = 미확인), 방법 `'구두'|'서면'`.
- 보낸 문구 사본(`message_text`)은 **QR에 실제로 들어간 문구**(토큰이 채워진 최종 문구, `SMSTO:번호:` 접두 제외, 최대 1000자)다.

## Review Focus

1. **[보냈어요] 연타·재시도로 같은 기록이 둘 생기는 경우:** 같은 QR에서 여러 번 눌러도 기록은 1건(`client_key`로 중복 방지). 문구를 고쳐 QR이 바뀌면 새 기록 대상이다. (Task 2, 3)
2. **QR을 만들고 기록 없이 다른 반려동물로 넘어가거나 화면을 떠났다 돌아온 경우:** "방금 만든 문자를 보냈나요?"를 한 번 묻고, 기록되는 문구·반려동물은 **넘어가기 전 그 QR**의 것이다. (Task 3)
3. **수신거부 보호자:** 눈에 띄는 경고가 뜨고, 보호자를 바꾸면 이전 경고가 남지 않는다. 늦게 도착한 이전 보호자의 상태가 덮어쓰지 못한다. (Task 4)
4. **이력의 빈 상태·삭제된 반려동물(`pet_id`가 null)·긴 문구·자정 경계:** 빈 상태 안내가 나오고, 삭제된 반려동물은 "삭제된 반려동물"로 보이며, 긴 문구는 접혀서 카드가 깨지지 않고, "오늘" 구간은 한국 시간 기준이다. (Task 1, 5)
5. **되돌린 기록의 영향:** `void`는 "이미 보냈어요" 안내와 이력의 "보냄" 필터에서 빠지고 "전체"에서만 흐리게 보인다. 되돌린 직후 목록이 바로 갱신된다. (Task 1, 5)

---

## File Structure

- Create `db/22_reminder_log_pref.sql` — 테이블 2개, RLS, RPC 3개(적용 전 사용자 승인 필요).
- Create `db/23_reminder_verify.sql` — 적용 후 읽기 전용 검증(`db/06_verify.sql`과 같은 방식: 실행하면 마지막에 일부러 예외로 롤백, "VERIFY OK"면 통과).
- Modify `messaging-core.js`, `tests/messaging-core.test.cjs` — 이력용 순수 함수(Task 1).
- Modify `index.html` (메시지 발송 구역), `app.js` (`msg*` 구역), `styles.css` — 화면(Task 3~5).
- Modify `tests/run-messaging-qr.js` — 화면 시험 추가(Task 3~5). 시험이 남기는 기록은 문구 앞에 `[시험]`을 붙이고 시험이 끝나기 전에 되돌림(`void`) 처리한다.
- Modify `docs/final-acceptance.md` — 알림 이력·수신 상태가 생겼음을 반영(Task 6).

---

### Task 1: 이력용 순수 함수 (`messaging-core.js`)

**Files:**
- Modify: `messaging-core.js`
- Test: `tests/messaging-core.test.cjs`

**Interfaces:**
- Consumes: 기존 `addDays(iso, days): string`, `formatDueDate`.
- Produces(모두 `MessagingCore`에 추가, 행 모양 `Row = { id, created_at (ISO 시각 문자열), kind, ref_key, due_on, status, message_text, pet: { id, name, owner: { name } } | null }`):
  - `HISTORY_RANGES = [{id:'today',label:'오늘'},{id:'7d',label:'7일'},{id:'30d',label:'30일'},{id:'all',label:'전체'}]`
  - `HISTORY_STATUSES = [{id:'all',label:'전체'},{id:'sent',label:'보냄'},{id:'skip',label:'넘김'}]`
  - `toKstDate(isoTimestamp: string): string` — 한국 시간(UTC+9) 기준 `YYYY-MM-DD`. `toKstTime(isoTimestamp: string): string` — `HH:MM`.
  - `historyStartDate(rangeId: string, todayIso: string): string | null` — `today`→오늘, `7d`→오늘−6일, `30d`→오늘−29일, `all`→`null`.
  - `filterHistory(rows: Row[], opts: { range: string, status: string, keyword: string, today: string, matches: (text: string, keyword: string) => boolean }): Row[]` — 기간(한국 날짜 기준)·상태(`all`은 `void` 포함, `sent`/`skip`은 그 상태만)·키워드(반려동물 이름+보호자 이름 문자열을 `matches`로 비교, 빈 키워드는 전부)로 거른다. 입력 순서를 바꾸지 않는다.
  - `groupHistoryByDate(rows: Row[]): { date: string, rows: Row[] }[]` — 한국 날짜별로 묶고 최신 날짜·최신 시각이 먼저.
  - `findSameSend(rows: Row[], q: { petId: number, refKey: string, dueOn: string | null, today: string }): Row | null` — **같은 건**을 이미 보냈는지 찾는다. `status==='sent'`이고 같은 반려동물·같은 `ref_key`인 행 중, `dueOn`이 있으면 `due_on`이 같은 행, `dueOn`이 `null`이면 한국 날짜가 `today`인 행(오늘 보낸 것)만 해당한다. 가장 최근 행을 돌려주고 없으면 `null`. 기간을 정해 두고 보지 않는다(주기가 짧은 약·접종에서 잘못 뜨지 않게).
  - `kindLabel(kind: string, refKey: string | null): string` — `manual`은 `refKey`로 `vaccine`→'접종 안내', `reservation`→'예약 확인', `aftercare`→'진료 후 안내', `custom`→'직접 쓴 문구'(그 외 '문자'); `vaccine`→'접종 안내', `rebuy`→'재구매 안내', `task`→'일정 알림'.
  - `statusLabel(status: string): string` — `sent`→'보냄', `skip`→'넘김', `void`→'되돌림'.
  - `prefLabel(pref: { status: string, status_on: string | null, method: string | null } | null): string` — `null`→'아직 확인하지 않았어요', `consented`→`안내 받기로 한 분 (M월 D일 · 방법)`(날짜·방법이 없으면 그 부분 생략), `optout`→'문자를 원하지 않는 분이에요'.

- [ ] **Step 1: 실패하는 시험 쓰기.** `tests/messaging-core.test.cjs`에 각 함수의 시험을 추가한다. 이름과 단언: `toKstDate/toKstTime`(`'2026-11-21T16:30:00Z'`→`'2026-11-22'`, `'01:30'`; `'2026-11-22T14:59:59Z'`→ `'2026-11-22'`·`'23:59'`; `'2026-11-22T15:00:00Z'`→`'2026-11-23'`·`'00:00'`), `historyStartDate`(오늘 `'2026-11-22'`일 때 `today`→같은 날, `7d`→`'2026-11-16'`, `30d`→`'2026-10-24'`, `all`→`null`), `filterHistory`(기간 경계: 오늘 구간에서 한국 날짜가 어제인 행 제외·오늘 00:00 포함; 상태 `all`은 `void`도 포함하고 `sent`는 `sent`만; 키워드는 주입한 `matches`를 부르며 `pet: null`인 행은 키워드가 있으면 제외·없으면 포함; 입력 배열 불변), `groupHistoryByDate`(날짜 내림차순, 날짜 안 시각 내림차순, 빈 배열은 `[]`), `findSameSend`(같은 반려동물·종류·예정일이면 찾음 / 예정일이 다르면 `null`(예: 2주 뒤 같은 종류 접종은 별개) / `dueOn=null`이면 오늘 보낸 행만 찾고 어제 보낸 행은 `null` / `void`·`skip`은 무시 / 다른 `ref_key`·다른 `petId` 무시 / 같은 조건이 둘이면 가장 최근 행), `kindLabel`(manual 4종+그 외, vaccine·rebuy·task), `statusLabel`(3종), `prefLabel`(`null`, `consented` 날짜·방법 있음/없음, `optout`).
- [ ] **Step 2: 실패 확인.** Run: `node tests/messaging-core.test.cjs` — Expected: 새 시험들이 `... is not a function`으로 FAIL(기존 시험은 PASS).
- [ ] **Step 3: 위 시그니처대로 구현.** 날짜 계산은 UTC 오프셋(+9시간)을 더하는 방식으로 `Intl`·시간대 설정에 의존하지 않는다. 기존 `addDays`를 재사용한다.
- [ ] **Step 4: 통과 확인.** Run: `node tests/messaging-core.test.cjs && node --check messaging-core.js` — Expected: 전부 PASS, 오류 없음.

---

### Task 2: DB 변경 SQL 작성 → 사용자 승인 → 적용·검증

**Files:**
- Create: `db/22_reminder_log_pref.sql`, `db/23_reminder_verify.sql`

**Interfaces:**
- Produces(DB, Task 3~5가 쓴다):
  - 테이블 `public.reminder_log(id bigint identity pk, client_key uuid unique not null, pet_id bigint null references pets(id) on delete set null, kind text, ref_key text, due_on date, status text, message_text text, created_at timestamptz default now(), created_by uuid, updated_at timestamptz default now())` — `kind`·`status`·`message_text`(≤1000자)에 check 제약, 인덱스 `(pet_id, created_at desc)`, `(created_at desc)`.
  - 테이블 `public.owner_reminder_pref(owner_id bigint pk references owners(id) on delete cascade, status text check in ('consented','optout'), status_on date, method text null check in ('구두','서면'), note text null, updated_at timestamptz default now(), updated_by uuid)`.
  - RLS 켬. `authenticated`에게 두 테이블 `select`만 주고 정책은 `is_admin()`일 때만 읽기. `anon`·public 권한 없음. insert/update/delete 정책 없음(쓰기는 RPC만).
  - `rpc_log_reminder(p_client_key uuid, p_pet_id bigint, p_kind text, p_ref_key text, p_due_on date, p_status text, p_message_text text) returns bigint` — 관리자만. 같은 `client_key`가 이미 있으면 새로 만들지 않고 그 행의 id를 돌려준다. `p_status`는 `sent`/`skip`만 허용. 반려동물이 주어지면 존재 확인. `created_by = auth.uid()`.
  - `rpc_void_reminder(p_id bigint) returns void` — 관리자만. `sent`/`skip` 행만 `void`로 바꾸고 `updated_at` 갱신. 없거나 이미 `void`이면 예외.
  - `rpc_set_reminder_pref(p_owner_id bigint, p_status text, p_method text, p_note text) returns void` — 관리자만. `p_status`가 `null`이면 행 삭제, 아니면 upsert(`status_on`은 오늘 한국 날짜). 보호자 존재 확인.
  - 모든 함수는 `security definer set search_path = ''`, `execute`는 `authenticated`에게만.

- [ ] **Step 1: `db/22_reminder_log_pref.sql` 작성.** 위 인터페이스대로. 기존 SQL 파일(`db/11_pet_visit_write.sql`, `db/12_create_pet.sql`)의 RPC 작성 방식(`if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'`)을 따른다. 주석은 한국어로.
- [ ] **Step 2: `db/23_reminder_verify.sql` 작성.** `db/06_verify.sql`처럼 역할/JWT를 흉내 내는 DO 블록 하나로, 마지막에 일부러 예외를 던져 전부 롤백한다. 확인 항목: ① admin이 `rpc_log_reminder`로 기록을 만들고 같은 `client_key`로 다시 불러도 행이 1개 ② staff는 세 RPC 모두 `42501`로 거부, `reminder_log`·`owner_reminder_pref`를 select해도 0행 ③ anon은 select 거부 ④ 잘못된 `status`·`kind`·1001자 문구는 거부 ⑤ `rpc_void_reminder`가 `sent`를 `void`로 바꾸고 두 번째 호출은 예외 ⑥ `rpc_set_reminder_pref`의 upsert·`null` 삭제·잘못된 상태 거부 ⑦ 반려동물 삭제 시 `reminder_log.pet_id`가 null이 되고 보호자 삭제 시 `owner_reminder_pref`가 함께 삭제. 통과하면 예외 메시지가 `VERIFY OK`로 시작.
- [ ] **Step 2b: 정적 점검.** 두 SQL 파일에 `drop table`, `truncate`, `delete from` 중 `owner_reminder_pref`/`reminder_log` 이외 대상, 기존 테이블 `alter`가 없는지 검색으로 확인한다. Expected: 없음.
- [ ] **Step 3: 사용자 승인 요청(여기서 멈춘다).** 두 SQL 파일의 위치와 "무엇이 새로 생기고 기존 것은 바뀌지 않는다"를 쉬운 말로 요약해 사용자에게 보여 주고, **적용해도 되는지 명시적으로 묻는다.** 승인 전에는 Step 4~5와 Task 3~5의 DB 의존 시험을 진행하지 않는다. (Task 3~5의 코드 작성은 승인 대기 중에도 할 수 있지만 화면 시험은 승인·적용 뒤에만 한다.)
- [ ] **Step 4: 승인 후 적용.** 사용자가 허락한 방식으로 `db/22_reminder_log_pref.sql`을 적용한다(Supabase MCP `apply_migration` 또는 사용자가 SQL Editor에서 직접). 적용 방식은 승인 때 사용자와 확정한다.
- [ ] **Step 5: 적용 후 검증.** `db/23_reminder_verify.sql`을 실행한다(롤백되므로 데이터는 남지 않는다). Expected: 결과 메시지가 `VERIFY OK`로 시작. 이어서 Supabase MCP의 읽기 전용 `list_tables`와 `get_advisors`(security)로 새 테이블의 RLS가 켜져 있고 새 경고가 없는지 확인한다. 실패하면 임의로 우회하지 않고 원인을 보고한다.

---

### Task 3: [폰에서 보냈어요] 기록·안 보낸 문자 확인·중복 안내

**Files:**
- Modify: `index.html`(QR 상자 아래), `app.js`(`msg*` 구역), `styles.css`
- Test: `tests/run-messaging-qr.js`

**Interfaces:**
- Consumes: Task 1의 `kindLabel`·`findSameSend`, Task 2의 `rpc_log_reminder`·`reminder_log` 읽기, 기존 `msgRefreshQr`·`msgSelectPet`·`msgClearPet`·`MessagingCore.fillTokens`.
- Produces(화면 요소): `#msgSent`(큰 버튼 "폰에서 보냈어요"), `#msgSentNote`(결과 문구), `#msgUnsentPrompt`(숨김 영역, 문구 "방금 만든 문자를 보냈나요? (반려동물 · 종류)"와 `#msgUnsentYes`[보냈어요]·`#msgUnsentNo`[안 보냈어요]), `#msgDupHint`("N월 N일에 같은 안내를 이미 보냈어요. 그래도 보낼 수 있어요").
- Produces(app.js 상태·함수): `msgPetId: number | null`(선택된 반려동물 id, `msgSelectPet`/`msgClearPet`에서 갱신), `msgPending: { clientKey: string, petId: number | null, petLabel: string, type: string, dueOn: string | null, text: string, logged: boolean } | null`(QR이 만들어질 때마다 같은 내용이면 유지·바뀌면 새 `clientKey`(`crypto.randomUUID()`)로 교체), `msgRecordSend(pending, status: 'sent' | 'skip'): Promise<boolean>`(`rpc_log_reminder`를 `p_kind='manual'`, `p_ref_key=type`, `p_message_text=text`로 호출).

- [ ] **Step 1: 실패하는 화면 시험 쓰기**(DB 적용 뒤 실행). `tests/run-messaging-qr.js`에 단계 추가: ① QR이 뜨면 `#msgSent`가 보이고, 누르면 `#msgSentNote`에 "기록했어요"가 보이며 버튼이 잠긴다 ② 같은 QR에서 `#msgSent`를 빠르게 두 번 눌러도 서버에 기록이 1건(`reminder_log`를 `client_key` 기준으로 admin 토큰으로 조회해 개수 확인 — 조회 결과의 이름·문구는 출력하지 않는다) ③ 문구를 고쳐 QR이 바뀌면 `#msgSent`가 다시 눌리는 상태가 된다 ④ QR을 만들고 기록하지 않은 채 다른 반려동물을 고르면 `#msgUnsentPrompt`가 보이고 `[보냈어요]`를 누르면 **이전 문구**가 기록된다(기록된 `message_text`가 이전 QR 문구와 같음을 단언) ⑤ `[안 보냈어요]`를 누르면 아무것도 기록되지 않는다 ⑥ 접종 안내를 날짜 A로 기록한 뒤 같은 반려동물·같은 날짜 A로 다시 만들면 `#msgDupHint`가 보이고(막지는 않아 QR은 계속 나온다), **날짜를 B로 바꾸면 안내가 사라지며**, 그 기록을 `void`로 바꾸면 날짜 A에서도 사라진다. 진료 후 안내처럼 날짜가 없는 종류는 방금(오늘) 기록한 뒤에만 안내가 뜬다. 시험 문구에는 앞에 `[시험]`을 넣고, 시험 마지막에 시험이 만든 기록을 모두 `rpc_void_reminder`로 되돌린다. 기대: 처음에는 요소가 없어 FAIL.
- [ ] **Step 2: 실패 확인.** Run: `node tests/run-messaging-qr.js`(계정 파일을 임시 복사해서) — Expected: 새 단계가 FAIL(요소 없음).
- [ ] **Step 3: 화면·동작 구현.** `index.html`의 `.msg-qr-box` 안 QR 힌트 아래에 위 요소를 추가한다. `app.js`에서 `msgRefreshQr`가 QR을 만들 때 `msgPending`을 설정/유지하고(문구·반려동물·종류가 같으면 같은 `clientKey` 유지, QR이 사라지면 `msgPending`을 해제), `#msgSent` 클릭은 `msgRecordSend(msgPending,'sent')`로 기록하고 성공하면 `logged=true`로 버튼을 잠근다. `msgSelectPet`/`msgClearPet`이 반려동물을 바꾸기 직전에 `msgPending`이 있고 `logged`가 아니면 그 내용을 **복사해 두었다가** `#msgUnsentPrompt`를 보여 준다(버튼은 복사본을 기록/버림). 메시지 메뉴(`#messagingNav`)를 다시 눌렀을 때도 기록 안 된 `msgPending`이 있으면 같은 확인을 보인다. 반려동물 선택 시 그 반려동물의 `reminder_log?select=...&pet_id=eq.<id>&status=eq.sent&order=created_at.desc&limit=100`을 읽어 두고, 반려동물·종류·날짜가 바뀔 때마다 `findSameSend`(예정일은 접종 안내·예약 확인이면 날짜 칸 값, 그 외 종류는 `null`)로 `#msgDupHint`를 채운다(요청 번호로 늦게 온 응답은 버린다). 새로 기록하면 그 행을 읽어 둔 목록에도 즉시 반영한다. 쉬운 말 문구: "폰에서 전송한 뒤 눌러 주세요", "기록했어요 ✔".
- [ ] **Step 4: 통과 확인.** Run: `node tests/run-messaging-qr.js` — Expected: 새 단계 PASS, 기존 단계 전부 PASS, 콘솔 오류 0. `node --check app.js` — 오류 없음.

---

### Task 4: 보호자 안내 수신 상태 보기·고치기

**Files:**
- Modify: `index.html`, `app.js`, `styles.css`
- Test: `tests/run-messaging-qr.js`

**Interfaces:**
- Consumes: Task 1의 `prefLabel`, Task 2의 `owner_reminder_pref` 읽기와 `rpc_set_reminder_pref`, `pets?select=owner_id&id=eq.<petId>`(읽기).
- Produces(화면 요소): `#msgPref`(반려동물을 고르면 보이는 영역), `#msgPrefStatus`(`prefLabel` 문구), `#msgPrefConsent`[안내 받기로 함], `#msgPrefOptout`[안내 안 받음], `#msgPrefClear`[표시 지우기], `#msgPrefWarning`(거부 상태일 때만 보이는 눈에 띄는 안내 "문자를 원하지 않는 분이에요. 보내지 않는 것이 좋아요").
- Produces(app.js): `msgOwnerId: number | null`, `msgPref: object | null`, `msgSetPref(status: 'consented' | 'optout' | null): Promise<void>`(동의는 방법 기본 '구두').

- [ ] **Step 1: 실패하는 화면 시험 쓰기.** ① 반려동물을 고르면 `#msgPref`가 보이고 `#msgPrefStatus`가 현재 상태를 보여 준다 ② `[안내 받기로 함]`을 누르면 "안내 받기로 한 분"으로 바뀌고 서버 값(`owner_reminder_pref`)도 `consented`다 ③ `[안내 안 받음]`을 누르면 `#msgPrefWarning`이 보이고 QR은 그대로 만들어진다(막지는 않음) ④ 다른 보호자의 반려동물을 고르면 경고가 즉시 사라진다 ⑤ 빠르게 두 번 바꿀 때 늦게 도착한 앞 보호자의 상태가 화면을 덮지 않는다 ⑥ `[표시 지우기]`로 원래 상태(미확인)로 돌아가고 서버 행이 없다. 시험이 바꾼 보호자 상태는 시험 끝에서 원래 값으로 되돌린다(시험 시작 시 저장해 둔 값으로 복원).
- [ ] **Step 2: 실패 확인.** Run: `node tests/run-messaging-qr.js` — Expected: 새 단계 FAIL.
- [ ] **Step 3: 구현.** `msgSelectPet`에서 `pets`로 `owner_id`를 읽고 `owner_reminder_pref`를 읽어 `msgOwnerId`·`msgPref`를 설정한다(`msgRequestVersion`으로 늦은 응답 폐기, `msgClearPet`에서 `msgOwnerId`·`msgPref`·경고를 즉시 비움). 버튼 3개는 `msgSetPref`로 RPC를 부른 뒤 화면 문구를 갱신한다. 거부 상태에서 `[안내 받기로 함]`을 누르면 "거부한 분이에요. 정말 바꿀까요?" 확인 줄(인라인, 브라우저 대화상자 사용 금지)을 한 번 보인다.
- [ ] **Step 4: 통과 확인.** Run: `node tests/run-messaging-qr.js` — Expected: 새 단계 PASS, 기존 PASS, 콘솔 오류 0.

---

### Task 5: 알림 이력 구역과 수신 상태 목록

**Files:**
- Modify: `index.html`(메시지 발송 구역 맨 아래), `app.js`, `styles.css`
- Test: `tests/run-messaging-qr.js`

**Interfaces:**
- Consumes: Task 1의 `HISTORY_RANGES`·`HISTORY_STATUSES`·`filterHistory`·`groupHistoryByDate`·`kindLabel`·`statusLabel`·`prefLabel`·`toKstTime`, 기존 `matchesKoreanText`, Task 2의 `rpc_void_reminder`·`rpc_set_reminder_pref`.
- Produces(화면 요소): `#msgHistory` 구역, `#msgHistoryRange`(기간 버튼, `data-range`), `#msgHistoryStatus`(상태 버튼, `data-status`), `#msgHistorySearch`(반려동물·보호자 초성 검색), `#msgHistoryList`, `#msgHistoryEmpty`("아직 보낸 알림이 없어요"), `#msgPrefList`(수신 상태 목록).
- Produces(app.js): `msgHistoryRows: Row[]`, `msgLoadHistory(): Promise<void>`(`reminder_log?select=id,created_at,kind,ref_key,due_on,status,message_text,pet:pets(id,name,owner:owners(name))&order=created_at.desc&limit=500`), `msgRenderHistory(): void`, `msgLoadPrefList(): Promise<void>`(`owner_reminder_pref?select=owner_id,status,status_on,method,owner:owners(name)&order=updated_at.desc`).

- [ ] **Step 1: 실패하는 화면 시험 쓰기.** ① 메시지 화면을 열면 `#msgHistory`가 맨 아래에 있고 기본 기간 "30일"·상태 "전체"가 눌린 상태이며, 기록이 없을 때만 `#msgHistoryEmpty`가 보인다 ② Task 3에서 기록한 시험 문구가 최신 날짜 머리글 아래 카드로 보이고 카드에 시각·종류 배지·상태 배지가 있으며 연락처(숫자 열)가 화면 텍스트에 없다 ③ `[문구 보기]`를 누르면 보낸 문구가 펼쳐지고 다시 누르면 접힌다 ④ `[되돌리기]`를 누르면 그 카드가 "되돌림"(흐림)으로 바뀌고 상태 필터 "보냄"에서는 사라지고 "전체"에서는 보인다 ⑤ 기간 "오늘"/"7일"/"30일"/"전체" 버튼이 `aria-pressed`로 하나만 눌린다 ⑥ 검색에 반려동물 초성을 넣으면 해당 카드만 남는다 ⑦ 수신 상태 목록 `#msgPrefList`에 방금 `consented`로 만든 보호자가 보이고 `[지우기]`로 사라진다 ⑧ 1440/768/390px에서 가로 넘침·버튼 겹침이 없고 긴 문구(최대 길이)가 카드를 깨지 않는다.
- [ ] **Step 2: 실패 확인.** Run: `node tests/run-messaging-qr.js` — Expected: 새 단계 FAIL.
- [ ] **Step 3: 구현.** 메시지 화면을 열 때(`#messagingNav` 클릭)와 기록·되돌리기 직후 `msgLoadHistory()`·`msgLoadPrefList()`를 부른다. `msgRenderHistory()`는 `filterHistory(msgHistoryRows, {...})` → `groupHistoryByDate` 결과를 날짜 머리글(예: "11월 22일 (일)")과 카드로 그린다. 카드: `시각 · 반려동물 (보호자) · 종류 배지 · 상태 배지(보냄=초록, 넘김=회색, 되돌림=흐림) · [문구 보기] · [되돌리기]`. `pet`이 `null`이면 "삭제된 반려동물", 보호자 이름이 없으면 이름 부분 생략. 문구는 `textContent`로 넣고(HTML 주입 금지) 기본은 한 줄로 잘라 보이며 펼치면 전체. 상태 배지는 색만이 아니라 글자로도 구분한다. `[되돌리기]`는 `rpc_void_reminder` 성공 뒤 목록을 다시 불러온다. 모든 버튼은 최소 44px 높이.
- [ ] **Step 4: 통과 확인.** Run: `node tests/run-messaging-qr.js` — Expected: 모든 단계 PASS, 콘솔 오류 0.

---

### Task 6: 마무리·회귀 확인

**Files:**
- Modify: `docs/final-acceptance.md`

- [ ] **Step 1: 전체 회귀 확인.** Run: `npm run qa:static && npm run qa:unit` — Expected: 통과. 계정 파일을 임시 복사한 뒤 `node tests/run-messaging-qr.js`(전체 통과, 콘솔 오류 0), `node tests/run-nav-audit.js`(콘솔 오류 0)를 실행한다. `run-sales-pet-link.js`는 실제 DB에 판매·반려동물 기록을 남기므로 이번 변경이 판매 화면을 건드리지 않았다면 실행하지 않고 그 사실을 보고한다. 끝나면 임시 복사한 계정 파일을 삭제한다.
- [ ] **Step 2: 문서 갱신.** `docs/final-acceptance.md`의 메시지 발송 문장에 "보낸 문자를 이력으로 기록하고 알림 이력·보호자 수신 상태를 확인할 수 있다. 보냈다는 표시는 직원이 직접 누른다"를 덧붙인다.
- [ ] **Step 3: 사용자 확인 항목 정리(완료 보고용).** 사장님이 직접 확인할 것: 실제 화면에서 본인 번호로 QR → 폰 전송 → [보냈어요] → 이력에 보이는지, [되돌리기]·수신 상태가 직관적인지. 시험이 남긴 `[시험]` 기록(되돌림 상태)이 이력에 남아 있을 수 있음을 알린다.
