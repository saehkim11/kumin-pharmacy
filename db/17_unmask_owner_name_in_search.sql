-- 반려동물 이름으로 검색했을 때 나오는 목록에서 보호자 이름이 성만 보이던 것을 없애고 전체 이름을 보여준다.
-- (상세보기 화면은 이미 전체 이름을 보여주고 있었음 — 검색 결과 목록만 가려져 있던 문제)
create or replace function public.rpc_search_pets_by_name(p_name text)
returns table(pet_id bigint, pet_name text, species text, breed text, sex text, neutered boolean, birth_date date, last_visit_on date, owner_name_masked text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.name, p.species, p.breed, p.sex, p.neutered, p.birth_date, p.last_visit_on,
         o.name
  from public.pets p join public.owners o on o.id = p.owner_id
  where public.is_staff()
    and public.similarity(p.name_normalized, lower(regexp_replace(p_name, '\s+', '', 'g'))) > 0.3
  order by public.similarity(p.name_normalized, lower(regexp_replace(p_name, '\s+', '', 'g'))) desc
  limit 20;
$$;
