"""접종관리 시트에서 견주 또는 동물이름이 비어 있어 pet_visits에 날짜 없이 누락됐던 기록을 추가로 넣는다.

문제: import_pet_visits.py는 "견주 또는 동물이름이 비어있는 행"을 통째로 건너뛰었다.
      반면 import_pets.py는 비어있어도 '미기재'로 채워서 반려동물 자체(및 notes)는 만들었다.
      그 결과 날짜가 있던 원본 기록이 pet_visits에는 못 들어가고 notes에만 날짜 없이 남았다.
      (둘 다 비어있는 행은 import_pets.py도 완전히 건너뛰므로 애초에 반려동물이 없어 복구 불가.)

해결: import_pets.py와 완전히 같은 순서·로직으로 owners/pets를 재구성하면(같은 파일을 같은
      순서로 다시 읽으므로) 이미 DB에 들어있는 pets.id와 100% 동일한 번호를 다시 얻을 수 있다.
      이 번호로 pet_id를 찾아서, 이전에 건너뛴 행만 날짜 포함해서 추가한다.

사용법:
  python tools/fix_pet_visits_missing_dates.py --dry-run
  python tools/fix_pet_visits_missing_dates.py
"""
import argparse
import datetime
import sys

sys.path.insert(0, "tools")
import import_pets as ip  # noqa: E402

OUT_SQL = "data/real/fix_pet_visits_missing_dates.sql"


def sql_str(v):
    if v is None or v == "":
        return "null"
    return "'" + str(v).replace("'", "''") + "'"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    # 1) import_pets.py와 동일하게 재구성 -> 이미 DB에 있는 pets.id와 같은 번호를 얻는다.
    owners, pets, _stats = ip.build(ip.load_rows())
    pet_id_of = {key: i for i, key in enumerate(pets.keys(), start=1)}

    added = []
    skipped_both_blank = 0
    skipped_no_record = 0
    skipped_no_date = 0
    unmatched = 0

    for row_idx, row in enumerate(ip.load_rows()):
        owner_raw = row["owner"]
        pet_raw = row["pet"]
        owner_blank = not owner_raw or not str(owner_raw).strip()
        pet_blank = not pet_raw or not str(pet_raw).strip()
        if owner_blank and pet_blank:
            skipped_both_blank += 1
            continue
        if not owner_blank and not pet_blank:
            continue  # 원래부터 정상적으로 들어간 행 (다시 건드리지 않음)

        if not row["record"] and not row["detail"]:
            skipped_no_record += 1
            continue
        visit_date = row["date"]
        if isinstance(visit_date, datetime.datetime):
            visit_date = visit_date.date()
        elif not isinstance(visit_date, datetime.date):
            visit_date = None
        if visit_date is None:
            skipped_no_date += 1
            continue

        # import_pets.py의 정규화 규칙과 동일해야 같은 pet_id가 나온다.
        phone = ip.norm_phone(row["phone"])
        if owner_blank:
            owner_key = ("미기재", phone) if phone else ("미기재", f"__row{row_idx}")
        else:
            owner_key = (ip.norm_name(owner_raw), phone)
        pet_name_n = ip.norm_name(pet_raw) if not pet_blank else "미기재"
        pet_key = (owner_key, pet_name_n)
        pid = pet_id_of.get(pet_key)
        if pid is None:
            unmatched += 1
            continue

        added.append({
            "pet_id": pid,
            "visit_date": visit_date,
            "record": str(row["record"]).strip() if row["record"] else None,
            "detail": str(row["detail"]).strip() if row["detail"] else None,
        })

    print("=== 복구 요약 (개인정보 미포함) ===")
    print(f"추가될 방문 기록: {len(added)}")
    print(f"견주·동물이름 둘 다 없어서 애초에 반려동물이 없는 행(복구 불가): {skipped_both_blank}")
    print(f"진료기록·상세 둘 다 없어서 제외: {skipped_no_record}")
    print(f"날짜 파싱 안 돼서 제외: {skipped_no_date}")
    print(f"대응되는 반려동물을 못 찾은 행(이상 있으면 0이어야 함): {unmatched}")

    if args.dry_run:
        return
    if unmatched:
        print("[중단] 매칭 안 된 행이 있어 SQL을 만들지 않았습니다.", file=sys.stderr)
        sys.exit(1)

    lines = ["begin;", ""]
    for item in added:
        lines.append(
            "insert into public.pet_visits (pet_id, visit_date, record, detail) values "
            f"({item['pet_id']}, {sql_str(item['visit_date'].isoformat())}, {sql_str(item['record'])}, {sql_str(item['detail'])});"
        )
    lines.append("")
    lines.append("commit;")
    with open(OUT_SQL, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"\n생성됨: {OUT_SQL}")


if __name__ == "__main__":
    main()
