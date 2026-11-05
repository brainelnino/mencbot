alter table public.office_bots drop constraint if exists office_bots_office_check;
alter table public.office_bots add constraint office_bots_office_check check (office in ('raisi','mbunge','polisi','mwenyekiti','ulinzi','jukwaa'));
insert into public.office_bots (office) values ('jukwaa') on conflict (office) do nothing;

create table public.tenant_bots (
  id uuid primary key default gen_random_uuid(),
  owner_tg_user_id bigint not null unique,
  bot_token text not null unique,
  bot_username text not null,
  webhook_secret text not null,
  welcome_message text not null default 'Karibu! Ujumbe wako unawafikia wanachama wote bila jina lako kuonekana.',
  content_policy jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.tenant_members (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.tenant_bots(id) on delete cascade,
  tg_user_id bigint not null,
  label text not null,
  status text not null default 'active' check (status in ('active','banned')),
  created_at timestamptz not null default now(),
  unique (bot_id, tg_user_id),
  unique (bot_id, label)
);
create table public.tenant_updates (
  bot_id uuid not null references public.tenant_bots(id) on delete cascade,
  update_id bigint not null,
  created_at timestamptz not null default now(),
  primary key (bot_id, update_id)
);
grant all on public.tenant_bots, public.tenant_members, public.tenant_updates to service_role;
alter table public.tenant_bots enable row level security;
alter table public.tenant_members enable row level security;
alter table public.tenant_updates enable row level security;

create or replace function public.register_tenant_member(_bot_id uuid, _tg_user_id bigint)
returns table(label text, is_new boolean) language plpgsql security definer set search_path = public as $$
declare _label text; _c text;
begin
  select m.label into _label from tenant_members m where m.bot_id = _bot_id and m.tg_user_id = _tg_user_id;
  if _label is not null then return query select _label, false; return; end if;
  perform pg_advisory_xact_lock(hashtext(_bot_id::text));
  select c into _label from (
    select g::text c, 1 o from generate_series(10,99) g
    union all select chr(g), 2 from generate_series(65,90) g
  ) s where not exists (select 1 from tenant_members m where m.bot_id = _bot_id and m.label = s.c)
  order by o, random() limit 1;
  if _label is null then
    select coalesce(max(m.label::int), 99) + 1 into _c from tenant_members m where m.bot_id = _bot_id and m.label ~ '^\d{3,}$';
    _label := _c;
  end if;
  insert into tenant_members(bot_id, tg_user_id, label) values (_bot_id, _tg_user_id, _label);
  return query select _label, true;
end $$;
revoke all on function public.register_tenant_member(uuid, bigint) from public, anon, authenticated;
grant execute on function public.register_tenant_member(uuid, bigint) to service_role;