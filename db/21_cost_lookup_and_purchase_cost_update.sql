-- 입고 관리 화면 최상단에 "상품 매입단가 조회" 블록을 추가하면서, 그 값이 언제 들어온 것인지
-- 보여주기 위해 product_costs에 갱신 시각을 추가한다. 기존 행은 전부 NULL로 남아(엑셀/통합 시트에서
-- 그대로 가져온 값이라 정확한 시점을 모름), 화면에서는 "최초 등록값(일자 미확인)"으로 표시한다.
alter table public.product_costs add column if not exists updated_at timestamptz;

-- 입고 등록(rpc_receive_purchase) 시 실제 매입 단가를 product_costs(기준 매입가)에도 반영해
-- 다음부터는 입고관리 화면에서 입력한 값이 매입단가 조회에 나타나게 한다.
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

    -- 입고관리에서 입력한 실제 매입 단가를 기준 매입가(매입단가 조회에 쓰는 값)에도 반영
    insert into public.product_costs (product_id, purchase_price, updated_at)
    values (r.pid, r.unit_cost, now())
    on conflict (product_id) do update set purchase_price = excluded.purchase_price, updated_at = excluded.updated_at;

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
