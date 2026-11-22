-- 다음 알림일 검증 (db/28_pet_next_due.sql 적용 뒤 SQL Editor에서 통째로 1회 실행).
-- 비밀번호 없이 역할/JWT를 흉내 내서 확인하고, 마지막에 일부러 예외를 던져 전체를 롤백하므로 데이터는 바뀌지 않는다.
--   결과가 "VERIFY OK ..."이면 통과, 그 외 메시지는 실패한 항목이다.
-- 전제: profiles에 admin 1명 + staff 1명 이상, product_categories에 1개 이상.

do $$
declare
  v_admin uuid; v_staff uuid;
  v_cat int; v_pid int; v_pid2 int; v_owner bigint; v_pet bigint; v_pet2 bigint;
  n int; v_state text; v_ok boolean; v_due date; v_sold date; v_src text;
  v_log text := '';
begin
  select id into v_admin from public.profiles where role = 'admin' and active limit 1;
  select id into v_staff from public.profiles where role = 'staff' and active limit 1;
  if v_admin is null or v_staff is null then raise exception 'profiles에 admin/staff가 필요'; end if;
  select id into v_cat from public.product_categories limit 1;
  if v_cat is null then raise exception 'product_categories가 필요'; end if;

  -- 시험용 보호자·반려동물·상품(롤백됨)
  insert into public.owners (name, phone) values ('검증보호자', null) returning id into v_owner;
  insert into public.pets (owner_id, name, species) values (v_owner, '검증펫', 'dog') returning id into v_pet;
  insert into public.pets (owner_id, name, species) values (v_owner, '검증펫2', 'cat') returning id into v_pet2;
  select coalesce(max(id), 0) + 1 into v_pid from public.products;
  insert into public.products (id, code, name, category_id, sale_price) values (v_pid, 'VERIFY-DUE-' || v_pid, '검증상품', v_cat, 0);
  v_pid2 := v_pid + 1;
  insert into public.products (id, code, name, category_id, sale_price) values (v_pid2, 'VERIFY-DUE-' || v_pid2, '검증상품2', v_cat, 0);

  -- ① anon은 읽을 수 없고 함수도 실행할 수 없다
  v_ok := false;
  begin
    set local role anon;
    perform 1 from public.pet_next_due limit 1;
  exception when insufficient_privilege then v_ok := true;
  end;
  reset role;
  if not v_ok then raise exception 'FAIL anon이 pet_next_due를 읽을 수 있음'; end if;
  if has_function_privilege('anon', 'public.rpc_set_next_due(bigint, int, date, date, text)', 'execute') then
    raise exception 'FAIL anon이 함수를 실행할 수 있음';
  end if;
  v_log := v_log || 'anon 차단 · ';

  -- ② admin: 저장하고 같은 키로 다시 저장하면 한 행이 갱신된다
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.rpc_set_next_due(v_pet, v_pid, date '2026-12-22', date '2026-11-22', 'auto');
  perform public.rpc_set_next_due(v_pet, v_pid, date '2027-01-05', date '2026-11-23', 'manual');
  select count(*), max(due_on), max(sold_on), max(source) into n, v_due, v_sold, v_src from public.pet_next_due where pet_id = v_pet and product_id = v_pid;
  if n <> 1 or v_due <> date '2027-01-05' or v_sold <> date '2026-11-23' or v_src <> 'manual' then
    raise exception 'FAIL 갱신 결과 이상 (% / % / % / %)', n, v_due, v_sold, v_src;
  end if;
  v_log := v_log || '저장·갱신 · ';

  -- ③ 더 이른 구매일 기준의 저장은 더 최근 구매 기준의 기존 값을 덮어쓰지 않는다
  perform public.rpc_set_next_due(v_pet, v_pid, date '2026-11-30', date '2026-11-10', 'auto');
  select due_on, sold_on into v_due, v_sold from public.pet_next_due where pet_id = v_pet and product_id = v_pid;
  if v_due <> date '2027-01-05' or v_sold <> date '2026-11-23' then raise exception 'FAIL 더 이른 구매가 최근 값을 덮어씀 (% / %)', v_due, v_sold; end if;
  v_log := v_log || '최근 구매 우선 · ';

  -- ④ 잘못된 값은 모두 거부
  v_ok := false; begin perform public.rpc_set_next_due(v_pet, v_pid2, date '2026-11-01', date '2026-11-22', 'auto'); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FAIL 구매일보다 이른 알림일을 받아들임'; end if;
  v_ok := false; begin perform public.rpc_set_next_due(v_pet, v_pid2, date '2037-01-01', date '2026-11-22', 'auto'); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FAIL 3650일을 넘는 알림일을 받아들임'; end if;
  v_ok := false; begin perform public.rpc_set_next_due(v_pet, v_pid2, date '2026-12-22', date '2026-11-22', 'zzz'); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FAIL 알 수 없는 출처를 받아들임'; end if;
  v_ok := false; begin perform public.rpc_set_next_due(-1, v_pid2, date '2026-12-22', date '2026-11-22', 'auto'); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FAIL 없는 반려동물을 받아들임'; end if;
  v_ok := false; begin perform public.rpc_set_next_due(v_pet, -1, date '2026-12-22', date '2026-11-22', 'auto'); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FAIL 없는 상품을 받아들임'; end if;
  v_ok := false; begin perform public.rpc_set_next_due(v_pet, v_pid2, date '2026-12-22', null, 'auto'); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FAIL 구매일 없는 저장을 받아들임'; end if;
  v_log := v_log || '입력검증 · ';

  -- ⑤ p_due_on이 null이면 지우고, 없는 키를 지워도 오류가 아니다
  perform public.rpc_set_next_due(v_pet, v_pid, null, null, null);
  perform public.rpc_set_next_due(v_pet, v_pid, null, null, null);
  select count(*) into n from public.pet_next_due where pet_id = v_pet and product_id = v_pid;
  if n <> 0 then raise exception 'FAIL 지우기 실패 (%)', n; end if;
  v_log := v_log || '지우기 · ';
  perform public.rpc_set_next_due(v_pet, v_pid, date '2026-12-22', date '2026-11-22', 'auto');
  perform public.rpc_set_next_due(v_pet2, v_pid2, date '2026-12-22', date '2026-11-22', 'auto');
  reset role;

  -- ⑥ staff: 읽기 0행, 함수는 거부(42501)
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.pet_next_due;
  if n <> 0 then raise exception 'FAIL staff가 pet_next_due를 읽음 (%)', n; end if;
  begin
    perform public.rpc_set_next_due(v_pet, v_pid, date '2026-12-22', date '2026-11-22', 'auto');
    raise exception 'FAIL staff가 저장할 수 있음';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> '42501' then raise exception 'FAIL staff 거부 코드 이상: %', v_state; end if;
  end;
  reset role;
  v_log := v_log || 'staff 차단 · ';

  -- ⑦ 반려동물·상품을 지우면 그 행도 같이 지워진다
  delete from public.pets where id = v_pet;
  select count(*) into n from public.pet_next_due where pet_id = v_pet;
  if n <> 0 then raise exception 'FAIL 반려동물 삭제 후 행이 남음 (%)', n; end if;
  delete from public.products where id = v_pid2;
  select count(*) into n from public.pet_next_due where product_id = v_pid2;
  if n <> 0 then raise exception 'FAIL 상품 삭제 후 행이 남음 (%)', n; end if;
  v_log := v_log || '삭제 연쇄';

  raise exception 'VERIFY OK: %', v_log;   -- 롤백용
end $$;
