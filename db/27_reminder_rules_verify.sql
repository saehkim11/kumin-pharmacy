-- 알림 주기 규칙 검증 (db/26_reminder_rules.sql 적용 뒤 SQL Editor에서 통째로 1회 실행).
-- 비밀번호 없이 역할/JWT를 흉내 내서 확인하고, 마지막에 일부러 예외를 던져 전체를 롤백하므로 데이터는 바뀌지 않는다.
--   결과가 "VERIFY OK ..."이면 통과, 그 외 메시지는 실패한 항목이다.
-- 전제: profiles에 admin 1명 + staff 1명 이상, product_categories에 1개 이상.

do $$
declare
  v_admin uuid; v_staff uuid;
  v_cat int; v_pid int;
  n int; v_state text; v_ok boolean; v_interval int; v_kind text;
  v_log text := '';
begin
  select id into v_admin from public.profiles where role = 'admin' and active limit 1;
  select id into v_staff from public.profiles where role = 'staff' and active limit 1;
  if v_admin is null or v_staff is null then raise exception 'profiles에 admin/staff가 필요'; end if;
  select id into v_cat from public.product_categories limit 1;
  if v_cat is null then raise exception 'product_categories가 필요'; end if;

  -- 시험용 상품(롤백됨)
  select coalesce(max(id), 0) + 1 into v_pid from public.products;
  insert into public.products (id, code, name, category_id, sale_price) values (v_pid, 'VERIFY-RULE-' || v_pid, '검증상품', v_cat, 0);

  -- ① anon은 읽을 수 없고 함수도 실행할 수 없다
  v_ok := false;
  begin
    set local role anon;
    perform 1 from public.reminder_rules limit 1;
  exception when insufficient_privilege then v_ok := true;
  end;
  reset role;
  if not v_ok then raise exception 'FAIL anon이 reminder_rules를 읽을 수 있음'; end if;
  if has_function_privilege('anon', 'public.rpc_set_reminder_rule(text, int, text, int, int)', 'execute') then
    raise exception 'FAIL anon이 규칙 저장 함수를 실행할 수 있음';
  end if;
  v_log := v_log || 'anon 차단 · ';

  -- ② admin: 분류 규칙·상품 규칙을 만들고, 같은 키로 다시 저장하면 한 행을 갱신한다
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.rpc_set_reminder_rule('feed', null, 'rebuy', 30, null);
  perform public.rpc_set_reminder_rule('feed', null, 'rebuy', 45, 3);
  select count(*), max(interval_days) into n, v_interval from public.reminder_rules where group_name = 'feed';
  if n <> 1 or v_interval <> 45 then raise exception 'FAIL 분류 규칙이 한 행으로 갱신되지 않음 (% / %)', n, v_interval; end if;
  select lead_days into n from public.reminder_rules where group_name = 'feed';
  if n <> 3 then raise exception 'FAIL lead_days 갱신 실패 (%)', n; end if;
  perform public.rpc_set_reminder_rule(null, v_pid, 'vaccine', 365, 7);
  perform public.rpc_set_reminder_rule(null, v_pid, 'rebuy', 30, null);
  select count(*), max(kind) into n, v_kind from public.reminder_rules where product_id = v_pid;
  if n <> 1 or v_kind <> 'rebuy' then raise exception 'FAIL 상품 규칙이 한 행으로 갱신되지 않음 (% / %)', n, v_kind; end if;
  select lead_days into n from public.reminder_rules where product_id = v_pid;
  if n <> 7 then raise exception 'FAIL lead_days 기본값 7이 아님 (%)', n; end if;
  v_log := v_log || '저장·갱신 · ';

  -- ③ 기간이 null이면 규칙을 지우고, 없는 키를 지워도 오류가 아니다
  perform public.rpc_set_reminder_rule('feed', null, null, null, null);
  perform public.rpc_set_reminder_rule('feed', null, null, null, null);
  select count(*) into n from public.reminder_rules where group_name = 'feed';
  if n <> 0 then raise exception 'FAIL 분류 규칙 지우기 실패 (%)', n; end if;
  v_log := v_log || '지우기 · ';

  -- ④ 잘못된 값은 모두 거부
  v_ok := false; begin perform public.rpc_set_reminder_rule(null, null, 'rebuy', 30, 7); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FAIL 키가 없는 저장을 받아들임'; end if;
  v_ok := false; begin perform public.rpc_set_reminder_rule('feed', v_pid, 'rebuy', 30, 7); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FAIL 키가 둘인 저장을 받아들임'; end if;
  v_ok := false; begin perform public.rpc_set_reminder_rule('feed', null, 'rebuy', 0, 7); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FAIL 기간 0을 받아들임'; end if;
  v_ok := false; begin perform public.rpc_set_reminder_rule('feed', null, 'rebuy', 3651, 7); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FAIL 기간 3651을 받아들임'; end if;
  v_ok := false; begin perform public.rpc_set_reminder_rule('feed', null, 'rebuy', 30, 366); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FAIL lead 366을 받아들임'; end if;
  v_ok := false; begin perform public.rpc_set_reminder_rule('feed', null, 'rebuy', 30, -1); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FAIL lead -1을 받아들임'; end if;
  v_ok := false; begin perform public.rpc_set_reminder_rule('zzz', null, 'rebuy', 30, 7); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FAIL 알 수 없는 분류를 받아들임'; end if;
  v_ok := false; begin perform public.rpc_set_reminder_rule(null, v_pid, 'zzz', 30, 7); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FAIL 알 수 없는 종류를 받아들임'; end if;
  v_ok := false; begin perform public.rpc_set_reminder_rule(null, -1, 'rebuy', 30, 7); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FAIL 없는 상품을 받아들임'; end if;
  v_ok := false; begin perform public.rpc_set_reminder_rule('feed', null, 'vaccine', 30, 7); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FAIL 분류 규칙에 접종 종류를 받아들임'; end if;
  v_log := v_log || '입력검증 · ';
  reset role;

  -- ⑤ staff: 읽을 수는 있고 함수는 거부된다(42501)
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.reminder_rules where product_id = v_pid;
  if n <> 1 then raise exception 'FAIL staff가 규칙을 읽지 못함 (%)', n; end if;
  begin
    perform public.rpc_set_reminder_rule('feed', null, 'rebuy', 30, 7);
    raise exception 'FAIL staff가 규칙을 저장할 수 있음';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> '42501' then raise exception 'FAIL staff 거부 코드 이상: %', v_state; end if;
  end;
  reset role;
  v_log := v_log || 'staff 읽기만 · ';

  -- ⑥ 상품을 지우면 그 상품의 규칙도 같이 지워진다
  delete from public.products where id = v_pid;
  select count(*) into n from public.reminder_rules where product_id = v_pid;
  if n <> 0 then raise exception 'FAIL 상품 삭제 후 규칙이 남음 (%)', n; end if;
  v_log := v_log || '상품 삭제 연쇄';

  raise exception 'VERIFY OK: %', v_log;   -- 롤백용
end $$;
