create table public.telegram_deliveries (
 id uuid primary key default gen_random_uuid(),
 message_id uuid not null references public.messages(id),
 member_id uuid not null references public.members(id),
 status text not null default 'pending' check(status in ('pending','sending','sent','failed','unreachable')),
 attempts int not null default 0,
 claimed_at timestamptz,
 sent_at timestamptz,
 telegram_message_id bigint,
 last_error text,
 unique(message_id,member_id)
);
grant select on public.telegram_deliveries to authenticated;
grant all on public.telegram_deliveries to service_role;
alter table public.telegram_deliveries enable row level security;
create policy "owner reads deliveries" on public.telegram_deliveries for select to authenticated using(public.is_owner());
create index telegram_delivery_work on public.telegram_deliveries(message_id,status);

create table public.telegram_admins (
 id uuid primary key default gen_random_uuid(),
 member_id uuid not null unique references public.members(id),
 admin_slot int not null unique check(admin_slot between 1 and 9),
 is_active boolean not null default true,
 appointed_at timestamptz not null default now()
);
grant select on public.telegram_admins to authenticated;
grant all on public.telegram_admins to service_role;
alter table public.telegram_admins enable row level security;
create policy "owner reads Telegram assistants" on public.telegram_admins for select to authenticated using(public.is_owner());

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$ select public.is_owner() $$;
create or replace function public.current_admin_id() returns uuid language sql stable security definer set search_path=public as $$ select id from public.admin_accounts where user_id=auth.uid() and is_owner and is_active limit 1 $$;
create or replace function public.has_permission(_perm public.admin_permission) returns boolean language sql stable security definer set search_path=public as $$ select public.is_owner() $$;

create or replace function public.appoint_telegram_admin(_label text,_slot int) returns uuid language plpgsql security definer set search_path=public as $$
declare mid uuid; aid uuid;
begin
 if not public.is_owner() then raise exception 'Ni mmiliki pekee anayeruhusiwa'; end if;
 if _slot is null or _slot not between 1 and 9 then raise exception 'Nafasi iwe 1–9'; end if;
 perform pg_advisory_xact_lock(hashtext('telegram_admin_slots'));
 select p.member_id into mid from public.public_identities p join public.members m on m.id=p.member_id where p.label=upper(trim(_label)) and m.status='active' and m.telegram_user_id is not null;
 if mid is null then raise exception 'Utambulisho haujapatikana au mwanachama si hai'; end if;
 insert into public.telegram_admins(member_id,admin_slot) values(mid,_slot) returning id into aid;
 perform public.write_audit('telegram.admin_appointed','telegram_admin',aid::text,jsonb_build_object('label',upper(trim(_label)),'slot',_slot));
 return aid;
end $$;
revoke execute on function public.appoint_telegram_admin(text,int) from public,anon;
grant execute on function public.appoint_telegram_admin(text,int) to authenticated;

create or replace function public.set_telegram_admin_active(_id uuid,_active boolean) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_owner() then raise exception 'Ni mmiliki pekee anayeruhusiwa'; end if;
 update public.telegram_admins set is_active=_active where id=_id;
 perform public.write_audit('telegram.admin_status','telegram_admin',_id::text,jsonb_build_object('active',_active));
end $$;
revoke execute on function public.set_telegram_admin_active(uuid,boolean) from public,anon;
grant execute on function public.set_telegram_admin_active(uuid,boolean) to authenticated;

create or replace function public.enqueue_private_message(_message_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from public.messages where id=_message_id and kind='text' and moderation_status in ('pending','approved') and publication_status <> 'withdrawn') then raise exception 'Ujumbe hauwezi kuchapishwa'; end if;
 update public.messages set moderation_status='approved', publication_status='published',published_at=coalesce(published_at,now()),processing_status='broadcasting' where id=_message_id;
 insert into public.telegram_deliveries(message_id,member_id)
 select _message_id,m.id from public.members m where m.telegram_user_id is not null and m.status='active'
 on conflict(message_id,member_id) do nothing;
end $$;
revoke execute on function public.enqueue_private_message(uuid) from public,anon,authenticated;
grant execute on function public.enqueue_private_message(uuid) to service_role;

create or replace function public.claim_private_deliveries(_message_id uuid) returns table(id uuid,chat_id bigint,body text,sender_label text) language sql security definer set search_path=public as $$
 with candidates as (
 select d.id from public.telegram_deliveries d where d.message_id=_message_id and (d.status in ('pending','failed') or (d.status='sending' and d.claimed_at < now()-interval '2 minutes')) order by d.id for update skip locked limit 6
 ), claimed as (
 update public.telegram_deliveries d set status='sending',claimed_at=now(),attempts=d.attempts+1 from candidates c where d.id=c.id returning d.id,d.member_id,d.message_id
 ) select c.id,m.telegram_user_id,msg.body,coalesce(a.admin_slot::text,msg.sender_label)
 from claimed c join public.members m on m.id=c.member_id join public.messages msg on msg.id=c.message_id left join public.telegram_admins a on a.member_id=msg.member_id and a.is_active;
$$;
revoke execute on function public.claim_private_deliveries(uuid) from public,anon,authenticated;
grant execute on function public.claim_private_deliveries(uuid) to service_role;

create or replace function public.get_telegram_admin_slot(_tg_user_id bigint) returns int language sql stable security definer set search_path=public as $$ select a.admin_slot from public.telegram_admins a join public.members m on m.id=a.member_id where m.telegram_user_id=_tg_user_id and m.status='active' and a.is_active $$;
revoke execute on function public.get_telegram_admin_slot(bigint) from public,anon,authenticated;
grant execute on function public.get_telegram_admin_slot(bigint) to service_role;

create or replace function public.telegram_admin_set_member_status(_tg_user_id bigint,_label text,_status public.member_status) returns boolean language plpgsql security definer set search_path=public as $$
declare mid uuid;
begin
 if public.get_telegram_admin_slot(_tg_user_id) is null then raise exception 'Huna ruhusa'; end if;
 if _status not in ('active','banned') then raise exception 'Hali haikubaliki'; end if;
 select member_id into mid from public.public_identities where label=upper(trim(_label));
 if mid is null then raise exception 'Utambulisho haujapatikana'; end if;
 if exists(select 1 from public.telegram_admins where member_id=mid) then raise exception 'Msimamizi hawezi kubadilishwa hapa'; end if;
 update public.members set status=_status where id=mid;
 insert into public.audit_events(action,target_type,target_id,details) values('telegram.member_status','member',mid::text,jsonb_build_object('admin_slot',public.get_telegram_admin_slot(_tg_user_id),'status',_status));
 return true;
end $$;
revoke execute on function public.telegram_admin_set_member_status(bigint,text,public.member_status) from public,anon,authenticated;
grant execute on function public.telegram_admin_set_member_status(bigint,text,public.member_status) to service_role;