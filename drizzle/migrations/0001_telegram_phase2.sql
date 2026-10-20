create table public.telegram_updates (
  update_id bigint primary key,
  update_kind text not null,
  status text not null default 'received' check (status in ('received','processed','ignored','failed')),
  error text,
  attempts int not null default 1,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
grant select on public.telegram_updates to authenticated;
grant all on public.telegram_updates to service_role;
alter table public.telegram_updates enable row level security;
create policy "owner reads telegram updates" on public.telegram_updates for select to authenticated using (public.is_owner());

alter table public.messages
  add column source_update_id bigint unique,
  add column processing_status text not null default 'received',
  add column publication_error text,
  add column publish_attempts int not null default 0,
  add column telegram_chat_message_ref jsonb;
create index on public.messages(processing_status);

alter table public.telegram_config
  add column last_update_at timestamptz,
  add column last_error text,
  add column last_error_at timestamptz,
  add column webhook_url text,
  add column group_title text,
  add column group_verified_at timestamptz,
  add column group_link_code text,
  add column group_link_expires_at timestamptz;

drop policy "admins read telegram config" on public.telegram_config;
drop policy "settings managers write telegram config" on public.telegram_config;
create policy "owner reads telegram config" on public.telegram_config for select to authenticated using (public.is_owner());

create or replace function public.register_telegram_member(_tg_user_id bigint)
returns table(member_id uuid, label text, is_new boolean)
language plpgsql security definer set search_path=public as $$
declare mid uuid; created boolean := false;
begin
  insert into public.members(telegram_user_id) values (_tg_user_id)
    on conflict (telegram_user_id) do nothing returning id into mid;
  if mid is not null then created := true;
  else select id into mid from public.members where telegram_user_id=_tg_user_id; end if;
  update public.members set last_active_at = now() where id = mid;
  insert into public.activity_events(member_id, event_type) values (mid, case when created then 'registered' else 'start_repeat' end);
  return query select mid, public.allocate_identity(mid), created;
end $$;
revoke execute on function public.register_telegram_member(bigint) from public, anon, authenticated;
grant execute on function public.register_telegram_member(bigint) to service_role;

insert into public.telegram_config(id) select gen_random_uuid() where not exists (select 1 from public.telegram_config);