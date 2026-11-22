-- 업무-반려동물 연결 검증 (db/24_task_pet_link.sql 적용 뒤 SQL Editor에서 통째로 1회 실행).
-- 비밀번호 없이 역할/JWT를 흉내 내서 확인하고, 마지막에 일부러 예외를 던져 전체를 롤백하므로 데이터는 바뀌지 않는다.
--   결과가 "VERIFY OK ..."이면 통과, 그 외 메시지는 실패한 항목이다.
-- 전제: profiles에 admin 1명 + staff 1명 이상.

do $$
declare
  v_admin uuid; v_staff uuid;
  v_owner bigint; v_pet bigint; v_task1 bigint; v_task2 bigint;
  n int; v_nullable text; v_deltype "char"; v_state text; v_pet_after bigint;
  v_log text := '';
begin
  select id into v_admin from public.profiles where role = 'admin' and active limit 1;
  select id into v_staff from public.profiles where role = 'staff' and active limit 1;
  if v_admin is null or v_staff is null then raise exception 'profiles에 admin/staff가 필요'; end if;

  -- ① 열이 있고 비워 둘 수 있으며, 반려동물 삭제 시 연결만 비우는 외래키다
  select is_nullable into v_nullable from information_schema.columns
   where table_schema = 'public' and table_name = 'action_tasks' and column_name = 'pet_id';
  if v_nullable is distinct from 'YES' then raise exception 'FAIL pet_id 열이 없거나 필수 열임 (%)', v_nullable; end if;
  select confdeltype into v_deltype from pg_constraint
   where conrelid = 'public.action_tasks'::regclass and confrelid = 'public.pets'::regclass and contype = 'f';
  if v_deltype is distinct from 'n' then raise exception 'FAIL 외래키 삭제 규칙이 set null이 아님 (%)', v_deltype; end if;
  v_log := v_log || '열·외래키 · ';

  insert into public.owners (name, phone) values ('검증보호자', null) returning id into v_owner;
  insert into public.pets (owner_id, name, species) values (v_owner, '검증펫', 'dog') returning id into v_pet;

  -- ② admin: 반려동물을 연결해서도, 연결 없이도 업무를 만들 수 있다
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.action_tasks (title, pet_id) values ('검증 업무(연결)', v_pet) returning id into v_task1;
  insert into public.action_tasks (title) values ('검증 업무(연결 없음)') returning id into v_task2;
  select count(*) into n from public.action_tasks where id = v_task1 and pet_id = v_pet;
  if n <> 1 then raise exception 'FAIL 연결한 업무를 읽지 못함'; end if;
  select count(*) into n from public.action_tasks where id = v_task2 and pet_id is null;
  if n <> 1 then raise exception 'FAIL 연결 없는 업무가 이상함'; end if;
  v_log := v_log || 'admin 등록 · ';

  -- ③ admin도 pet_id는 나중에 바꿀 수 없다(수정 가능한 열 목록은 그대로)
  begin
    update public.action_tasks set pet_id = null where id = v_task1;
    raise exception 'FAIL admin이 pet_id를 수정할 수 있음';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> '42501' then raise exception 'FAIL pet_id 수정 거부 코드 이상: %', v_state; end if;
  end;
  reset role;
  v_log := v_log || 'pet_id 수정 불가 · ';

  -- ④ staff: 연결된 업무를 읽을 수 있고, 업무를 새로 만들 수는 없다(기존 정책 그대로)
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.action_tasks where id = v_task1 and pet_id = v_pet;
  if n <> 1 then raise exception 'FAIL staff가 연결된 업무를 읽지 못함'; end if;
  begin
    insert into public.action_tasks (title, pet_id) values ('직원 등록 시도', v_pet);
    raise exception 'FAIL staff가 업무를 만들 수 있음';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> '42501' then raise exception 'FAIL staff 등록 거부 코드 이상: %', v_state; end if;
  end;
  reset role;
  v_log := v_log || 'staff 읽기만 · ';

  -- ⑤ 반려동물을 지우면 업무는 남고 연결만 비워진다
  delete from public.pets where id = v_pet;
  select count(*) into n from public.action_tasks where id = v_task1;
  if n <> 1 then raise exception 'FAIL 반려동물 삭제로 업무가 같이 지워짐'; end if;
  select pet_id into v_pet_after from public.action_tasks where id = v_task1;
  if v_pet_after is not null then raise exception 'FAIL 반려동물 삭제 후 pet_id가 비워지지 않음'; end if;
  v_log := v_log || '삭제 시 연결만 해제';

  raise exception 'VERIFY OK: %', v_log;   -- 롤백용
end $$;
