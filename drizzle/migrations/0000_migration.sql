
-- ===== Enums =====
create type public.admin_permission as enum (
  'view_moderation_queue','review_images','review_reports','manage_blocked_terms',
  'manage_link_rules','manage_rate_limits','manage_restrictions','manage_members',
  'view_statistics','view_audit','manage_admins','manage_settings');
create type public.generation_kind as enum ('numeric','alpha');
create type public.member_status as enum ('active','restricted','banned');
create type public.message_kind as enum ('text','image');
create type public.moderation_status as enum ('pending','approved','rejected','flagged');
create type public.publication_status as enum ('unpublished','published','withdrawn');
create type public.restriction_kind as enum ('mute','ban','shadow_ban');

create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path=public as $$
begin new.updated_at = now(); return new; end $$;

-- ===== Identity generations =====
create table public.identity_generations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  kind public.generation_kind not null,
  range_start int,
  range_end int,
  sort_order int not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint numeric_range check (kind <> 'numeric' or (range_start is not null and range_end is not null and range_start >= 10 and range_end >= range_start))
);
create trigger trg_gen_upd before update on public.identity_generations for each row execute function public.touch_updated_at();
insert into public.identity_generations (code,label,kind,range_start,range_end,sort_order) values
 ('G1','Kizazi cha 1','numeric',10,99,1),
 ('G2','Kizazi cha 2','alpha',null,null,2),
 ('G3','Kizazi cha 3','numeric',100,199,3);

-- ===== Members (private) =====
create table public.members (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint unique,
  status public.member_status not null default 'active',
  registered_at timestamptz not null default now(),
  last_active_at timestamptz,
  updated_at timestamptz not null default now()
);
create trigger trg_mem_upd before update on public.members for each row execute function public.touch_updated_at();

create table public.public_identities (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null unique references public.members(id) on delete restrict,
  generation_id uuid not null references public.identity_generations(id),
  label text not null unique,
  numeric_value int,
  created_at timestamptz not null default now()
);
create index on public.public_identities(generation_id);

-- ===== Admins =====
create table public.admin_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  is_owner boolean not null default false,
  admin_slot int unique check (admin_slot between 1 and 9),
  display_label text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index one_owner on public.admin_accounts((true)) where is_owner;
create trigger trg_adm_upd before update on public.admin_accounts for each row execute function public.touch_updated_at();

create table public.admin_permission_grants (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.admin_accounts(id) on delete cascade,
  permission public.admin_permission not null,
  granted_at timestamptz not null default now(),
  unique (admin_id, permission)
);

-- ===== Messages & moderation =====
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references public.members(id) on delete set null,
  sender_label text not null,
  kind public.message_kind not null default 'text',
  body text check (body is null or char_length(body) <= 4000),
  image_path text,
  reply_to_id uuid references public.messages(id) on delete set null,
  moderation_status public.moderation_status not null default 'pending',
  moderation_reason text,
  publication_status public.publication_status not null default 'unpublished',
  telegram_message_id bigint,
  created_at timestamptz not null default now(),
  published_at timestamptz
);
create index on public.messages(publication_status, created_at desc);
create index on public.messages(member_id);

create table public.moderation_events (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references public.messages(id) on delete cascade,
  decision public.moderation_status not null,
  reason text,
  decided_by_admin uuid references public.admin_accounts(id) on delete set null,
  automated boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.moderation_events(created_at desc);

create table public.moderation_rules (
  id uuid primary key default gen_random_uuid(),
  rule_type text not null check (rule_type in ('link','privacy','spam','rate_limit')),
  name text not null,
  config jsonb not null default '{}'::jsonb,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_rule_upd before update on public.moderation_rules for each row execute function public.touch_updated_at();

create table public.blocked_terms (
  id uuid primary key default gen_random_uuid(),
  term text not null,
  severity text not null default 'block' check (severity in ('block','flag')),
  created_by uuid references public.admin_accounts(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index blocked_terms_lower on public.blocked_terms(lower(term));

create table public.user_restrictions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  kind public.restriction_kind not null,
  reason text,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  lifted_at timestamptz,
  created_by uuid references public.admin_accounts(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.user_restrictions(member_id);

-- ===== Images =====
create table public.image_submissions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references public.members(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  storage_path text not null,
  status public.moderation_status not null default 'pending',
  created_at timestamptz not null default now()
);
create table public.image_votes (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.image_submissions(id) on delete cascade,
  admin_id uuid not null references public.admin_accounts(id) on delete cascade,
  approve boolean not null,
  created_at timestamptz not null default now(),
  unique (submission_id, admin_id)
);
create table public.image_reviews (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.image_submissions(id) on delete cascade,
  decision public.moderation_status not null,
  reason text,
  decided_by uuid references public.admin_accounts(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ===== Config, audit, activity, insights =====
create table public.telegram_config (
  id uuid primary key default gen_random_uuid(),
  bot_username text,
  public_group_chat_id bigint,
  webhook_registered boolean not null default false,
  updated_at timestamptz not null default now()
);
create table public.system_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.system_settings(key,value) values
 ('activity_window_minutes','15'::jsonb),
 ('default_moderation','{"text":"auto","image":"manual_review","links":"block"}'::jsonb),
 ('rate_limit','{"messages_per_minute":5}'::jsonb);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_admin_id uuid references public.admin_accounts(id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.audit_events(created_at desc);
create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references public.members(id) on delete cascade,
  event_type text not null,
  created_at timestamptz not null default now()
);
create index on public.activity_events(created_at desc);
create table public.community_insights (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  distinct_members int not null default 0,
  mention_count int not null default 0,
  evidence jsonb not null default '{}'::jsonb,
  limitations text,
  status text not null default 'observed' check (status in ('observed','hypothesis','validated','dismissed')),
  period_start timestamptz,
  period_end timestamptz,
  created_at timestamptz not null default now()
);

-- ===== Authorization helpers =====
create or replace function public.current_admin_id() returns uuid language sql stable security definer set search_path=public as $$
  select id from public.admin_accounts where user_id = auth.uid() and is_active limit 1 $$;
create or replace function public.is_owner() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.admin_accounts where user_id = auth.uid() and is_owner and is_active) $$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.admin_accounts where user_id = auth.uid() and is_active) $$;
create or replace function public.has_permission(_perm public.admin_permission) returns boolean language sql stable security definer set search_path=public as $$
  select public.is_owner() or exists(
    select 1 from public.admin_permission_grants g join public.admin_accounts a on a.id=g.admin_id
    where a.user_id = auth.uid() and a.is_active and g.permission = _perm) $$;

create or replace function public.write_audit(_action text, _target_type text, _target_id text, _details jsonb)
returns void language sql security definer set search_path=public as $$
  insert into public.audit_events(actor_admin_id, action, target_type, target_id, details)
  values (public.current_admin_id(), _action, _target_type, _target_id, coalesce(_details,'{}'::jsonb)) $$;

-- Owner bootstrap: only works while no owner exists
create or replace function public.claim_ownership(_display_label text) returns uuid
language plpgsql security definer set search_path=public as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if exists(select 1 from public.admin_accounts where is_owner) then raise exception 'Owner already exists'; end if;
  if _display_label is null or char_length(trim(_display_label)) not between 1 and 12 then raise exception 'Invalid label'; end if;
  insert into public.admin_accounts(user_id, is_owner, display_label) values (auth.uid(), true, trim(_display_label)) returning id into new_id;
  insert into public.audit_events(actor_admin_id, action, target_type, target_id) values (new_id,'owner.claimed','admin_account',new_id::text);
  return new_id;
end $$;

create or replace function public.owner_exists() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.admin_accounts where is_owner) $$;

-- Identity allocation (backend / Telegram only)
create or replace function public.allocate_identity(_member_id uuid) returns text
language plpgsql security definer set search_path=public as $$
declare g record; candidate text; n int; c int;
begin
  if exists(select 1 from public.public_identities where member_id=_member_id) then
    return (select label from public.public_identities where member_id=_member_id);
  end if;
  perform pg_advisory_xact_lock(hashtext('allocate_identity'));
  for g in select * from public.identity_generations where is_active order by sort_order loop
    if g.kind = 'numeric' then
      select s into n from generate_series(g.range_start, g.range_end) s
        where s::text not in (select label from public.public_identities) order by s limit 1;
      if n is not null then
        insert into public.public_identities(member_id,generation_id,label,numeric_value) values(_member_id,g.id,n::text,n);
        return n::text;
      end if;
    else
      for c in 65..90 loop
        candidate := chr(c);
        if not exists(select 1 from public.public_identities where label=candidate) then
          insert into public.public_identities(member_id,generation_id,label) values(_member_id,g.id,candidate);
          return candidate;
        end if;
      end loop;
    end if;
  end loop;
  raise exception 'IDENTITY_RANGES_EXHAUSTED';
end $$;
revoke execute on function public.allocate_identity(uuid) from public, anon, authenticated;
grant execute on function public.allocate_identity(uuid) to service_role;
revoke execute on function public.write_audit(text,text,text,jsonb) from public, anon;

-- Public feed (no private identifiers; shadow-banned members excluded for others)
create or replace function public.get_public_messages(_limit int default 100)
returns table(id uuid, sender_label text, kind public.message_kind, body text, reply_to_id uuid, published_at timestamptz)
language sql stable security definer set search_path=public as $$
  select m.id, m.sender_label, m.kind, m.body, m.reply_to_id, coalesce(m.published_at, m.created_at)
  from public.messages m
  where m.publication_status='published' and m.moderation_status='approved'
    and not exists(select 1 from public.user_restrictions r where r.member_id=m.member_id and r.kind='shadow_ban' and r.lifted_at is null and (r.ends_at is null or r.ends_at>now()))
  order by coalesce(m.published_at, m.created_at) desc limit least(greatest(_limit,1),200) $$;
grant execute on function public.get_public_messages(int) to anon, authenticated;

create or replace function public.get_dashboard_stats() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare win int;
begin
  if not public.has_permission('view_statistics') then raise exception 'Forbidden'; end if;
  select coalesce((value)::text::int,15) into win from public.system_settings where key='activity_window_minutes';
  return jsonb_build_object(
    'members',(select count(*) from public.members),
    'active',(select count(*) from public.members where last_active_at > now() - make_interval(mins => coalesce(win,15))),
    'published',(select count(*) from public.messages where publication_status='published'),
    'pending_images',(select count(*) from public.image_submissions where status='pending'),
    'active_restrictions',(select count(*) from public.user_restrictions where lifted_at is null and (ends_at is null or ends_at>now())),
    'activity_window',coalesce(win,15));
end $$;

-- ===== Grants =====
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

-- ===== RLS =====
alter table public.identity_generations enable row level security;
alter table public.members enable row level security;
alter table public.public_identities enable row level security;
alter table public.admin_accounts enable row level security;
alter table public.admin_permission_grants enable row level security;
alter table public.messages enable row level security;
alter table public.moderation_events enable row level security;
alter table public.moderation_rules enable row level security;
alter table public.blocked_terms enable row level security;
alter table public.user_restrictions enable row level security;
alter table public.image_submissions enable row level security;
alter table public.image_votes enable row level security;
alter table public.image_reviews enable row level security;
alter table public.telegram_config enable row level security;
alter table public.system_settings enable row level security;
alter table public.audit_events enable row level security;
alter table public.activity_events enable row level security;
alter table public.community_insights enable row level security;

create policy "admins read generations" on public.identity_generations for select to authenticated using (public.is_admin());
create policy "settings managers write generations" on public.identity_generations for all to authenticated using (public.has_permission('manage_settings')) with check (public.has_permission('manage_settings'));

create policy "member managers read members" on public.members for select to authenticated using (public.has_permission('manage_members'));
create policy "member managers update members" on public.members for update to authenticated using (public.has_permission('manage_members')) with check (public.has_permission('manage_members'));
create policy "member managers read identities" on public.public_identities for select to authenticated using (public.has_permission('manage_members') or public.has_permission('view_moderation_queue'));

create policy "admins read admin accounts" on public.admin_accounts for select to authenticated using (public.is_admin());
create policy "admin managers insert admins" on public.admin_accounts for insert to authenticated with check (public.has_permission('manage_admins') and is_owner = false);
create policy "admin managers update admins" on public.admin_accounts for update to authenticated using (public.has_permission('manage_admins') and is_owner = false) with check (is_owner = false);
create policy "owner deletes admins" on public.admin_accounts for delete to authenticated using (public.is_owner() and is_owner = false);

create policy "admins read grants" on public.admin_permission_grants for select to authenticated using (public.is_admin());
create policy "owner manages grants" on public.admin_permission_grants for all to authenticated using (public.is_owner()) with check (public.is_owner());

create policy "moderators read messages" on public.messages for select to authenticated using (public.has_permission('view_moderation_queue'));
create policy "moderators update messages" on public.messages for update to authenticated using (public.has_permission('view_moderation_queue')) with check (public.has_permission('view_moderation_queue'));
create policy "moderators read mod events" on public.moderation_events for select to authenticated using (public.has_permission('view_moderation_queue'));
create policy "moderators insert mod events" on public.moderation_events for insert to authenticated with check (public.has_permission('view_moderation_queue'));

create policy "admins read rules" on public.moderation_rules for select to authenticated using (public.is_admin());
create policy "rule managers write rules" on public.moderation_rules for all to authenticated
  using (public.has_permission('manage_link_rules') or public.has_permission('manage_rate_limits'))
  with check (public.has_permission('manage_link_rules') or public.has_permission('manage_rate_limits'));

create policy "admins read terms" on public.blocked_terms for select to authenticated using (public.is_admin());
create policy "term managers write terms" on public.blocked_terms for all to authenticated using (public.has_permission('manage_blocked_terms')) with check (public.has_permission('manage_blocked_terms'));

create policy "restriction readers" on public.user_restrictions for select to authenticated using (public.has_permission('manage_restrictions') or public.has_permission('manage_members'));
create policy "restriction managers write" on public.user_restrictions for all to authenticated using (public.has_permission('manage_restrictions')) with check (public.has_permission('manage_restrictions'));

create policy "image reviewers read submissions" on public.image_submissions for select to authenticated using (public.has_permission('review_images'));
create policy "image reviewers update submissions" on public.image_submissions for update to authenticated using (public.has_permission('review_images')) with check (public.has_permission('review_images'));
create policy "image reviewers read votes" on public.image_votes for select to authenticated using (public.has_permission('review_images'));
create policy "image reviewers own vote" on public.image_votes for insert to authenticated with check (public.has_permission('review_images') and admin_id = public.current_admin_id());
create policy "image reviewers read reviews" on public.image_reviews for select to authenticated using (public.has_permission('review_images'));
create policy "image reviewers write reviews" on public.image_reviews for insert to authenticated with check (public.has_permission('review_images'));

create policy "admins read telegram config" on public.telegram_config for select to authenticated using (public.is_admin());
create policy "settings managers write telegram config" on public.telegram_config for all to authenticated using (public.has_permission('manage_settings')) with check (public.has_permission('manage_settings'));
create policy "admins read settings" on public.system_settings for select to authenticated using (public.is_admin());
create policy "settings managers write settings" on public.system_settings for all to authenticated using (public.has_permission('manage_settings')) with check (public.has_permission('manage_settings'));

create policy "auditors read audit" on public.audit_events for select to authenticated using (public.has_permission('view_audit'));
create policy "stat readers read activity" on public.activity_events for select to authenticated using (public.has_permission('view_statistics'));
create policy "stat readers read insights" on public.community_insights for select to authenticated using (public.has_permission('view_statistics'));

-- Audit triggers for privileged tables
create or replace function public.audit_row_change() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.audit_events(actor_admin_id, action, target_type, target_id, details)
  values (public.current_admin_id(), tg_table_name || '.' || lower(tg_op), tg_table_name,
          coalesce((case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end)->>'id',
                   (case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end)->>'key'), '{}'::jsonb);
  return coalesce(new, old);
end $$;
create trigger aud_admins after insert or update or delete on public.admin_accounts for each row execute function public.audit_row_change();
create trigger aud_grants after insert or delete on public.admin_permission_grants for each row execute function public.audit_row_change();
create trigger aud_terms after insert or delete on public.blocked_terms for each row execute function public.audit_row_change();
create trigger aud_rules after insert or update or delete on public.moderation_rules for each row execute function public.audit_row_change();
create trigger aud_restr after insert or update or delete on public.user_restrictions for each row execute function public.audit_row_change();
create trigger aud_settings after insert or update on public.system_settings for each row execute function public.audit_row_change();
create trigger aud_gens after insert or update or delete on public.identity_generations for each row execute function public.audit_row_change();
create trigger aud_modev after insert on public.moderation_events for each row execute function public.audit_row_change();
