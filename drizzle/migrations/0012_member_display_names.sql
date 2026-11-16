-- Member-chosen display names for the single-bot Beta live chat.
-- Telegram identifiers remain server-only and are never returned by these RPCs.
ALTER TABLE public.members
  ADD COLUMN display_name text,
  ADD COLUMN display_name_set_at timestamptz,
  ADD COLUMN display_name_visible boolean NOT NULL DEFAULT true;

INSERT INTO public.system_settings(key, value)
VALUES ('display_names_enabled', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Do not let authenticated dashboard users bypass the owner-only RPCs by
-- writing these fields through the broad members UPDATE grant.
REVOKE UPDATE (display_name, display_name_set_at, display_name_visible)
  ON public.members FROM authenticated;

CREATE OR REPLACE FUNCTION public.set_member_display_name(_tg_user_id bigint, _display_name text)
RETURNS TABLE(identity_label text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  clean_name text;
  mid uuid;
  enabled boolean;
BEGIN
  clean_name := regexp_replace(trim(coalesce(_display_name, '')), '\s+', ' ', 'g');
  IF char_length(clean_name) NOT BETWEEN 2 AND 24
     OR clean_name ~ '[[:cntrl:]<>]' THEN
    RAISE EXCEPTION 'Jina liwe herufi 2 hadi 24; alama za HTML haziruhusiwi';
  END IF;

  SELECT coalesce((value #>> '{}')::boolean, true)
    INTO enabled FROM public.system_settings WHERE key = 'display_names_enabled';
  IF NOT coalesce(enabled, true) THEN
    RAISE EXCEPTION 'Kubadili majina kumezimwa kwa sasa';
  END IF;

  SELECT id INTO mid FROM public.members
    WHERE telegram_user_id = _tg_user_id AND status = 'active' FOR UPDATE;
  IF mid IS NULL THEN RAISE EXCEPTION 'Tuma /start kwanza'; END IF;

  IF EXISTS (SELECT 1 FROM public.members WHERE id = mid AND display_name_set_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Jina linaweza kubadilishwa mara moja tu';
  END IF;

  UPDATE public.members SET display_name = clean_name, display_name_set_at = now()
    WHERE id = mid;
  UPDATE public.messages msg SET sender_label = clean_name
    FROM public.public_identities pi WHERE msg.member_id = mid AND pi.member_id = mid;

  RETURN QUERY
    SELECT pi.label FROM public.public_identities pi WHERE pi.member_id = mid;
END $$;
REVOKE ALL ON FUNCTION public.set_member_display_name(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_member_display_name(bigint, text) TO service_role;

CREATE OR REPLACE FUNCTION public.owner_set_display_names_enabled(_enabled boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_owner() THEN RAISE EXCEPTION 'Huna ruhusa'; END IF;
  INSERT INTO public.system_settings(key, value, updated_at)
    VALUES ('display_names_enabled', to_jsonb(_enabled), now())
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now();
  INSERT INTO public.audit_events(action, target_type, details)
    VALUES ('member.display_names_global', 'settings', jsonb_build_object('enabled', _enabled));
END $$;
REVOKE ALL ON FUNCTION public.owner_set_display_names_enabled(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_set_display_names_enabled(boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.owner_set_member_name_visible(_label text, _visible boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE mid uuid;
BEGIN
  IF NOT public.is_owner() THEN RAISE EXCEPTION 'Huna ruhusa'; END IF;
  SELECT member_id INTO mid FROM public.public_identities WHERE label = upper(trim(_label));
  IF mid IS NULL THEN RAISE EXCEPTION 'Utambulisho haujapatikana'; END IF;
  UPDATE public.members SET display_name_visible = _visible WHERE id = mid;
  INSERT INTO public.audit_events(action, target_type, target_id, details)
    VALUES ('member.display_name_visibility', 'member', _label,
      jsonb_build_object('visible', _visible));
END $$;
REVOKE ALL ON FUNCTION public.owner_set_member_name_visible(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_set_member_name_visible(text, boolean) TO authenticated, service_role;

-- Public feed resolves names at read time so a global/per-member hide takes
-- effect immediately without rewriting old messages.
CREATE OR REPLACE FUNCTION public.get_public_messages(_limit int default 100)
RETURNS TABLE(id uuid, sender_label text, kind public.message_kind, body text, reply_to_id uuid, published_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT m.id,
    CASE
      WHEN m.member_id IS NOT NULL AND coalesce((SELECT (value #>> '{}')::boolean
        FROM public.system_settings WHERE key = 'display_names_enabled'), true)
        AND mem.display_name_visible AND nullif(trim(mem.display_name), '') IS NOT NULL
      THEN mem.display_name
      WHEN m.member_id IS NOT NULL THEN coalesce(pi.label, m.sender_label)
      ELSE m.sender_label
    END,
    m.kind, m.body, m.reply_to_id, coalesce(m.published_at, m.created_at)
  FROM public.messages m
  LEFT JOIN public.members mem ON mem.id = m.member_id
  LEFT JOIN public.public_identities pi ON pi.member_id = m.member_id
  WHERE m.publication_status = 'published' AND m.moderation_status = 'approved'
    AND NOT EXISTS (
      SELECT 1 FROM public.user_restrictions r WHERE r.member_id = m.member_id
        AND r.kind = 'shadow_ban' AND r.lifted_at IS NULL
        AND (r.ends_at IS NULL OR r.ends_at > now())
    )
  ORDER BY coalesce(m.published_at, m.created_at) DESC
  LIMIT least(greatest(_limit, 1), 200)
$$;
GRANT EXECUTE ON FUNCTION public.get_public_messages(int) TO anon, authenticated;

-- Keep stored message labels in sync for newly delivered Telegram copies too.
UPDATE public.messages msg
SET sender_label = mem.display_name
FROM public.members mem
JOIN public.public_identities pi ON pi.member_id = mem.id
WHERE msg.member_id = mem.id
  AND mem.display_name IS NOT NULL
  AND mem.display_name_visible
  AND coalesce((SELECT (value #>> '{}')::boolean FROM public.system_settings WHERE key='display_names_enabled'), true);

CREATE OR REPLACE FUNCTION public.owner_set_display_names_enabled(_enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.is_owner() THEN RAISE EXCEPTION 'Huna ruhusa'; END IF;
  INSERT INTO public.system_settings(key,value,updated_at)
    VALUES ('display_names_enabled',to_jsonb(_enabled),now())
    ON CONFLICT (key) DO UPDATE SET value=excluded.value,updated_at=now();
  UPDATE public.messages msg SET sender_label =
    CASE WHEN _enabled AND mem.display_name_visible AND mem.display_name IS NOT NULL
      THEN mem.display_name ELSE pi.label END
  FROM public.members mem JOIN public.public_identities pi ON pi.member_id=mem.id
  WHERE msg.member_id=mem.id;
  INSERT INTO public.audit_events(action,target_type,details)
    VALUES ('member.display_names_global','settings',jsonb_build_object('enabled',_enabled));
END $$;

CREATE OR REPLACE FUNCTION public.owner_set_member_name_visible(_label text,_visible boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE mid uuid;
DECLARE enabled boolean;
BEGIN
  IF NOT public.is_owner() THEN RAISE EXCEPTION 'Huna ruhusa'; END IF;
  SELECT member_id INTO mid FROM public.public_identities WHERE label=upper(trim(_label));
  IF mid IS NULL THEN RAISE EXCEPTION 'Utambulisho haujapatikana'; END IF;
  UPDATE public.members SET display_name_visible=_visible WHERE id=mid;
  SELECT coalesce((value #>> '{}')::boolean,true) INTO enabled
    FROM public.system_settings WHERE key='display_names_enabled';
  UPDATE public.messages msg SET sender_label =
    CASE WHEN coalesce(enabled,true) AND _visible AND mem.display_name IS NOT NULL
      THEN mem.display_name ELSE pi.label END
  FROM public.members mem JOIN public.public_identities pi ON pi.member_id=mem.id
  WHERE msg.member_id=mid AND mem.id=mid;
  INSERT INTO public.audit_events(action,target_type,target_id,details)
    VALUES ('member.display_name_visibility','member',_label,jsonb_build_object('visible',_visible));
END $$;

-- Enforce protected identity fields even though authenticated admins have
-- broad UPDATE rights on members for unrelated moderation settings.
CREATE OR REPLACE FUNCTION public.guard_member_display_name_fields()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF current_user NOT IN ('postgres', 'service_role')
     AND (NEW.display_name IS DISTINCT FROM OLD.display_name
       OR NEW.display_name_set_at IS DISTINCT FROM OLD.display_name_set_at
       OR NEW.display_name_visible IS DISTINCT FROM OLD.display_name_visible) THEN
    RAISE EXCEPTION 'Tumia vitendo maalumu vya utambulisho';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_guard_member_display_name_fields
BEFORE UPDATE ON public.members
FOR EACH ROW EXECUTE FUNCTION public.guard_member_display_name_fields();
