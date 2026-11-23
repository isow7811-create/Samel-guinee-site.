-- SAMEL-GUINEE — migration de mise en coherence de la base
-- A executer une seule fois dans Supabase > SQL Editor.
-- Les numeros de membre 1 a 21 restent reserves a l'integration manuelle.
-- Toute nouvelle inscription publique recoit le premier numero libre a partir de 22.
-- L'ancien numero de carte est conserve separement dans numero_carte_origine.

begin;

alter table public.members
  add column if not exists region text,
  add column if not exists ville text,
  add column if not exists commune text,
  add column if not exists numero_carte_origine bigint;

-- Reconstituer Region / Ville / Commune depuis l'ancien champ combine.
update public.members
set
  region = coalesce(region, nullif(btrim(split_part(region_ville_commune, '/', 1)), '')),
  ville = coalesce(ville, nullif(btrim(split_part(region_ville_commune, '/', 2)), '')),
  commune = coalesce(commune, nullif(btrim(split_part(region_ville_commune, '/', 3)), ''))
where region is null or ville is null or commune is null;

-- Reprendre les anciens numeros deja stockes.
update public.members
set numero_carte_origine = coalesce(numero_carte_origine, numero_existant)
where numero_carte_origine is null and numero_existant is not null;

-- numero_existant / numero_carte_origine representent l'ancien numero de carte,
-- pas le numero de membre. Plusieurs membres peuvent avoir une ancienne reference identique.
do $$
declare c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_attribute a
      on a.attrelid = con.conrelid
     and a.attnum = any(con.conkey)
    where con.conrelid = 'public.members'::regclass
      and con.contype = 'u'
      and a.attname = 'numero_existant'
  loop
    execute format('alter table public.members drop constraint %I', c.conname);
  end loop;
end $$;

-- Garder numero_existant synchronise pour compatibilite avec les anciennes versions.
update public.members
set numero_existant = numero_carte_origine
where numero_existant is distinct from numero_carte_origine;

-- Controle d'acces administrateur sans recursion RLS sur profiles.
create or replace function public.is_samel_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where user_id = auth.uid()
      and role in ('admin', 'super_admin')
  );
$$;

revoke all on function public.is_samel_admin() from public, anon;
grant execute on function public.is_samel_admin() to authenticated;

drop policy if exists "admins read profiles" on public.profiles;
drop policy if exists "admins read members" on public.members;
drop policy if exists "admins update members" on public.members;
drop policy if exists "admins read member selfies" on storage.objects;
drop policy if exists "samel admins read profiles" on public.profiles;
drop policy if exists "samel admins read members" on public.members;
drop policy if exists "samel admins update members" on public.members;
drop policy if exists "samel admins read member selfies" on storage.objects;

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
set public = false,
    file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg','image/png','image/webp'];

-- Allocation atomique du premier numero de membre libre a partir de 22.
create or replace function public.next_samel_member_number()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate bigint := 22;
begin
  insert into public.member_counter(id, last_number)
  values (true, 21)
  on conflict (id) do nothing;

  perform 1
  from public.member_counter
  where id = true
  for update;

  loop
    exit when not exists (
      select 1 from public.members where member_number = candidate
    );
    candidate := candidate + 1;
  end loop;

  update public.member_counter
  set last_number = greatest(last_number, candidate)
  where id = true;

  return candidate;
end;
$$;

revoke all on function public.next_samel_member_number() from public, anon, authenticated;
grant execute on function public.next_samel_member_number() to service_role;

-- Inscription publique : le numero membre est toujours genere a partir de 22.
-- L'ancien numero de carte est conserve dans numero_carte_origine / numero_existant.
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
  old_card_number bigint := p_requested_number;
  inserted public.members%rowtype;
begin
  if old_card_number is not null and old_card_number < 22 then
    raise exception 'Les anciens numeros de carte de 1 a 21 sont reserves.';
  end if;

  chosen_number := public.next_samel_member_number();

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
    coalesce(p_member->>'emplacement', ''),
    p_member->>'telephone',
    p_member->>'numero_pdv',
    nullif(p_member->>'poste_occupe', ''),
    old_card_number,
    old_card_number,
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

-- Ajout manuel par un administrateur : seuls les numeros 1 a 21 peuvent etre saisis.
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
  old_card_number bigint := nullif(p_member->>'numero_carte_origine', '')::bigint;
  inserted public.members%rowtype;
begin
  if p_member_number is not null then
    if p_member_number < 1 or p_member_number > 21 then
      raise exception 'La saisie manuelle du numero membre est reservee aux numeros 1 a 21.';
    end if;
    if exists (select 1 from public.members where member_number = p_member_number) then
      raise exception 'Ce numero de membre est deja utilise.';
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
    coalesce(nullif(p_member->>'emplacement', ''), ''),
    p_member->>'telephone',
    p_member->>'numero_pdv',
    nullif(p_member->>'poste_occupe', ''),
    old_card_number,
    old_card_number,
    coalesce(nullif(p_member->>'selfie_path', ''), 'manual/no-selfie')
  )
  returning * into inserted;

  return jsonb_build_object(
    'id', inserted.id,
    'member_number', inserted.member_number,
    'numero_carte_origine', inserted.numero_carte_origine
  );
end;
$$;

revoke all on function public.insert_member_by_admin(jsonb, bigint) from public, anon, authenticated;
grant execute on function public.insert_member_by_admin(jsonb, bigint) to service_role;

commit;
