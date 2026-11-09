-- 처음 방문하는 보호자/반려동물 등록. 같은 이름+연락처 보호자가 이미 있으면 재사용한다.

create function public.rpc_create_pet(
  p_owner_name text, p_owner_phone text,
  p_pet_name text, p_species text, p_breed text, p_sex text, p_neutered boolean,
  p_birth_date date, p_coat_color text, p_weight_kg numeric
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_owner_name text := btrim(coalesce(p_owner_name, ''));
  v_owner_phone text := nullif(regexp_replace(coalesce(p_owner_phone, ''), '\D', '', 'g'), '');
  v_pet_name text := btrim(coalesce(p_pet_name, ''));
  v_owner_id bigint;
  v_pet_id bigint;
begin
  if not public.is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_owner_name = '' then raise exception 'owner name required'; end if;
  if v_pet_name = '' then raise exception 'pet name required'; end if;
  if p_species is null or p_species not in ('dog', 'cat', 'unknown') then raise exception 'invalid species'; end if;
  if p_sex is not null and p_sex not in ('male', 'female', 'unknown') then raise exception 'invalid sex'; end if;

  select id into v_owner_id from public.owners
  where name = v_owner_name and phone is not distinct from v_owner_phone
  limit 1;

  if v_owner_id is null then
    insert into public.owners (name, phone) values (v_owner_name, v_owner_phone)
    returning id into v_owner_id;
  end if;

  insert into public.pets (owner_id, name, species, breed, sex, neutered, birth_date, coat_color, weight_kg)
  values (v_owner_id, v_pet_name, p_species, nullif(btrim(coalesce(p_breed, '')), ''),
          coalesce(p_sex, 'unknown'), p_neutered, p_birth_date,
          nullif(btrim(coalesce(p_coat_color, '')), ''), p_weight_kg)
  returning id into v_pet_id;

  return v_pet_id;
end;
$$;

grant execute on function
  public.rpc_create_pet(text, text, text, text, text, text, boolean, date, text, numeric)
to authenticated;
