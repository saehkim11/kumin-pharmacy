-- 알림 이력·수신 상태 검증 (db/22_reminder_log_pref.sql 적용 뒤 SQL Editor에서 통째로 1회 실행).
-- 비밀번호 없이 역할/JWT를 흉내 내서 확인하고, 마지막에 일부러 예외를 던져 전체를 롤백하므로 데이터는 바뀌지 않는다.
--   결과가 "VERIFY OK ..."이면 통과, 그 외 메시지는 실패한 항목이다.
-- 전제: profiles에 admin 1명 + staff 1명 이상.

do $$
declare
  v_admin uuid; v_staff uuid;
  v_owner bigint; v_pet bigint;
  v_key uuid := gen_random_uuid();
  v_id bigint; v_id2 bigint; n int; v_state text; v_status text; v_ok boolean;
  v_log text := '';
begin
  select id into v_admin from public.profiles where role = 'admin' and active limit 1;
  select id into v_staff from public.profiles where role = 'staff' and active limit 1;
  if v_admin is null or v_staff is null then raise exception 'profiles에 admin/staff가 필요'; end if;

  -- 시험용 보호자·반려동물(롤백됨)
  insert into public.owners (name, phone) values ('검증보호자', null) returning id into v_owner;
  insert into public.pets (owner_id, name, species) values (v_owner, '검증펫', 'dog') returning id into v_pet;

  -- ① anon은 읽을 수 없다
  v_ok := false;
  begin
    set local role anon;
    perform 1 from public.reminder_log limit 1;
  exception when insufficient_privilege then v_ok := true;
  end;
  reset role;
  if not v_ok then raise exception 'FAIL anon이 reminder_log를 읽을 수 있음'; end if;
  v_log := v_log || 'anon 차단 · ';

  -- ①-2 anon은 새 함수 3개를 실행할 수 없다
  if has_function_privilege('anon', 'public.rpc_log_reminder(uuid, bigint, text, text, date, text, text)', 'execute')
     or has_function_privilege('anon', 'public.rpc_void_reminder(bigint)', 'execute')
     or has_function_privilege('anon', 'public.rpc_set_reminder_pref(bigint, text, text, text)', 'execute') then
    raise exception 'FAIL anon이 알림 함수를 실행할 수 있음';
  end if;

  -- ② staff: 읽기 0행, 세 함수 모두 거부(42501)
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.reminder_log;
  if n <> 0 then raise exception 'FAIL staff가 reminder_log를 읽음 (%)', n; end if;
  select count(*) into n from public.owner_reminder_pref;
  if n <> 0 then raise exception 'FAIL staff가 owner_reminder_pref를 읽음 (%)', n; end if;
  begin
    perform public.rpc_log_reminder(gen_random_uuid(), v_pet, 'manual', 'vaccine', null, 'sent', 'x');
    raise exception 'FAIL staff가 rpc_log_reminder 호출 가능';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> '42501' then raise exception 'FAIL staff 거부 코드 이상: %', v_state; end if;
  end;
  begin
    perform public.rpc_void_reminder(1);
    raise exception 'FAIL staff가 rpc_void_reminder 호출 가능';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> '42501' then raise exception 'FAIL staff void 거부 코드 이상: %', v_state; end if;
  end;
  begin
    perform public.rpc_set_reminder_pref(v_owner, 'optout', null, null);
    raise exception 'FAIL staff가 rpc_set_reminder_pref 호출 가능';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> '42501' then raise exception 'FAIL staff pref 거부 코드 이상: %', v_state; end if;
  end;
  reset role;
  v_log := v_log || 'staff 차단 · ';

  -- ③ admin: 기록 만들기, 같은 키 재호출 시 중복 없음
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_id := public.rpc_log_reminder(v_key, v_pet, 'manual', 'vaccine', date '2026-12-13', 'sent', '검증 문구');
  v_id2 := public.rpc_log_reminder(v_key, v_pet, 'manual', 'vaccine', date '2026-12-13', 'sent', '검증 문구');
  if v_id is null or v_id2 is distinct from v_id then raise exception 'FAIL 같은 client_key가 다른 번호를 돌려줌 (% / %)', v_id, v_id2; end if;
  select count(*) into n from public.reminder_log where client_key = v_key;
  if n <> 1 then raise exception 'FAIL 같은 client_key로 %건 생성', n; end if;
  select count(*) into n from public.reminder_log;
  if n < 1 then raise exception 'FAIL admin이 reminder_log를 읽지 못함'; end if;
  v_log := v_log || '기록·중복방지 · ';

  -- ④ 잘못된 값은 거부
  v_ok := false;
  begin perform public.rpc_log_reminder(gen_random_uuid(), v_pet, 'zzz', null, null, 'sent', 'x'); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FAIL 잘못된 kind를 받아들임'; end if;
  v_ok := false;
  begin perform public.rpc_log_reminder(gen_random_uuid(), v_pet, 'manual', null, null, 'void', 'x'); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FAIL status void로 직접 기록 가능'; end if;
  v_ok := false;
  begin perform public.rpc_log_reminder(gen_random_uuid(), v_pet, 'manual', null, null, 'sent', repeat('가', 1001)); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FAIL 1001자 문구를 받아들임'; end if;
  v_ok := false;
  begin perform public.rpc_log_reminder(gen_random_uuid(), -1, 'manual', null, null, 'sent', 'x'); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FAIL 없는 반려동물을 받아들임'; end if;
  -- 반려동물 없이도 기록 가능(번호만 직접 입력해 보낸 문자)
  perform public.rpc_log_reminder(gen_random_uuid(), null, 'manual', 'custom', null, 'sent', '반려동물 없음');
  v_log := v_log || '입력검증 · ';

  -- ⑤ 되돌리기: sent → void, 두 번째는 오류
  perform public.rpc_void_reminder(v_id);
  select status into v_status from public.reminder_log where id = v_id;
  if v_status <> 'void' then raise exception 'FAIL 되돌림 후 상태 %', v_status; end if;
  v_ok := false;
  begin perform public.rpc_void_reminder(v_id); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FAIL 이미 되돌린 기록을 다시 되돌릴 수 있음'; end if;
  v_log := v_log || '되돌리기 · ';

  -- ⑥ 수신 상태: upsert, 거부로 변경, 지우기, 잘못된 값 거부
  perform public.rpc_set_reminder_pref(v_owner, 'consented', '구두', null);
  select status into v_status from public.owner_reminder_pref where owner_id = v_owner;
  if v_status is distinct from 'consented' then raise exception 'FAIL 동의 저장 실패 (%)', v_status; end if;
  perform public.rpc_set_reminder_pref(v_owner, 'optout', null, '전화로 거부');
  select status into v_status from public.owner_reminder_pref where owner_id = v_owner;
  if v_status is distinct from 'optout' then raise exception 'FAIL 거부로 바뀌지 않음 (%)', v_status; end if;
  select count(*) into n from public.owner_reminder_pref where owner_id = v_owner;
  if n <> 1 then raise exception 'FAIL 보호자당 한 행이어야 함 (%)', n; end if;
  v_ok := false;
  begin perform public.rpc_set_reminder_pref(v_owner, 'maybe', null, null); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FAIL 잘못된 상태를 받아들임'; end if;
  v_ok := false;
  begin perform public.rpc_set_reminder_pref(v_owner, 'consented', '이메일', null); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FAIL 잘못된 방법을 받아들임'; end if;
  v_ok := false;
  begin perform public.rpc_set_reminder_pref(-1, 'consented', null, null); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FAIL 없는 보호자를 받아들임'; end if;
  perform public.rpc_set_reminder_pref(v_owner, null, null, null);
  select count(*) into n from public.owner_reminder_pref where owner_id = v_owner;
  if n <> 0 then raise exception 'FAIL 표시 지우기 실패 (%)', n; end if;
  v_log := v_log || '수신상태 · ';
  perform public.rpc_set_reminder_pref(v_owner, 'consented', '서면', null);   -- ⑦ 삭제 연쇄 확인용
  reset role;

  -- ⑦ 반려동물 삭제 시 이력의 pet_id는 null, 보호자 삭제 시 수신 상태도 함께 삭제
  delete from public.pets where id = v_pet;
  select count(*) into n from public.reminder_log where client_key = v_key and pet_id is null;
  if n <> 1 then raise exception 'FAIL 반려동물 삭제 후 pet_id가 null이 되지 않음'; end if;
  delete from public.owners where id = v_owner;
  select count(*) into n from public.owner_reminder_pref where owner_id = v_owner;
  if n <> 0 then raise exception 'FAIL 보호자 삭제 후 수신 상태가 남음'; end if;
  v_log := v_log || '삭제 연쇄';

  raise exception 'VERIFY OK: %', v_log;   -- 롤백용
end $$;
