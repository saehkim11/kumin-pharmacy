"""접종관리 시트 -> pet_visits INSERT SQL 생성기 (날짜별 방문 기록 그대로 보존).
owners/pets는 이미 DB에 있다고 가정하고, owner.name + pet.name으로 매칭해 pet_id를 찾는다.
실제 데이터는 data/real/ 입력, 결과도 data/real/ (Git 제외). 대화/로그에 개인정보 출력 금지.

사용법:
  python tools/import_pet_visits.py --dry-run
  python tools/import_pet_visits.py
"""
import argparse
import datetime
import sys

import openpyxl

XLSX_PATH = "data/real/판매관리 3 2025_수정_v2_요일별.xlsx"
SHEET = "접종관리"
HEADER_ROW = 2
OUT_SQL = "data/real/import_pet_visits.sql"


def norm_name(v) -> str:
    if v is None:
        return ""
    import re
    return re.sub(r"\s+", "", str(v)).strip()


def sql_str(v):
    if v is None or v == "":
        return "null"
    return "'" + str(v).replace("'", "''") + "'"


def load_rows():
    wb = openpyxl.load_workbook(XLSX_PATH, read_only=True, data_only=True)
    ws = wb[SHEET]
    rows = ws.iter_rows(min_row=1, max_row=ws.max_row, values_only=True)
    for _ in range(HEADER_ROW):
        header = next(rows)
    idx = {name: i for i, name in enumerate(header) if name}
    for r in rows:
        def g(col):
            i = idx.get(col)
            return r[i] if i is not None and i < len(r) else None
        yield {
            "date": g("날짜"), "owner": g("견주"), "pet": g("강아지이름"),
            "record": g("진료기록"), "detail": g("상세"),
        }


def build_visits(rows):
    visits = []
    skipped = 0
    for row in rows:
        owner_raw = row["owner"]
        pet_raw = row["pet"]
        owner_blank = not owner_raw or not str(owner_raw).strip()
        pet_blank = not pet_raw or not str(pet_raw).strip()
        if owner_blank or pet_blank:
            skipped += 1
            continue
        if not row["record"] and not row["detail"]:
            continue

        visit_date = row["date"]
        if isinstance(visit_date, datetime.datetime):
            visit_date = visit_date.date()
        elif not isinstance(visit_date, datetime.date):
            visit_date = None

        visits.append({
            "owner_name": str(owner_raw).strip(),
            "pet_name": str(pet_raw).strip(),
            "visit_date": visit_date,
            "record": str(row["record"]).strip() if row["record"] else None,
            "detail": str(row["detail"]).strip() if row["detail"] else None,
        })
    return visits, skipped


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    visits, skipped = build_visits(load_rows())
    print("=== 가져오기 요약 (개인정보 미포함) ===")
    print(f"방문 기록 수: {len(visits)}")
    print(f"보호자/반려동물 이름 비어 있어 제외: {skipped}")

    if args.dry_run:
        return

    lines = ["begin;", "",
             "create temporary table pet_visit_staging (",
             "  owner_name text, pet_name text, visit_date date, record text, detail text",
             ");", ""]
    for v in visits:
        lines.append(
            "insert into pet_visit_staging (owner_name, pet_name, visit_date, record, detail) values "
            f"({sql_str(v['owner_name'])}, {sql_str(v['pet_name'])}, {sql_str(v['visit_date'].isoformat() if v['visit_date'] else None)}, "
            f"{sql_str(v['record'])}, {sql_str(v['detail'])});"
        )
    lines.append("")
    lines.append(
        "insert into public.pet_visits (pet_id, visit_date, record, detail) "
        "select p.id, s.visit_date, s.record, s.detail "
        "from pet_visit_staging s "
        "join public.owners o on o.name = s.owner_name "
        "join public.pets p on p.owner_id = o.id and p.name = s.pet_name;"
    )
    lines.append("")
    lines.append("commit;")

    with open(OUT_SQL, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"\n생성됨: {OUT_SQL} (Git 제외 경로)")


if __name__ == "__main__":
    main()
