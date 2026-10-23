create table public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (message_id, member_id)
);
create index message_reactions_message on public.message_reactions(message_id);

grant select on public.message_reactions to authenticated;
grant all on public.message_reactions to service_role;

alter table public.message_reactions enable row level security;

create policy "admins read reactions" on public.message_reactions for select to authenticated using (public.is_admin());

create trigger trg_reaction_upd before update on public.message_reactions for each row execute function public.touch_updated_at();

-- Records/removes one member's reaction to a message they received on Telegram.
-- Resolves the message through the recipient-scoped delivery, so a Telegram message id
-- is only meaningful for the member who received that copy. Returns the message id or null.
create or replace function public.record_telegram_reaction(_tg_user_id bigint, _telegram_message_id bigint, _emoji text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _member_id uuid;
  _message_id uuid;
begin
  select id into _member_id from public.members where telegram_user_id = _tg_user_id;
  if _member_id is null then return null; end if;

  select d.message_id into _message_id
  from public.telegram_deliveries d
  where d.member_id = _member_id and d.telegram_message_id = _telegram_message_id and d.status = 'sent'
  order by d.sent_at desc nulls last
  limit 1;
  if _message_id is null then return null; end if;

  if _emoji is null or _emoji = '' then
    delete from public.message_reactions where message_id = _message_id and member_id = _member_id;
  else
    insert into public.message_reactions (message_id, member_id, emoji)
    values (_message_id, _member_id, _emoji)
    on conflict (message_id, member_id) do update set emoji = excluded.emoji, updated_at = now();
  end if;
  return _message_id;
end;
$$;

revoke all on function public.record_telegram_reaction(bigint, bigint, text) from public, anon, authenticated;
grant execute on function public.record_telegram_reaction(bigint, bigint, text) to service_role;

-- Aggregated reaction counts for one message (service_role only; used for Telegram summaries).
create or replace function public.get_reaction_summary(_message_id uuid)
returns table(emoji text, total bigint)
language sql
stable
security definer
set search_path = public
as $$
  select mr.emoji, count(*)::bigint as total
  from public.message_reactions mr
  where mr.message_id = _message_id
  group by mr.emoji
  order by total desc, mr.emoji
$$;

revoke all on function public.get_reaction_summary(uuid) from public, anon, authenticated;
grant execute on function public.get_reaction_summary(uuid) to service_role;

-- Aggregated reaction counts for published messages, safe for the anonymous public feed.
create or replace function public.get_public_reactions()
returns table(message_id uuid, emoji text, total bigint)
language sql
stable
security definer
set search_path = public
as $$
  select mr.message_id, mr.emoji, count(*)::bigint as total
  from public.message_reactions mr
  join public.messages m on m.id = mr.message_id
  where m.publication_status = 'published'
  group by mr.message_id, mr.emoji
  order by mr.message_id, total desc, mr.emoji
$$;

revoke all on function public.get_public_reactions() from public;
grant execute on function public.get_public_reactions() to anon, authenticated;