create extension if not exists pgcrypto;
create table if not exists public.profiles(
 user_id uuid primary key references auth.users(id) on delete cascade,
 role text not null check(role in ('super_admin','admin')),
 created_at timestamptz not null default now()
);
create table if not exists public.member_counter(id boolean primary key default true check(id), last_number bigint not null);
insert into public.member_counter(id,last_number) values(true,21) on conflict(id) do nothing;
create table if not exists public.members(
 id uuid primary key default gen_random_uuid(),
 member_number bigint not null unique,
 nom text not null, prenom text not null, sexe text not null,
 region_ville_commune text not null, emplacement text not null,
 telephone text not null, numero_pdv text not null,
 poste_occupe text,
 numero_existant bigint unique,
 selfie_path text not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
alter table public.members enable row level security;
create policy "admins read profiles" on public.profiles for select to authenticated
 using (exists(select 1 from public.profiles p where p.user_id=auth.uid()));
create policy "admins read members" on public.members for select to authenticated
 using (exists(select 1 from public.profiles p where p.user_id=auth.uid()));
create policy "admins update members" on public.members for update to authenticated
 using (exists(select 1 from public.profiles p where p.user_id=auth.uid()))
 with check (exists(select 1 from public.profiles p where p.user_id=auth.uid()));
-- Les insertions publiques passent uniquement par la fonction Edge submit-member.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('member-selfies','member-selfies',false,5242880,array['image/jpeg','image/png','image/webp'])
 on conflict(id) do nothing;
create policy "admins read member selfies" on storage.objects for select to authenticated
 using(bucket_id='member-selfies' and exists(select 1 from public.profiles p where p.user_id=auth.uid()));

create or replace function public.allocate_member_number()
returns bigint language plpgsql security definer set search_path=public as $$
declare n bigint;
begin
 update public.member_counter set last_number=last_number+1 where id=true returning last_number into n;
 return n;
end; $$;
revoke all on function public.allocate_member_number() from public, anon, authenticated;
grant execute on function public.allocate_member_number() to service_role;
