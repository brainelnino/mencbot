ALTER TABLE public.members ADD COLUMN IF NOT EXISTS can_send_restricted boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.get_brand_name() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(nullif(trim((SELECT value #>> '{}' FROM public.system_settings WHERE key = 'brand_name')), ''), 'Live Chat bot')
$$;
GRANT EXECUTE ON FUNCTION public.get_brand_name() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_member_exempt(_member_id uuid, _exempt boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_owner() THEN RAISE EXCEPTION 'Huna ruhusa'; END IF;
  UPDATE public.members SET can_send_restricted = _exempt WHERE id = _member_id;
  INSERT INTO public.audit_events(action, target_type, details) VALUES ('member.exempt_set', 'member', jsonb_build_object('member_id', _member_id, 'exempt', _exempt));
END $$;
REVOKE ALL ON FUNCTION public.set_member_exempt(uuid, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_member_exempt(uuid, boolean) TO authenticated, service_role;