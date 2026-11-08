# Supabase MCP 연동 방법

이 문서는 `kumin-pharmacy` 프로젝트에서 Supabase를 MCP(Model Context Protocol)로 연동해
스키마 변경과 대량 데이터 업로드를 진행한 방법을 정리합니다. 다음에 다시 연동하거나
비슷한 작업을 할 때 같은 실수를 반복하지 않기 위한 참고 문서입니다.

## 1. 연동 방식: OAuth

- Supabase MCP 서버는 **OAuth 방식**으로 연동했습니다. (API 키를 직접 설정 파일에 넣는 방식이 아님)
- 연동이 끝나면 `mcp__supabase__*` 도구들(`execute_sql`, `apply_migration`, `list_tables`,
  `get_project_url` 등)을 바로 사용할 수 있습니다.
- Codex, Claude Code 등 여러 에이전트/클라이언트에서 각자 OAuth로 연동해도 같은 Supabase
  프로젝트를 가리키면 됩니다.

## 2. 스키마 변경 (DDL)

- 테이블 생성·변경 같은 DDL은 `mcp__supabase__apply_migration`을 사용합니다.
- 예: `db/09_sales_legacy.sql`의 `create table public.sales_legacy (...)`를
  `apply_migration`으로 실행 → RLS, 인덱스, 정책까지 한 번에 적용됨.
- **주의**: 이 프로젝트는 AGENTS.md 규칙상 기존 스키마·RLS·인증 규칙을 임의로 바꿀 수 없습니다.
  새 테이블 추가처럼 기존 것을 건드리지 않는 변경이라도, 실행 전에 사용자에게 명시적으로
  승인을 받아야 합니다.

## 3. 소량 데이터 조회/조작

- 단순 `SELECT`, `COUNT` 같은 조회는 `mcp__supabase__execute_sql`을 그대로 사용하면 됩니다.
- 이 방식은 SQL 쿼리 문자열을 도구 호출 파라미터로 그대로 전달하므로, 쿼리 텍스트가
  에이전트의 컨텍스트에 전부 들어갑니다. 수십~수백 줄 정도면 문제 없습니다.

## 4. 대량 데이터 업로드 (수백~수천 건 INSERT)

`execute_sql`에 거대한 SQL 파일(수백~수천 줄의 `insert into ...`)을 그대로 전달하면
파일 내용을 전부 읽어서 파라미터로 넣어야 하므로 에이전트 컨텍스트 토큰을 매우 많이
소모합니다(한글 텍스트는 토큰 밀도가 더 높아서 특히 비효율적입니다).

이 프로젝트에서는 **Supabase Management API를 curl로 직접 호출**해서, SQL 파일 내용이
에이전트 컨텍스트를 거치지 않고 디스크 → curl로 바로 전송되도록 했습니다.

### 4-1. 프로젝트 정보 확인

```
mcp__supabase__get_project_url
→ {"url":"https://<project-ref>.supabase.co"}
```

URL의 서브도메인이 `<project-ref>`입니다.

### 4-2. Management API로 SQL 파일 실행

Windows(Git Bash) 환경에서 `jq`가 없는 경우가 많으므로, 설치된 Python으로 JSON 본문을
만들고 `curl --data-binary`로 전송합니다. `/tmp` 경로는 Windows Python에서 바로 쓰지
못할 수 있으니, 세션 스크래치패드 디렉토리 같은 실제 존재하는 쓰기 가능한 경로를 씁니다.

```bash
PYEXE="/c/Users/USER/AppData/Local/Programs/Python/Python311/python"
TOKEN=$(grep SUPABASE_ACCESS_TOKEN .env | cut -d= -f2-)   # 값은 절대 echo/출력하지 않음

"$PYEXE" -c "
import json, sys
with open(sys.argv[1], encoding='utf-8') as f:
    q = f.read()
with open(sys.argv[2], 'w', encoding='utf-8') as f:
    json.dump({'query': q}, f)
" "data/real/import_01_products.sql" "/path/to/scratch/body.json"

curl -s -X POST "https://<project-ref>.supabase.co/v1/projects/<project-ref>/database/query" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data-binary @"/path/to/scratch/body.json"
```

실제 사용한 엔드포인트:
`https://api.supabase.com/v1/projects/<project-ref>/database/query`

- 응답이 `[]`이면 반환할 행이 없는 쓰기 작업(INSERT 등)이 정상적으로 끝난 것입니다.
- `SELECT` 결과가 필요한 조회는 그냥 `mcp__supabase__execute_sql`을 쓰는 게 더 간단합니다.
  (내용이 작을 때)

### 4-3. 체크리스트

1. 대상 SQL 파일에 FK(외래키) 참조가 있다면, **참조되는 테이블(마스터 데이터)을 먼저
   업로드**해야 합니다. (`products` → `sales_legacy` 순서로 실행)
2. SQL 파일이 자체적으로 `begin; ... commit;`을 포함하고 있다면 파일 단위로 그대로
   한 번에 실행합니다. 중간에 끊어서 여러 번 보내면 트랜잭션이 깨집니다.
3. 토큰 값(`SUPABASE_ACCESS_TOKEN`)은 커맨드 결과나 로그에 **절대 출력하지 않습니다.**
   `grep ... | cut ...`처럼 셸 변수에만 담아서 바로 사용합니다.
4. 업로드 후에는 `execute_sql`로 건수(`count(*)`), 기간(`min/max`), 참조 무결성(FK가
   NULL이거나 매칭 안 된 건수)까지 반드시 검증합니다.

## 5. 참고

- `.env`, `config.js`, `test-accounts.local.json`은 Git에 커밋하지 않고(`.gitignore`
  처리됨), 화면/로그에도 값을 노출하지 않습니다. (AGENTS.md 규칙)
- `data/real/`은 실제 업무 데이터라서 Git에서 완전히 제외되어 있습니다. 이 폴더의 SQL은
  로컬에만 존재하므로, 다른 환경에서 다시 업로드하려면 같은 파일을 다시 받아와야 합니다.
