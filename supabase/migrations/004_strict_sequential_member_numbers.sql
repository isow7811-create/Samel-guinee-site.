-- SAMEL-GUINEE — correction définitive de la numérotation
-- Le numéro de membre est toujours attribué séquentiellement à partir de 22.
-- L'ancien numéro de carte est conservé uniquement dans numero_carte_origine.
-- Les numéros 1 à 21 restent réservés à l'intégration manuelle.

begin;

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
  -- Ne jamais utiliser l'ancien numéro de carte comme numéro de membre.
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

revoke all on function public.insert_member_with_auto_number(jsonb, bigint)
  from public, anon, authenticated;
grant execute on function public.insert_member_with_auto_number(jsonb, bigint)
  to service_role;

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
  -- Même verrou transactionnel que la numérotation automatique :
  -- empêche deux ajouts simultanés de prendre le même numéro réservé.
  perform pg_advisory_xact_lock(824224);

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

revoke all on function public.insert_member_by_admin(jsonb, bigint)
  from public, anon, authenticated;
grant execute on function public.insert_member_by_admin(jsonb, bigint)
  to service_role;

commit;
