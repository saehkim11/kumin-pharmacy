# kumin-pharmacy ERP & BI

동물약국 판매·입고·재고·공유 업무를 관리하고 매출·이익을 분석하는 웹앱입니다.
HTML, CSS, JavaScript만 사용하며 데이터는 Supabase(로그인, 권한, 데이터베이스)에 저장합니다.

## 화면
- 대시보드: 오늘 일정·매출, 판매 건수, 이번 달 판매 수익·마진율, 매출·분류별 전년 대비 증감
- 판매 관리: 판매 등록, 월별 판매 내역(일자별·품목별, 관리자에게 허용된 엑셀 과거 판매 포함)
- 고객·반려동물 관리: 이름·초성 검색, 보호자·반려동물 등록, 방문 기록·구매 이력
- 입고 관리(admin): 매입단가 조회, 입고 등록 (월별 재고 수불부는 화면에서 숨김)
- 공유 업무: 업무 달력, 상태 변경, 댓글
- 분석(admin): 전체·판매 등록·엑셀 자료 범위별 매출·이익·마진율, 분류·상품별 수익성, 날씨·계절 수요 알림
- 매출관리(admin): 과거 매출의 일별·상품별·요일별·마진율·최근 3개월·전년 동기 비교, 날씨·인구 예측
- 사이트 구조(admin): 판매·입고·업무·과거 자료의 입력→조회 연결 안내, 데이터 백업

## 역할
- `admin`(대표): 모든 화면
- `staff`(직원): 대시보드, 판매 관리, 고객·반려동물 관리, 공유 업무

## 최종 검수

- 최신 결과와 검증 범위: [납품 전 재검수](docs/release-review.md), [1차 검수 기록](docs/final-acceptance.md)
- 사용자 불만 접수·개발 수정·원고객 재검증: [사용자·개발자 쌍 검수](docs/paired-customer-review.md)
- 로컬 서버가 실행 중일 때 `node tests/final-audit.cjs`로 재검증합니다.
- Playwright 러너에서는 `npx playwright test tests/final-audit.spec.js`로 실행합니다. 기존 서버를 종료한 상태에서 실행하세요.
- 테스트 계정은 로컬 파일에서만 읽고 출력하지 않습니다. 판매는 목록 담기까지, 업무 상태·댓글 쓰기는 별도 시험 응답으로 검증합니다.

## 로컬 실행
1. 프로젝트 폴더에 `config.js`를 만듭니다(Git에 올리지 않습니다).
   ```js
   window.APP_CONFIG = { supabaseUrl: "...", supabasePublishableKey: "..." };
   ```
2. `index.html`을 브라우저로 엽니다.

## 배포
`main`에 push하면 `.github/workflows/deploy-pages.yml`이 GitHub Pages로 배포합니다.
저장소 Secrets에 `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`가 있어야 합니다.

## Supabase 연동(MCP)
에이전트(Claude Code, Codex 등)에서 Supabase MCP를 OAuth 방식으로 연동해 스키마 변경,
조회, 대량 데이터 업로드를 진행합니다. 연동 방법과 대량 업로드 시 주의할 점은
[`docs/supabase-mcp.md`](docs/supabase-mcp.md)에 정리했습니다.

## 폴더
- `db/` Supabase SQL (스키마, 권한, RPC, 검증)
- `data/real/` 실제 업무 엑셀·가져오기 결과 보관용(Git 제외, 절대 커밋 금지)
- `docs/supabase-mcp.md` Supabase MCP 연동·대량 업로드 방법
- `docs/sales-legacy-product-matching.md` 과거 판매 데이터 상품 매칭(퍼지 매칭) 기록
- `AGENTS.md` 작업 규칙
