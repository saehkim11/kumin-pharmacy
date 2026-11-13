"""통합 시트의 매입 참고정보(거래처·매입단가·공항가격·마진율·제조사·용량·최근 거래내역)를
products/suppliers/product_costs에 반영하는 UPDATE/INSERT SQL 생성기.

상품 매칭 로직은 tools/import_sales.py의 build_products()와 동일하게 맞춘다
(같은 이름의 상품이 여러 행에 걸쳐 있으면 하나로 합치고, 그 순서대로 product_id가
이미 배정되어 있으므로 반드시 같은 정규화 규칙으로 이름을 매칭해야 한다).

개인정보 없음(품목·거래처·단가 데이터). 대화 로그에는 요약 통계만 남긴다.

사용법:
  python tools/import_product_costs.py --dry-run
  python tools/import_product_costs.py
"""
import argparse
import datetime
import re
from collections import Counter

import openpyxl

XLSX_PATH = "data/real/판매관리 3 2025_수정_v2_요일별.xlsx"
OUT_SQL = "data/real/import_10_product_costs.sql"

CATEGORY_FIX = {
    "야품": "약품", "댝품": "약품",
    "사료17019": "사료", "사료3914": "사료", "사료11055": "사료",
    "투약보조제": "보조제", "첨가": "보조제",
}
CATEGORY_IDS = {"약품": 1, "사료": 2, "보조제": 3, "서비스": 4}


def norm_product_name(v) -> str:
    if v is None:
        return ""
    return re.sub(r"\s+", " ", str(v)).strip()


def norm_text(v):
    if v is None:
        return None
    t = re.sub(r"\s+", " ", str(v)).strip()
    return t or None


def sql_str(v):
    if v is None or v == "":
        return "null"
    return "'" + str(v).replace("'", "''") + "'"


def sql_num(v):
    if v is None:
        return "null"
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return str(v)
    return "null"


def sql_date(v):
    if isinstance(v, datetime.datetime):
        v = v.date()
    if isinstance(v, datetime.date):
        return f"'{v.isoformat()}'"
    return "null"


def load_tonghap_rows():
    wb = openpyxl.load_workbook(XLSX_PATH, read_only=True, data_only=True)
    ws = wb["통합"]
    rows = ws.iter_rows(min_row=1, max_row=ws.max_row, values_only=True)
    header = next(rows)
    idx = {n: i for i, n in enumerate(header) if n}

    def g(r, col):
        i = idx.get(col)
        return r[i] if i is not None and i < len(r) else None

    for r in rows:
        yield {
            "name": g(r, "약  품  명"),
            "category": g(r, "구분"),
            "volume": g(r, "용량"),
            "supplier": g(r, "공급자명"),
            "manufacturer": g(r, "제조사"),
            "txn_date": g(r, "거래일자"),
            "qty": g(r, "매입량"),
            "amount": g(r, "매입금액"),
            "margin": g(r, "마진율"),
            "unit_cost": g(r, "매입단가"),
            "list_price": g(r, "공항가격"),
        }


def build_products():
    """import_sales.py의 build_products()와 동일한 규칙으로 상품 집합과 id를 재구성한다."""
    products = {}
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
    return products


def is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def build_cost_rows(products):
    """상품별로 비어있지 않은 첫 값을 채택해 매입 참고정보를 하나로 모은다."""
    costs = {}  # name -> dict of fields
    for row in load_tonghap_rows():
        name = norm_product_name(row["name"])
        if not name or name not in products:
            continue
        entry = costs.setdefault(name, {
            "volume": None, "supplier": None, "manufacturer": None,
            "txn_date": None, "qty": None, "amount": None, "margin": None,
            "unit_cost": None, "list_price": None,
        })
        if entry["volume"] is None:
            entry["volume"] = norm_text(row["volume"])
        if entry["supplier"] is None:
            entry["supplier"] = norm_text(row["supplier"])
        if entry["manufacturer"] is None:
            entry["manufacturer"] = norm_text(row["manufacturer"])
        if entry["txn_date"] is None and isinstance(row["txn_date"], (datetime.date, datetime.datetime)):
            entry["txn_date"] = row["txn_date"]
        if entry["qty"] is None and is_num(row["qty"]):
            entry["qty"] = row["qty"]
        if entry["amount"] is None and is_num(row["amount"]):
            entry["amount"] = row["amount"]
        if entry["margin"] is None and is_num(row["margin"]):
            entry["margin"] = row["margin"]
        if entry["unit_cost"] is None and is_num(row["unit_cost"]):
            entry["unit_cost"] = row["unit_cost"]
        if entry["list_price"] is None and is_num(row["list_price"]):
            entry["list_price"] = row["list_price"]
    return costs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    products = build_products()
    costs = build_cost_rows(products)

    supplier_names = sorted({c["supplier"] for c in costs.values() if c["supplier"]})
    with_unit_cost = sum(1 for c in costs.values() if c["unit_cost"] is not None)
    with_supplier = sum(1 for c in costs.values() if c["supplier"])
    with_list_price = sum(1 for c in costs.values() if c["list_price"] is not None)

    print("=== 매입단가/거래처 가져오기 요약 ===")
    print(f"상품 수(통합 시트 기준): {len(products)}")
    print(f"거래처(공급자명) 종류 수: {len(supplier_names)}")
    print(f"매입단가가 있는 상품 수: {with_unit_cost}")
    print(f"공항가격이 있는 상품 수: {with_list_price}")
    print(f"거래처 정보가 있는 상품 수: {with_supplier}")

    if args.dry_run:
        return

    lines = ["begin;", "", "-- 거래처(공급자명) 목록 (id는 수동 배정 테이블이라 직접 번호를 매긴다)"]
    lines.append("insert into public.suppliers (id, name) values")
    lines.append(",\n".join(f"  ({i + 1}, {sql_str(n)})" for i, n in enumerate(supplier_names)) + "\non conflict (name) do nothing;")
    lines.append("")
    lines.append("-- 상품별 거래처 연결")
    for name, c in costs.items():
        if not c["supplier"]:
            continue
        pid = products[name]["id"]
        lines.append(
            f"update public.products set supplier_id = (select id from public.suppliers where name = {sql_str(c['supplier'])}) "
            f"where id = {pid};"
        )
    lines.append("")
    lines.append("-- 상품별 매입 참고정보(product_costs) - 200행씩 나눠서 INSERT (각 묶음이 독립 실행 가능하게)")
    value_tuples = []
    for name, c in costs.items():
        pid = products[name]["id"]
        value_tuples.append(
            f"({pid},{sql_num(c['unit_cost']) if c['unit_cost'] is not None else 0},{sql_num(c['list_price'])},"
            f"{sql_num(c['margin'])},{sql_str(c['manufacturer'])},{sql_str(c['volume'])},"
            f"{sql_str(c['supplier'])},{sql_num(c['qty'])},{sql_num(c['amount'])},{sql_date(c['txn_date'])})"
        )
    BATCH = 200
    for i in range(0, len(value_tuples), BATCH):
        batch = value_tuples[i:i + BATCH]
        lines.append(
            "insert into public.product_costs "
            "(product_id, purchase_price, list_price, margin_rate, manufacturer, volume, "
            "supplier_name_raw, last_purchase_qty, last_purchase_amount, last_purchase_date) values"
        )
        lines.append(",\n".join(batch))
        lines.append(
            "on conflict (product_id) do update set "
            "purchase_price = excluded.purchase_price, list_price = excluded.list_price, "
            "margin_rate = excluded.margin_rate, manufacturer = excluded.manufacturer, volume = excluded.volume, "
            "supplier_name_raw = excluded.supplier_name_raw, last_purchase_qty = excluded.last_purchase_qty, "
            "last_purchase_amount = excluded.last_purchase_amount, last_purchase_date = excluded.last_purchase_date;"
        )
        lines.append("")
    lines.append("commit;")

    with open(OUT_SQL, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"SQL written to {OUT_SQL}")


if __name__ == "__main__":
    main()
