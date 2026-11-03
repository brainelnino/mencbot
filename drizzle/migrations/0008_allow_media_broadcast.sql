create or replace function public.enqueue_private_message(_message_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare already_published boolean;
begin
 select publication_status='published' into already_published from public.messages where id=_message_id and moderation_status in ('pending','approved') and publication_status <> 'withdrawn';
 if already_published is null then raise exception 'Ujumbe hauwezi kuchapishwa'; end if;
 update public.messages set moderation_status='approved',publication_status='published',published_at=coalesce(published_at,now()),processing_status='broadcasting' where id=_message_id;
 if not already_published then
 insert into public.telegram_deliveries(message_id,member_id)
 select msg.id,m.id from public.messages msg cross join public.members m where msg.id=_message_id and m.telegram_user_id is not null and m.status='active' and m.id is distinct from msg.member_id
 on conflict(message_id,member_id) do nothing;
 end if;
end $$;
revoke execute on function public.enqueue_private_message(uuid) from public,anon,authenticated;
grant execute on function public.enqueue_private_message(uuid) to service_role;