# 검색창 초성 검색 규칙

이 프로젝트의 모든 검색창은 **이름을 끝까지 타이핑하지 않아도, 초성(자음)만 입력해도 찾을 수 있어야 한다.**
실사용자가 장년층 약사·직원이라 타이핑을 최소화해야 하기 때문이다 (`AGENTS.md` 참고).

## 공용 매칭 함수

`app.js`의 두 함수가 이 규칙을 구현한다.

- `getKoreanInitials(text)` — 한글 문자열을 초성 문자열로 변환 (예: "별" → "ㅂ").
- `matchesKoreanText(text, keyword)` — 완전/부분 일치 또는 초성 일치 여부를 반환하는 공용 매칭 함수.
  ```js
  matchesKoreanText('넥스가드 S(3.5-7.5)', 'ㄴㅅㄱ') // true
  matchesKoreanText('별', '별')                      // true
  ```
- `matchesProduct(product, keyword)` — 상품(이름+코드) 전용 버전. 내부적으로 같은 방식을 쓴다.

새 검색창을 만들 때는 이 함수들을 재사용한다. 서버(Supabase) 쪽에서 `like`/`similarity`로 새로 필터링 로직을 만들지 않는다 — 데이터가 이미 클라이언트에 로드돼 있다면 `matchesKoreanText`로 거른다.

## 화면별 현황

| 검색창 | 위치 | 방식 | 초성 검색 |
| --- | --- | --- | --- |
| 상품 선택 (`#saleProductSearch`) | 판매 관리 | 클릭형 추천 목록 + `matchesProduct` | 가능 |
| 입고 상품 선택 (`#purchaseProductSearch`) | 입고 관리 | 클릭형 추천 목록 + `matchesProduct` | 가능 |
| 상품 찾기 (`#productSearch`) | 입고 관리 · 월별 재고 수불부 | 표 필터 + `matchesProduct` | 가능 |
| 반려동물 선택 (`#salePetSearch`) | 판매 관리 | 클릭형 추천 목록 + `matchesKoreanText` (이름+보호자 라벨) | 가능 (2025-11 추가) |
| 반려동물 이름 검색 (`#petSearchInput`) | 고객·반려동물 관리 | 전체 목록을 불러와 `matchesKoreanText`로 매칭 | 가능 (2025-11 추가, 외자 포함) |
| 상품명 검색 (`#legacySalesSearch`) | 매출관리 | 표 필터 + `matchesKoreanText` | 가능 (2025-11 추가) |

## 변경 이력 메모

- 2025-11 이전: `#petSearchInput`은 Supabase RPC(`rpc_search_pets_by_name`, pg_trgm 유사도)로 서버에서 검색했다. 외자(한 글자) 이름은 유사도 점수가 낮아 누락되는 문제가 있었고, 초성 검색도 지원하지 않았다. 지금은 상품 검색과 같은 클라이언트 매칭 방식으로 바꿔서 두 문제를 함께 해결했다. `rpc_search_pets_by_name` 함수 자체는 DB에 남아 있지만 더 이상 호출하지 않는다 (삭제하지 않음 — 필요 시 참고용).
- `#salePetSearch`는 원래 네이티브 `<datalist>`였다. 브라우저가 옵션을 자체적으로 "부분 문자열 포함" 기준으로만 걸러서, 아무리 목록을 초성 기준으로 미리 걸러줘도 브라우저가 다시 숨겨버려 초성 검색이 근본적으로 불가능했다. 그래서 판매 관리 상품 선택과 같은 클릭형 추천 목록으로 교체했다.
