-- 권한: 전부 회수 후 필요한 것만 부여 -> RLS. 화면 숨김은 편의이고 권한은 여기서 강제한다.
-- 쓰기(판매·매입·취소)는 03_rpc.sql의 SECURITY DEFINER 함수로만 가능하다.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

grant execute on function public.is_admin(), public.is_staff() to authenticated;

do $$
declare t text;
begin
  foreach t in array array['profiles','product_categories','suppliers','products','product_costs',
    'product_stock','product_stock_costs','sales','sale_items','sale_item_costs','payments','payment_matches',
    'purchases','purchase_items','inventory_movements','inventory_movement_costs','vaccinations',
    'environmental_data','action_tasks','task_assignees','task_comments']
  loop execute format('alter table public.%I enable row level security', t); end loop;
end $$;

-- ---- 직원+관리자 조회(비민감) ----
do $$
declare t text;
begin
  foreach t in array array['product_categories','suppliers','products','product_stock','sales','sale_items',
    'payment_matches','inventory_movements','vaccinations','environmental_data']
  loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.is_staff()))',
                   t || '_staff_read', t);
  end loop;
end $$;

-- ---- 관리자 전용 조회(원가·이익·매입·결제) ----
do $$
declare t text;
begin
  foreach t in array array['product_costs','product_stock_costs','sale_item_costs','payments','purchases',
    'purchase_items','inventory_movement_costs']
  loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.is_admin()))',
                   t || '_admin_read', t);
  end loop;
end $$;

-- ---- 기준정보 관리(관리자): 상품·분류·거래처·매입가 ----
do $$
declare t text;
begin
  foreach t in array array['product_categories','suppliers','products','product_costs']
  loop
    execute format('grant insert, update, delete on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))',
                   t || '_admin_write', t);
  end loop;
end $$;

-- ---- profiles: 직원·관리자 조회, 본인은 표시 이름만 수정(역할 변경은 rpc_set_role) ----
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
create policy profiles_read on public.profiles for select to authenticated
  using ((select public.is_staff()));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ---- 실행 관리 ----
grant select, insert, delete on public.action_tasks to authenticated;
grant update (title, description, status, priority, due_date) on public.action_tasks to authenticated;
create policy tasks_read on public.action_tasks for select to authenticated using ((select public.is_staff()));
create policy tasks_insert on public.action_tasks for insert to authenticated with check ((select public.is_admin()));
create policy tasks_update on public.action_tasks for update to authenticated
  using ((select public.is_admin()) or exists (select 1 from public.task_assignees a
         where a.task_id = action_tasks.id and a.user_id = (select auth.uid())))
  with check ((select public.is_admin()) or exists (select 1 from public.task_assignees a
         where a.task_id = action_tasks.id and a.user_id = (select auth.uid())));
create policy tasks_delete on public.action_tasks for delete to authenticated using ((select public.is_admin()));

grant select, insert, delete on public.task_assignees to authenticated;
create policy assignees_read on public.task_assignees for select to authenticated using ((select public.is_staff()));
create policy assignees_admin_insert on public.task_assignees for insert to authenticated with check ((select public.is_admin()));
create policy assignees_admin_delete on public.task_assignees for delete to authenticated using ((select public.is_admin()));

grant select, insert, delete on public.task_comments to authenticated;
grant update (body) on public.task_comments to authenticated;
create policy comments_read on public.task_comments for select to authenticated using ((select public.is_staff()));
create policy comments_insert on public.task_comments for insert to authenticated with check ((select public.is_staff()));
create policy comments_update on public.task_comments for update to authenticated
  using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
create policy comments_delete on public.task_comments for delete to authenticated
  using (author_id = (select auth.uid()) or (select public.is_admin()));

-- ---- 관리자 분석용 뷰(원가·이익 포함). security_invoker라 직원은 빈 결과 ----
create view public.v_sale_items_profit with (security_invoker = true) as
select si.id as sale_item_id, s.sold_at, s.status, si.product_id, si.quantity, si.amount,
       c.unit_cost, c.cost_amount, c.gross_profit
from public.sale_items si
join public.sales s on s.id = si.sale_id
join public.sale_item_costs c on c.sale_item_id = si.id;
grant select on public.v_sale_items_profit to authenticated;
