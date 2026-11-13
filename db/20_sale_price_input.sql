-- 판매관리 화면에 판매가 입력란을 추가하면서, 그 값을 실제 판매 기록(sale_items.unit_price)에
-- 쓸 수 있도록 rpc_create_sale이 p_items의 unit_price를 받게 한다.
-- 입력한 판매가는 상품 마스터(products.sale_price)에도 저장해 다음 판매부터 자동으로 제안되게 하고,
-- 이후 다른 가격을 입력하면 그 값으로 다시 갱신한다(사용자 확인 완료).

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
           round(sum((e ->> 'quantity')::numeric), 3) as qty,
           max(nullif(e ->> 'unit_price', ''))::numeric as price_override
    from jsonb_array_elements(p_items) e
    group by 1, 2 order by 1, 2
  loop
    if r.qty is null or r.qty <= 0 or r.qty > 100000 then raise exception 'invalid quantity (product %)', r.pid; end if;
    if r.price_override is not null and r.price_override < 0 then raise exception 'invalid price (product %)', r.pid; end if;

    select p.sale_price, c.group_name, p.target_animal, p.track_stock
      into v_price, v_group, v_target, v_track
    from public.products p join public.product_categories c on c.id = p.category_id
    where p.id = r.pid and p.active;
    if not found then raise exception 'unknown or inactive product %', r.pid; end if;

    if r.price_override is not null then
      -- 화면에서 입력한 판매가를 이번 판매에 쓰고, 기존 값과 다르면 상품 마스터도 갱신해
      -- 다음 판매부터 자동으로 제안되게 한다.
      if r.price_override is distinct from v_price then
        update public.products set sale_price = r.price_override where id = r.pid;
      end if;
      v_price := r.price_override;
    end if;

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
