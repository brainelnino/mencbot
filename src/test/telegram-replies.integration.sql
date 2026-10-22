-- Transactional fixtures: no Telegram API calls; all test data rolls back.
begin;
do $$
declare sender uuid := gen_random_uuid(); recipient uuid := gen_random_uuid(); outsider uuid := gen_random_uuid();
 parent uuid := gen_random_uuid(); child uuid := gen_random_uuid(); resolved uuid; claimed record;
begin
 insert into public.members(id,telegram_user_id) values(sender,-900000001),(recipient,-900000002),(outsider,-900000003);
 insert into public.messages(id,member_id,sender_label,body,telegram_chat_message_ref)
 values(parent,sender,'11','Habari','{"message_id":77}');
 perform public.enqueue_private_message(parent);
 if exists(select 1 from public.telegram_deliveries where message_id=parent and member_id=sender) then raise exception 'Sender received their own message'; end if;
 if not exists(select 1 from public.telegram_deliveries where message_id=parent and member_id=recipient) then raise exception 'Recipient not queued'; end if;
 update public.telegram_deliveries set status='sent',telegram_message_id=88 where message_id=parent and member_id=recipient;
 resolved := public.resolve_telegram_reply(recipient,88);
 if resolved is distinct from parent then raise exception 'Delivered reply not resolved'; end if;
 if public.resolve_telegram_reply(outsider,88) is not null then raise exception 'Reply crossed private chat scope'; end if;
 if public.resolve_telegram_reply(sender,77) is distinct from parent then raise exception 'Sender original reply not resolved'; end if;
 insert into public.messages(id,member_id,sender_label,body,reply_to_id) values(child,recipient,'12','Jibu',parent);
 perform public.enqueue_private_message(child);
 -- Keep claims confined to fixtures for deterministic checks.
 update public.telegram_deliveries set status='unreachable' where message_id=child and member_id not in(sender,outsider);
 for claimed in select * from public.claim_private_deliveries_v2(child) loop
  if claimed.chat_id=-900000002 then raise exception 'Sender claimed'; end if;
  if claimed.chat_id=-900000001 and claimed.reply_message_id is distinct from 77 then raise exception 'Wrong recipient-local parent ID'; end if;
  if claimed.chat_id=-900000003 and claimed.reply_message_id is not null then raise exception 'Invented reply ID'; end if;
 end loop;
 raise notice 'PASS: sender exclusion, scoped reply resolution, original-sender mapping, fallback recipient mapping';
end $$;
rollback;