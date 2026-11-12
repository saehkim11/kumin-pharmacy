"""접종관리 시트 -> pet_visits INSERT SQL 생성기 (날짜별 방문 기록 그대로 보존).

owners/pets는 import_pets.py로 먼저 만든다고 가정한다. pet_id를 찾을 때 이름으로
조인하지 않고, import_pets.py와 완전히 같은 순서·정규화 규칙으로 owners/pets를 다시
만들어서(결정론적이라 항상 같은 순서가 나옴) 이미 DB에 들어간 pets.id와 같은 번호를
그대로 얻는다. 이렇게 해야 "미기재" 같은 중복 이름이 많아도 정확한 반려동물에만 연결된다.
(이전 버전은 이름으로 조인해서, 견주·동물이름이 비어 '미기재'로 들어간 행 전체를
 건너뛰었다 — 원본에는 날짜가 있는데도 날짜가 사라지는 문제가 있었다. 2025-11 수정.)

실제 데이터는 data/real/ 입력, 결과도 data/real/ (Git 제외). 대화/로그에 개인정보 출력 금지.

사용법:
  python tools/import_pet_visits.py --dry-run
  python tools/import_pet_visits.py
"""
import argparse
import datetime
import sys

sys.path.insert(0, "tools")
import import_pets as ip  # noqa: E402

OUT_SQL = "data/real/import_pet_visits.sql"


def sql_str(v):
    if v is None or v == "":
        return "null"
    return "'" + str(v).replace("'", "''") + "'"


def build_visits():
    # import_pets.py와 동일한 순서로 재구성해야 같은 pets.id가 나온다.
    owners, pets, _stats = ip.build(ip.load_rows())
    pet_id_of = {key: i for i, key in enumerate(pets.keys(), start=1)}

    visits = []
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

        visits.append({
            "pet_id": pid, "visit_date": visit_date,
            "record": str(row["record"]).strip() if row["record"] else None,
            "detail": str(row["detail"]).strip() if row["detail"] else None,
        })

    return visits, {
        "skipped_both_blank": skipped_both_blank,
        "skipped_no_record": skipped_no_record,
        "skipped_no_date": skipped_no_date,
        "unmatched": unmatched,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    visits, stats = build_visits()
    print("=== 가져오기 요약 (개인정보 미포함) ===")
    print(f"방문 기록 수: {len(visits)}")
    print(f"견주·동물이름 둘 다 없어서 애초에 반려동물이 없는 행(복구 불가): {stats['skipped_both_blank']}")
    print(f"진료기록·상세 둘 다 없어서 제외: {stats['skipped_no_record']}")
    print(f"날짜 파싱 안 돼서 제외: {stats['skipped_no_date']}")
    print(f"대응되는 반려동물을 못 찾은 행(이상 있으면 0이어야 함): {stats['unmatched']}")

    if args.dry_run:
        return
    if stats["unmatched"]:
        print("[중단] 매칭 안 된 행이 있어 SQL을 만들지 않았습니다. owners/pets를 먼저 최신으로 가져왔는지 확인하세요.", file=sys.stderr)
        sys.exit(1)

    lines = ["begin;", ""]
    for v in visits:
        lines.append(
            "insert into public.pet_visits (pet_id, visit_date, record, detail) values "
            f"({v['pet_id']}, {sql_str(v['visit_date'].isoformat())}, {sql_str(v['record'])}, {sql_str(v['detail'])});"
        )
    lines.append("")
    lines.append("commit;")

    with open(OUT_SQL, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"\n생성됨: {OUT_SQL} (Git 제외 경로)")


if __name__ == "__main__":
    main()
