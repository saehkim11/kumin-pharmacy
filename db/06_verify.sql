-- RLS/RPC 검증 (SQL Editor에서 통째로 1회 실행). 비밀번호 없이 역할/JWT를 흉내 내서 확인한다.
-- 마지막에 일부러 예외를 던져 전체를 롤백하므로 데이터는 바뀌지 않는다.
--   결과가 "VERIFY OK ..."이면 통과, 그 외 메시지는 실패한 항목이다.
-- 전제: 상품과 재고(product_stock)가 있고, profiles에 admin 1명 + staff 1명 이상.

do $$
declare
  v_admin uuid; v_staff uuid;
  n int; v_pid int; v_price numeric; v_q0 numeric; v_q1 numeric; v_id bigint; v_id2 bigint;
  v_total numeric; v_state text; v_key uuid := gen_random_uuid();
  v_log text := '';
begin
  select id into v_admin from public.profiles where role = 'admin' and active limit 1;
  select id into v_staff from public.profiles where role = 'staff' and active limit 1;
  if v_admin is null or v_staff is null then raise exception 'profiles에 admin/staff가 필요'; end if;

  -- 판매 가능한 일반 상품(백신 아님, 재고 충분)
  select p.id, p.sale_price, s.quantity into v_pid, v_price, v_q0
  from public.products p
  join public.product_stock s on s.product_id = p.id
  join public.product_categories c on c.id = p.category_id
  where p.track_stock and c.group_name = 'drug' and s.quantity >= 3 and p.sale_price > 0
  order by p.id limit 1;
  if v_pid is null then raise exception '재고 3 이상인 약품이 없음'; end if;

  -- ============ anon ============
  set local role anon;
  begin
    perform 1 from public.products limit 1;
    raise exception 'FAIL anon이 products를 읽음';
  exception when insufficient_privilege then v_log := v_log || 'anon 차단 OK; ';
  end;
  reset role;

  -- ============ staff ============
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.products;
  if n = 0 then raise exception 'FAIL staff가 products를 못 읽음'; end if;
  foreach v_state in array array['product_costs','sale_item_costs','purchases','purchase_items','payments',
                                  'product_stock_costs','inventory_movement_costs'] loop
    execute format('select count(*) from public.%I', v_state) into n;
    if n <> 0 then raise exception 'FAIL staff가 % 행을 봄(%)', v_state, n; end if;
  end loop;
  v_log := v_log || 'staff 원가/매입 비노출 OK; ';

  begin
    insert into public.sales (receipt_no, payment_method, total_amount) values ('X-1', 'cash', 1);
    raise exception 'FAIL staff가 sales에 직접 insert';
  exception when insufficient_privilege then v_log := v_log || 'staff 직접쓰기 차단 OK; ';
  end;
  begin
    update public.profiles set role = 'admin' where id = v_staff;
    raise exception 'FAIL staff가 role 변경';
  exception when insufficient_privilege then v_log := v_log || 'staff role 변경 차단 OK; ';
  end;
  begin
    perform public.rpc_receive_purchase(1, current_date, '[]'::jsonb);
    raise exception 'FAIL staff가 입고 RPC 실행';
  exception when insufficient_privilege then v_log := v_log || 'staff 입고 RPC 차단 OK; ';
  end;
  begin
    perform public.rpc_cancel_sale(1, 'x');
    raise exception 'FAIL staff가 취소 RPC 실행';
  exception when insufficient_privilege then v_log := v_log || 'staff 취소 RPC 차단 OK; ';
  end;

  -- staff 판매 등록
  v_id := public.rpc_create_sale(v_key, 'card', jsonb_build_array(jsonb_build_object('product_id', v_pid, 'quantity', 2)));
  select total_amount into v_total from public.sales where id = v_id;
  if v_total <> round(2 * v_price) then raise exception 'FAIL 합계 불일치 % vs %', v_total, round(2 * v_price); end if;
  v_id2 := public.rpc_create_sale(v_key, 'card', jsonb_build_array(jsonb_build_object('product_id', v_pid, 'quantity', 2)));
  if v_id2 <> v_id then raise exception 'FAIL 멱등성: 같은 키로 다른 판매 생성'; end if;
  begin
    perform public.rpc_create_sale(gen_random_uuid(), 'cash',
      jsonb_build_array(jsonb_build_object('product_id', v_pid, 'quantity', 99999)));
    raise exception 'FAIL 재고 초과 판매가 허용됨';
  exception when raise_exception then
    if sqlerrm not like 'insufficient stock%' then raise; end if;
    v_log := v_log || '재고부족 거부 OK; ';
  end;
  reset role;

  select quantity into v_q1 from public.product_stock where product_id = v_pid;
  if v_q1 <> v_q0 - 2 then raise exception 'FAIL 재고 차감 % -> %', v_q0, v_q1; end if;
  select count(*) into n from public.sale_item_costs c join public.sale_items i on i.id = c.sale_item_id
    where i.sale_id = v_id and c.unit_cost > 0;
  if n <> 1 then raise exception 'FAIL 판매 원가 미기록'; end if;
  v_log := v_log || '판매 RPC(합계/재고/원가/멱등) OK; ';

  -- ============ admin ============
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.product_costs;
  if n = 0 then raise exception 'FAIL admin이 product_costs를 못 읽음'; end if;
  select count(*) into n from public.v_sale_items_profit where sale_item_id in (select id from public.sale_items where sale_id = v_id);
  if n <> 1 then raise exception 'FAIL 이익 뷰'; end if;

  perform public.rpc_cancel_sale(v_id, '검증');
  begin
    perform public.rpc_cancel_sale(v_id, '재취소');
    raise exception 'FAIL 이중 취소 허용';
  exception when raise_exception then
    if sqlerrm not like 'sale not found%' then raise; end if;
  end;
  begin
    perform public.rpc_set_role(v_admin, 'staff', true);   -- 유일한 관리자를 강등
    raise exception 'FAIL 마지막 관리자 강등 허용';
  exception when raise_exception then
    if sqlerrm not like 'at least one%' then raise; end if;
    v_log := v_log || '마지막 관리자 보호 OK; ';
  end;
  reset role;

  select quantity into v_q1 from public.product_stock where product_id = v_pid;
  if v_q1 <> v_q0 then raise exception 'FAIL 취소 후 재고 미복원 % vs %', v_q1, v_q0; end if;
  v_log := v_log || '취소 RPC(재고 복원/이중취소 방지) OK';

  raise exception 'VERIFY OK: %', v_log;   -- 롤백용
end $$;
