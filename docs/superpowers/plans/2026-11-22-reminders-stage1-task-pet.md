# 알림 1단계: 공유 업무에 반려동물 연결 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 공유 업무(예약·일정)를 만들 때 반려동물을 고를 수 있게 하고, 업무 상세에서 연결된 반려동물을 보며 [알림 보내기]로 메시지 발송 화면(예약 확인 문구)을 바로 여는 흐름을 만든다.

**Architecture:** `action_tasks`에 `pet_id` 열 하나를 추가하고(적용은 사용자 승인 후), 업무 등록 폼에 판매 관리와 같은 초성 카드 검색을 붙인다. 조회는 기존 REST 조회에 `pet` 정보를 함께 읽는다. 메시지 화면에는 밖에서 반려동물·종류·날짜를 채워 여는 입구 `msgOpenWith` 하나를 추가한다(4단계 추천 카드도 이 입구를 쓴다).

**Tech Stack:** 순수 HTML/CSS/JS, Supabase REST + RLS, Node 내장 `assert`, Playwright 저수준 API.

**Spec:** `docs/superpowers/specs/2026-11-22-reminders-design.md` §6.1(`action_tasks.pet_id`), §6.3(업무 등록 폼·업무 상세의 알림 버튼), §8(1단계), §11-4(`msgOpenWith`). 사용자 승인 2026-11-22.

## Global Constraints

- DB 변경은 **추가만**: `action_tasks.pet_id`(nullable, `on delete set null`)와 인덱스 하나. 기존 열·정책·함수는 바꾸지 않는다. **SQL은 사용자 승인 전에는 실행하지 않는다**(Task 2의 승인 단계에서 멈추고 묻는다). 업무 수정 열 권한(`title, description, status, priority, due_date`)은 그대로라서 `pet_id`는 등록 때만 정할 수 있다(나중에 바꾸려면 삭제 후 다시 등록).
- 새 라이브러리·서버 없음. 화면 문구는 쉬운 말, 큰 버튼, 타이핑 최소(초성 검색 + 카드 클릭). 개발 용어 노출 금지.
- 기존 공유 업무(달력·상세·댓글·상태 변경)와 대시보드 오늘 일정, 판매 등록, 메시지 발송(QR·이력)이 그대로 동작해야 한다. 반려동물이 없는 업무(기존 업무 포함)는 화면이 지금과 같다.
- 알림 기능(메시지 발송·[알림 보내기])은 **관리자 전용**이다. 직원(staff)은 업무 상세에서 연결된 반려동물 이름만 볼 수 있고 알림 버튼은 보이지 않는다.
- 보호자 이름·전화번호·보낸 문구를 콘솔·테스트 로그·답변에 출력하지 않는다. `config.js`, `.env`, `test-accounts.local.json` 값은 출력하지 않는다. 테스트가 만든 업무는 테스트가 끝나기 전에 **그 테스트가 만든 것만** 삭제한다.
- Git commit/push는 사용자가 요청할 때만 한다. 계정 파일은 임시로 복사해 쓰고 끝나면 지운다.
- 데스크톱(1440)·태블릿(768)·모바일(390px)에서 가로 넘침·겹침 없음.
- DB 마이그레이션이 적용되기 전에도 앱이 깨지지 않게, 업무 조회는 `pet` 포함 조회가 실패하면 기존 조회로 한 번 다시 시도한다.

## Review Focus

1. **반려동물이 없는 업무·기존 업무:** 등록(반려동물 없이)·달력·상세·오늘 일정이 지금과 같고 상세에 반려동물 줄·알림 버튼이 보이지 않는다. (Task 3)
2. **같은 이름의 반려동물:** 목록의 `#번호` 꼬리표가 제목·화면에 새지 않고, 고른 카드와 저장되는 `pet_id`가 정확히 일치한다. (Task 1, 3)
3. **고른 뒤 검색칸을 고치거나, 목록에서 고르지 않고 글자만 입력한 채 등록:** 이전에 고른 `pet_id`가 남아 엉뚱한 반려동물로 저장되지 않고, 글자만 입력했다면 "추천 목록에서 눌러 선택해 주세요"로 막는다. (Task 3)
4. **반려동물이 삭제되어 `pet`이 비어 오는 업무 / 직원 계정:** 오류 없이 반려동물 줄이 사라지고, 직원에게는 알림 버튼이 없다. (Task 3)
5. **[알림 보내기]로 메시지 화면을 열 때:** 반려동물 목록이 아직 불러와지기 전, 이미 다른 반려동물이 선택돼 있던 경우, 업무에 시간이 없는 경우에도 문구·날짜·시간이 이 업무의 것으로 정확히 채워지고 옛 값이 남지 않는다. (Task 1, 3)

---

## File Structure

- Create `db/24_task_pet_link.sql`, `db/25_task_pet_link_verify.sql` — 열 추가와 읽기 전용 검증(적용 전 사용자 승인 필요).
- Modify `messaging-core.js`, `tests/messaging-core.test.cjs` — 업무→메시지 채우기 값 계산(Task 1).
- Modify `index.html`(업무 등록 폼·업무 상세), `app.js`(업무 조회·등록·상세, 메시지 화면 `msgOpenWith`), `styles.css` — 화면(Task 3).
- Create `tests/run-task-pet-link.js` — 화면 시험(Task 3).
- Modify `docs/final-acceptance.md`, `docs/superpowers/specs/2026-11-22-reminders-design.md` — 1단계 완료 반영(Task 4).

---

### Task 1: 업무 → 메시지 채우기 값 (`messaging-core.js`)

**Files:**
- Modify: `messaging-core.js`
- Test: `tests/messaging-core.test.cjs`

**Interfaces:**
- Produces (`MessagingCore`):
  - `reservationFromTask(task: { pet_id: number | null, due_date: string | null, scheduled_time: string | null }): { petId: number, type: 'reservation', dueDate: string | null, time: string } | null` — `pet_id`가 없으면 `null`. `time`은 `scheduled_time`(`HH:MM:SS` 또는 `HH:MM`)의 앞 5글자 `HH:MM`, 시간이 없으면 빈 문자열 `''`.
  - `plainPetLabel(label: string): string` — 목록 라벨에서 같은 이름 구분용 꼬리표(` #123`)를 떼어 낸다. 예: `'보리 (김현주) #12'` → `'보리 (김현주)'`.

- [ ] **Step 1: 실패하는 시험 쓰기.** `tests/messaging-core.test.cjs`에 추가: `reservationFromTask`(`{pet_id:5,due_date:'2026-11-25',scheduled_time:'10:00:00'}`→`{petId:5,type:'reservation',dueDate:'2026-11-25',time:'10:00'}`; 시간 `null`이면 `time:''`; `due_date`가 `null`이면 `dueDate:null`; `pet_id`가 `null`·`undefined`이면 `null`; `scheduled_time:'09:05'`→`'09:05'`), `plainPetLabel`(`'보리 (김현주) #12'`→`'보리 (김현주)'`, 꼬리표가 없으면 그대로, `'콩 (박) #3 '`처럼 뒤 공백도 정리, 이름에 `#`이 들어간 `'#1호 (이)'`는 그대로).
- [ ] **Step 2: 실패 확인.** Run: `node tests/messaging-core.test.cjs` — Expected: 새 시험 FAIL(`is not a function`).
- [ ] **Step 3: 시그니처대로 구현.** `plainPetLabel`은 끝의 `\s*#\d+\s*$`만 제거한다.
- [ ] **Step 4: 통과 확인.** Run: `node tests/messaging-core.test.cjs && node --check messaging-core.js` — Expected: 전부 PASS.

---

### Task 2: DB 변경 SQL 작성 → 사용자 승인 → 적용·검증

**Files:**
- Create: `db/24_task_pet_link.sql`, `db/25_task_pet_link_verify.sql`

**Interfaces:**
- Produces(DB): `public.action_tasks.pet_id bigint null references public.pets(id) on delete set null`, 인덱스 `action_tasks(pet_id)`. 기존 정책·열 권한은 그대로(테이블 단위 `select, insert`는 새 열에도 적용되고, 수정은 기존 5개 열만 가능).

- [ ] **Step 1: `db/24_task_pet_link.sql` 작성.** 열 추가 + 인덱스만. 한국어 주석(왜 필요한지, 기존 것은 바뀌지 않음, 수정 권한은 그대로라 등록 때만 정함).
- [ ] **Step 2: `db/25_task_pet_link_verify.sql` 작성.** `db/23_reminder_verify.sql`처럼 역할/JWT를 흉내 내는 DO 블록 하나, 끝에 일부러 예외로 롤백, 통과하면 `VERIFY OK`로 시작. 확인: ① 열이 있고 nullable이며 FK가 `on delete set null` ② admin이 `pet_id`를 넣어 업무를 만들고 `pet_id` 없이도 만든다 ③ staff는 `pet_id`가 들어간 업무를 읽을 수 있고 직접 만들지 못한다(기존 정책) ④ admin도 `update ... set pet_id`는 권한 오류(열 권한 유지) ⑤ 반려동물을 지우면 업무의 `pet_id`가 `null`이 되고 업무는 남는다.
- [ ] **Step 3: 정적 점검.** 두 SQL에 `drop`, `truncate`, 다른 테이블 변경, 정책 변경이 없는지 검색한다. Expected: `alter table public.action_tasks add column`과 `create index`만 있음(검증 SQL의 시험용 insert/delete는 롤백됨).
- [ ] **Step 4: 사용자 승인 요청(여기서 멈춘다).** 무엇이 생기고 기존 것이 바뀌지 않음을 쉬운 말로 요약해 **적용해도 되는지 명시적으로 묻는다.** 승인 전에는 Step 5~6과 Task 3의 DB 의존 시험을 진행하지 않는다.
- [ ] **Step 5: 승인 후 적용.** 승인된 방식(Supabase MCP `apply_migration`)으로 `db/24_task_pet_link.sql`을 적용한다.
- [ ] **Step 6: 검증.** `db/25_task_pet_link_verify.sql`을 실행한다. Expected: `VERIFY OK`로 시작. 이어서 `get_advisors`(security)에 새 경고가 없는지, `action_tasks`의 기존 행 수가 그대로인지 읽기 전용으로 확인한다.

---

### Task 3: 업무 등록 폼·업무 상세·[알림 보내기]·메시지 화면 입구

**Files:**
- Modify: `index.html`, `app.js`, `styles.css`
- Test: `tests/run-task-pet-link.js`

**Interfaces:**
- Consumes: Task 1의 `reservationFromTask`·`plainPetLabel`, Task 2의 `action_tasks.pet_id`, 기존 `salePetDirectory`(label→pet_id)·`loadSalePetOptions`·`matchesKoreanText`·`showTask`·`renderCalendar`·`msgSelectPet`·`msgSetDue`·`msgUpdateTypeUi`·`msgRefreshAll`.
- Produces(화면 요소): `#newTaskPetSearch`(검색 입력), `#newTaskPetSuggestions`(카드 목록, 기존 `.product-suggestions` 방식), `#newTaskPetId`(숨김, 고른 반려동물 번호), `#taskDetailPet`(업무 상세의 연결된 반려동물 줄, 없으면 숨김), `#taskDetailNotify`(관리자 전용 [알림 보내기] 버튼, 반려동물이 연결된 업무에서만 보임).
- Produces(app.js): `msgOpenWith(params: { petId: number, type: 'reservation', dueDate: string | null, time: string }): Promise<void>` — 메시지 화면을 열고 반려동물을 고른 뒤 종류·날짜·시간을 채우고 문구·QR을 갱신한다.

- [ ] **Step 1: 실패하는 화면 시험 쓰기**(DB 적용 뒤 실행). `tests/run-task-pet-link.js`(저수준 Playwright, `tests/run-messaging-qr.js`와 같은 방식, 정적 서버 포트 4178): admin 로그인 후 공유 업무 화면에서 ① 업무 등록 폼에 반려동물 검색칸이 있고, 초성 일부를 치면 카드가 뜨며 카드를 누르면 제목이 비어 있을 때 이름(보호자) 라벨로 미리 채워지고(`#번호` 꼬리표 없음) `#newTaskPetId`에 번호가 들어간다 ② 날짜·시간·담당자를 채워 등록하면(제목 앞에 `[시험]`) 서버 업무 행의 `pet_id`가 고른 반려동물과 같다 ③ 달력에서 그 날짜를 눌러 업무를 열면 `#taskDetailPet`에 반려동물이 보이고 `#taskDetailNotify`가 보인다 ④ 반려동물 없이 만든 업무(시험용)는 상세에 반려동물 줄·알림 버튼이 보이지 않고 정상 등록된다 ⑤ 카드를 고른 뒤 검색칸 글자를 고치면 `#newTaskPetId`가 비고, 카드를 고르지 않고 글자만 입력해 등록하면 막히고 "추천 목록에서 눌러 선택해 주세요"가 보인다 ⑥ `#taskDetailNotify`를 누르면 메시지 발송 화면이 열리고(`#messaging`이 보임) 그 반려동물이 선택되며 종류가 "예약 확인"이고 문구에 업무 날짜(`formatDueDate`)와 시간이 들어간다(업무에 시간이 없으면 문구에 시간이 없다) ⑦ 직원(staff) 계정으로 같은 업무를 열면 반려동물 줄은 보이고 알림 버튼은 보이지 않는다 ⑧ 1440/768/390px에서 가로 넘침·겹침이 없다 ⑨ 콘솔 오류 0. 시험이 만든 업무는 응답에서 번호를 모아 끝에서 **그것만** 삭제한다(`action_tasks?id=in.(…)` DELETE). 기대: 처음에는 요소가 없어 FAIL.
- [ ] **Step 2: 실패 확인.** Run: `node tests/run-task-pet-link.js`(계정 파일 임시 복사) — Expected: 새 단계 FAIL.
- [ ] **Step 3: 업무 조회.** `loadTasks`의 조회에 `pet_id,pet:pets(id,name,owner:owners(name))`를 더하고, 응답이 실패하면 기존 열만으로 한 번 다시 조회한다. `tasks` 행의 `pet`이 `null`이어도 화면이 깨지지 않는다.
- [ ] **Step 4: 업무 등록 폼.** `#newTaskForm`의 제목 아래에 "반려동물 (선택)" 검색칸과 카드 목록을 추가한다(판매 관리의 반려동물 선택과 같은 초성 검색·카드 클릭, 새 함수는 이 폼 전용 `createTaskPetPicker`로 작게 만든다). 카드를 누르면 `#newTaskPetId`에 번호를 넣고 제목이 비어 있으면 `plainPetLabel(라벨) + ' '`로 채운다. 검색칸 글자를 고치면 `#newTaskPetId`를 비우고, 글자는 있는데 번호가 비어 있으면 등록을 막고 쉬운 말로 안내한다. 등록 요청 본문에 `pet_id`(번호 또는 `null`)를 넣는다. 반려동물 목록이 비어 있으면 입력칸을 열 때 `loadSalePetOptions()`를 불러 채운다. 등록 성공 뒤 이 칸도 비운다.
- [ ] **Step 5: 업무 상세.** `index.html`의 `.task-detail`에 `#taskDetailPet`("연결된 반려동물: 이름 (보호자)")과 `#taskDetailNotify`([알림 보내기])를 추가한다. `showTask`에서 `task.pet`이 있으면 줄을 보이고(없으면 숨김), 관리자이고 `task.pet`이 있을 때만 버튼을 보인다. 버튼은 `msgOpenWith(MessagingCore.reservationFromTask(task))`를 부른다(`null`이면 아무것도 안 함).
- [ ] **Step 6: `msgOpenWith`.** 메시지 구역(`app.js`)에 추가한다: 메시지 메뉴를 열고(`#messagingNav` 클릭), 반려동물 목록이 비어 있으면 `loadSalePetOptions()`를 기다리고, `petId`에 맞는 라벨을 목록에서 찾아 `msgSelectPet(label)`을 기다린 뒤, `msgType`을 `type`으로, `msgTime.value`를 `time`(없으면 빈 값)으로, `msgSetDue(dueDate)`로 날짜를 채우고 `msgUpdateTypeUi()`와 `msgRefreshAll()`을 부른다. 반려동물을 찾지 못하면 `msgShowQrMessage('반려동물을 찾지 못했어요. 직접 골라 주세요.')`를 보인다. 이미 같은 반려동물이 선택된 경우에도 종류·날짜·시간은 이 업무의 값으로 바뀐다.
- [ ] **Step 7: 스타일.** `styles.css`에 업무 폼의 반려동물 칸(기존 `.sale-pet-field`·`.product-suggestions` 재사용), `#taskDetailPet`, `#taskDetailNotify`(큰 버튼, 44px 이상)를 추가한다. 모바일에서 겹치지 않게 한다.
- [ ] **Step 8: 통과 확인.** Run: `node --check app.js && node tests/run-task-pet-link.js` — Expected: 모든 단계 PASS, 콘솔 오류 0.

---

### Task 4: 마무리·회귀 확인

**Files:**
- Modify: `docs/final-acceptance.md`, `docs/superpowers/specs/2026-11-22-reminders-design.md`

- [ ] **Step 1: 회귀 확인.** Run: `npm run qa:static && npm run qa:unit` — Expected: 통과. 계정 파일을 임시 복사한 뒤 `node tests/run-task-pet-link.js`, `node tests/run-messaging-qr.js`(전체 통과), `node tests/run-nav-audit.js`(콘솔 오류 0)를 실행하고, 끝나면 계정 파일을 삭제한다. `run-sales-pet-link.js`는 판매 화면을 바꾸지 않았으므로 실행하지 않고 그 사실을 보고한다.
- [ ] **Step 2: 문서.** `docs/final-acceptance.md`에 "공유 업무에 반려동물을 연결할 수 있고, 상세에서 [알림 보내기]로 예약 확인 문구가 채워진 메시지 화면을 연다. 반려동물은 업무를 만들 때만 정할 수 있다"를 덧붙이고, 설계 문서 §8의 1단계에 완료 날짜를 적는다.
- [ ] **Step 3: 사용자 확인 항목 정리(완료 보고용).** 사장님이 직접 확인할 것: 실제 업무를 반려동물과 함께 등록 → 달력에서 열기 → [알림 보내기] → QR 확인. 시험이 만든 업무는 삭제했음을 알린다.
