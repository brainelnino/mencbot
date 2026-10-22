create or replace function public.enqueue_private_message(_message_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare already_published boolean;
begin
 select publication_status='published' into already_published from public.messages where id=_message_id and kind='text' and moderation_status in ('pending','approved') and publication_status <> 'withdrawn';
 if already_published is null then raise exception 'Ujumbe hauwezi kuchapishwa'; end if;
 update public.messages set moderation_status='approved',publication_status='published',published_at=coalesce(published_at,now()),processing_status='broadcasting' where id=_message_id;
 if not already_published then
 insert into public.telegram_deliveries(message_id,member_id)
 select msg.id,m.id from public.messages msg cross join public.members m where msg.id=_message_id and m.telegram_user_id is not null and m.status='active' and m.id is distinct from msg.member_id
 on conflict(message_id,member_id) do nothing;
 end if;
end $$;

create or replace function public.resolve_telegram_reply(_member_id uuid,_telegram_message_id bigint) returns uuid language sql stable security definer set search_path=public as $$
 select msg.id from public.messages msg where msg.publication_status='published' and (
 exists(select 1 from public.telegram_deliveries d where d.message_id=msg.id and d.member_id=_member_id and d.telegram_message_id=_telegram_message_id and d.status='sent')
 or (msg.member_id=_member_id and (msg.telegram_chat_message_ref->>'message_id')::bigint=_telegram_message_id)
 ) order by msg.created_at desc limit 1
$$;
revoke execute on function public.resolve_telegram_reply(uuid,bigint) from public,anon,authenticated;
grant execute on function public.resolve_telegram_reply(uuid,bigint) to service_role;

create or replace function public.claim_private_deliveries_v2(_message_id uuid) returns table(id uuid,chat_id bigint,body text,sender_label text,reply_message_id bigint,reply_label text,reply_body text) language sql security definer set search_path=public as $$
 with candidates as (
 select d.id from public.telegram_deliveries d join public.messages msg on msg.id=d.message_id join public.members m on m.id=d.member_id
 where d.message_id=_message_id and d.member_id is distinct from msg.member_id and m.status='active'
 and (d.status in ('pending','failed') or (d.status='sending' and d.claimed_at < now()-interval '2 minutes'))
 order by d.id for update of d skip locked limit 6
 ), claimed as (
 update public.telegram_deliveries d set status='sending',claimed_at=now(),attempts=d.attempts+1 from candidates c where d.id=c.id returning d.id,d.member_id,d.message_id
 ) select c.id,m.telegram_user_id,msg.body,coalesce(a.admin_slot::text,msg.sender_label),
 coalesce(parent_delivery.telegram_message_id,case when parent.member_id=c.member_id then (parent.telegram_chat_message_ref->>'message_id')::bigint end),
 coalesce(pa.admin_slot::text,parent.sender_label),parent.body
 from claimed c join public.members m on m.id=c.member_id join public.messages msg on msg.id=c.message_id
 left join public.telegram_admins a on a.member_id=msg.member_id and a.is_active
 left join public.messages parent on parent.id=msg.reply_to_id and parent.publication_status='published' and parent.moderation_status='approved'
 left join public.telegram_admins pa on pa.member_id=parent.member_id and pa.is_active
 left join public.telegram_deliveries parent_delivery on parent_delivery.message_id=parent.id and parent_delivery.member_id=c.member_id and parent_delivery.status='sent';
$$;
revoke execute on function public.claim_private_deliveries_v2(uuid) from public,anon,authenticated;
grant execute on function public.claim_private_deliveries_v2(uuid) to service_role;
create index telegram_reply_lookup on public.telegram_deliveries(member_id,telegram_message_id) where status='sent';
comment on function public.claim_private_deliveries(uuid) is 'DEPRECATED: replaced by claim_private_deliveries_v2 with sender exclusion and recipient-local reply references';