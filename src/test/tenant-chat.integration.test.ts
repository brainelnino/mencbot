// Uses isolated database fixtures when server credentials are present; never sends Telegram messages.
import {describe,it,expect} from 'vitest';
import {createClient} from '@supabase/supabase-js';
const url=process.env['SUPABASE_URL']; const key=process.env['SUPABASE_SERVICE_ROLE_KEY'];
describe.skipIf(!url || !key)('tenant interaction database rules',() => {
  it('enforces Admin, tenant-scoped replies, anonymous vote toggles and owner-only moderation',async () => {
    if(!url || !key) return;
    const db=createClient(url,key,{auth:{persistSession:false},global:{fetch:(input,init) => {const headers=new Headers(init?.headers); headers.set('apikey',key); if(key.startsWith('sb_')) headers.delete('Authorization'); return fetch(input,{...init,headers});}}});
    const owner=-810001; const recipient=-810002; const outsider=-810003;
    const id=crypto.randomUUID(); const other=crypto.randomUUID();
    const must=<T,>(r:{data:T;error:unknown}) => {if(r.error) throw new Error('Database fixture operation failed'); return r.data;};
    try {
      must(await db.from('tenant_bots').insert([{id,owner_tg_user_id:owner,bot_token:`test-${id}`,bot_username:'test_fixture',webhook_secret:'test-only'},{id:other,owner_tg_user_id:outsider,bot_token:`test-${other}`,bot_username:'test_fixture_other',webhook_secret:'test-only'}]));
      for(const user of [owner,recipient]) must(await db.rpc('register_tenant_member',{_bot_id:id,_tg_user_id:user}));
      must(await db.rpc('register_tenant_member',{_bot_id:other,_tg_user_id:outsider}));
      const parent=must(await db.rpc('enqueue_tenant_message',{_bot_id:id,_user:owner,_update:1,_source_message:77,_body:'Habari'}));
      const message=must(await db.from('tenant_messages').select('sender_label,sender_id').eq('id',parent).single());
      expect(message.sender_label).toBe('Admin');
      const deliveries=must(await db.from('tenant_deliveries').select('*').eq('message_id',parent));
      expect(deliveries).toHaveLength(1); expect(deliveries[0]?.member_id).not.toBe(message.sender_id);
      must(await db.from('tenant_deliveries').update({state:'sent',tg_message_id:88}).eq('message_id',parent));
      const child=must(await db.rpc('enqueue_tenant_message',{_bot_id:id,_user:recipient,_update:2,_source_message:99,_body:'Jibu',_reply:88}));
      expect(must(await db.from('tenant_messages').select('reply_id').eq('id',child).single()).reply_id).toBe(parent);
      const claimed=must(await db.rpc('claim_tenant_deliveries',{_message:child})) as Array<{chat_id:number;reply_message_id:number}>;
      expect(claimed[0]).toMatchObject({chat_id:owner,reply_message_id:77});
      const foreign=must(await db.rpc('enqueue_tenant_message',{_bot_id:other,_user:outsider,_update:1,_source_message:1,_body:'Other',_reply:88}));
      expect(must(await db.from('tenant_messages').select('reply_id').eq('id',foreign).single()).reply_id).toBeNull();
      const reaction={_bot_id:id,_user:recipient,_message:88,_emoji:'✅',_toggle:true,_update:3};
      expect(must(await db.rpc('react_tenant_message',reaction))).toBe(parent);
      must(await db.rpc('react_tenant_message',reaction));
      expect(must(await db.from('tenant_reactions').select('emoji').eq('message_id',parent))).toHaveLength(1);
      must(await db.rpc('react_tenant_message',{...reaction,_update:4}));
      expect(must(await db.from('tenant_reactions').select('emoji').eq('message_id',parent))).toHaveLength(0);
      expect((await db.rpc('tenant_owner_action',{_bot_id:id,_actor:outsider,_action:'words',_value:'bad'})).error).toBeTruthy();
      must(await db.rpc('tenant_owner_action',{_bot_id:id,_actor:owner,_action:'words',_value:'bad,spam'}));
      expect(must(await db.from('tenant_bots').select('blocked_words').eq('id',id).single()).blocked_words).toEqual(['bad','spam']);
      const member=must(await db.from('tenant_members').select('label').eq('bot_id',id).eq('tg_user_id',recipient).single());
      must(await db.rpc('tenant_owner_action',{_bot_id:id,_actor:owner,_action:'ban',_value:member.label}));
      expect((await db.rpc('enqueue_tenant_message',{_bot_id:id,_user:recipient,_update:5,_source_message:100,_body:'Blocked'})).error).toBeTruthy();
    } finally {
      must(await db.from('tenant_bots').delete().in('id',[id,other]));
    }
  });
});