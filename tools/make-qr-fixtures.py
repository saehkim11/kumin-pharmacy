# QR 인코더(qr-code.js) 검증용 기준 행렬을 만든다. 한 번 실행해서 tests/fixtures/qr-reference.json 으로 보관하고,
# 이후에는 이 파일이 필요 없다. 실행: python tools/make-qr-fixtures.py
# segno가 없으면 임시 폴더에 설치하고 SEGNO_PATH 환경변수로 그 위치를 알려준다.
import json, os, sys
if os.environ.get("SEGNO_PATH"):
    sys.path.insert(0, os.environ["SEGNO_PATH"])
import segno

korean = "SMSTO:01012345678:[시험] 보리 보호자님, 보리 종합백신 접종일이 11월 25일입니다. 문의: 병원 전화번호"
long_korean = "SMSTO:01012345678:" + "보리 보호자님, 종합백신 접종일이 11월 25일(수)입니다. 문의: 02-1234-5678 " * 2
korean_213 = "가나다라마바사아자차카타파하" * 5 + "가"  # 71글자 = 213바이트
ascii_213 = ("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" * 6)[:213]
texts = [
    "A", "HELLO", "abcdefghijklmn" , "abcdefghijklmno",  # 14바이트(버전 1 한계), 15바이트(버전 2)
    korean, long_korean, korean_213, ascii_213, "이모지😀포함 문구",
]
# 버전 1~10을 모두 거치도록 각 버전 용량(M 등급: 14,26,42,62,84,106,122,152,180,213) 안쪽으로 채운 입력을 추가한다.
for n in (26, 42, 62, 84, 106, 122, 152, 180):
    texts.append(("0123456789abcdefghijklmnopqrstuvwxyz" * 6)[:n])
items = []
for t in texts:
    n = len(t.encode("utf-8"))
    assert n <= 213, (t, n)
    auto = segno.make(t, error="m", micro=False, boost_error=False, mode="byte")
    rows = lambda q: ["".join("1" if c else "0" for c in r) for r in q.matrix]
    items.append({"text": t, "version": auto.version, "mask": auto.mask, "auto": True, "modules": rows(auto)})
    for m in range(8):
        q = segno.make(t, error="m", micro=False, boost_error=False, mode="byte", mask=m)
        items.append({"text": t, "version": q.version, "mask": m, "auto": False, "modules": rows(q)})
with open("tests/fixtures/qr-reference.json", "w", encoding="utf-8") as f:
    json.dump(items, f, ensure_ascii=False)
print(len(items), "items; versions:", sorted({i["version"] for i in items}), "bytes:", [len(t.encode()) for t in texts])
