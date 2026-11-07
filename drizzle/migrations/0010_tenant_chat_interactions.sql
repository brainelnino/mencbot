ALTER TABLE public.tenant_bots ADD COLUMN blocked_words text[] NOT NULL DEFAULT '{}', ADD COLUMN vote_policy jsonb NOT NULL DEFAULT '{"text":true,"media":true}';
CREATE TABLE public.tenant_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bot_id uuid NOT NULL REFERENCES public.tenant_bots(id) ON DELETE CASCADE,
 update_id bigint NOT NULL, sender_id uuid NOT NULL REFERENCES public.tenant_members(id) ON DELETE CASCADE,
 sender_label text NOT NULL, body text, media text, metadata_notice text, source_chat_id bigint NOT NULL, source_message_id bigint NOT NULL,
 reply_id uuid REFERENCES public.tenant_messages(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(bot_id,update_id)
);
GRANT ALL ON public.tenant_messages TO service_role;
ALTER TABLE public.tenant_messages ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.tenant_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), message_id uuid NOT NULL REFERENCES public.tenant_messages(id) ON DELETE CASCADE,
 member_id uuid NOT NULL REFERENCES public.tenant_members(id) ON DELETE CASCADE, tg_message_id bigint,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent')), claimed_at timestamptz,
 UNIQUE(message_id,member_id)
);
GRANT ALL ON public.tenant_deliveries TO service_role;
ALTER TABLE public.tenant_deliveries ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.tenant_reactions (
 message_id uuid NOT NULL REFERENCES public.tenant_messages(id) ON DELETE CASCADE,
 member_id uuid NOT NULL REFERENCES public.tenant_members(id) ON DELETE CASCADE, emoji text NOT NULL,
 PRIMARY KEY(message_id,member_id)
);
GRANT ALL ON public.tenant_reactions TO service_role;
ALTER TABLE public.tenant_reactions ENABLE ROW LEVEL SECURITY;
CREATE INDEX tenant_delivery_scope ON public.tenant_deliveries(member_id,tg_message_id);
CREATE OR REPLACE FUNCTION public.tenant_owner_action(_bot_id uuid,_actor bigint,_action text,_value text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b public.tenant_bots; result jsonb;
BEGIN
 SELECT * INTO b FROM public.tenant_bots WHERE id=_bot_id AND owner_tg_user_id=_actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Not authorized'; END IF;
 IF _action='words' THEN
   IF length(_value)>2000 THEN RAISE EXCEPTION 'Too many words'; END IF;
   UPDATE public.tenant_bots SET blocked_words=ARRAY(SELECT DISTINCT trim(w) FROM unnest(string_to_array(_value,',')) w WHERE trim(w)<>''),updated_at=now() WHERE id=b.id;
 ELSIF _action IN ('ban','restore') THEN
   UPDATE public.tenant_members SET status=CASE WHEN _action='ban' THEN 'banned' ELSE 'active' END WHERE bot_id=b.id AND label=upper(trim(_value)) AND tg_user_id<>_actor;
   IF NOT FOUND THEN RAISE EXCEPTION 'Member not found'; END IF;
 ELSIF _action='votes_text' OR _action='votes_media' THEN
   UPDATE public.tenant_bots SET vote_policy=jsonb_set(vote_policy,ARRAY[CASE WHEN _action='votes_text' THEN 'text' ELSE 'media' END],to_jsonb(NOT coalesce((vote_policy->>CASE WHEN _action='votes_text' THEN 'text' ELSE 'media' END)::boolean,true))),updated_at=now() WHERE id=b.id;
 ELSIF _action<>'read' THEN RAISE EXCEPTION 'Unknown action'; END IF;
 SELECT jsonb_build_object('blocked_words',blocked_words,'vote_policy',vote_policy,'members',coalesce((SELECT jsonb_agg(jsonb_build_object('label',CASE WHEN m.tg_user_id=_actor THEN 'Admin' ELSE m.label END,'status',m.status)) FROM public.tenant_members m WHERE m.bot_id=b.id),'[]'::jsonb)) INTO result FROM public.tenant_bots WHERE id=b.id;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.enqueue_tenant_message(_bot_id uuid,_user bigint,_update bigint,_source_message bigint,_body text,_media text DEFAULT NULL,_reply bigint DEFAULT NULL,_metadata text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE m public.tenant_members; b public.tenant_bots; msg uuid; replied uuid;
BEGIN
 SELECT * INTO b FROM public.tenant_bots WHERE id=_bot_id AND is_active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Bot inactive'; END IF;
 SELECT id INTO msg FROM public.tenant_messages WHERE bot_id=_bot_id AND update_id=_update;
 IF msg IS NOT NULL THEN RETURN msg; END IF;
 SELECT * INTO m FROM public.tenant_members WHERE bot_id=_bot_id AND tg_user_id=_user AND status='active';
 IF NOT FOUND THEN RAISE EXCEPTION 'Member not active'; END IF;
 IF _reply IS NOT NULL THEN
   SELECT x.id INTO replied FROM public.tenant_messages x WHERE x.bot_id=_bot_id AND ((x.sender_id=m.id AND x.source_message_id=_reply) OR EXISTS(SELECT 1 FROM public.tenant_deliveries d WHERE d.message_id=x.id AND d.member_id=m.id AND d.tg_message_id=_reply AND d.state='sent')) LIMIT 1;
 END IF;
 INSERT INTO public.tenant_messages(bot_id,update_id,sender_id,sender_label,body,media,metadata_notice,source_chat_id,source_message_id,reply_id)
 VALUES(_bot_id,_update,m.id,CASE WHEN b.owner_tg_user_id=_user THEN 'Admin' ELSE m.label END,_body,_media,_metadata,_user,_source_message,replied) RETURNING id INTO msg;
 INSERT INTO public.tenant_deliveries(message_id,member_id) SELECT msg,id FROM public.tenant_members WHERE bot_id=_bot_id AND status='active' AND id<>m.id;
 RETURN msg;
END $$;
CREATE OR REPLACE FUNCTION public.claim_tenant_deliveries(_message uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ids uuid[]; result jsonb;
BEGIN
 SELECT array_agg(id) INTO ids FROM(SELECT d.id FROM public.tenant_deliveries d JOIN public.tenant_members m ON m.id=d.member_id WHERE d.message_id=_message AND m.status='active' AND (d.state='pending' OR (d.state='sending' AND d.claimed_at<now()-interval '2 minutes')) ORDER BY d.id LIMIT 6 FOR UPDATE OF d SKIP LOCKED) q;
 UPDATE public.tenant_deliveries SET state='sending',claimed_at=now() WHERE id=ANY(ids);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'chat_id',m.tg_user_id,'reply_message_id',CASE WHEN r.sender_id=m.id THEN r.source_message_id ELSE rd.tg_message_id END)),'[]'::jsonb) INTO result
 FROM public.tenant_deliveries d JOIN public.tenant_members m ON m.id=d.member_id JOIN public.tenant_messages x ON x.id=d.message_id LEFT JOIN public.tenant_messages r ON r.id=x.reply_id LEFT JOIN public.tenant_deliveries rd ON rd.message_id=r.id AND rd.member_id=m.id AND rd.state='sent' WHERE d.id=ANY(ids);
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.react_tenant_message(_bot_id uuid,_user bigint,_message bigint,_emoji text,_toggle boolean,_update bigint) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE member uuid; msg uuid; previous text; media_kind text; p jsonb;
BEGIN
 SELECT id INTO member FROM public.tenant_members WHERE bot_id=_bot_id AND tg_user_id=_user AND status='active';
 IF member IS NULL THEN RETURN NULL; END IF;
 SELECT x.id,x.media INTO msg,media_kind FROM public.tenant_messages x WHERE x.bot_id=_bot_id AND EXISTS(SELECT 1 FROM public.tenant_deliveries d WHERE d.message_id=x.id AND d.member_id=member AND d.tg_message_id=_message AND d.state='sent') LIMIT 1;
 IF msg IS NULL THEN RETURN NULL; END IF;
 SELECT vote_policy INTO p FROM public.tenant_bots WHERE id=_bot_id;
 IF _toggle AND NOT coalesce((p->>CASE WHEN media_kind IS NULL THEN 'text' ELSE 'media' END)::boolean,true) THEN RETURN NULL; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(msg::text));
 INSERT INTO public.tenant_updates(bot_id,update_id) VALUES(_bot_id,_update) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN msg; END IF;
 SELECT emoji INTO previous FROM public.tenant_reactions WHERE message_id=msg AND member_id=member;
 IF _emoji IS NULL OR (_toggle AND previous=_emoji) THEN DELETE FROM public.tenant_reactions WHERE message_id=msg AND member_id=member;
 ELSE INSERT INTO public.tenant_reactions(message_id,member_id,emoji) VALUES(msg,member,left(_emoji,32)) ON CONFLICT(message_id,member_id) DO UPDATE SET emoji=excluded.emoji; END IF;
 RETURN msg;
END $$;
REVOKE ALL ON FUNCTION public.tenant_owner_action(uuid,bigint,text,text), public.enqueue_tenant_message(uuid,bigint,bigint,bigint,text,text,bigint,text), public.claim_tenant_deliveries(uuid), public.react_tenant_message(uuid,bigint,bigint,text,boolean,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_owner_action(uuid,bigint,text,text), public.enqueue_tenant_message(uuid,bigint,bigint,bigint,text,text,bigint,text), public.claim_tenant_deliveries(uuid), public.react_tenant_message(uuid,bigint,bigint,text,boolean,bigint) TO service_role;