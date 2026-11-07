-- 쓰기 경로: 판매·매입·취소는 아래 SECURITY DEFINER 함수로만 가능(테이블 직접 쓰기 권한 없음).
-- 모든 함수: 로그인/역할 검증 -> 서버에서 가격·원가 확정 -> 재고 행 잠금(product_id 순서로 데드락 방지) -> 원자 저장.

-- ---------------------------------------------------------------- 판매 등록
create function public.rpc_create_sale(p_idempotency_key uuid, p_payment_method text, p_items jsonb, p_sold_at date default current_date)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_sale_id bigint;
  v_today text;
  v_sold_at timestamptz;
  v_seq int;
  v_total numeric := 0;
  r record;
  v_price numeric;
  v_group text;
  v_target text;
  v_track boolean;
  v_stock numeric;
  v_cost numeric := 0;
  v_amount numeric;
  v_item_id bigint;
  v_vacc_id bigint;
  v_mov_id bigint;
begin
  if not public.is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_idempotency_key is null then raise exception 'idempotency key required'; end if;
  if p_payment_method is null or p_payment_method not in ('card', 'cash') then
    raise exception 'invalid payment method';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'items required';
  end if;
  p_sold_at := coalesce(p_sold_at, (now() at time zone 'Asia/Seoul')::date);
  if p_sold_at > (now() at time zone 'Asia/Seoul')::date then raise exception 'future sales date is not allowed'; end if;
  v_sold_at := (p_sold_at::timestamp + (now() at time zone 'Asia/Seoul')::time) at time zone 'Asia/Seoul';
  v_today := to_char(p_sold_at, 'YYYYMMDD');

  select s.id into v_sale_id from public.sales s where s.idempotency_key = p_idempotency_key;
  if found then return v_sale_id; end if;                       -- 중복 요청: 기존 결과 반환

  perform pg_advisory_xact_lock(hashtext('receipt_no'));
  select coalesce(max(substr(s.receipt_no, 10)::int), 0) + 1 into v_seq
  from public.sales s where s.receipt_no like v_today || '-%';

  insert into public.sales (receipt_no, sold_at, payment_method, total_amount, idempotency_key, created_by)
  values (v_today || '-' || lpad(v_seq::text, 3, '0'), v_sold_at, p_payment_method, 0, p_idempotency_key, auth.uid())
  returning id into v_sale_id;

  for r in
    select (e ->> 'product_id')::int as pid, round(sum((e ->> 'quantity')::numeric), 3) as qty
    from jsonb_array_elements(p_items) e
    group by 1 order by 1
  loop
    if r.qty is null or r.qty <= 0 or r.qty > 100000 then raise exception 'invalid quantity (product %)', r.pid; end if;

    select p.sale_price, c.group_name, p.target_animal, p.track_stock
      into v_price, v_group, v_target, v_track
    from public.products p join public.product_categories c on c.id = p.category_id
    where p.id = r.pid and p.active;
    if not found then raise exception 'unknown or inactive product %', r.pid; end if;

    v_cost := 0;
    if v_track then
      select s.quantity into v_stock from public.product_stock s where s.product_id = r.pid for update;
      if v_stock is null or v_stock < r.qty then
        raise exception 'insufficient stock (product %)', r.pid using errcode = 'P0001';
      end if;
      select sc.avg_cost into v_cost from public.product_stock_costs sc where sc.product_id = r.pid;
      v_cost := coalesce(v_cost, 0);
      update public.product_stock set quantity = quantity - r.qty where product_id = r.pid;
    end if;

    v_amount := round(r.qty * v_price);
    insert into public.sale_items (sale_id, product_id, quantity, unit_price, amount)
    values (v_sale_id, r.pid, r.qty, v_price, v_amount) returning id into v_item_id;
    insert into public.sale_item_costs (sale_item_id, unit_cost, cost_amount, gross_profit)
    values (v_item_id, v_cost, round(r.qty * v_cost), v_amount - round(r.qty * v_cost));

    if v_track then
      v_vacc_id := null;
      if v_group = 'vaccine' then
        insert into public.vaccinations (administered_on, product_id, animal_type, quantity, sale_item_id)
        values (p_sold_at, r.pid,
                case when v_target = 'cat' then 'cat' else 'dog' end, r.qty, v_item_id)
        returning id into v_vacc_id;
      end if;
      insert into public.inventory_movements (product_id, moved_at, movement_type, quantity, ref_type, ref_id)
      values (r.pid, v_sold_at, case when v_group = 'vaccine' then 'vaccination_use' else 'sale_out' end, -r.qty,
              case when v_group = 'vaccine' then 'vaccination' else 'sale_item' end,
              case when v_group = 'vaccine' then v_vacc_id else v_item_id end)
      returning id into v_mov_id;
      insert into public.inventory_movement_costs (movement_id, unit_cost) values (v_mov_id, v_cost);
    end if;
    v_total := v_total + v_amount;
  end loop;

  update public.sales set total_amount = v_total where id = v_sale_id;
  return v_sale_id;
end $$;

-- ---------------------------------------------------------------- 매입 입고 (관리자)
create function public.rpc_receive_purchase(p_supplier_id int, p_purchased_at date, p_items jsonb)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_purchase_id bigint;
  v_total numeric := 0;
  r record;
  v_qty0 numeric;
  v_avg0 numeric;
  v_item_id bigint;
  v_mov_id bigint;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'items required';
  end if;
  if not exists (select 1 from public.suppliers where id = p_supplier_id) then
    raise exception 'unknown supplier';
  end if;

  insert into public.purchases (supplier_id, purchased_at, received_at, total_amount)
  values (p_supplier_id, coalesce(p_purchased_at, current_date), current_date, 0)
  returning id into v_purchase_id;

  for r in
    select (e ->> 'product_id')::int as pid, (e ->> 'quantity')::numeric as qty,
           (e ->> 'unit_cost')::numeric as unit_cost, e ->> 'lot_no' as lot_no,
           nullif(e ->> 'expiry_date', '')::date as expiry
    from jsonb_array_elements(p_items) e
    order by 1
  loop
    if r.qty is null or r.qty <= 0 or r.unit_cost is null or r.unit_cost < 0 then
      raise exception 'invalid quantity/cost (product %)', r.pid;
    end if;
    if not exists (select 1 from public.products p where p.id = r.pid and p.track_stock) then
      raise exception 'product % is not stock-tracked', r.pid;
    end if;
    insert into public.product_stock (product_id) values (r.pid) on conflict do nothing;
    insert into public.product_stock_costs (product_id) values (r.pid) on conflict do nothing;
    select s.quantity into v_qty0 from public.product_stock s where s.product_id = r.pid for update;
    select sc.avg_cost into v_avg0 from public.product_stock_costs sc where sc.product_id = r.pid;

    update public.product_stock_costs
       set avg_cost = round((v_qty0 * v_avg0 + r.qty * r.unit_cost) / (v_qty0 + r.qty), 2)
     where product_id = r.pid;
    update public.product_stock set quantity = quantity + r.qty where product_id = r.pid;

    insert into public.purchase_items (purchase_id, product_id, quantity, unit_cost, lot_no, expiry_date)
    values (v_purchase_id, r.pid, r.qty, r.unit_cost, r.lot_no, r.expiry) returning id into v_item_id;
    insert into public.inventory_movements (product_id, movement_type, quantity, ref_type, ref_id)
    values (r.pid, 'purchase_in', r.qty, 'purchase_item', v_item_id) returning id into v_mov_id;
    insert into public.inventory_movement_costs (movement_id, unit_cost) values (v_mov_id, r.unit_cost);
    v_total := v_total + round(r.qty * r.unit_cost);
  end loop;

  update public.purchases set total_amount = v_total where id = v_purchase_id;
  return v_purchase_id;
end $$;

-- ---------------------------------------------------------------- 판매 취소 (관리자)
-- 취소 수량은 판매 당시 원가로 재고에 되돌리고(이동평균 재계산), 접종 기록을 지운다.
create function public.rpc_cancel_sale(p_sale_id bigint, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_qty0 numeric;
  v_avg0 numeric;
  v_mov_id bigint;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_reason is null or char_length(btrim(p_reason)) = 0 then raise exception 'reason required'; end if;

  perform 1 from public.sales s where s.id = p_sale_id and s.status = 'completed' for update;
  if not found then raise exception 'sale not found or already cancelled'; end if;

  for r in
    select si.id as item_id, si.product_id as pid, si.quantity as qty, c.unit_cost
    from public.sale_items si
    join public.sale_item_costs c on c.sale_item_id = si.id
    join public.products p on p.id = si.product_id and p.track_stock
    where si.sale_id = p_sale_id
    order by si.product_id
  loop
    insert into public.product_stock (product_id) values (r.pid) on conflict do nothing;
    insert into public.product_stock_costs (product_id) values (r.pid) on conflict do nothing;
    select s.quantity into v_qty0 from public.product_stock s where s.product_id = r.pid for update;
    select sc.avg_cost into v_avg0 from public.product_stock_costs sc where sc.product_id = r.pid;
    update public.product_stock_costs
       set avg_cost = round((v_qty0 * v_avg0 + r.qty * r.unit_cost) / (v_qty0 + r.qty), 2)
     where product_id = r.pid;
    update public.product_stock set quantity = quantity + r.qty where product_id = r.pid;
    insert into public.inventory_movements (product_id, movement_type, quantity, ref_type, ref_id)
    values (r.pid, 'sale_return', r.qty, 'sale_item', r.item_id) returning id into v_mov_id;
    insert into public.inventory_movement_costs (movement_id, unit_cost) values (v_mov_id, r.unit_cost);
  end loop;

  delete from public.vaccinations v
   where v.sale_item_id in (select si.id from public.sale_items si where si.sale_id = p_sale_id);
  update public.sales
     set status = 'cancelled', cancelled_at = now(), cancel_reason = btrim(p_reason)
   where id = p_sale_id;
end $$;

-- ---------------------------------------------------------------- 계정 관리 (관리자)
-- 공개 가입은 막고(Supabase Auth 설정에서 Disable signups), 관리자가 Auth에서 사용자를 만든 뒤 프로필을 연결한다.
-- 최초 관리자는 SQL Editor에서 직접 insert into public.profiles (id, display_name, role) values (..., 'admin').
create function public.rpc_create_profile(p_user_id uuid, p_display_name text, p_role text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_role not in ('admin', 'staff') then raise exception 'invalid role'; end if;
  insert into public.profiles (id, display_name, role) values (p_user_id, p_display_name, p_role);
end $$;

create function public.rpc_set_role(p_user_id uuid, p_role text, p_active boolean)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_role not in ('admin', 'staff') then raise exception 'invalid role'; end if;
  update public.profiles set role = p_role, active = p_active where id = p_user_id;
  if not found then raise exception 'profile not found'; end if;
  if not exists (select 1 from public.profiles where role = 'admin' and active) then
    raise exception 'at least one active admin is required';   -- 트랜잭션이 롤백된다
  end if;
end $$;

grant execute on function
  public.rpc_create_sale(uuid, text, jsonb, date),
  public.rpc_receive_purchase(int, date, jsonb),
  public.rpc_cancel_sale(bigint, text),
  public.rpc_create_profile(uuid, text, text),
  public.rpc_set_role(uuid, text, boolean)
to authenticated;
