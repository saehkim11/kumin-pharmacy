-- 재고 수량은 앞으로도 정밀하게 세지 않을 예정이라, 재고 부족을 이유로 판매를 막지 않는다.
-- 대신 "원가 추적(마진 계산)"은 그 상품을 처음 입고 등록하는 순간부터 자동으로 시작되게 한다.
-- (이전에는 track_stock=true인 상품만 입고 등록이 가능했고, 판매 시 재고 부족이면 판매 자체가
--  막혔다. 이 업장은 수량 관리를 한 적이 없고 마진 계산용 원가만 썼으므로 그 방식을 그대로 반영한다.)

create or replace function public.rpc_create_sale(p_idempotency_key uuid, p_payment_method text, p_items jsonb, p_sold_at date default current_date)
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
  if found then return v_sale_id; end if;

  perform pg_advisory_xact_lock(hashtext('receipt_no'));
  select coalesce(max(substr(s.receipt_no, 10)::int), 0) + 1 into v_seq
  from public.sales s where s.receipt_no like v_today || '-%';

  insert into public.sales (receipt_no, sold_at, payment_method, total_amount, idempotency_key, created_by)
  values (v_today || '-' || lpad(v_seq::text, 3, '0'), v_sold_at, p_payment_method, 0, p_idempotency_key, auth.uid())
  returning id into v_sale_id;

  for r in
    select (e ->> 'product_id')::int as pid, nullif(e ->> 'pet_id', '')::bigint as pet_id,
           round(sum((e ->> 'quantity')::numeric), 3) as qty
    from jsonb_array_elements(p_items) e
    group by 1, 2 order by 1, 2
  loop
    if r.qty is null or r.qty <= 0 or r.qty > 100000 then raise exception 'invalid quantity (product %)', r.pid; end if;

    select p.sale_price, c.group_name, p.target_animal, p.track_stock
      into v_price, v_group, v_target, v_track
    from public.products p join public.product_categories c on c.id = p.category_id
    where p.id = r.pid and p.active;
    if not found then raise exception 'unknown or inactive product %', r.pid; end if;

    v_cost := 0;
    if v_track then
      -- 재고 부족을 이유로 판매를 막지 않는다. 원가만 가져오고 수량은 참고용으로만 내려간다.
      -- product_stock.quantity에는 음수를 막는 체크 제약이 있어(기존 스키마, 그대로 둠) 0 밑으로는
      -- 내려가지 않게 clamp한다 — 그래야 재고 부족 시 DB 제약 위반으로 판매가 또 막히는 일이 없다.
      select sc.avg_cost into v_cost from public.product_stock_costs sc where sc.product_id = r.pid;
      v_cost := coalesce(v_cost, 0);
      update public.product_stock set quantity = greatest(quantity - r.qty, 0) where product_id = r.pid;
    end if;

    v_amount := round(r.qty * v_price);
    insert into public.sale_items (sale_id, product_id, quantity, unit_price, amount, pet_id)
    values (v_sale_id, r.pid, r.qty, v_price, v_amount, r.pet_id) returning id into v_item_id;
    insert into public.sale_item_costs (sale_item_id, unit_cost, cost_amount, gross_profit)
    values (v_item_id, v_cost, round(r.qty * v_cost), v_amount - round(r.qty * v_cost));

    if v_track then
      v_vacc_id := null;
      if v_group = 'vaccine' then
        insert into public.vaccinations (administered_on, product_id, animal_type, quantity, sale_item_id, pet_id)
        values (p_sold_at, r.pid,
                case when v_target = 'cat' then 'cat' else 'dog' end, r.qty, v_item_id, r.pet_id)
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

create or replace function public.rpc_receive_purchase(p_supplier_id integer, p_purchased_at date, p_items jsonb)
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
    if not exists (select 1 from public.products p where p.id = r.pid) then
      raise exception 'unknown product %', r.pid;
    end if;
    -- 처음 입고하는 상품이면 이 순간부터 원가·마진 추적을 자동으로 시작한다(재고 수량 강제는 안 함)
    update public.products set track_stock = true where id = r.pid and not track_stock;

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
