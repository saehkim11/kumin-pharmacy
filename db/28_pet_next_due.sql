-- 알림 3단계: 반려동물별 "다음 알림일"(pet_next_due). 실행 순서: 01~27 다음에 실행.
-- 새 테이블과 새 함수만 추가하며 기존 테이블·열·정책·함수(특히 판매 등록 함수 rpc_create_sale)는 바꾸지 않는다.
--  - 판매 화면에서 (반려동물, 상품)별로 계산·확인한 다음 알림일을 판매가 성공한 뒤 별도로 저장한다. 판매가 성공한 구매일이 sold_on이다.
--  - sold_on은 "이 알림일이 어느 구매에 대한 것인지"를 뜻한다. 4단계에서 마지막 구매일보다 이른 구매 기준의 값은 무시하는 데 쓴다.
--  - source: auto = 화면이 자동 계산한 값, manual = 사장님이 날짜를 직접 고친 값.
--  - 더 이른 구매일 기준의 저장은 더 최근 구매 기준의 기존 값을 덮어쓰지 않는다(과거 판매일을 입력해 등록해도 최신 값이 유지된다).
--  - 읽기·쓰기 모두 관리자만. 연락처는 저장하지 않는다.

create table public.pet_next_due (
  pet_id bigint not null references public.pets (id) on delete cascade,
  product_id int not null references public.products (id) on delete cascade,
  due_on date not null,
  sold_on date not null,
  source text not null check (source in ('auto', 'manual')),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  primary key (pet_id, product_id),
  constraint pet_next_due_after_sale check (due_on >= sold_on)
);

alter table public.pet_next_due enable row level security;
grant select on public.pet_next_due to authenticated;
create policy pet_next_due_admin_read on public.pet_next_due for select to authenticated
  using ((select public.is_admin()));

-- 다음 알림일을 저장한다(관리자 전용). p_due_on이 null이면 그 (반려동물, 상품)의 값을 지운다(없어도 오류 아님).
create function public.rpc_set_next_due(
  p_pet_id bigint, p_product_id int, p_due_on date, p_sold_on date, p_source text
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_pet_id is null or p_product_id is null then raise exception 'pet and product are required'; end if;

  if p_due_on is null then
    delete from public.pet_next_due where pet_id = p_pet_id and product_id = p_product_id;
    return;
  end if;

  if p_sold_on is null then raise exception 'sold_on is required'; end if;
  if p_source is null or p_source not in ('auto', 'manual') then raise exception 'invalid source'; end if;
  if p_due_on < p_sold_on then raise exception 'due date is before the sale date'; end if;
  if p_due_on > p_sold_on + 3650 then raise exception 'due date is too far'; end if;
  if not exists (select 1 from public.pets where id = p_pet_id) then raise exception 'pet not found'; end if;
  if not exists (select 1 from public.products where id = p_product_id) then raise exception 'product not found'; end if;

  insert into public.pet_next_due (pet_id, product_id, due_on, sold_on, source, updated_by)
  values (p_pet_id, p_product_id, p_due_on, p_sold_on, p_source, auth.uid())
  on conflict (pet_id, product_id) do update
     set due_on = excluded.due_on, sold_on = excluded.sold_on, source = excluded.source,
         updated_at = now(), updated_by = excluded.updated_by
   where public.pet_next_due.sold_on <= excluded.sold_on;   -- 더 최근 구매 기준의 기존 값은 유지
end;
$$;

-- 로그인한 사용자만 실행할 수 있게 하고(함수 안에서도 관리자인지 다시 확인한다), 로그인하지 않은 사용자의 실행 권한은 없앤다.
revoke execute on function public.rpc_set_next_due(bigint, int, date, date, text) from public, anon;
grant execute on function public.rpc_set_next_due(bigint, int, date, date, text) to authenticated;
