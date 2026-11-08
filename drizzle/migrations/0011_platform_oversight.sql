ALTER TABLE public.tenant_bots ALTER COLUMN vote_policy SET DEFAULT '{"text":false,"media":true}'::jsonb;
ALTER TABLE public.tenant_bots ADD COLUMN platform_suspended boolean NOT NULL DEFAULT false;
ALTER TABLE public.tenant_members ADD COLUMN last_seen_at timestamptz;
CREATE INDEX tenant_members_seen ON public.tenant_members(bot_id,last_seen_at);

CREATE TABLE public.platform_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tg_user_id bigint NOT NULL,
  bot_id uuid REFERENCES public.tenant_bots(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('idea','problem','praise')),
  body text,
  photo_file_id text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','seen')),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.platform_feedback TO authenticated;
GRANT ALL ON public.platform_feedback TO service_role;
ALTER TABLE public.platform_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads feedback" ON public.platform_feedback FOR SELECT TO authenticated USING (public.is_owner());
CREATE POLICY "owner updates feedback" ON public.platform_feedback FOR UPDATE TO authenticated USING (public.is_owner()) WITH CHECK (public.is_owner());

CREATE OR REPLACE FUNCTION public.get_platform_bots() RETURNS TABLE(id uuid, bot_username text, is_active boolean, platform_suspended boolean, created_at timestamptz, last_error text, members bigint, today bigint, week bigint, month bigint, messages bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.is_owner() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  RETURN QUERY SELECT b.id,b.bot_username,b.is_active,b.platform_suspended,b.created_at,b.last_error,
    (SELECT count(*) FROM tenant_members m WHERE m.bot_id=b.id),
    (SELECT count(*) FROM tenant_members m WHERE m.bot_id=b.id AND m.last_seen_at >= date_trunc('day', now() AT TIME ZONE 'Africa/Dar_es_Salaam') AT TIME ZONE 'Africa/Dar_es_Salaam'),
    (SELECT count(*) FROM tenant_members m WHERE m.bot_id=b.id AND m.last_seen_at >= now()-interval '7 days'),
    (SELECT count(*) FROM tenant_members m WHERE m.bot_id=b.id AND m.last_seen_at >= now()-interval '30 days'),
    (SELECT count(*) FROM tenant_messages x WHERE x.bot_id=b.id)
  FROM tenant_bots b ORDER BY b.created_at DESC;
END $$;

CREATE OR REPLACE FUNCTION public.set_bot_suspended(_bot uuid, _suspended boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.is_owner() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  UPDATE tenant_bots SET platform_suspended=_suspended, updated_at=now() WHERE id=_bot;
END $$;
REVOKE ALL ON FUNCTION public.get_platform_bots(), public.set_bot_suspended(uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_platform_bots(), public.set_bot_suspended(uuid,boolean) TO authenticated, service_role;