-- 접종·방문 기록 등록. 쓰기는 기존 패턴대로 SECURITY DEFINER 함수로만 허용한다.

create function public.rpc_add_pet_visit(p_pet_id bigint, p_visit_date date, p_record text, p_detail text default null)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_visit_id bigint;
begin
  if not public.is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_pet_id is null then raise exception 'pet_id required'; end if;
  if p_record is null or btrim(p_record) = '' then raise exception 'record required'; end if;
  if not exists (select 1 from public.pets where id = p_pet_id) then raise exception 'pet not found'; end if;
  if p_visit_date is not null and p_visit_date > (now() at time zone 'Asia/Seoul')::date then
    raise exception 'future visit date is not allowed';
  end if;

  insert into public.pet_visits (pet_id, visit_date, record, detail)
  values (p_pet_id, coalesce(p_visit_date, (now() at time zone 'Asia/Seoul')::date), btrim(p_record), nullif(btrim(p_detail), ''))
  returning id into v_visit_id;

  update public.pets
  set last_visit_on = greatest(coalesce(last_visit_on, '0001-01-01'::date), coalesce(p_visit_date, (now() at time zone 'Asia/Seoul')::date))
  where id = p_pet_id;

  return v_visit_id;
end;
$$;

grant execute on function public.rpc_add_pet_visit(bigint, date, text, text) to authenticated;
