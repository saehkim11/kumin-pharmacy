# sales_legacy 상품 매칭(퍼지 매칭) 기록

`public.sales_legacy`에 과거 판매 데이터 3,507건을 업로드한 뒤, 상품명이 `products`
마스터와 정확히 일치하지 않아 `product_id`가 `NULL`로 남은 건이 63건 있었습니다.
이 문서는 그 중 일부를 퍼지 매칭으로 채운 방법과 결과, 그리고 남겨둔 이유를 기록합니다.
다음에 비슷한 레거시 데이터를 들여올 때 같은 기준으로 판단할 수 있도록 남깁니다.

## 왜 단순 유사도만으로는 안 되는가

Postgres `pg_trgm`(`similarity()`)로 상품명 텍스트 유사도만 보고 자동 매칭하면 틀린
상품에 연결될 위험이 있습니다. 예:

- `오메가3 플러스` → 트라이그램 유사도 1위는 `오메가3`(0.56)였지만, `닥터힐오메가3 플러스`
  (0.50)도 거의 같은 점수였습니다. 둘 중 하나는 틀린 매칭입니다.
- `베트메딘` → 마스터에 `베트메딘1.25mg`, `베트메딘5mg`, `베트메딘10mg/50T` 세 가지가
  있어서, 이름만으로는 어느 용량인지 알 수 없습니다.

## 검증 방법: 기존 연결 건의 단가로 교차 확인

후보 상품이 이미 다른 행에서 `product_id`로 연결되어 있다면, 그 상품의 기존
`unit_price` 분포(최소/최대/평균)를 구해서, 매칭하려는 행의 `unit_price`가 그 범위에
들어맞는지로 교차 검증했습니다.

```sql
select p.id, p.name, min(l.unit_price) mn, max(l.unit_price) mx, avg(l.unit_price) avgp, count(*) n
from public.sales_legacy l join public.products p on p.id = l.product_id
where p.name in ('오메가3', '닥터힐오메가3 플러스')
group by p.id, p.name;
```

- `오메가3`(id 764): 기존 연결 건 단가가 전부 2,400원 → `오메가3 플러스`(2,000~2,400원)와
  정확히 일치 → **확정**.
- `닥터힐오메가3 플러스`(id 184): 기존 연결 건 단가가 2,400~43,000원(평균 23,628원,
  박스 단위 추정) → 범위가 안 맞음 → **제외**.

반대로 가격이 안 맞으면 유사도가 높아도 매칭하지 않았습니다:

- `독 다이아베틱`(8건, 92,000~115,000원, 대용량 사료봉지 추정) → 유사도 1위는
  `독 다이아베틱 스페셜캔`(id 249)이었지만, 이건 소용량 캔 제품이라 가격대가 전혀
  맞지 않음(캔 제품은 보통 수천~수만원대) → **제외**. 마스터에 해당 사료봉지 상품이
  아예 없는 것으로 판단.

## 적용 결과 (2026-11 기준)

63건 → **27건 매칭 완료, 36건 보류**.

| 원본 상품명(`product_name_raw`) | 매칭한 상품(`products.name`) | 건수 | 판단 근거 |
|---|---|---|---|
| 오메가3 플러스 | 오메가3 | 18 | 기존 연결 건 단가(2,400원)와 정확히 일치 |
| 독 하이포 | 독 유리나리 하이포 | 1 | 텍스트 유사도 0.545 + 가격대(사료봉지 단위) 합리적, 비교 대상 없음 |
| 레볼루션플러스 5-10 kg | 레볼루션플러스켓 5-10 kg | 1 | 중량 구간 텍스트 완전 일치(유사도 0.833) |
| 덴탈투스페이스트(cet치약) | 덴탈엔자임메틱(cet치약) | 1 | 기존 연결 건 단가(13,000~15,000원) 범위 내 |
| 독글리코벨런스 | 독 글리코벨런스스몰독 | 1 | 품목·용량군(스몰독) 일치, 가격대 합리적 |
| 네오덤연고 | 네오덤크림 | 1 | 같은 브랜드, 가격대 근접(기존 범위 5,000~250,000원의 하단) |
| 복막백신 | 벵가드 복막염백신 | 1 | 유일 후보, 가격대 같은 자릿수(30,000~50,000원) |
| 소독제 | 소독용에탄올 | 1 | 가격(3,000원) 완전 일치 |

적용한 SQL(참고용, 재실행 금지 — 이미 적용됨):

```sql
update public.sales_legacy set product_id = 342 where product_id is null and product_name_raw = '레볼루션플러스 5-10 kg';
update public.sales_legacy set product_id = 764 where product_id is null and product_name_raw = '오메가3 플러스';
update public.sales_legacy set product_id = 277 where product_id is null and product_name_raw = '독 하이포';
update public.sales_legacy set product_id = 207 where product_id is null and product_name_raw = '덴탈투스페이스트(cet치약)';
update public.sales_legacy set product_id = 248 where product_id is null and product_name_raw = '독글리코벨런스';
update public.sales_legacy set product_id = 75  where product_id is null and product_name_raw = '네오덤연고';
update public.sales_legacy set product_id = 518 where product_id is null and product_name_raw = '복막백신';
update public.sales_legacy set product_id = 588 where product_id is null and product_name_raw = '소독제';
```

## 보류한 36건 (사용자 결정: 그대로 둔다)

아래 유형은 **매칭하지 않고 `product_id = NULL`로 그대로 둡니다.** 매출 합계·기간 등
전체 집계에는 영향이 없고(이미 `amount`가 들어가 있음), "상품별" 분석에서만 집계에서
빠집니다.

- **가격 신호가 모순되는 경우**: `독 다이아베틱`(8건) — 유사도는 높지만 실제 가격대가
  후보 상품과 전혀 다름. 마스터에 해당 상품이 없는 것으로 보임.
- **용량/종류가 여러 개라 특정할 수 없는 경우**: `베트메딘`(용량 3종 중 특정 불가,
  가격 데이터도 없음)
- **서비스·비품·오타성 항목** (유사도 0.3 미만, 상품이 아닐 가능성이 높음):
  `조`, `피부약ㅋ`, `인식표`, `동물등록`, `교환`, `교체`, `지료`, `장`, `솜`, `솜알콜`,
  `알코올`, `약절단기`, `약커팅기`, `뱅가드`, `독pa`, `셀리녹스`, `아놀레딕스`,
  `독레날위드피쉬`, `네스18kg 1 넥스7kg2`, `멕페란`, `기관 심부전 약` 등

나중에 이 항목들을 다시 다루고 싶다면, 이 문서의 "검증 방법"을 그대로 적용해서
(1) 후보 상품을 `pg_trgm`으로 뽑고, (2) 기존 연결 건의 단가 범위와 비교해서
확신이 설 때만 매칭하는 방식을 권장합니다.
