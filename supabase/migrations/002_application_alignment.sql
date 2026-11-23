-- SAMEL-Guinee: align the deployed schema with the current application.
-- Apply once in Supabase SQL Editor after reviewing the existing data.

alter table public.members
  add column if not exists region text,
  add column if not exists ville text,
  add column if not exists commune text,
  add column if not exists numero_carte_origine bigint;

-- Preserve the former combined location field for existing records.
update public.members
set region = coalesce(region, nullif(split_part(region_ville_commune, '/', 1), '')),
    ville = coalesce(ville, nullif(split_part(region_ville_commune, '/', 2), '')),
    commune = coalesce(commune, nullif(split_part(region_ville_commune, '/', 3), ''))
where region is null or ville is null or commune is null;

-- Keep both legacy and current card-number columns synchronized for compatibility.
update public.members
set numero_carte_origine = coalesce(numero_carte_origine, numero_existant),
    numero_existant = coalesce(numero_existant, numero_carte_origine)
where numero_carte_origine is null or numero_existant is null;

create or replace function public.is_samel_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid()
      and role in ('admin', 'super_admin')
  );
$$;

revoke all on function public.is_samel_admin() from public;
grant execute on function public.is_samel_admin() to authenticated;

drop policy if exists "admins read profiles" on public.profiles;
drop policy if exists "admins read members" on public.members;
drop policy if exists "admins update members" on public.members;
drop policy if exists "admins read member selfies" on storage.objects;

create policy "samel admins read profiles"
  on public.profiles for select to authenticated
  using (public.is_samel_admin());

create policy "samel admins read members"
  on public.members for select to authenticated
  using (public.is_samel_admin());

create policy "samel admins update members"
  on public.members for update to authenticated
  using (public.is_samel_admin())
  with check (public.is_samel_admin());

create policy "samel admins read member selfies"
  on storage.objects for select to authenticated
  using (bucket_id = 'member-selfies' and public.is_samel_admin());

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('member-selfies', 'member-selfies', false, 5242880,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
set public = false, file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg','image/png','image/webp'];

-- Allocate a new public number atomically. Numbers 1-21 stay reserved.
create or replace function public.next_samel_member_number()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  n bigint;
begin
  insert into public.member_counter(id, last_number)
  values (true, 21)
  on conflict (id) do nothing;

  select last_number into n
  from public.member_counter
  where id = true
  for update;

  select greatest(n, coalesce(max(member_number), 21))
    into n
  from public.members;

  loop
    n := n + 1;
    exit when not exists (
      select 1 from public.members where member_number = n
    );
  end loop;

  update public.member_counter set last_number = n where id = true;
  return n;
end;
$$;

revoke all on function public.next_samel_member_number() from public, anon, authenticated;
grant execute on function public.next_samel_member_number() to service_role;

-- Public registrations: reuse a requested old card number only if it is free.
create or replace function public.insert_member_with_auto_number(
  p_member jsonb,
  p_requested_number bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  chosen_number bigint;
  inserted public.members%rowtype;
begin
  if p_requested_number is not null and p_requested_number >= 22
     and not exists (select 1 from public.members where member_number = p_requested_number) then
    chosen_number := p_requested_number;
    update public.member_counter
      set last_number = greatest(last_number, chosen_number)
      where id = true;
  else
    chosen_number := public.next_samel_member_number();
  end if;

  insert into public.members(
    member_number, nom, prenom, sexe, region_ville_commune,
    region, ville, commune, emplacement, telephone, numero_pdv,
    poste_occupe, numero_existant, numero_carte_origine, selfie_path
  ) values (
    chosen_number,
    p_member->>'nom',
    p_member->>'prenom',
    p_member->>'sexe',
    concat_ws(' / ', p_member->>'region', p_member->>'ville', p_member->>'commune'),
    p_member->>'region',
    p_member->>'ville',
    p_member->>'commune',
    p_member->>'emplacement',
    p_member->>'telephone',
    p_member->>'numero_pdv',
    nullif(p_member->>'poste_occupe', ''),
    p_requested_number,
    p_requested_number,
    p_member->>'selfie_path'
  )
  returning * into inserted;

  return jsonb_build_object(
    'id', inserted.id,
    'member_number', inserted.member_number,
    'numero_carte_origine', inserted.numero_carte_origine
  );
end;
$$;

revoke all on function public.insert_member_with_auto_number(jsonb, bigint) from public, anon, authenticated;
grant execute on function public.insert_member_with_auto_number(jsonb, bigint) to service_role;

-- Manual admin insertion: explicit numbers 1-21 are reserved for legacy records.
create or replace function public.insert_member_by_admin(
  p_member jsonb,
  p_member_number bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  chosen_number bigint;
  inserted public.members%rowtype;
begin
  if p_member_number is not null then
    if p_member_number < 1 or p_member_number > 21 then
      raise exception 'Les numéros saisis manuellement doivent être compris entre 1 et 21.';
    end if;
    if exists (select 1 from public.members where member_number = p_member_number) then
      raise exception 'Ce numéro de membre est déjà utilisé.';
    end if;
    chosen_number := p_member_number;
  else
    chosen_number := public.next_samel_member_number();
  end if;

  insert into public.members(
    member_number, nom, prenom, sexe, region_ville_commune,
    region, ville, commune, emplacement, telephone, numero_pdv,
    poste_occupe, numero_existant, numero_carte_origine, selfie_path
  ) values (
    chosen_number,
    p_member->>'nom',
    p_member->>'prenom',
    p_member->>'sexe',
    concat_ws(' / ', p_member->>'region', p_member->>'ville', p_member->>'commune'),
    nullif(p_member->>'region', ''),
    nullif(p_member->>'ville', ''),
    nullif(p_member->>'commune', ''),
    nullif(p_member->>'emplacement', ''),
    p_member->>'telephone',
    p_member->>'numero_pdv',
    nullif(p_member->>'poste_occupe', ''),
    nullif(p_member->>'numero_carte_origine', '')::bigint,
    nullif(p_member->>'numero_carte_origine', '')::bigint,
    coalesce(nullif(p_member->>'selfie_path', ''), 'manual/no-selfie')
  )
  returning * into inserted;

  return jsonb_build_object('id', inserted.id, 'member_number', inserted.member_number);
end;
$$;

revoke all on function public.insert_member_by_admin(jsonb, bigint) from public, anon, authenticated;
grant execute on function public.insert_member_by_admin(jsonb, bigint) to service_role;
