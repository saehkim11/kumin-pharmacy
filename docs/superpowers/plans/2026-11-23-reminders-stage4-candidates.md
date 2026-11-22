# 알림 4단계: 알림 후보 + 대시보드 1주 달력 줄 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 판매 화면에서 저장한 다음 알림일(`pet_next_due`)을 모아 "알림 보낼 때예요" 후보로 만들고, 대시보드 맨 위를 오늘부터 7일을 한 줄로 보여 주는 달력(일정 + 알림 후보)으로 바꾸며, 메시지 발송 화면에 후보 목록과 [알림 보내기]·[넘김]을 둔다.

**Architecture:** 새 DB 객체 없이 앱이 관리자 권한으로 이미 있는 테이블(`pet_next_due`, `reminder_rules`, `reminder_log`, `owner_reminder_pref`, `sale_items`)을 읽어 후보를 계산한다(계산은 `messaging-core.js`의 순수 함수). 읽기·쓰기 모두 기존 RLS·관리자 전용 함수를 그대로 쓰므로 DB 변경이 없다. 후보에서 보낸 문자는 기존 `rpc_log_reminder`에 후보와 같은 키(종류·`p<상품번호>`·예정일)로 기록해 중복 제안을 막는다.

**Tech Stack:** 순수 HTML/CSS/JS, Supabase REST, Node `assert`, Playwright 저수준 API.

**Spec:** `docs/superpowers/specs/2026-11-22-reminders-design.md` §8(4단계), §12·§13(법적 유의·발송 정책), §16, §22, §23.

## Global Constraints
- DB 스키마·RLS·기존 함수는 바꾸지 않는다(이번 단계는 DB 변경 없음). 알림 후보는 관리자에게만 보이고, 직원 화면은 기존 일정만 보인다.
- 재구매 안내 문구에는 맨 앞 `(광고)`와 수신거부 안내를 넣고, 문자가 QR 한도(213바이트)를 넘지 않게 줄인다.
- 같은 건(반려동물 + 종류 + 예정일)은 `sent`/`skip` 기록이 있으면 다시 제안하지 않는다. `void`는 무시한다.
- 비밀값·보호자 연락처·이름을 콘솔·시험 로그에 출력하지 않는다. 사장님이 실제로 등록한 기록은 시험이 바꾸거나 지우지 않는다.
- 데스크톱·태블릿·모바일(1440/768/390px)에서 가로 넘침·겹침·잘림이 없다.

## Review Focus
1. 후보 제외 규칙(수신거부·취소 판매·기한 지난 재구매·6개월 한도·접종 +7일 유예)이 설계와 같은지, 경계일(183일·+7일)이 맞는지.
2. 후보에서 연 문자가 이후 다른 문자의 기록에 섞이지 않는지(반려동물·종류 변경, 미전송 확인 질문).
3. 보낸 기록·넘김 기록과 후보 중복 방지 키가 같은지, 연타·늦은 응답에도 한 번만 반영되는지.
4. 구매 확인(`sale_items`) 읽기가 많은 이력에서 잘리지 않는지.
5. 직원 계정에서 관리자 전용 요청이 오류·콘솔 경고를 만들지 않는지.

## File Structure
- `messaging-core.js`, `tests/messaging-core.test.cjs`: 계산·문구(Task 1).
- `index.html`, `app.js`, `styles.css`: 달력 줄·후보 목록(Task 2).
- `tests/run-reminder-candidates.js`: 화면·데이터 입출력 시험(Task 2).
- 문서: 설계 §8·§23, `docs/final-acceptance.md`(Task 3).

### Task 1: 후보 계산·문구 (`messaging-core.js`)
**Interfaces — Produces:** `buildCandidates({ today, dueRows, rules, pets, prefs, logs, validPurchases, productNames }) → Candidate[]`(`{ key, petId, petName, ownerId, productId, productName, kind, refKey:'p<상품>', dueOn, startOn, showOn, overdue, ready }`, 날짜순), `candidatesByDay(candidates, todayIso, dayCount) → Map(날짜 → 후보[])`, `rebuyText({ petName, productName }) → string`, `daysBetween`, `REBUY_WINDOW_DAYS = 183`, `VACCINE_GRACE_DAYS = 7`.
- [x] **Step 1:** `tests/messaging-core.test.cjs`에 기본 후보, 시작일 전(`ready=false`), 규칙 없음·취소 판매·수신거부 제외, 같은 건 기록(`sent`/`skip`) 제외와 `void`·다른 예정일·다른 종류는 유지, 재구매 기한 지남 제외·접종 +7일 유예, 6개월(183일) 경계·동의 보호자 예외, 접종은 6개월 제한 없음, 반려동물 정보 없음·정렬, `candidatesByDay` 7칸, `rebuyText`(광고·수신거부·병원 정보·QR 한도) 시험을 쓴다.
- [x] **Step 2:** `node tests/messaging-core.test.cjs` — 새 시험 FAIL 확인(10건).
- [x] **Step 3:** 위 시그니처대로 구현한다(`rebuyText`는 길면 상품 이름 → 반려동물 이름 순으로 줄임).
- [x] **Step 4:** `node tests/messaging-core.test.cjs && node --check messaging-core.js` — 55건 통과.

### Task 2: 대시보드 1주 달력 줄 + 메시지 화면 후보 목록
**Interfaces — Consumes:** Task 1 함수, `msgOpenWith`, `rpc_log_reminder`, `tasks`, `products`. **Produces:** `#weekStrip`(`.week-day[data-date]`, `.week-item.task|.cand`), `#msgCandidates`(`.msg-cand-item`, `.msg-cand-send`, `.msg-cand-skip`), `loadReminderCandidates()`, `reminderCandidates`, `msgOpenCandidate(candidate)`, `msgSkipCandidate(candidate, button)`.
- [x] **Step 1:** `tests/run-reminder-candidates.js`를 먼저 쓴다: 달력 7칸(탭 없음), 공유 업무 표시·이동, 후보 표시(재구매·접종), 메시지 후보 목록, 재구매 [알림 보내기] 문구((광고)·수신거부)·QR, [보냈어요] 기록(kind=rebuy)과 후보 사라짐, 접종 후보 문구·기록(kind=vaccine), 되돌림(void) 시 후보 복귀, [넘김](skip), optout 제외, 취소 판매 제외, 실제 등록 기록 보존, 직원 화면, 3개 화면 크기, 콘솔 오류 0. 구매 확인 응답에만 시험용 행을 끼우고 실제 판매·규칙·수신 상태·기록은 시험이 만든 것만 되돌린다.
- [x] **Step 2:** HTML(`#weekStrip`, `#msgCandidates`), `app.js`(`renderTodaySchedule` 재작성, 후보 불러오기·열기·넘김, `msgRefreshQr`/`msgRecordSend`의 `logKind`·`logRef`, `msgCandidate`를 반려동물·종류 변경 때 비움), `styles.css`를 구현한다.
- [x] **Step 3:** `node tests/run-reminder-candidates.js` — 17건 통과, 전체 회귀(정적·단위·메시지 43·업무 15·규칙 14·판매 18·메뉴 점검) 통과.

### Task 3: 문서
- [x] 설계 §8 4단계 완료 표시와 §23 추가, `docs/final-acceptance.md` 갱신.
