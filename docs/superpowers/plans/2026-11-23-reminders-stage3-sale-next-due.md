# 알림 3단계: 판매할 때 다음 알림일 정하기 + 수신 동의 체크 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) 알림 주기 설정 화면에서 큰 분류별 설정을 없애고 약·상품 하나씩만 남긴다. (2) 판매 관리 화면에서 반려동물을 골라 약·사료를 팔 때, 그 상품의 "1개당 며칠"이 정해져 있으면 다음 알림일을 자동으로 계산해 보여 주고(고칠 수 있음), 정해져 있지 않으면 **그 자리에서 버튼으로 처음 정하게** 한다. (3) 같은 화면에서 보호자가 안내 문자를 받기로 했는지 체크한다.

**Architecture:** DB에 `pet_next_due` 테이블과 관리자 전용 저장 함수 하나를 추가한다(적용은 사용자 승인 후). 판매 등록 함수(`rpc_create_sale`)는 **건드리지 않고**, 판매가 성공한 뒤 별도로 다음 알림일을 저장한다(실패해도 판매는 정상). 계산·문구는 순수 함수(`messaging-core.js`)에 두고 화면은 `app.js`의 판매 구역에 작게 붙인다. 이 화면 기능은 모두 **관리자에게만** 보인다.

**Tech Stack:** 순수 HTML/CSS/JS, Supabase(PostgreSQL, REST, SECURITY DEFINER 함수), Node 내장 `assert`, Playwright 저수준 API.

**Spec:** `docs/superpowers/specs/2026-11-22-reminders-design.md` §6.1(`pet_next_due`), §6.3(판매 관리 화면(B)), §11-1(새 구매가 이긴다), §16(수신 동의 체크박스), §18(1개당 며칠분), §21(규칙 종류). 사용자 승인 2026-11-23(분류별 구역 삭제 + 판매할 때 처음 정하기).

## 설계 보완 (이번 대화에서 정한 것 — 설계 문서 §22에 기록)
- **분류별 주기 설정 화면은 없앤다**(큰 분류는 상품마다 다른 주기를 담지 못한다). DB의 분류 규칙 기능은 그대로 두지만 화면에서는 쓰지 않는다. 주기는 **약·상품 하나씩**만 정한다.
- **처음 정하기는 판매 화면에서:** 반려동물을 고른 판매에서 주기가 없는 상품을 담으면 "이 상품 1개로 며칠 쓰나요?" 버튼(7/14/30/60/90일/직접)과 "접종처럼 정해진 간격" 버튼(3주/4주/1년/직접)이 나온다. 고르면 그 상품의 규칙으로 저장되고(재구매 안내 또는 접종 안내), 다음 판매부터 자동으로 채워진다.
- **`pet_next_due.sold_on`:** 저장 때 "어느 구매에 대한 알림일인지"를 구매일(`sold_on`)로 기록한다(설계의 `set_on`을 대체). 4단계에서 "마지막 구매보다 이른 구매 기준 값은 무시"에 쓴다.

## Global Constraints

- DB 변경은 **추가만**: 새 테이블 `pet_next_due`와 새 함수 `rpc_set_next_due`. 기존 테이블·열·정책·함수(특히 `rpc_create_sale`)는 바꾸지 않는다. **SQL은 사용자 승인 전에는 실행하지 않는다**(Task 3의 승인 단계에서 멈추고 묻는다). 새 함수는 `public`·`anon` 실행 권한을 회수하고 `authenticated`에만 준다.
- 다음 알림일·처음 정하기·수신 동의 체크는 **관리자 전용**이다. 직원 계정의 판매 화면은 지금과 똑같아야 한다.
- 기존 판매 등록(상품 담기·삭제·합계·등록·중복 방지 키·취소 불가)은 한 글자도 동작이 바뀌지 않아야 한다. 다음 알림일 저장은 **판매 성공 뒤에만, 실패해도 판매 결과를 바꾸지 않고** 쉬운 안내만 덧붙인다.
- 반려동물을 고르지 않은 판매에는 아무것도 나타나지 않는다. 주기를 정하지 않기로 한(안 정함) 상품은 저장하지 않는다.
- 장년층 사용자: 큰 버튼, 쉬운 말, 타이핑 최소(버튼 우선, 직접 입력은 마지막 선택지). 개발 용어 노출 금지. 새 라이브러리·서버 없음.
- 보호자·반려동물 이름·전화번호를 콘솔·테스트 로그·답변에 출력하지 않는다. `config.js`, `.env`, `test-accounts.local.json` 값은 출력하지 않는다.
- **시험이 실제 판매를 만들지 않는다.** 판매 등록 요청(`rpc/rpc_create_sale`)은 시험에서 가로채 가짜 판매 번호로 응답하고(실제 판매·재고·번호가 생기지 않음), 그 뒤 다음 알림일·수신 동의·규칙 저장은 실제 DB에 하되 시험이 끝나기 전에 시험 전 상태로 복원한다.
- Git commit/push는 사용자가 요청할 때만 한다. 계정 파일은 임시로 복사해 쓰고 끝나면 지운다. 데스크톱(1440)·태블릿(768)·모바일(390px)에서 가로 넘침·겹침 없음.

## Review Focus

1. **판매 등록이 그대로 동작:** 직원 계정, 반려동물이 없는 판매, 관리자의 기존 흐름에서 장바구니·합계·등록 결과가 이전과 같고, 다음 알림일 저장이 실패(오류·끊김)해도 판매는 성공으로 남고 안내만 붙는다. (Task 4)
2. **같은 상품·같은 반려동물이 여러 줄(가격이 달라 합쳐지지 않은 경우):** 수량을 합산해 한 번만 계산·저장한다. 수량이 바뀌어도 사장님이 직접 고친 날짜는 유지된다. 상품을 삭제하면 해당 알림일 블록이 사라지고 다른 상품 블록은 영향받지 않는다. (Task 1, 4)
3. **처음 정하기의 안전:** 버튼을 연타해도 규칙은 한 번만 저장되고, 직접 입력의 이상한 값(0·글자·3651)은 저장되지 않는다. 직원 계정에서는 아예 보이지 않는다. 저장이 실패하면 그 상품의 상태가 "정함"으로 잘못 남지 않는다. (Task 4)
4. **날짜 계산 경계:** 판매일(과거 날짜 가능)이 기준이고, 판매일을 바꾸면 자동 계산이 따라가며, 월말·윤년·큰 수량(곱한 값이 매우 큼)에서 이상한 날짜가 나오지 않는다. 계산 결과가 10년을 넘으면 저장하지 않고 안내한다. (Task 1, 4)
5. **수신 동의 체크박스:** 반려동물을 바꾸면 이전 보호자의 상태가 남지 않고(늦은 응답이 덮지 못함), 거부(optout) 보호자에게는 체크할 수 없고 이유가 보이며, 체크 해제는 상태를 지운다. 같은 보호자의 반려동물을 오가도 중복 요청이 쌓이지 않는다. (Task 4)

---

## File Structure

- Create `db/28_pet_next_due.sql`, `db/29_pet_next_due_verify.sql` — 테이블·함수와 읽기 전용 검증(적용 전 사용자 승인 필요).
- Modify `messaging-core.js`, `tests/messaging-core.test.cjs` — 계산·문구·버튼 값(Task 1).
- Modify `index.html`(알림 주기 설정 구역 정리, 판매 화면 새 영역), `app.js`(알림 주기 설정 구역 정리, 판매 구역), `styles.css` — 화면(Task 2, 4).
- Modify `tests/run-reminder-rules.js`(분류 구역 삭제 반영), Create `tests/run-sale-next-due.js`(Task 2, 4).
- Modify `docs/final-acceptance.md`, `docs/superpowers/specs/2026-11-22-reminders-design.md`(§22 추가, §8 완료 표시) — Task 5.

---

### Task 1: 다음 알림일 계산·문구·버튼 값 (`messaging-core.js`)

**Files:**
- Modify: `messaging-core.js`
- Test: `tests/messaging-core.test.cjs`

**Interfaces:**
- Produces (`MessagingCore`):
  - `UNIT_DAY_PRESETS = [7, 14, 30, 60, 90]`, `FIXED_PRESETS = [{ label: '3주', days: 21 }, { label: '4주', days: 28 }, { label: '1년', days: 365 }]`, `MAX_NEXT_DUE_DAYS = 3650`
  - `calcNextDue(input: { kind: 'vaccine' | 'rebuy', intervalDays: number, quantity: number, soldOn: string }): { ok: true, days: number, dueOn: string } | { ok: false, reason: 'too-far' | 'invalid' }` — `rebuy`는 `intervalDays × quantity`일 뒤, `vaccine`은 `intervalDays`일 뒤(수량을 곱하지 않음). 수량은 소수(예: 0.5)를 허용하되 올림하지 않고 `Math.round(intervalDays × quantity)`로 일수를 구한다(0일 이하면 `invalid`). 결과 일수가 `MAX_NEXT_DUE_DAYS`(3650)를 넘으면 `too-far`. `soldOn`은 `YYYY-MM-DD`.
  - `nextDueText(input: { kind, intervalDays, quantity, soldOn }): string` — `rebuy`: `'3개 × 30일 = 90일 뒤 · 2027-02-20'`, `vaccine`: `'365일 뒤 · 2027-11-22'`. 수량이 정수면 소수점 없이, 소수면 그대로 쓴다. 계산이 실패하면 `''`.
  - `sumQuantity(items: { productId: number, petId: number | null, quantity: number }[]): Map<string, number>` — 키 `"<petId>:<productId>"`(반려동물이 없으면 건너뜀)별 수량 합계.

- [ ] **Step 1: 실패하는 시험 쓰기.** `tests/messaging-core.test.cjs`에 추가: `calcNextDue`(rebuy 30일×3개, 판매일 `2026-11-22` → `{ok:true,days:90,dueOn:'2027-02-20'}`; vaccine 365일(수량 5여도) → 365일 뒤 `'2027-11-22'`; 월말 `2026-01-31` + 30일 → `'2026-03-02'`; 윤년 `2028-02-28`+1일 → `'2028-02-29'`; 수량 0.5×30 → 15일; 수량 0 또는 음수 → `invalid`; 곱한 값이 3650 초과(30일×200개) → `too-far`; 3650 정확히는 허용), `nextDueText`(위 두 문장 정확히, 수량 0.5는 `'0.5개 × 30일 = 15일 뒤 · …'`, 실패 시 `''`), `sumQuantity`(같은 상품·같은 반려동물 두 줄 합산, 반려동물 없는 줄 제외, 다른 상품·다른 반려동물은 별도 키), 상수 값.
- [ ] **Step 2: 실패 확인.** Run: `node tests/messaging-core.test.cjs` — Expected: 새 시험 FAIL.
- [ ] **Step 3: 시그니처대로 구현.** 날짜 계산은 기존 `addDays`를 재사용한다.
- [ ] **Step 4: 통과 확인.** Run: `node tests/messaging-core.test.cjs && node --check messaging-core.js` — Expected: 전부 PASS.

---

### Task 2: 알림 주기 설정 화면에서 분류별 구역 삭제

**Files:**
- Modify: `index.html`, `app.js`, `styles.css`, `tests/run-reminder-rules.js`

**Interfaces:**
- Consumes: 기존 `#msgRules` 패널과 상품별 설정(`#msgRuleProductSearch` 등).
- Produces: 분류별 영역(`#msgRuleCategories`, `#msgRuleAdNotice`와 "분류별로 정하기" 제목·설명)이 사라지고, 설명문이 "약이나 사료는 **약·상품 하나씩** 정하거나, 판매 화면에서 처음 팔 때 바로 정할 수 있어요"로 바뀐다. 분류 규칙 관련 코드(분류 불러오기·줄 만들기·저장, 분류 우선순위 안내)는 제거한다(DB 함수·테이블은 그대로).

- [ ] **Step 1: 시험 먼저 바꾸기.** `tests/run-reminder-rules.js`에서 분류 줄·분류 저장·분류 입력 검증·분류 연타·우선순위 안내 단계를 지우고, 대신 ① 패널에 "분류별로 정하기" 제목과 `#msgRuleCategories`·`#msgRuleAdNotice`가 없고 "약·상품 하나씩"과 "판매 화면" 안내가 있다 ② 상품 규칙 저장의 입력 검증(0·글자·3651·lead 366은 저장 안 됨)과 저장 버튼 연타가 한 번만 저장되는지를 상품 입력 칸에서 확인한다 ③ 불러오기 실패 시 이전 값 유지·안내, 저장하지 않은 입력값 버림은 상품 쪽으로 옮겨 유지한다. 복원은 상품 규칙 키만 다룬다. 기대: 처음에는 분류 영역이 아직 있어 FAIL.
- [ ] **Step 2: 실패 확인.** Run: `node tests/run-reminder-rules.js`(계정 파일 임시 복사) — Expected: 새 단계 FAIL.
- [ ] **Step 3: 구현.** HTML에서 분류 영역을 지우고 설명문을 바꾼다. `app.js`의 분류 관련 함수(`msgBuildRuleField` 중 분류에서만 쓰는 부분, `msgBuildRuleRow`, `msgSaveCategoryRow`, `msgRenderRuleCategories`, `msgGroupRule`, `msgGroupOfProduct`, 우선순위 안내 줄, `product_categories` 조회)를 제거하고 상품 입력에서 쓰는 `msgBuildRuleField`는 남긴다. `msgLoadRules`는 규칙과 비활성 상품만 읽는다.
- [ ] **Step 4: 통과 확인.** Run: `node --check app.js && node tests/run-reminder-rules.js` — Expected: 모든 단계 PASS, 콘솔 오류 0.

---

### Task 3: DB 변경 SQL 작성 → 사용자 승인 → 적용·검증

**Files:**
- Create: `db/28_pet_next_due.sql`, `db/29_pet_next_due_verify.sql`

**Interfaces:**
- Produces(DB):
  - `public.pet_next_due(pet_id bigint references pets(id) on delete cascade, product_id int references products(id) on delete cascade, due_on date not null, sold_on date not null, source text not null check in ('auto','manual'), updated_at timestamptz default now(), updated_by uuid references profiles(id), primary key (pet_id, product_id))`. RLS 켬, `authenticated`에게 `select`만, 정책은 `is_admin()`일 때 읽기. 쓰기 정책 없음.
  - `rpc_set_next_due(p_pet_id bigint, p_product_id int, p_due_on date, p_sold_on date, p_source text) returns void` — 관리자만(`42501`). 반려동물·상품 존재 확인, `p_source`는 `auto`/`manual`, `p_due_on`이 `p_sold_on`보다 이르거나 `p_sold_on`보다 3650일 넘게 뒤이면 거부. **`p_due_on`이 `null`이면 그 (반려동물, 상품)의 행을 지운다(없어도 오류 아님, 다른 검사는 건너뜀).** 같은 (반려동물, 상품)이 이미 있으면 **기존 행의 `sold_on`이 `p_sold_on`보다 늦으면 바꾸지 않고**(더 최근 구매 우선) 아니면 갱신한다. `security definer set search_path = ''`, `public`·`anon` 실행 권한 회수.

- [ ] **Step 1: `db/28_pet_next_due.sql` 작성.** 위 인터페이스대로. `db/26_reminder_rules.sql`의 방식(관리자 확인 `42501`, 읽기 정책, 실행 권한 회수)을 따른다. 한국어 주석으로 `sold_on`의 뜻을 적는다.
- [ ] **Step 2: `db/29_pet_next_due_verify.sql` 작성.** `db/27_reminder_rules_verify.sql`처럼 롤백되는 DO 블록. 확인: ① anon은 읽기·실행 거부 ② staff는 읽기 0행, 함수는 `42501` ③ admin이 저장하고 같은 키로 다시 저장하면 한 행이 갱신 ④ 더 이른 `p_sold_on`으로 저장해도 기존(더 최근 구매) 행은 바뀌지 않음 ⑤ 잘못된 값(없는 반려동물·상품, `p_source` 이상, `due_on < sold_on`, 3650일 초과)은 거부 ⑥ 반려동물을 지우면 그 행도 지워지고 상품을 지워도 마찬가지 ⑦ `p_due_on = null`로 부르면 행이 지워지고 없는 키를 지워도 오류가 아님.
- [ ] **Step 3: 정적 점검.** 두 SQL에서 `drop`, `truncate`, 기존 테이블 `alter`, 기존 정책 변경이 없는지 검색한다. Expected: 새 테이블·정책·함수·권한만 있음.
- [ ] **Step 4: 사용자 승인 요청(여기서 멈춘다).** 무엇이 생기고 기존 것(특히 판매 등록 함수)이 바뀌지 않음을 쉬운 말로 요약해 **적용해도 되는지 명시적으로 묻는다.** 승인 전에는 Step 5~6과 Task 4의 DB 의존 시험을 진행하지 않는다.
- [ ] **Step 5: 승인 후 적용.** Supabase MCP `apply_migration`으로 `db/28_pet_next_due.sql`을 적용한다.
- [ ] **Step 6: 검증.** `db/29_pet_next_due_verify.sql`을 실행한다. Expected: `VERIFY OK`로 시작. `get_advisors`(security)에 새 경고가 없는지, 새 함수의 `anon` 실행 권한이 없는지 읽기 전용으로 확인한다.

---

### Task 4: 판매 화면의 다음 알림일·처음 정하기·수신 동의

**Files:**
- Modify: `index.html`(판매 구역), `app.js`(판매 구역), `styles.css`
- Test: `tests/run-sale-next-due.js`

**Interfaces:**
- Consumes: Task 1의 `calcNextDue`·`nextDueText`·`sumQuantity`·`UNIT_DAY_PRESETS`·`FIXED_PRESETS`·`parseRuleInput`, Task 3의 `pet_next_due`·`rpc_set_next_due`, 기존 `msgSaveRule`(상품 규칙 저장), `rpc_set_reminder_pref`(수신 상태), `saleItems`·`renderSale`·`saleDate`·`salePetId`·`selectSalePet`.
- Produces(화면 요소): 장바구니 아래 영역 `#saleNextDue`(그룹마다 `.sale-due-item[data-pet-id][data-product-id]`; 안에 `.sale-due-text`(상태 문장), 처음 정하기 버튼 `.sale-due-unit[data-days]`·`.sale-due-fixed[data-days]`·`.sale-due-custom`(직접 입력 칸 `.sale-due-custom-input`+`.sale-due-custom-ok`), 접종 안내 상품의 날짜 버튼 `.sale-due-fixed[data-days]`, `.sale-due-none`([알림 안 함]), 날짜 고치기 `.sale-due-date`(date 입력)와 안내 `.sale-due-note`); 수신 동의 `#saleConsent`(`#saleConsentCheck`, `#saleConsentStatus`).
- Produces(app.js): `saleRules: Map<number, { kind, interval_days, lead_days }>`(상품 번호 → 규칙; 관리자 로그인 때와 규칙 저장 뒤 불러옴), `saleDue: Map<string, { mode: 'auto' | 'manual' | 'none', dueOn: string | null }>`(키 `"<petId>:<productId>"`), `renderSaleDue(): void`, `saveSaleNextDue(items, soldOn): Promise<{ saved: number, failed: number }>`.

- [ ] **Step 1: 실패하는 화면 시험 쓰기**(DB 적용 뒤 실행). `tests/run-sale-next-due.js`(저수준 Playwright, 포트 4180, `rpc/rpc_create_sale`은 `page.route`로 가로채 가짜 번호 응답): admin 로그인 후 판매 관리에서 시험용 상품(규칙 없음)을 고르고 ① 반려동물을 고르지 않고 담으면 `#saleNextDue`에 아무것도 없다 ② 반려동물을 고르고 담으면 `.sale-due-item`이 생기고 "이 상품 1개로 며칠 쓰나요?" 버튼들이 보인다 ③ `30일`을 누르면 그 상품의 규칙이 서버에 `rebuy`·30일로 저장되고(시험 뒤 복원) 상태 문장이 `'… × 30일 = … 일 뒤 · 날짜'`로 바뀌며 날짜가 판매일 + 30×수량이다 ④ 수량을 바꾸면(같은 상품 다시 담기) 날짜가 합산 수량으로 다시 계산되고, 날짜를 직접 고친 뒤 수량을 바꿔도 고친 날짜가 유지된다 ⑤ 판매일을 바꾸면 자동 계산이 따라간다 ⑥ 직접 입력에 `0`·글자·`3651`은 저장되지 않고 안내가 나온다 ⑦ `[알림 안 함]`을 누르면 저장 대상에서 빠지고 판매 등록 뒤 서버에 행이 생기지 않는다 ⑧ 판매 등록(가로채기) 뒤 서버 `pet_next_due`에 (반려동물, 상품, 날짜, `sold_on`=판매일, `source`)가 저장되고(자동은 `auto`, 고친 날짜는 `manual`), 화면에 판매 성공 메시지가 그대로 나온다 ⑨ 다음 알림일 저장 요청이 실패하도록 막아도(`rpc_set_next_due` 가로채 오류 응답) 판매 성공 메시지는 유지되고 쉬운 안내가 덧붙는다 ⑩ 접종 안내 규칙(시험 중 저장한 `vaccine`) 상품은 날짜 버튼(3주/4주/1년/알림 안 함)이 나오고 고르면 그 날짜가 저장된다 ⑪ 같은 상품·같은 반려동물을 가격이 다르게 두 줄로 담으면 알림일 블록은 하나이고 수량이 합산된다 ⑫ 상품을 삭제하면 그 블록이 사라진다 ⑬ 반려동물을 고르면 `#saleConsent`가 보이고 현재 상태가 나오며, 체크하면 서버 `owner_reminder_pref`가 `consented`, 해제하면 지워지고, 거부(`optout`) 보호자는 체크 칸이 잠기고 이유가 보이며, 반려동물을 바꾸면 이전 상태가 즉시 사라진다 ⑭ 직원 계정의 판매 화면에는 `#saleNextDue`·`#saleConsent`가 나타나지 않는다 ⑮ 1440/768/390px에서 가로 넘침·겹침이 없다 ⑯ 콘솔 오류 0. 시험이 만든 규칙·`pet_next_due`·수신 상태는 끝나기 전에 복원/삭제한다(`pet_next_due`는 `rpc_set_next_due`에 `p_due_on = null`을 보내 지우고, 규칙·수신 상태는 시험 전 값으로 되돌린다). 기대: 처음에는 요소가 없어 FAIL.
- [ ] **Step 2: 실패 확인.** Run: `node tests/run-sale-next-due.js`(계정 파일 임시 복사) — Expected: 새 단계 FAIL.
- [ ] **Step 3: HTML.** 판매 구역의 장바구니 표 아래, 합계 위에 관리자 전용 `#saleNextDue`(처음엔 `hidden`)와 반려동물 선택 칸 아래에 `#saleConsent`(`hidden`)를 추가한다.
- [ ] **Step 4: 규칙 불러오기.** 관리자 로그인 직후와 규칙 저장 뒤 `saleRules`를 `reminder_rules?select=product_id,kind,interval_days,lead_days&product_id=not.is.null`로 채운다(실패하면 이전 값 유지).
- [ ] **Step 5: 다음 알림일 영역.** `renderSale()` 끝에서 `renderSaleDue()`를 부른다. 관리자가 아니거나 반려동물이 연결된 줄이 없으면 영역을 숨긴다. 그룹은 `sumQuantity`로 (반려동물, 상품)별 수량을 합산한다. 규칙 `rebuy`가 있으면 `calcNextDue`로 자동 날짜(직접 고친 날짜(`manual`)는 유지, 알림 안 함(`none`)도 유지)와 `nextDueText` 문장, 날짜 고치기 입력, [알림 안 함]을 보인다. 규칙 `vaccine`이면 `FIXED_PRESETS` 버튼과 [알림 안 함]. 규칙이 없으면 처음 정하기 버튼(`UNIT_DAY_PRESETS`는 "1개 = N일", `FIXED_PRESETS`는 "정해진 간격", 직접 입력 칸)과 [알림 안 함]. 처음 정하기를 누르면 `msgSaveRule`로 상품 규칙을 저장하고(재구매 안내 또는 접종 안내, lead 7) `saleRules`를 갱신한 뒤 다시 그린다. 저장이 실패하면 그 상품의 상태를 바꾸지 않고 쉬운 안내를 보인다. 연타는 잠가서 한 번만 보낸다. 계산이 `too-far`이면 날짜를 정하지 않고 "너무 멀어요. 날짜를 직접 정해 주세요"를 보인다. 판매일(`#saleDate`)이 바뀌면 다시 그린다. 같은 키의 상태는 상품 줄이 없어지면 버린다.
- [ ] **Step 6: 판매 성공 뒤 저장.** 판매 등록이 성공한 직후, 목록을 비우기 **전에** 저장 대상(`none`이 아니고 날짜가 있는 그룹)을 모아 둔다. 목록을 비우고 기존 후속 처리를 한 뒤 `saveSaleNextDue(...)`로 `rpc_set_next_due`를 그룹마다 한 번씩 부르고(`p_sold_on` = 판매일, `p_source` = 자동이면 `auto`·고친 날짜면 `manual`), 일부 실패해도 판매 성공 메시지는 그대로 두고 뒤에 "다음 알림일 N건은 저장하지 못했어요"를 덧붙인다. 이 로직은 기존 `try/catch`·`finally(release)` 구조와 판매 메시지를 바꾸지 않는다.
- [ ] **Step 7: 수신 동의.** 반려동물 선택(`selectSalePet`)과 지우기 때 `#saleConsent`를 갱신한다: 관리자일 때만, `pets?select=owner_id`와 `owner_reminder_pref`를 읽어(요청 번호로 늦은 응답은 버림) 상태 문장(`MessagingCore.prefLabel`)과 체크박스("복용 시기 안내 문자를 받기로 했어요")를 보인다. 체크 → `rpc_set_reminder_pref(owner, 'consented', '구두')`, 해제 → 상태 지우기. `optout`이면 체크 칸을 잠그고 "문자를 원하지 않는 분이에요. 바꾸려면 메시지 발송 화면에서 고쳐 주세요"를 보인다. 저장 중에는 체크 칸을 잠가 연타·중복 요청을 막는다.
- [ ] **Step 8: 스타일.** 기존 `.msg-*`·`.sale-*` 규칙을 재사용해 새 영역을 큰 버튼으로 만들고 좁은 화면에서 줄바꿈되며 겹치지 않게 한다.
- [ ] **Step 9: 통과 확인.** Run: `node --check app.js && node tests/run-sale-next-due.js` — Expected: 모든 단계 PASS, 콘솔 오류 0.

---

### Task 5: 마무리·회귀 확인

**Files:**
- Modify: `docs/final-acceptance.md`, `docs/superpowers/specs/2026-11-22-reminders-design.md`

- [ ] **Step 1: 회귀 확인.** Run: `npm run qa:static && npm run qa:unit` — Expected: 통과. 계정 파일을 임시 복사한 뒤 `node tests/run-sale-next-due.js`, `node tests/run-reminder-rules.js`, `node tests/run-messaging-qr.js`(전체 통과), `node tests/run-task-pet-link.js`(전체 통과), `node tests/run-nav-audit.js`(콘솔 오류 0), **`node tests/run-sales-pet-link.js`(판매 등록 회귀 — 이 시험은 실제 판매·반려동물 기록을 만들므로 실행 전에 사용자에게 알리고, 실행했다면 만든 기록을 보고한다)**를 실행하고 끝나면 계정 파일을 삭제한다.
- [ ] **Step 2: 문서.** 설계 문서에 §22(분류별 설정 화면 삭제와 판매 화면 처음 정하기, `pet_next_due.sold_on`, 관리자 전용)를 추가하고 §8의 3단계를 완료 표시한다. `docs/final-acceptance.md`에 판매 화면의 다음 알림일·처음 정하기·수신 동의를 적는다.
- [ ] **Step 3: 사용자 확인 항목 정리(완료 보고용).** 사장님이 직접 할 것: 실제 판매로 반려동물을 고르고 약·사료를 담아 처음 정하기·자동 계산·고치기, 접종 상품의 날짜 버튼, 수신 동의 체크를 써 보기. 접종 +7일 유예와 이력 보관 기간은 4단계 전에 정한다.
