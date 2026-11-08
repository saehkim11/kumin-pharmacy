"""통합 시트 -> products / 판매관리 시트 -> sales_legacy INSERT SQL 생성기.
개인정보 없음(품목·거래 데이터). 그래도 대화 로그에는 요약 통계만 남긴다.

사용법:
  python tools/import_sales.py --dry-run
  python tools/import_sales.py
"""
import argparse
import datetime
import re
from collections import Counter

import openpyxl

XLSX_PATH = "data/real/판매관리 3 2025_수정_v2_요일별.xlsx"
OUT_SQL = "data/real/import_products_sales.sql"

CATEGORY_FIX = {
    "야품": "약품", "댝품": "약품",
    "사료17019": "사료", "사료3914": "사료", "사료11055": "사료",
    "투약보조제": "보조제", "첨가": "보조제",
}
CATEGORY_IDS = {"약품": 1, "사료": 2, "보조제": 3, "서비스": 4}
CATEGORY_NAMES = {1: ("의약품", "drug"), 2: ("사료", "feed"), 3: ("보조제", "supplement"), 4: ("조제·진료", "service")}

# 판매관리 품목명 표기 차이 교정(같은 상품으로 확인된 것만). 종이 다르거나 핵심명이 다른 건 넣지 않는다.
SALE_NAME_FIX = {
    "힐즈다이제스티브캔": "힐즈다이제스티브로펫캔",
    "레나메진캡슐285.7mg/700/500": "레나메진캡슐285.7mg/700/500 에스엔피",
    "닥터힐모빌펫": "닥터힐모빌벳",
    "브라벡토 S 10kg이하": "브라벡토 S 4.5-10kg이하",
    "클라펫 50": "클라펫 50 (액티클라브)",
    "넥스가드캣콤보 (2.5~7.5)": "넥스가드캣콤보 XS(2.5~7.5)",
    # 품목 칸이 비어서 '찾기' 열에만 적힌 약품명 교정(같은 상품으로 확인된 것만)
    "벳에이다플러스": "벳에이다플러스12g",
    "독레날캔": "독 레날 캔",
    "코로나": "노비박코로나",
}

# 조제/진료/주사 등 완제품이 아닌 서비스성 항목. '찾기' 열 텍스트에서 키워드로 정규화한다
# (오타·반려동물 애칭 등 부가 텍스트는 무시). 여러 키워드가 섞이면 조합 이름으로 묶는다.
SERVICE_KEYWORDS = [
    ("조제", ["조제", "제조", "조재"]),
    ("주사", ["주사"]),
    ("진료", ["진료", "초진", "진"]),
    ("검진", ["검진"]),
]


def normalize_service_label(find_label: str):
    """'찾기' 열 텍스트가 조제/진료/주사 류면 캐노니컬 이름을, 아니면 None을 반환."""
    tags = []
    for canon, kws in SERVICE_KEYWORDS:
        if any(kw in find_label for kw in kws):
            tags.append(canon)
    if not tags:
        return None
    return "+".join(tags)


def norm_product_name(v) -> str:
    if v is None:
        return ""
    return re.sub(r"\s+", " ", str(v)).strip()


def sql_str(v):
    if v is None or v == "":
        return "null"
    return "'" + str(v).replace("'", "''") + "'"


def sql_num(v):
    return "null" if v is None else str(v)


def load_tonghap_rows():
    wb = openpyxl.load_workbook(XLSX_PATH, read_only=True, data_only=True)
    ws = wb["통합"]
    rows = ws.iter_rows(min_row=1, max_row=ws.max_row, values_only=True)
    header = next(rows)
    idx = {n: i for i, n in enumerate(header) if n}
    for r in rows:
        def g(col):
            i = idx.get(col)
            return r[i] if i is not None and i < len(r) else None
        yield {"name": g("약  품  명"), "unit": g("용량"), "category": g("구분")}


# 셀 서식 오류로 1900년대로 깨진 날짜 보정(위아래 행 날짜로 확인됨)
DATE_FIX = {
    "레나메진캡슐285.7mg/700/500 에스엔피|3|138000": datetime.date(2026, 6, 4),
}


def load_sale_rows():
    wb = openpyxl.load_workbook(XLSX_PATH, read_only=True, data_only=True)
    ws = wb["판매관리"]
    rows = ws.iter_rows(min_row=1, max_row=ws.max_row, values_only=True)
    for _ in range(3):
        header = next(rows)
    idx = {n: i for i, n in enumerate(header) if n}
    for r in rows:
        def g(col):
            i = idx.get(col)
            return r[i] if i is not None and i < len(r) else None
        yield {
            "date": g("날짜"), "name": g("품목"), "find": g("찾기"), "unit": g("종류"), "qty": g("판매량"),
            "unit_price": g("판매단가"), "amount": g("매출"), "unit_cost": g("매입단가"),
            "profit": g("손익"), "margin": g("마진율"),
        }


def collect_service_canon_names():
    """품목 칸이 비어 '찾기'만 있는 행 중, 상품 교정(SALE_NAME_FIX) 대상이 아니면서
    조제/주사/진료/검진 키워드로 정규화되는 캐노니컬 이름 집합을 모은다."""
    names = set()
    for row in load_sale_rows():
        name = norm_product_name(row["name"])
        if name:
            continue
        find_label = norm_product_name(row.get("find"))
        if not find_label or find_label in SALE_NAME_FIX:
            continue
        canon = normalize_service_label(find_label)
        if canon:
            names.add(canon)
    return names


def build_products():
    products = {}  # name_norm -> {"id":..., "name":..., "category_id":..., "unmatched_category": bool}
    unmatched_categories = Counter()
    for row in load_tonghap_rows():
        name = norm_product_name(row["name"])
        if not name:
            continue
        cat_raw = str(row["category"]).strip() if row["category"] else None
        cat_fixed = CATEGORY_FIX.get(cat_raw, cat_raw)
        cat_id = CATEGORY_IDS.get(cat_fixed)
        if cat_id is None:
            unmatched_categories[cat_raw] += 1
        if name not in products:
            products[name] = {"name": name, "category_id": cat_id}
        elif products[name]["category_id"] is None and cat_id is not None:
            products[name]["category_id"] = cat_id

    next_id = 1
    for p in products.values():
        p["id"] = next_id
        next_id += 1

    for svc_name in sorted(collect_service_canon_names()):
        if svc_name in products:
            continue
        products[svc_name] = {"name": svc_name, "category_id": CATEGORY_IDS["서비스"], "id": next_id}
        next_id += 1

    return products, unmatched_categories


def build_sales_legacy(products):
    matched = 0
    unmatched = 0
    skipped_bad_date = 0
    rows_out = []
    unmatched_names = Counter()
    for row in load_sale_rows():
        d = row["date"]
        if isinstance(d, datetime.datetime):
            d = d.date()
        name_raw = norm_product_name(row["name"]) or norm_product_name(row.get("find"))
        if not isinstance(d, datetime.date) or d.year < 2015:
            fix_key = f"{name_raw}|{row['qty']}|{row['amount']}"
            fixed = DATE_FIX.get(fix_key)
            if fixed:
                d = fixed
            else:
                skipped_bad_date += 1
                continue
        if not name_raw:
            continue
        lookup_name = SALE_NAME_FIX.get(name_raw, name_raw)
        prod = products.get(lookup_name)
        if not prod:
            is_service_row = not norm_product_name(row["name"])  # 품목 칸이 비어 찾기로 대체된 행만
            if is_service_row:
                svc = normalize_service_label(name_raw)
                if svc:
                    prod = products.get(svc)
        if prod:
            matched += 1
            product_id = prod["id"]
        else:
            unmatched += 1
            unmatched_names[name_raw] += 1
            product_id = None
        rows_out.append({
            "sold_on": d, "product_id": product_id, "name_raw": name_raw,
            "unit": row["unit"] if isinstance(row["unit"], str) else None,
            "qty": row["qty"] if isinstance(row["qty"], (int, float)) else None,
            "unit_price": row["unit_price"] if isinstance(row["unit_price"], (int, float)) else None,
            "amount": row["amount"] if isinstance(row["amount"], (int, float)) else None,
            "unit_cost": row["unit_cost"] if isinstance(row["unit_cost"], (int, float)) else None,
            "profit": row["profit"] if isinstance(row["profit"], (int, float)) else None,
            "margin": row["margin"] if isinstance(row["margin"], (int, float)) else None,
        })
    return rows_out, {
        "matched": matched, "unmatched": unmatched, "skipped_bad_date": skipped_bad_date,
        "unmatched_names": unmatched_names,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    products, unmatched_categories = build_products()
    rows_out, stats = build_sales_legacy(products)

    print("=== 가져오기 요약 ===")
    print(f"상품(products) 수: {len(products)}")
    if unmatched_categories:
        print(f"분류(구분) 매핑 안 된 값 종류 수: {len(unmatched_categories)} -> {unmatched_categories.most_common(10)}")
    print(f"판매 이력(sales_legacy) 행 수: {len(rows_out)}")
    print(f"  품목명 매칭 성공: {stats['matched']} / 매칭 실패(product_id 없음): {stats['unmatched']}")
    print(f"  날짜가 이상해서 제외한 행: {stats['skipped_bad_date']}")
    if stats["unmatched_names"]:
        print(f"  매칭 안 된 품목명 상위: {stats['unmatched_names'].most_common(10)}")

    if args.dry_run:
        return

    # SQL Editor 용량 제한 때문에 여러 파일로 나눈다.
    import os
    out_dir = os.path.dirname(OUT_SQL)

    cat_lines = ["begin;", "", "-- product_categories (스키마 최초 1회만 필요)",
                 "insert into public.product_categories (id, name, group_name) values"]
    cat_vals = [f"  ({cid}, {sql_str(name)}, {sql_str(group)})" for cid, (name, group) in CATEGORY_NAMES.items()]
    cat_lines.append(",\n".join(cat_vals) + " on conflict (id) do nothing;")
    cat_lines.append("")
    cat_lines.append("-- products (통합 시트 기준, track_stock=false: 재고관리는 아직 비활성)")
    for p in products.values():
        cat_sql = sql_num(p["category_id"]) if p["category_id"] else "3"
        cat_lines.append(
            "insert into public.products (id, code, name, category_id, target_animal, sale_price, track_stock, track_expiry, active) "
            f"values ({p['id']}, {sql_str('LEGACY-' + str(p['id']))}, {sql_str(p['name'])}, {cat_sql}, 'all', 0, false, false, true);"
        )
    cat_lines.append("")
    cat_lines.append("commit;")
    products_path = os.path.join(out_dir, "import_01_products.sql")
    with open(products_path, "w", encoding="utf-8") as f:
        f.write("\n".join(cat_lines))
    print(f"생성됨: {products_path}")

    CHUNK = 500
    chunk_paths = []
    for ci in range(0, len(rows_out), CHUNK):
        chunk = rows_out[ci:ci + CHUNK]
        lines = ["begin;", ""]
        for r in chunk:
            lines.append(
                "insert into public.sales_legacy (sold_on, product_id, product_name_raw, unit_label, quantity, unit_price, amount, unit_cost, profit, margin_rate) "
                f"values ({sql_str(r['sold_on'].isoformat())}, {sql_num(r['product_id'])}, {sql_str(r['name_raw'])}, "
                f"{sql_str(r['unit'])}, {sql_num(r['qty'])}, {sql_num(r['unit_price'])}, {sql_num(r['amount'])}, "
                f"{sql_num(r['unit_cost'])}, {sql_num(r['profit'])}, {sql_num(r['margin'])});"
            )
        lines.append("")
        lines.append("commit;")
        n = ci // CHUNK + 2
        path = os.path.join(out_dir, f"import_{n:02d}_sales_legacy.sql")
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
        chunk_paths.append(path)
        print(f"생성됨: {path} ({len(chunk)}건)")

    if os.path.exists(OUT_SQL):
        os.remove(OUT_SQL)


if __name__ == "__main__":
    main()
