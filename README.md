# kumin-pharmacy ERP & BI

동물약국 판매·입고·재고·공유 업무를 관리하고 매출·이익을 분석하는 웹앱입니다.
HTML, CSS, JavaScript만 사용하며 데이터는 Supabase(로그인, 권한, 데이터베이스)에 저장합니다.

## 화면
- 대시보드: 오늘 매출, 재고 확인 필요, 이번 달 마진율, 매출·분류별 전년 대비 증감
- 판매 관리: 판매 등록, 월별 판매 내역(일자별·품목별)
- 입고 관리(admin): 입고 등록, 월별 재고 수불부
- 공유 업무: 업무 달력, 상태 변경, 댓글
- 분석(admin): 이익·마진율 추이, 분류·상품별 수익성, 날씨·계절 수요 알림
- 사이트 구조(admin): 화면 구성 지도와 개선 포인트

## 역할
- `admin`(대표): 모든 화면
- `staff`(직원): 대시보드, 판매 관리, 공유 업무

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
