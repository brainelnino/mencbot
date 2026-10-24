create or replace function public.appoint_telegram_admin(_label text,_slot int) returns uuid language plpgsql security definer set search_path=public as $$
declare mid uuid; aid uuid;
begin
 if not public.is_owner() then raise exception 'Ni mmiliki pekee anayeruhusiwa'; end if;
 if _slot is null or _slot not between 1 and 9 then raise exception 'Nafasi iwe 1–9'; end if;
 perform pg_advisory_xact_lock(hashtext('telegram_admin_slots'));
 select p.member_id into mid from public.public_identities p join public.members m on m.id=p.member_id where p.label=upper(trim(_label)) and m.status='active' and m.telegram_user_id is not null;
 if mid is null then raise exception 'Utambulisho "%" haujapatikana au mwanachama si hai', upper(trim(_label)); end if;
 if exists (select 1 from public.telegram_admins where member_id = mid) then raise exception 'Mwanachama % tayari ni msimamizi', upper(trim(_label)); end if;
 if exists (select 1 from public.telegram_admins where admin_slot = _slot) then raise exception 'Nafasi % tayari ina msimamizi', _slot; end if;
 insert into public.telegram_admins(member_id,admin_slot) values(mid,_slot) returning id into aid;
 perform public.write_audit('telegram.admin_appointed','telegram_admin',aid::text,jsonb_build_object('label',upper(trim(_label)),'slot',_slot));
 return aid;
end $$;
revoke execute on function public.appoint_telegram_admin(text,int) from public,anon;
grant execute on function public.appoint_telegram_admin(text,int) to authenticated;