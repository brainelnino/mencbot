import { botCall } from './office.server';
import { classifyUpdate, findBlockedTerm, hasLink, hasPhone, type TgUpdate } from './telegram-parse';
import { contentRejection, parsePolicy } from './content-policy';
import { tenantMessageHtml, tenantKeyboard } from './tenant-format';
import { inspectImageMetadata } from './image-metadata.server';
import { PLATFORM_POLICY_KEY, effectiveContent, effectiveVotes, parsePlatformPolicy } from './platform-policy';
import { parseVotePolicy } from './vote-policy';

export async function platformPolicy() {
  const {data} = await (await admin()).from('system_settings').select('value').eq('key',PLATFORM_POLICY_KEY).maybeSingle();
  return parsePlatformPolicy(data?.value);
}

export type CommunityBot = { id: string; bot_token: string; welcome_message: string; content_policy: unknown; is_active: boolean; vote_policy?: unknown; blocked_words?: string[]; owner_tg_user_id: number };
async function admin() { return (await import('@/integrations/supabase/client.server')).supabaseAdmin; }

async function messageContent(id: string) {
  const db = await admin();
  const {data,error} = await db.from('tenant_messages').select('*').eq('id',id).single();
  if (error) throw error;
  const reply = data.reply_id ? await db.from('tenant_messages').select('sender_label,body').eq('id',data.reply_id).single() : null;
  return {...data,reply_label:reply?.data?.sender_label ?? null,reply_body:reply?.data?.body ?? null};
}
async function syncReactions(bot: CommunityBot, id: string) {
  const db = await admin(); const row = await messageContent(id);
  const {data:reactions,error} = await db.from('tenant_reactions').select('emoji').eq('message_id',id); if(error) throw error;
  const totals = new Map<string,number>(); for(const r of reactions ?? []) totals.set(r.emoji,(totals.get(r.emoji) ?? 0)+1);
  const counts = [...totals].map(([emoji,total]) => ({emoji,total}));
  const {data:deliveries,error:deliveryError} = await db.from('tenant_deliveries').select('tg_message_id,tenant_members(tg_user_id)').eq('message_id',id).eq('state','sent'); if(deliveryError) throw deliveryError;
  const {data:fresh} = await db.from('tenant_bots').select('vote_policy').eq('id',bot.id).single();
  for(const delivery of deliveries ?? []) {
    const chat = delivery.tenant_members?.tg_user_id; if(!chat || !delivery.tg_message_id) continue;
    const base = {chat_id:chat,message_id:delivery.tg_message_id,reply_markup:tenantKeyboard(effectiveVotes(parseVotePolicy(fresh?.vote_policy),await platformPolicy()),row.media,counts)};
    try {
      await botCall(bot.bot_token,row.media === 'sticker' ? 'editMessageReplyMarkup' : row.media ? 'editMessageCaption' : 'editMessageText', {...base,...(row.media === 'sticker' ? {} : {parse_mode:'HTML',[row.media ? 'caption' : 'text']:tenantMessageHtml(row,true,counts)})});
    } catch(e) { if(!(e instanceof Error && e.message.includes('message is not modified'))) throw e; }
  }
}
async function deliver(bot: CommunityBot, id: string) {
  const db = await admin(); const row = await messageContent(id);
  while(true) {
    const {data,error} = await db.rpc('claim_tenant_deliveries',{_message:id}); if(error) throw error;
    const batch = data as Array<{id:string;chat_id:number;reply_message_id:number|null}>;
    if(!batch.length) break;
    const outcomes = await Promise.allSettled(batch.map(async d => {
      try {
        const reply = d.reply_message_id ? {reply_parameters:{message_id:d.reply_message_id,allow_sending_without_reply:true}} : {};
        const result = await botCall<{message_id:number}>(bot.bot_token,row.media ? 'copyMessage' : 'sendMessage',{
          chat_id:d.chat_id,...reply,reply_markup:tenantKeyboard(bot.vote_policy,row.media),
          ...(row.media ? {from_chat_id:row.source_chat_id,message_id:row.source_message_id,...(row.media === 'sticker' ? {} : {caption:tenantMessageHtml(row,!d.reply_message_id),parse_mode:'HTML'})} : {text:tenantMessageHtml(row,!d.reply_message_id),parse_mode:'HTML'}),
        });
        const {error:saveError} = await db.from('tenant_deliveries').update({state:'sent',tg_message_id:result.message_id}).eq('id',d.id); if(saveError) throw saveError;
      } catch(e) {
  const msg = e instanceof Error ? e.message : '';
  const permanent = msg.includes('[403]') || msg.includes('chat not found') || msg.includes('user is deactivated');
  if (permanent) {
    // Mtumiaji amezuia bot au akaunti haipo: usijaribu tena, endelea na wengine
    await db.from('tenant_deliveries').update({state:'sent'}).eq('id',d.id);
    return;
  }
  await db.from('tenant_deliveries').update({state:'pending'}).eq('id',d.id);
  throw e;
}
    }));
    const failure = outcomes.find(o => o.status === 'rejected'); if(failure?.status === 'rejected') throw failure.reason;
  }
}
export async function handleCommunityUpdate(bot: CommunityBot, update: TgUpdate) {
  const db = await admin(); const c = classifyUpdate(update);
  const platform = await platformPolicy();
  bot = {...bot, content_policy: effectiveContent(parsePolicy(bot.content_policy),platform), vote_policy: effectiveVotes(parseVotePolicy(bot.vote_policy),platform)};
  if('userId' in c && c.userId) await db.from('tenant_members').update({last_seen_at:new Date().toISOString()}).eq('bot_id',bot.id).eq('tg_user_id',c.userId);
  const send = (chat_id:number,text:string) => botCall(bot.bot_token,'sendMessage',{chat_id,text,parse_mode:'HTML'});
  if(c.kind === 'vote' && !platform.votes) { await botCall(bot.bot_token,'answerCallbackQuery',{callback_query_id:c.callbackId,text:'Kura zimezimwa kwa sasa.'}); return; }
  if(c.kind === 'vote' || c.kind === 'reaction') {
    // PostgreSQL accepts null here for removal; generated RPC types omit SQL nullability.
    const {data,error} = await db.rpc('react_tenant_message',{_bot_id:bot.id,_user:c.userId,_message:c.messageId,_emoji:c.emoji as string,_toggle:c.kind === 'vote',_update:update.update_id}); if(error) throw error;
    if(c.kind === 'vote') await botCall(bot.bot_token,'answerCallbackQuery',{callback_query_id:c.callbackId,...(!data ? {text:'Kura hazipatikani kwenye ujumbe huu.'} : {})});
    if(data) await syncReactions(bot,data); return;
  }
  if(c.kind === 'start') {
    const {data,error} = await db.rpc('register_tenant_member',{_bot_id:bot.id,_tg_user_id:c.userId}); if(error) throw error;
    await db.from('tenant_members').update({last_seen_at:new Date().toISOString()}).eq('bot_id',bot.id).eq('tg_user_id',c.userId);
    const {escapeHtml} = await import('./telegram-format');
    await send(c.chatId,`${escapeHtml(bot.welcome_message)}\n\nUtambulisho wako: <b>${c.userId === bot.owner_tg_user_id ? 'Admin' : escapeHtml(data?.[0]?.label ?? '')}</b>`);
    return;
  }
  if(c.kind !== 'private_text' && c.kind !== 'private_media') return;
  const {data:existing} = await db.from('tenant_messages').select('id').eq('bot_id',bot.id).eq('update_id',update.update_id).maybeSingle();
  if(existing) { await deliver(bot,existing.id); return; }
  const {data:member} = await db.from('tenant_members').select('status').eq('bot_id',bot.id).eq('tg_user_id',c.userId).maybeSingle();
  if(!member) { await send(c.chatId,'Tuma /start kwanza ili kujiunga.'); return; } if(member.status !== 'active') return;
  const media = c.kind === 'private_media' ? c.media : null;
  const reject = contentRejection(parsePolicy(bot.content_policy),false,media,hasLink(c.text),hasPhone(c.text));
  if(reject || findBlockedTerm(c.text,bot.blocked_words ?? [])) { await send(c.chatId,'⚠️ Ujumbe haujatumwa kwa sababu una maudhui yasiyoruhusiwa hapa.'); return; }
  const metadata = media === 'photo' || media === 'document' ? await inspectImageMetadata(bot.bot_token,update) : null;
  const {data:id,error} = await db.rpc('enqueue_tenant_message',{_bot_id:bot.id,_user:c.userId,_update:update.update_id,_source_message:c.messageId,_body:c.text,...(media ? {_media:media} : {}),...(c.replyMessageId ? {_reply:c.replyMessageId} : {}),...(metadata ? {_metadata:metadata} : {})});
  if(error) throw error; if(id) await deliver(bot,id);
}