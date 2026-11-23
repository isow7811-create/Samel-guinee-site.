-- Correction: an old card number must not be reused if it is already
-- present either as a member number or as another member's original card.
-- Keep the original number for traceability even when a new member number is assigned.

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
  legacy_number bigint;
  inserted public.members%rowtype;
begin
  legacy_number := p_requested_number;

  if legacy_number is not null
     and legacy_number >= 22
     and not exists (
       select 1 from public.members
       where member_number = legacy_number
          or numero_existant = legacy_number
          or numero_carte_origine = legacy_number
     ) then
    chosen_number := legacy_number;
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
    case
      when legacy_number is not null
       and not exists (
         select 1 from public.members
         where numero_existant = legacy_number
       )
      then legacy_number
      else null
    end,
    legacy_number,
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
