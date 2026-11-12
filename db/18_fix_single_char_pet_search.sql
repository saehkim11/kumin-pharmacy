-- 반려동물 이름이 한 글자(외자)일 때 음성/텍스트 검색이 안 되던 문제를 고친다.
-- 원인: 이름이 짧을수록 trigram 유사도(similarity) 점수가 쉽게 0.3 밑으로 떨어져서
--       정확히 같은 글자를 말해도 기준치를 못 넘기고 걸러짐. (2~3글자는 점수가 더 높게 나와 통과됨)
-- 해결: 유사도 기준을 통과 못 해도, 이름에 검색어가 그대로 포함돼 있으면("부분 일치") 결과에 포함시킨다.
create or replace function public.rpc_search_pets_by_name(p_name text)
returns table(pet_id bigint, pet_name text, species text, breed text, sex text, neutered boolean, birth_date date, last_visit_on date, owner_name_masked text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.name, p.species, p.breed, p.sex, p.neutered, p.birth_date, p.last_visit_on,
         o.name
  from public.pets p join public.owners o on o.id = p.owner_id
  where public.is_staff()
    and (
      public.similarity(p.name_normalized, lower(regexp_replace(p_name, '\s+', '', 'g'))) > 0.3
      or p.name_normalized like '%' || lower(regexp_replace(p_name, '\s+', '', 'g')) || '%'
    )
  order by public.similarity(p.name_normalized, lower(regexp_replace(p_name, '\s+', '', 'g'))) desc
  limit 20;
$$;
