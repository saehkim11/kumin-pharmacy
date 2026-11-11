"""날씨(Open-Meteo)와 천호1동 생활인구(서울 열린데이터광장)를 받아와
environmental_data / dong_population_hourly 에 넣을 INSERT SQL을 생성한다.
개인정보 없음(공공 통계 데이터). .env의 SEOUL_OPENAPI_KEY를 사용한다 (출력에 키를 남기지 않는다).

사용법:
  python tools/fetch_environment_data.py --weather --start 2024-03-01 --end 2026-11-11
  python tools/fetch_environment_data.py --population --start 2026-05-01 --end 2026-11-11
"""
import argparse
import datetime
import os
import sys
import time
import urllib.request
import json

DONG_CODE = "11740600"  # 강동구 천호1동
LAT, LON = 37.5486, 127.1248  # 천호동 인근 좌표
OUT_DIR = "data/real"


def load_env_key():
    with open(".env", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.startswith("SEOUL_OPENAPI_KEY="):
                return line.split("=", 1)[1].strip()
    raise SystemExit(".env에 SEOUL_OPENAPI_KEY가 없습니다.")


def sql_escape(s):
    return str(s).replace("'", "''")


def fetch_weather(start, end):
    url = (
        "https://archive-api.open-meteo.com/v1/archive"
        f"?latitude={LAT}&longitude={LON}&start_date={start}&end_date={end}"
        "&daily=temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,relative_humidity_2m_mean"
        "&timezone=Asia%2FSeoul"
    )
    with urllib.request.urlopen(url, timeout=30) as resp:
        data = json.load(resp)
    daily = data["daily"]
    rows = []
    for i, date in enumerate(daily["time"]):
        rows.append((
            date,
            daily["temperature_2m_max"][i],
            daily["temperature_2m_min"][i],
            daily["temperature_2m_mean"][i],
            daily["precipitation_sum"][i],
            daily["relative_humidity_2m_mean"][i],
        ))
    return rows


def write_weather_sql(rows, out_path):
    def n(v):
        return "null" if v is None else str(v)
    lines = ["insert into public.environmental_data (date, temp_max, temp_min, temp_mean, precipitation_mm, humidity_mean, source) values"]
    values = [f"('{date}', {n(tmax)}, {n(tmin)}, {n(tmean)}, {n(precip)}, {n(hum)}, 'open-meteo archive')" for date, tmax, tmin, tmean, precip, hum in rows]
    lines.append(",\n".join(values))
    lines.append("on conflict (date) do update set temp_max = excluded.temp_max, temp_min = excluded.temp_min, temp_mean = excluded.temp_mean, precipitation_mm = excluded.precipitation_mm, humidity_mean = excluded.humidity_mean, source = excluded.source;")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"{len(rows)}일치 -> {out_path}")


def fetch_population_day(key, ymd):
    """해당 날짜의 천호1동(DONG_CODE) 24시간 생활인구를 반환. 서버가 동 필터를 안 받아줘서
    하루 전체(약 10,248건)를 1000건씩 받아 클라이언트에서 걸러낸다."""
    rows = []
    start = 1
    while True:
        end = start + 999
        url = f"http://openapi.seoul.go.kr:8088/{key}/json/Spop250mLocalResdDong/{start}/{end}/{ymd}/"
        with urllib.request.urlopen(url, timeout=30) as resp:
            body = resp.read().decode("utf-8")
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            break
        payload = data.get("Spop250mLocalResdDong")
        if not payload:
            break
        for row in payload.get("row", []):
            if row["H_DNG_CD"].strip() == DONG_CODE:
                rows.append((row["YMD"], int(row["TT"]), row["SPOP"]))
        total = payload.get("list_total_count", 0)
        if end >= total:
            break
        start = end + 1
    return rows


def write_population_sql(rows, out_path):
    """시간대별 원본을 일별(평균/영업시간평균/최소/최대)로 요약해 dong_population_daily에 넣는다.
    시간대별 그대로 저장하면 행이 너무 많아 다루기 번거로워, 상관분석에 바로 쓰는 일별 지표만 둔다."""
    by_date = {}
    for ymd, hour, spop in rows:
        date = f"{ymd[0:4]}-{ymd[4:6]}-{ymd[6:8]}"
        by_date.setdefault(date, []).append((hour, float(spop)))
    header = "insert into public.dong_population_daily (dong_code, measured_on, avg_population, business_hours_avg, min_population, max_population) values"
    footer = "on conflict (dong_code, measured_on) do update set avg_population = excluded.avg_population, business_hours_avg = excluded.business_hours_avg, min_population = excluded.min_population, max_population = excluded.max_population;"
    values = []
    for date in sorted(by_date):
        vals = by_date[date]
        allv = [v for _, v in vals]
        bh = [v for h, v in vals if 9 <= h <= 20] or allv
        values.append(f"('{DONG_CODE}', '{date}', {sum(allv)/len(allv):.2f}, {sum(bh)/len(bh):.2f}, {min(allv):.2f}, {max(allv):.2f})")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(header + "\n" + ",\n".join(values) + "\n" + footer + "\n")
    print(f"{len(values)}일치 요약 -> {out_path}")


def daterange(start, end):
    d = datetime.date.fromisoformat(start)
    stop = datetime.date.fromisoformat(end)
    while d <= stop:
        yield d
        d += datetime.timedelta(days=1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weather", action="store_true")
    ap.add_argument("--population", action="store_true")
    ap.add_argument("--start", required=True)
    ap.add_argument("--end", required=True)
    args = ap.parse_args()
    os.makedirs(OUT_DIR, exist_ok=True)

    if args.weather:
        rows = fetch_weather(args.start, args.end)
        out = os.path.join(OUT_DIR, "import_weather.sql")
        write_weather_sql(rows, out)
        print(f"날씨 {len(rows)}일치 -> {out}")

    if args.population:
        key = load_env_key()
        all_rows = []
        days = list(daterange(args.start, args.end))
        for i, d in enumerate(days):
            ymd = d.strftime("%Y%m%d")
            day_rows = fetch_population_day(key, ymd)
            all_rows.extend(day_rows)
            if (i + 1) % 10 == 0 or i == len(days) - 1:
                print(f"  {i + 1}/{len(days)}일 수집, 누적 {len(all_rows)}건", file=sys.stderr)
            time.sleep(0.1)
        out = os.path.join(OUT_DIR, "import_population.sql")
        write_population_sql(all_rows, out)
        print(f"생활인구 {len(all_rows)}건 ({len(days)}일 x 24시간 기준) -> {out}")


if __name__ == "__main__":
    main()
