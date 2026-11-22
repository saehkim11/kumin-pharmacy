# 알림 2단계: 알림 주기 설정 Implementation Plan

> **후속 변경(2026-11-23, 3단계):** 이 계획의 "분류별로 정하기" 화면 구역은 사용자 결정으로 삭제되었습니다(설계 §22). DB의 분류 규칙 기능은 그대로이고 화면은 약·상품 하나씩만 남았습니다.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 메시지 발송 화면 맨 아래에서 관리자가 "며칠마다 다시 필요한지(알림 주기)"를 분류별로, 그리고 약(상품) 하나씩 정해 저장하게 한다. 이 값은 3단계(판매 화면 자동 계산)와 4단계(대시보드 알림 카드)가 읽는다. 이 단계에서는 값을 **저장하고 보여 주기까지만** 한다.

**Architecture:** DB에 `reminder_rules` 테이블 하나와 관리자 전용 쓰기 함수 하나를 추가한다(적용은 사용자 승인 후). 읽기는 기존처럼 REST(`api()`), 쓰기는 함수만 쓴다. 입력 검사·설명 문구는 순수 함수(`messaging-core.js`, Node로 시험)에 두고, 화면은 기존 `app.js`의 `msg*` 구역 뒤에 작은 구역으로 붙인다.

**Tech Stack:** 순수 HTML/CSS/JS, Supabase(PostgreSQL, REST, SECURITY DEFINER 함수), Node 내장 `assert`, Playwright 저수준 API.

**Spec:** `docs/superpowers/specs/2026-11-22-reminders-design.md` §6.1(`reminder_rules`), §6.3(알림 주기 설정 화면), §12(접종=정보성/재구매=광고 소지), §18(1개당 며칠분), 그리고 이번에 추가하는 §21(실제 상품 분류 확인 결과와 규칙 종류). 사용자 승인 2026-11-23.

## 실제 데이터 확인 결과가 바꾸는 점 (설계 보완, §21에 기록)
상품 분류는 `의약품`(drug 830개)·`사료`(feed 368)·`보조제`(supplement 14)·`조제·진료`(service 6)뿐이고 **접종(vaccine) 분류가 없다.** 접종 상품은 "의약품" 안에 섞여 있다. 그래서 (1) 분류별 주기는 사료·보조제 같은 곳에 쓰고, 의약품은 **약 하나씩**(심장사상충약, 백신 등) 정하는 것이 중심이 되며 (2) **접종 안내(정보성) / 재구매 안내(광고 소지) 구분과 "수량을 곱할지"는 분류가 아니라 규칙마다 고르는 "종류"로 정한다**(접종 안내 = 수량을 곱하지 않는 정해진 간격, 재구매 안내 = 판매 단위 1개당 일수 × 수량). 분류별 규칙은 항상 재구매 안내다.

## Global Constraints

- DB 변경은 **추가만**: 새 테이블 `reminder_rules`와 새 함수 `rpc_set_reminder_rule`. 기존 테이블·열·정책·함수는 바꾸지 않는다. **SQL은 사용자 승인 전에는 실행하지 않는다**(Task 2의 승인 단계에서 멈추고 묻는다). 새 함수는 `public`·`anon`의 실행 권한을 회수하고 `authenticated`에만 준다.
- 규칙 **읽기는 직원 이상**(3단계 판매 화면이 읽는다), **쓰기는 관리자만**(함수 안에서도 관리자인지 확인). 화면의 설정 구역은 관리자에게만 보인다.
- 주기 기본값을 시스템이 넣지 않는다. 값을 정하지 않은 분류·상품은 알림 대상이 아니다. 화면에 의료 주기를 추천하는 문구를 쓰지 않는다.
- 재구매 안내 규칙 옆에는 "광고로 볼 수 있어요. 보내기 전에 확인하세요" 안내를 둔다(설계 §12).
- 장년층 사용자: 큰 글씨·큰 버튼, 쉬운 말("며칠마다 다시 필요해요", "며칠 전부터 알려요"), 상품은 초성 검색 + 카드 클릭. 개발 용어(RLS, RPC, kind 등)를 화면에 노출하지 않는다. 숫자 입력은 칸 하나에 하나만.
- 새 라이브러리·서버 없음. 기존 메시지 발송(QR)·이력·수신 상태·판매·재고·로그인·공유 업무가 그대로 동작해야 한다. 데스크톱(1440)·태블릿(768)·모바일(390px)에서 가로 넘침·겹침 없음.
- 보호자·반려동물 이름·전화번호를 콘솔·테스트 로그·답변에 출력하지 않는다. `config.js`, `.env`, `test-accounts.local.json` 값은 출력하지 않는다. 시험이 만든 규칙은 시험이 끝나기 전에 그 시험이 만든 것만 지우고 시험 전 값으로 복원한다.
- Git commit/push는 사용자가 요청할 때만 한다. 계정 파일은 임시로 복사해 쓰고 끝나면 지운다.

## Review Focus

1. **한 상품·분류에 규칙이 둘 생기는 경우(중복 저장·연타·두 화면):** 키(분류 또는 상품)마다 규칙은 하나뿐이고, 다시 저장하면 덮어쓴다. 저장 버튼 연타도 한 번만 저장된다. (Task 2, 3)
2. **숫자 입력의 경계:** 빈칸·0·음수·소수·글자·너무 큰 수(3650일 초과)·앞뒤 공백·전각 숫자에서 이상한 값이 저장되지 않고 쉬운 말로 안내한다. 며칠 전부터 알림은 0~365. (Task 1, 3)
3. **분류와 상품 규칙의 우선순위 표시:** 같은 약이 상품 규칙과 분류 규칙을 모두 가지면 상품 규칙이 우선임을 화면이 오해 없이 보여 준다. 상품 규칙을 지우면 분류 규칙이 다시 적용된다고 안내한다. (Task 3)
4. **약 830개 목록에서 초성 검색:** 카드는 8개까지만 보이므로 적게 쳤을 때 원하는 약이 안 보일 수 있다 — 더 입력하라는 안내가 있고, 검색 결과가 없을 때 빈 상태 안내가 있다. 비활성 상품·이름이 같은 상품 구분. (Task 3)
5. **직원 계정·권한:** 직원에게는 설정 구역이 보이지 않고, 직원이 함수를 직접 불러도 거부된다. 규칙을 읽을 수는 있다. 삭제된 상품의 규칙은 함께 사라진다. (Task 2, 3)

---

## File Structure

- Create `db/26_reminder_rules.sql`, `db/27_reminder_rules_verify.sql` — 테이블·함수와 읽기 전용 검증(적용 전 사용자 승인 필요).
- Modify `messaging-core.js`, `tests/messaging-core.test.cjs` — 입력 검사·설명 문구(Task 1).
- Modify `index.html`(메시지 발송 구역 맨 아래), `app.js`(`msg*` 구역 뒤), `styles.css` — 설정 화면(Task 3).
- Create `tests/run-reminder-rules.js` — 화면 시험(Task 3).
- Modify `docs/final-acceptance.md`, `docs/superpowers/specs/2026-11-22-reminders-design.md`(§21 추가, §8 완료 표시) — Task 4.

---

### Task 1: 규칙 입력 검사·설명 문구 (`messaging-core.js`)

**Files:**
- Modify: `messaging-core.js`
- Test: `tests/messaging-core.test.cjs`

**Interfaces:**
- Produces (`MessagingCore`):
  - `RULE_KINDS = [{ id: 'vaccine', label: '접종 안내' }, { id: 'rebuy', label: '재구매 안내' }]`, `DEFAULT_LEAD_DAYS = 7`
  - `parseRuleInput(input: { intervalText: string, leadText: string }): { ok: true, intervalDays: number | null, leadDays: number } | { ok: false, error: string }` — `intervalText`가 비어 있으면(공백만 포함) `intervalDays: null`(= 알림 안 함, 규칙 지우기). 값이 있으면 1~3650의 정수만 허용. `leadText`가 비어 있으면 `DEFAULT_LEAD_DAYS`, 있으면 0~365의 정수. 앞뒤 공백·쉼표 없는 전각 숫자(`'３０'`)는 허용해 숫자로 바꾼다. 소수·음수·글자·범위 밖은 `{ ok:false, error }`이며 `error`는 쉬운 말(예: `'며칠마다인지 1에서 3650 사이 숫자로 넣어 주세요.'`, `'며칠 전부터인지 0에서 365 사이 숫자로 넣어 주세요.'`).
  - `describeRule(rule: { kind: 'vaccine' | 'rebuy', interval_days: number, lead_days: number }): string` — `vaccine`: `'접종 안내 · 365일마다 · 7일 전부터 알려요'`, `rebuy`: `'재구매 안내 · 1개당 30일 · 여러 개 사면 기간도 곱해요 · 7일 전부터 알려요'`.

- [ ] **Step 1: 실패하는 시험 쓰기.** `tests/messaging-core.test.cjs`에 추가: `parseRuleInput`(`'30','7'`→`{ok:true,intervalDays:30,leadDays:7}`; `' 30 ',''`→ 기간 30·lead 7(기본); `'３０','３'`(전각)→30, 3; `'','7'`와 `'   ','7'`→`{ok:true,intervalDays:null,leadDays:7}`; `'0'`·`'-5'`·`'3.5'`·`'abc'`·`'3651'`·`'1e3'`은 interval 오류; `'3650'`은 허용; lead `'0'`과 `'365'` 허용, `'366'`·`'-1'`·`'1.5'`·`'x'`는 lead 오류; 오류 문구가 비어 있지 않고 "며칠"을 포함), `describeRule`(위 두 예와 정확히 같은 문자열), `RULE_KINDS`·`DEFAULT_LEAD_DAYS` 값.
- [ ] **Step 2: 실패 확인.** Run: `node tests/messaging-core.test.cjs` — Expected: 새 시험 FAIL(`is not a function`/undefined).
- [ ] **Step 3: 시그니처대로 구현.** 숫자 변환은 전각 숫자를 반각으로 바꾼 뒤 `/^\d+$/`만 받는다(부호·소수점·지수 표기 거부).
- [ ] **Step 4: 통과 확인.** Run: `node tests/messaging-core.test.cjs && node --check messaging-core.js` — Expected: 전부 PASS.

---

### Task 2: DB 변경 SQL 작성 → 사용자 승인 → 적용·검증

**Files:**
- Create: `db/26_reminder_rules.sql`, `db/27_reminder_rules_verify.sql`

**Interfaces:**
- Produces(DB):
  - `public.reminder_rules(id bigint identity pk, group_name text null check in ('drug','feed','supplement','supply','vaccine','service'), product_id int null references public.products(id) on delete cascade, kind text not null default 'rebuy' check in ('vaccine','rebuy'), interval_days int not null check between 1 and 3650, lead_days int not null default 7 check between 0 and 365, updated_at timestamptz default now(), updated_by uuid null references public.profiles(id))`. `group_name`과 `product_id`는 **정확히 하나만** 채운다(check). 분류당·상품당 규칙은 하나(부분 유일 인덱스 2개). 분류 규칙은 `kind='rebuy'`만 허용(check).
  - RLS 켬. `authenticated`에게 `select`만 주고 정책은 `is_staff()`일 때 읽기. `anon`·public 권한 없음. 쓰기 정책 없음.
  - `rpc_set_reminder_rule(p_group_name text, p_product_id int, p_kind text, p_interval_days int, p_lead_days int) returns void` — 관리자만(`42501`). 키는 정확히 하나. `p_interval_days`가 `null`이면 그 키의 규칙을 지운다(없어도 오류 아님). 아니면 값 검사 후 있으면 갱신·없으면 만든다. 분류 규칙에 `vaccine`을 주면 거부. `updated_by = auth.uid()`. `security definer set search_path = ''`, `execute`는 `authenticated`에게만(`public`·`anon` 회수).

- [ ] **Step 1: `db/26_reminder_rules.sql` 작성.** 위 인터페이스대로. 기존 `db/22_reminder_log_pref.sql`의 방식(관리자 확인 `42501`, 읽기 정책, 실행 권한 회수)을 따른다. 한국어 주석으로 "접종 분류가 없어 규칙의 종류로 구분한다"를 적는다.
- [ ] **Step 2: `db/27_reminder_rules_verify.sql` 작성.** `db/25_task_pet_link_verify.sql`처럼 역할/JWT를 흉내 내는 DO 블록 하나, 끝에 일부러 예외로 롤백, 통과하면 `VERIFY OK`로 시작. 확인: ① anon은 읽기·실행 모두 거부 ② staff는 읽을 수 있고 함수는 `42501`로 거부 ③ admin이 분류 규칙·상품 규칙을 만들고 같은 키로 다시 부르면 행이 1개(갱신) ④ `p_interval_days = null`이 규칙을 지우고 없는 키를 지워도 오류 없음 ⑤ 키가 둘 다 비었거나 둘 다 있으면, 기간 0·3651, lead 366·-1, 알 수 없는 분류·종류, 없는 상품, 분류 규칙에 `vaccine` 종류는 모두 거부 ⑥ 상품을 지우면 그 상품 규칙이 같이 지워진다.
- [ ] **Step 3: 정적 점검.** 두 SQL에서 `drop`, `truncate`, 기존 테이블 `alter`, 기존 정책 변경이 없는지 검색한다. Expected: 새 테이블 생성·그 테이블의 RLS 켜기·새 함수·권한 설정만 있음.
- [ ] **Step 4: 사용자 승인 요청(여기서 멈춘다).** 무엇이 생기고 기존 것이 바뀌지 않음을 쉬운 말로 요약해 **적용해도 되는지 명시적으로 묻는다.** 승인 전에는 Step 5~6과 Task 3의 DB 의존 시험을 진행하지 않는다.
- [ ] **Step 5: 승인 후 적용.** 승인된 방식(Supabase MCP `apply_migration`)으로 `db/26_reminder_rules.sql`을 적용한다.
- [ ] **Step 6: 검증.** `db/27_reminder_rules_verify.sql`을 실행한다. Expected: `VERIFY OK`로 시작. 이어서 `get_advisors`(security)에 새 경고가 없는지, 새 함수의 `anon` 실행 권한이 없는지 읽기 전용으로 확인한다.

---

### Task 3: 알림 주기 설정 화면

**Files:**
- Modify: `index.html`(메시지 발송 구역 맨 아래에 새 패널), `app.js`, `styles.css`
- Test: `tests/run-reminder-rules.js`

**Interfaces:**
- Consumes: Task 1의 `parseRuleInput`·`describeRule`·`RULE_KINDS`·`DEFAULT_LEAD_DAYS`, Task 2의 `reminder_rules`·`rpc_set_reminder_rule`, 기존 `products`(상품 목록)·`matchesProduct`·`api`, `product_categories`(읽기).
- Produces(화면 요소): 패널 `#msgRules`; 분류 줄 영역 `#msgRuleCategories`(분류마다 `.msg-rule-row[data-group]`, 안에 `.msg-rule-interval`, `.msg-rule-lead`, `.msg-rule-save`, `.msg-rule-note`); 상품 검색 `#msgRuleProductSearch`와 카드 `#msgRuleProductSuggestions`; 상품 규칙 입력 `#msgRuleProductForm`(`#msgRuleProductName`, 종류 버튼 `.msg-rule-kind[data-kind]`, `#msgRuleProductInterval`, `#msgRuleProductLead`, `#msgRuleProductSave`); 저장된 상품 규칙 목록 `#msgRuleProductList`(`.msg-rule-item[data-product-id]`, `.msg-rule-edit`, `.msg-rule-delete`); 안내문 `#msgRuleAdNotice`.
- Produces(app.js): `msgLoadRules(): Promise<void>`(`reminder_rules?select=id,group_name,product_id,kind,interval_days,lead_days&order=id.asc`과 `product_categories?select=id,name,group_name`을 읽어 그린다), `msgSaveRule({ groupName, productId, kind, intervalDays, leadDays }): Promise<boolean>`(`rpc_set_reminder_rule` 호출).

- [ ] **Step 1: 실패하는 화면 시험 쓰기**(DB 적용 뒤 실행). `tests/run-reminder-rules.js`(저수준 Playwright, `tests/run-task-pet-link.js`와 같은 방식, 포트 4179): admin 로그인 후 메시지 발송 화면 맨 아래에서 ① `#msgRules`가 맨 아래에 있고 실제 분류 이름(의약품·사료·보조제·조제·진료)마다 줄이 있으며 처음에는 모든 칸이 비어 있다(시험 전 DB에 이미 규칙이 있으면 그 값을 기억해 두고 끝에서 복원) ② 사료 줄에 `30`과 lead 비움을 넣고 저장하면 "저장했어요 ✔"가 보이고 서버 행이 `group_name='feed'`, `interval_days=30`, `lead_days=7`, `kind='rebuy'`이다 ③ 같은 줄을 `45`로 다시 저장하면 행이 1개이고 값이 45이며, 칸을 비우고 저장하면 규칙이 지워진다 ④ 잘못된 값(`0`, `abc`, `3651`, lead `366`)은 저장되지 않고 쉬운 말 안내가 줄 안에 보이며 서버에 행이 생기지 않는다 ⑤ 상품 검색칸에 초성 일부를 치면 카드가 뜨고(최대 8개, 더 입력하라는 안내 포함) 카드를 누르면 폼에 상품 이름이 보이며, 종류를 "접종 안내"로 정하고 `365`를 저장하면 서버 행이 `product_id`가 그 상품이고 `kind='vaccine'`이며 목록에 `describeRule` 문구가 보인다 ⑥ 목록의 [고치기]를 누르면 폼에 값이 채워지고 수정해 저장하면 갱신된다(행 1개) ⑦ 같은 상품이 상품 규칙과 분류 규칙을 모두 가지면 목록 항목에 "분류 규칙보다 이 규칙이 먼저 적용돼요"가 보인다 ⑧ [지우기]는 한 번 눌러서는 지워지지 않고 두 번째에 지워지며, 지운 뒤 "분류 규칙이 다시 적용돼요" 안내가 보인다 ⑨ 재구매 안내 규칙에는 "광고로 볼 수 있어요" 안내가 보이고 접종 안내에는 보이지 않는다 ⑩ 저장 버튼을 빠르게 두 번 눌러도 서버 행은 1개 ⑪ 직원(staff) 계정에는 설정 구역이 보이지 않고, 직원 토큰으로 함수를 직접 불러도 거부된다(상태 코드만 확인) ⑫ 1440/768/390px에서 가로 넘침·겹침이 없다 ⑬ 콘솔 오류 0. 시험이 만든 규칙은 시험 전 상태로 복원한다(없던 규칙은 지우고, 있던 값은 되돌림). 기대: 처음에는 요소가 없어 FAIL.
- [ ] **Step 2: 실패 확인.** Run: `node tests/run-reminder-rules.js`(계정 파일 임시 복사) — Expected: 새 단계 FAIL.
- [ ] **Step 3: HTML.** `index.html`의 메시지 발송 구역 맨 아래(알림 이력 패널 뒤)에 관리자 전용 패널을 만든다. 제목 "알림 주기 설정", 설명 "약이나 사료를 한 번 사면 며칠 뒤에 다시 필요한지 정해 두면, 나중에 알림 대상을 자동으로 찾아 드려요. 정하지 않은 것은 알림 대상이 아니에요.", 두 구역: ① "분류별로 정하기"(분류 줄) ② "약·상품 하나씩 정하기"(검색·폼·저장된 목록). 분류 줄 문구는 `며칠마다 다시 필요해요 [   ]일 · 며칠 전부터 알려요 [7]일 [저장]`. 의약품 줄에는 "의약품은 종류가 많아서 아래 '약·상품 하나씩 정하기'를 권해요"를 덧붙인다.
- [ ] **Step 4: 동작.** `msgLoadRules()`를 메시지 메뉴를 열 때와 저장·삭제 뒤에 부른다(요청 번호로 늦은 응답을 버린다). 분류 줄은 `product_categories`의 `group_name`별로 한 줄(이름은 그 분류의 한글 이름)이며 저장된 규칙이 있으면 값이 채워지고, 칸을 비워 저장하면 지운다. 저장은 `parseRuleInput`으로 검사하고 오류는 그 줄 안에 보인다. 상품 검색은 `matchesProduct`로 최대 8개 카드(이름·분류 표시, 비활성 상품 제외, 결과가 8개를 넘으면 "더 입력하면 줄어들어요" 안내), 카드를 누르면 폼에 상품을 채우고 이미 상품 규칙이 있으면 그 값을 불러온다. 종류 버튼은 `RULE_KINDS`(접종 안내/재구매 안내, 기본 재구매 안내, `aria-pressed`), 재구매 안내를 고르면 `#msgRuleAdNotice`가 보인다. 저장된 목록 항목은 상품 이름·`describeRule` 문구·[고치기]·[지우기](두 번 눌러야 지움, 4초 안에 다시 눌러야 함). 저장 버튼은 저장 중 잠가 연타해도 한 번만 보낸다. 관리자가 아니면 패널 전체를 숨기고 규칙을 읽지 않는다.
- [ ] **Step 5: 스타일.** 기존 `.msg-*` 규칙을 재사용하고, 입력칸은 숫자 키패드(`inputmode="numeric"`), 줄은 좁은 화면에서 줄바꿈되며 겹치지 않게 한다.
- [ ] **Step 6: 통과 확인.** Run: `node --check app.js && node tests/run-reminder-rules.js` — Expected: 모든 단계 PASS, 콘솔 오류 0.

---

### Task 4: 마무리·회귀 확인

**Files:**
- Modify: `docs/final-acceptance.md`, `docs/superpowers/specs/2026-11-22-reminders-design.md`

- [ ] **Step 1: 회귀 확인.** Run: `npm run qa:static && npm run qa:unit` — Expected: 통과. 계정 파일을 임시 복사한 뒤 `node tests/run-reminder-rules.js`, `node tests/run-messaging-qr.js`(전체 통과), `node tests/run-task-pet-link.js`(전체 통과), `node tests/run-nav-audit.js`(콘솔 오류 0)를 실행하고 끝나면 계정 파일을 삭제한다. `run-sales-pet-link.js`는 판매 화면을 바꾸지 않았으므로 실행하지 않고 그 사실을 보고한다.
- [ ] **Step 2: 문서.** 설계 문서에 §21(실제 상품 분류에 접종 분류가 없어 규칙 종류로 구분, 분류 규칙은 재구매 전용, `scale_by_quantity` 대신 종류로 수량 곱하기를 정함)을 추가하고 §8의 2단계를 완료 표시한다. `docs/final-acceptance.md`에 알림 주기 설정이 생겼고 아직 알림 대상을 찾지는 않는다는 점을 적는다.
- [ ] **Step 3: 사용자 확인 항목 정리(완료 보고용).** 사장님이 직접 할 것: 실제로 주기를 정할 약(심장사상충약, 백신 등)과 사료·보조제를 골라 값을 넣어 보기. 접종 +7일 유예와 이력 보관 기간 등 아직 사장님이 정하지 않은 항목은 3~4단계에서 다시 여쭙는다.
