-- SAMEL-GUINEE — alignement sur la structure REELLE de public.members
-- Migration adaptee aux colonnes existantes : id, member_number, nom, prenom,
-- sexe, telephone, numero_pdv, region, ville, commune, emplacement,
-- poste_occupe, selfie_path, created_by, created_at, numero_carte_origine.
-- Les numeros de membre 1 a 21 restent reserves a l'ajout manuel.
-- Les inscriptions publiques recoivent le premier numero libre a partir de 22.
-- L'ancien numero de carte est conserve separement, sans restriction de valeur.

begin;

alter table public.members
  add column if not exists region text,
  add column if not exists ville text,
  add column if not exists commune text,
  add column if not exists numero_carte_origine bigint;

create table if not exists public.member_counter (
  id boolean primary key default true check (id),
  last_number bigint not null default 21
);

insert into public.member_counter(id, last_number)
values (true, 21)
on conflict (id) do nothing;

-- Fonction d'autorisation administrateur sans recursion RLS.
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

-- Attribution atomique : premier numero libre a partir de 22.
create or replace function public.next_samel_member_number()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate bigint := 22;
begin
  perform pg_advisory_xact_lock(824224);

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

-- Inscription publique : le numero membre est genere par le serveur.
-- p_requested_number correspond uniquement a l'ancien numero de carte.
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
  chosen_number := public.next_samel_member_number();

  insert into public.members (
    member_number, nom, prenom, sexe, telephone, numero_pdv,
    region, ville, commune, emplacement, poste_occupe,
    selfie_path, numero_carte_origine
  ) values (
    chosen_number,
    p_member->>'nom',
    p_member->>'prenom',
    p_member->>'sexe',
    p_member->>'telephone',
    p_member->>'numero_pdv',
    nullif(p_member->>'region', ''),
    nullif(p_member->>'ville', ''),
    nullif(p_member->>'commune', ''),
    nullif(p_member->>'emplacement', ''),
    nullif(p_member->>'poste_occupe', ''),
    nullif(p_member->>'selfie_path', ''),
    p_requested_number
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

-- Ajout administratif : numeros 1 a 21 saisis manuellement.
-- Sans numero manuel, attribution automatique a partir de 22.
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

    if exists (
      select 1 from public.members where member_number = p_member_number
    ) then
      raise exception 'Ce numero de membre est deja utilise.';
    end if;

    chosen_number := p_member_number;
  else
    chosen_number := public.next_samel_member_number();
  end if;

  insert into public.members (
    member_number, nom, prenom, sexe, telephone, numero_pdv,
    region, ville, commune, emplacement, poste_occupe,
    selfie_path, numero_carte_origine
  ) values (
    chosen_number,
    p_member->>'nom',
    p_member->>'prenom',
    p_member->>'sexe',
    p_member->>'telephone',
    p_member->>'numero_pdv',
    nullif(p_member->>'region', ''),
    nullif(p_member->>'ville', ''),
    nullif(p_member->>'commune', ''),
    nullif(p_member->>'emplacement', ''),
    nullif(p_member->>'poste_occupe', ''),
    coalesce(nullif(p_member->>'selfie_path', ''), 'manual/no-selfie'),
    old_card_number
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
