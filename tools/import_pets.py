"""접종관리 시트 -> owners/pets INSERT SQL 생성기.
실제 데이터는 data/real/ 입력, 결과도 data/real/ (Git 제외). 대화/로그에 개인정보 출력 금지.

사용법:
  python tools/import_pets.py --dry-run           # 통계만 출력, 파일 생성 안 함
  python tools/import_pets.py                      # data/real/import_owners_pets.sql 생성
"""
import argparse
import datetime
import re
import sys
from collections import Counter

import openpyxl

XLSX_PATH = "data/real/판매관리 3 2025_수정_v2_요일별.xlsx"
SHEET = "접종관리"
HEADER_ROW = 2  # 1-indexed row that holds the real header
OUT_SQL = "data/real/import_owners_pets.sql"

DOG_KEYWORDS = [
    "말티", "푸들", "시츄", "시추", "치와와", "지와와", "진도", "진돗개", "비글", "비숑",
    "슈나", "슈너", "요크", "욕크", "포메", "폼피츠", "폴피", "퐁츄", "포시츄", "포피츠",
    "보더콜리", "보도콜리", "보조콜리", "닥스", "도베르망", "레트리버", "레브라도",
    "허스키", "그레이하운드", "휘핏", "카네코르소", "테리어", "스피츠", "시바", "코카스파니엘",
    "마리노이즈", "아리노이즈", "믹스견", "강아지", "웰시콕", "장모치와와", "장모지와와",
    "장모닥스훈트", "장모말티", "몰키", "요키", "토이푸들", "프렌치불독", "보스턴테리어",
    "보스톤테리어", "잭러쎌", "토푸", "미니핀", "미니두둘", "무들", "라사압소", "라사암소",
]
CAT_KEYWORDS = [
    "고양", "캣", "켓", "코숏", "숏헤어", "페르시안", "샴", "벵갈", "뱅갈",
    "러시안블루", "렉돌", "스핑크스", "데본렉스", "브리티쉬", "터키쉬", "메인쿤", "아비니쉬",
    "노르웨이숲",
]

# 통합.구분 오타 교정 (제품 분류, 다음 단계에서 재사용)
CATEGORY_FIX = {
    "야품": "약품", "댝품": "약품",
    "사료17019": "사료", "사료3914": "사료", "사료11055": "사료",
}


def classify_species(breed: str) -> str:
    if not breed:
        return "unknown"
    b = breed.strip()
    for kw in CAT_KEYWORDS:
        if kw in b:
            return "cat"
    for kw in DOG_KEYWORDS:
        if kw in b:
            return "dog"
    return "unknown"


def norm_phone(v) -> str:
    if v is None:
        return ""
    digits = re.sub(r"\D", "", str(v))
    return digits


def norm_name(v) -> str:
    if v is None:
        return ""
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
    required = ["날짜", "견주", "품종", "강아지이름", "성별", "중성화", "전화번호", "나이", "모색", "몸무게", "진료기록", "상세"]
    missing = [c for c in required if c not in idx]
    if missing:
        print(f"[경고] 헤더에서 못 찾은 열: {missing}", file=sys.stderr)
    for r in rows:
        def g(col):
            i = idx.get(col)
            return r[i] if i is not None and i < len(r) else None
        yield {
            "date": g("날짜"), "owner": g("견주"), "breed": g("품종"), "pet": g("강아지이름"),
            "sex": g("성별"), "neutered": g("중성화"), "phone": g("전화번호"), "age": g("나이"),
            "coat": g("모색"), "weight": g("몸무게"), "record": g("진료기록"), "detail": g("상세"),
        }


def build(rows):
    owners = {}   # key(name_norm, phone) -> {"name":..., "phone":..., "id": seq}
    pets = {}     # key(owner_key, pet_name_norm) -> dict(accumulated)
    skipped_no_pet_name = 0
    skipped_no_owner = 0
    skipped_both_blank = 0
    ambiguous_species = Counter()
    phone_conflicts = Counter()  # same name, different non-empty phones seen

    owner_name_to_phones = {}

    for row_idx, row in enumerate(rows):
        owner_raw = row["owner"]
        pet_raw = row["pet"]
        owner_blank = not owner_raw or not str(owner_raw).strip()
        pet_blank = not pet_raw or not str(pet_raw).strip()
        if owner_blank and pet_blank:
            skipped_both_blank += 1
            continue
        if pet_blank:
            skipped_no_pet_name += 1
            pet_raw = "미기재"

        phone = norm_phone(row["phone"])
        if owner_blank:
            skipped_no_owner += 1
            owner_name = "미기재"
            owner_name_n = "미기재"
            # 이름·전화번호 둘 다 없으면 서로 다른 사람일 수 있으니 합치지 않는다
            owner_key = (owner_name_n, phone) if phone else (owner_name_n, f"__row{row_idx}")
        else:
            owner_name = str(owner_raw).strip()
            owner_name_n = norm_name(owner_raw)
            owner_key = (owner_name_n, phone)

        seen_phones = owner_name_to_phones.setdefault(owner_name_n, set())
        if phone:
            seen_phones.add(phone)
        if len(seen_phones) > 1:
            phone_conflicts[owner_name_n] += 1

        if owner_key not in owners:
            owners[owner_key] = {"name": owner_name, "phone": phone or None}

        pet_name = str(pet_raw).strip()
        pet_name_n = norm_name(pet_raw)
        breed = str(row["breed"]).strip() if row["breed"] else None
        species = classify_species(breed)
        if species == "unknown" and breed:
            ambiguous_species[breed] += 1

        sex_raw = str(row["sex"]).strip() if row["sex"] else None
        sex = "male" if sex_raw in ("수", "남", "M", "male") else ("female" if sex_raw in ("암", "여", "F", "female") else "unknown")
        neutered_raw = row["neutered"]
        neutered = None
        if neutered_raw is not None:
            s = str(neutered_raw).strip()
            if s in ("Y", "y", "O", "예", "완료", "1"):
                neutered = True
            elif s in ("N", "n", "X", "아니오", "0"):
                neutered = False

        visit_date = row["date"]
        if isinstance(visit_date, datetime.datetime):
            visit_date = visit_date.date()
        elif isinstance(visit_date, str):
            visit_date = None
        elif not isinstance(visit_date, datetime.date):
            visit_date = None

        age_raw = row["age"]
        age_years = None
        age_note = None
        if isinstance(age_raw, (int, float)):
            age_years = float(age_raw)
        elif isinstance(age_raw, str) and age_raw.strip():
            try:
                age_years = float(age_raw.strip())
            except ValueError:
                age_note = f"나이기록(원문): {age_raw.strip()}"
        birth_date_est = None
        if age_years is not None and visit_date:
            birth_date_est = visit_date - datetime.timedelta(days=round(age_years * 365.25))

        pet_key = (owner_key, pet_name_n)
        note_parts = []
        if row["record"]:
            note_parts.append(str(row["record"]).strip())
        if row["detail"]:
            note_parts.append(str(row["detail"]).strip())
        if age_note:
            note_parts.append(age_note)
        note = " / ".join(p for p in note_parts if p)

        weight_raw = row["weight"]
        weight_val = None
        if isinstance(weight_raw, (int, float)):
            weight_val = float(weight_raw)
        elif isinstance(weight_raw, str) and weight_raw.strip():
            try:
                weight_val = float(weight_raw.strip())
            except ValueError:
                note_parts.append(f"몸무게기록(원문): {weight_raw.strip()}")
        if weight_val is not None and not (0 < weight_val < 200):
            note_parts.append(f"몸무게기록(원문): {weight_raw}")
            weight_val = None
        note = " / ".join(p for p in note_parts if p)

        if pet_key not in pets:
            pets[pet_key] = {
                "owner_key": owner_key, "name": pet_name, "species": species, "breed": breed,
                "sex": sex, "neutered": neutered, "coat": row["coat"], "weight": weight_val,
                "notes": [note] if note else [], "last_visit_on": visit_date,
                "birth_date": birth_date_est,
            }
        else:
            p = pets[pet_key]
            if visit_date and (not p["last_visit_on"] or visit_date > p["last_visit_on"]):
                p["last_visit_on"] = visit_date
            if note and note not in p["notes"]:
                p["notes"].append(note)
            if not p["breed"] and breed:
                p["breed"] = breed
                p["species"] = species
            if not p["coat"] and row["coat"]:
                p["coat"] = row["coat"]
            if not p["weight"] and weight_val is not None:
                p["weight"] = weight_val
            if not p["birth_date"] and birth_date_est:
                p["birth_date"] = birth_date_est

    return owners, pets, {
        "skipped_no_pet_name": skipped_no_pet_name,
        "skipped_no_owner": skipped_no_owner,
        "skipped_both_blank": skipped_both_blank,
        "ambiguous_species": ambiguous_species,
        "phone_conflicts": {k: v for k, v in phone_conflicts.items()},
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    owners, pets, stats = build(load_rows())

    species_count = Counter(p["species"] for p in pets.values())
    print("=== 가져오기 요약 (개인정보 미포함) ===")
    print(f"보호자 수(중복제거): {len(owners)}")
    print(f"반려동물 수(중복제거): {len(pets)}")
    print(f"종 분류: dog={species_count['dog']} cat={species_count['cat']} unknown={species_count['unknown']}")
    print(f"동물이름 미기재로 '미기재'로 넣은 행: {stats['skipped_no_pet_name']}")
    print(f"견주 미기재로 보호자명을 '미기재'로 넣은 행: {stats['skipped_no_owner']}")
    print(f"견주·동물이름 둘 다 비어서 제외한 행: {stats['skipped_both_blank']}")
    print(f"같은 이름인데 전화번호가 서로 다른 경우(동명이인 가능성, 보호자 수에 영향): {len(stats['phone_conflicts'])}건")
    if stats["ambiguous_species"]:
        print(f"품종을 dog/cat으로 못 정한 품종 종류 수: {len(stats['ambiguous_species'])} (unknown으로 처리됨)")
        print("  상위 품종값(이름 아님, 품종 텍스트):", stats["ambiguous_species"].most_common(10))

    if args.dry_run:
        return

    owner_id = {}
    lines = ["begin;", ""]
    for i, (key, o) in enumerate(owners.items(), start=1):
        owner_id[key] = i
        lines.append(
            f"insert into public.owners (id, name, phone) values ({i}, {sql_str(o['name'])}, {sql_str(o['phone'])});"
        )
    lines.append("")
    for i, (key, p) in enumerate(pets.items(), start=1):
        oid = owner_id[p["owner_key"]]
        notes = sql_str(" | ".join(p["notes"]) if p["notes"] else None)
        last_visit = sql_str(p["last_visit_on"].isoformat() if p["last_visit_on"] else None)
        birth = sql_str(p["birth_date"].isoformat() if p.get("birth_date") else None)
        neutered_sql = "null" if p["neutered"] is None else ("true" if p["neutered"] else "false")
        weight_sql = sql_str(p["weight"]) if p["weight"] else "null"
        lines.append(
            "insert into public.pets (id, owner_id, name, species, breed, sex, neutered, birth_date, coat_color, weight_kg, notes, last_visit_on) "
            f"values ({i}, {oid}, {sql_str(p['name'])}, {sql_str(p['species'])}, {sql_str(p['breed'])}, "
            f"{sql_str(p['sex'])}, {neutered_sql}, {birth}, {sql_str(p['coat'])}, {weight_sql}, {notes}, {last_visit});"
        )
    lines.append("")
    lines.append(f"select setval('public.owners_id_seq', {max(owner_id.values()) if owner_id else 1});")
    lines.append(f"select setval('public.pets_id_seq', {len(pets) if pets else 1});")
    lines.append("")
    lines.append("commit;")

    with open(OUT_SQL, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"\n생성됨: {OUT_SQL} (Git 제외 경로, 검토 후 SQL Editor에 붙여넣기)")


if __name__ == "__main__":
    main()
