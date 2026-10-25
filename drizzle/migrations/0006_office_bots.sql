create table public.office_bots (
 office text primary key check (office in ('raisi','mbunge','polisi','mwenyekiti','ulinzi')),
 bot_token text,
 bot_username text,
 webhook_secret text,
 is_active boolean not null default false,
 last_error text,
 last_update_at timestamptz,
 updated_at timestamptz not null default now()
);
grant select (office,bot_username,is_active,last_error,last_update_at,updated_at) on public.office_bots to authenticated;
grant all on public.office_bots to service_role;
alter table public.office_bots enable row level security;
create policy "owner reads office bots" on public.office_bots for select to authenticated using (public.is_owner());
insert into public.office_bots(office) values ('raisi'),('mbunge'),('polisi'),('mwenyekiti'),('ulinzi');

create table public.office_updates (
 office text not null,
 update_id bigint not null,
 created_at timestamptz not null default now(),
 primary key (office, update_id)
);
grant all on public.office_updates to service_role;
alter table public.office_updates enable row level security;

create or replace function public.office_slots(_office text) returns int[] language sql immutable set search_path=public as $$
 select case _office when 'raisi' then array[1] when 'mbunge' then array[2] when 'polisi' then array[5] when 'mwenyekiti' then array[7] when 'ulinzi' then array[3,4,6,8,9] else array[]::int[] end $$;

create or replace function public.raisi_appoint(_actor_tg bigint,_label text,_slot int) returns uuid language plpgsql security definer set search_path=public as $$
declare mid uuid; aid uuid;
begin
 if public.get_telegram_admin_slot(_actor_tg) is distinct from 1 then raise exception 'Ni Raisi pekee'; end if;
 if _slot is null or _slot not between 2 and 9 then raise exception 'Nafasi iwe 2–9'; end if;
 perform pg_advisory_xact_lock(hashtext('telegram_admin_slots'));
 select p.member_id into mid from public.public_identities p join public.members m on m.id=p.member_id where p.label=upper(trim(_label)) and m.status='active' and m.telegram_user_id is not null;
 if mid is null then raise exception 'Utambulisho % haujapatikana', upper(trim(_label)); end if;
 if exists (select 1 from public.telegram_admins where member_id=mid) then raise exception 'Mwanachama % tayari ni kiongozi', upper(trim(_label)); end if;
 if exists (select 1 from public.telegram_admins where admin_slot=_slot) then raise exception 'Nafasi % tayari ina kiongozi', _slot; end if;
 insert into public.telegram_admins(member_id,admin_slot) values(mid,_slot) returning id into aid;
 insert into public.audit_events(action,target_type,target_id,details) values('raisi.appoint','telegram_admin',aid::text,jsonb_build_object('label',upper(trim(_label)),'slot',_slot));
 return aid;
end $$;

create or replace function public.raisi_remove(_actor_tg bigint,_slot int) returns boolean language plpgsql security definer set search_path=public as $$
declare aid uuid;
begin
 if public.get_telegram_admin_slot(_actor_tg) is distinct from 1 then raise exception 'Ni Raisi pekee'; end if;
 if _slot is null or _slot not between 2 and 9 then raise exception 'Nafasi iwe 2–9'; end if;
 delete from public.telegram_admins where admin_slot=_slot returning id into aid;
 if aid is null then raise exception 'Nafasi % haina kiongozi', _slot; end if;
 insert into public.audit_events(action,target_type,target_id,details) values('raisi.remove','telegram_admin',aid::text,jsonb_build_object('slot',_slot));
 return true;
end $$;

create or replace function public.raisi_move(_actor_tg bigint,_from int,_to int) returns boolean language plpgsql security definer set search_path=public as $$
begin
 if public.get_telegram_admin_slot(_actor_tg) is distinct from 1 then raise exception 'Ni Raisi pekee'; end if;
 if _from not between 2 and 9 or _to not between 2 and 9 then raise exception 'Nafasi iwe 2–9'; end if;
 perform pg_advisory_xact_lock(hashtext('telegram_admin_slots'));
 if exists (select 1 from public.telegram_admins where admin_slot=_to) then raise exception 'Nafasi % tayari ina kiongozi', _to; end if;
 update public.telegram_admins set admin_slot=_to where admin_slot=_from;
 if not found then raise exception 'Nafasi % haina kiongozi', _from; end if;
 insert into public.audit_events(action,target_type,target_id,details) values('raisi.move','telegram_admin',_to::text,jsonb_build_object('from',_from,'to',_to));
 return true;
end $$;

create or replace function public.office_report() returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
  'members',(select count(*) from public.members where status='active'),
  'banned',(select count(*) from public.members where status='banned'),
  'messages_today',(select count(*) from public.messages where created_at > now()-interval '24 hours'),
  'leaders',(select coalesce(jsonb_agg(jsonb_build_object('slot',a.admin_slot,'label',p.label,'active',a.is_active) order by a.admin_slot),'[]'::jsonb) from public.telegram_admins a join public.public_identities p on p.member_id=a.member_id)) $$;

revoke execute on function public.raisi_appoint(bigint,text,int) from public,anon,authenticated;
revoke execute on function public.raisi_remove(bigint,int) from public,anon,authenticated;
revoke execute on function public.raisi_move(bigint,int,int) from public,anon,authenticated;
revoke execute on function public.office_report() from public,anon,authenticated;
grant execute on function public.raisi_appoint(bigint,text,int) to service_role;
grant execute on function public.raisi_remove(bigint,int) to service_role;
grant execute on function public.raisi_move(bigint,int,int) to service_role;
grant execute on function public.office_report() to service_role;