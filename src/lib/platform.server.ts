// Server-only: platform (master) bot that lets anyone connect their own community bot, and the community bots themselves.
// Owners manage everything inside Telegram; each owner only ever sees their own bot.
import { botCall } from "./office.server";
import { classifyUpdate, hasLink, hasPhone, type TgUpdate } from "./telegram-parse";
import { contentRejection, parsePolicy, type ContentPolicy } from "./content-policy";
import { buildMessageHtml, escapeHtml } from "./telegram-format";
import { MAX_BOTS_PER_OWNER, PROMPT_TOKEN, PROMPT_WELCOME, TENANT_TOGGLES, WELCOME_MAX, isToken, togglePolicy } from "./platform-parse";

async function admin() { return (await import("@/integrations/supabase/client.server")).supabaseAdmin; }

type Msg = { message_id?: number; chat: { id: number; type: string }; from?: { id: number }; text?: string; reply_to_message?: { text?: string } };
export type PlatformUpdate = { update_id: number; message?: Msg; callback_query?: { id: string; from: { id: number }; data?: string; message?: Msg } };

type TenantRow = { id: string; bot_username: string; bot_token: string; welcome_message: string; content_policy: unknown; is_active: boolean };

function tenantUrl(origin: string, id: string) {
  const u = new URL(origin);
  const m = /^id-preview--([0-9a-f-]+)\.(.+)$/.exec(u.host);
  const host = m ? `project--${m[1]}-dev.${m[2]}` : u.host;
  return `https://${host}/api/public/telegram/kikundi/${id}`;
}

const homeKb = (has: boolean) => ({ inline_keyboard: has
  ? [[{ text: "⚙️ Bot yangu", callback_data: "p:my" }], [{ text: "ℹ️ Msaada", callback_data: "p:help" }]]
  : [[{ text: "➕ Unganisha bot yangu", callback_data: "p:conn" }], [{ text: "ℹ️ Msaada", callback_data: "p:help" }]] });

function manageKb(t: TenantRow) {
  const p = parsePolicy(t.content_policy);
  const toggles = TENANT_TOGGLES.map((x) => ({ text: `${p[x.key] ? "✅" : "🚫"} ${x.label}`, callback_data: `p:pol:${x.key}` }));
  const rows: { text: string; callback_data: string }[][] = [];
  for (let i = 0; i < toggles.length; i += 2) rows.push(toggles.slice(i, i + 2));
  return { inline_keyboard: [
    [{ text: "✏️ Ujumbe wa karibu", callback_data: "p:welcome" }],
    ...rows,
    [{ text: t.is_active ? "⏸ Zima bot" : "▶️ Washa bot", callback_data: "p:toggle" }, { text: "🔄 Badili TOKEN", callback_data: "p:conn" }],
    [{ text: "🗑 Ondoa bot", callback_data: "p:del" }, { text: "🏠 Mwanzo", callback_data: "p:home" }],
  ] };
}

async function myBot(owner: number) {
  const { data } = await (await admin()).from("tenant_bots").select("id,bot_username,bot_token,welcome_message,content_policy,is_active").eq("owner_tg_user_id", owner).maybeSingle();
  return data as TenantRow | null;
}

async function manageText(t: TenantRow) {
  const { count } = await (await admin()).from("tenant_members").select("id", { count: "exact", head: true }).eq("bot_id", t.id);
  return `⚙️ <b>@${escapeHtml(t.bot_username)}</b>\nHali: ${t.is_active ? "🟢 Hai" : "⏸ Imezimwa"}\nWanachama: <b>${count ?? 0}</b>\n\nUjumbe wa karibu:\n<blockquote>${escapeHtml(t.welcome_message)}</blockquote>\n✅ = inaruhusiwa · 🚫 = imezuiwa`;
}

/** Handles the master bot: connect a bot by TOKEN, then manage it with buttons. */
export async function handlePlatformUpdate(token: string, update: PlatformUpdate, origin: string) {
  const db = await admin();
  const send = (chat_id: number, text: string, extra: Record<string, unknown> = {}) => botCall(token, "sendMessage", { chat_id, text, parse_mode: "HTML", ...extra });
  const cb = update.callback_query;
  if (cb) {
    const chat = cb.message?.chat.id; const user = cb.from.id; const data = cb.data ?? "";
    await botCall(token, "answerCallbackQuery", { callback_query_id: cb.id }).catch(() => undefined);
    if (!chat || cb.message?.chat.type !== "private") return;
    const bot = await myBot(user);
    const edit = (text: string, reply_markup: unknown) => botCall(token, "editMessageText", { chat_id: chat, message_id: cb.message!.message_id, text, parse_mode: "HTML", reply_markup }).catch(() => send(chat, text, { reply_markup }));
    if (data === "p:conn") {
      if (!bot && (await countOwned(user)) >= MAX_BOTS_PER_OWNER) return;
      await send(chat, `${PROMPT_TOKEN}\n\n1. Fungua @BotFather → /newbot\n2. Nakili TOKEN\n3. Ibandike hapa kama jibu`, { reply_markup: { force_reply: true, input_field_placeholder: "123456:ABC..." } });
      return;
    }
    if (data === "p:help") { await edit(helpText(), homeKb(!!bot)); return; }
    if (data === "p:home") { await edit(homeText(), homeKb(!!bot)); return; }
    if (!bot) { await edit("Bado huna bot. Bofya ➕ kuunganisha.", homeKb(false)); return; }
    if (data === "p:my") { await edit(await manageText(bot), manageKb(bot)); return; }
    if (data === "p:welcome") { await send(chat, PROMPT_WELCOME, { reply_markup: { force_reply: true } }); return; }
    if (data.startsWith("p:pol:")) {
      const key = data.slice(6) as keyof ContentPolicy;
      if (!TENANT_TOGGLES.some((x) => x.key === key)) return;
      const next = togglePolicy(parsePolicy(bot.content_policy), key);
      await db.from("tenant_bots").update({ content_policy: next, updated_at: new Date().toISOString() }).eq("id", bot.id);
      const fresh = { ...bot, content_policy: next };
      await edit(await manageText(fresh), manageKb(fresh));
      return;
    }
    if (data === "p:toggle") {
      await db.from("tenant_bots").update({ is_active: !bot.is_active, updated_at: new Date().toISOString() }).eq("id", bot.id);
      const fresh = { ...bot, is_active: !bot.is_active };
      await edit(await manageText(fresh), manageKb(fresh));
      return;
    }
    if (data === "p:del") {
      await edit(`⚠️ Una uhakika unataka kuondoa @${escapeHtml(bot.bot_username)}? Wanachama na namba zao zitafutwa.`, { inline_keyboard: [[{ text: "🗑 Ndiyo, ondoa", callback_data: "p:delok" }, { text: "↩️ Hapana", callback_data: "p:my" }]] });
      return;
    }
    if (data === "p:delok") {
      await botCall(bot.bot_token, "deleteWebhook").catch(() => undefined);
      await db.from("tenant_bots").delete().eq("id", bot.id);
      await edit("✅ Bot imeondolewa. Unaweza kuunganisha nyingine.", homeKb(false));
    }
    return;
  }

  const m = update.message;
  if (!m?.from || m.chat.type !== "private") return;
  const text = (m.text ?? "").trim();
  const user = m.from.id;
  const prompt = m.reply_to_message?.text ?? "";

  if (isToken(text)) {
    if (m.message_id) await botCall(token, "deleteMessage", { chat_id: m.chat.id, message_id: m.message_id }).catch(() => undefined);
    await connectBot(token, m.chat.id, user, text.trim(), origin);
    return;
  }
  if (prompt.startsWith(PROMPT_WELCOME)) {
    const bot = await myBot(user);
    if (!bot) return;
    if (!text) { await send(m.chat.id, "Tuma maandishi tu."); return; }
    await db.from("tenant_bots").update({ welcome_message: text.slice(0, WELCOME_MAX), updated_at: new Date().toISOString() }).eq("id", bot.id);
    const fresh = { ...bot, welcome_message: text.slice(0, WELCOME_MAX) };
    await send(m.chat.id, "✅ Ujumbe wa karibu umehifadhiwa.\n\n" + await manageText(fresh), { reply_markup: manageKb(fresh) });
    return;
  }
  if (prompt.startsWith(PROMPT_TOKEN)) { await send(m.chat.id, "❌ Hiyo si TOKEN sahihi. Nakili TOKEN yote kutoka @BotFather."); return; }
  const bot = await myBot(user);
  await send(m.chat.id, homeText(), { reply_markup: homeKb(!!bot) });
}

async function countOwned(user: number) {
  const { count } = await (await admin()).from("tenant_bots").select("id", { count: "exact", head: true }).eq("owner_tg_user_id", user);
  return count ?? 0;
}

const homeText = () => "🤖 <b>Jukwaa la Live Chat</b>\n\nUnganisha bot yako ya Telegram ugeuze kuwa live chat ya siri: kila mwanachama anapata namba au herufi, ujumbe unawafikia wote papo hapo bila majina kuonekana.\n\nKwa sasa: bot 1 kwa kila mtu, bure.";
const helpText = () => "ℹ️ <b>Jinsi inavyofanya kazi</b>\n\n1. Tengeneza bot kwa @BotFather (/newbot)\n2. Bofya ➕ Unganisha, bandika TOKEN\n3. Shiriki link ya bot yako — wanaojiunga wanapata namba (10–99, kisha A–Z)\n\nUdhibiti wote uko hapa: ujumbe wa karibu, picha, link, namba za simu, kuzima bot. Huoni data za bot za wengine, wala wao hawaoni zako.";

async function connectBot(token: string, chat: number, user: number, newToken: string, origin: string) {
  const db = await admin();
  const send = (text: string, extra: Record<string, unknown> = {}) => botCall(token, "sendMessage", { chat_id: chat, text, parse_mode: "HTML", ...extra });
  if (newToken === token) { await send("❌ Hiyo ni TOKEN ya jukwaa hili. Tengeneza bot mpya kwa @BotFather."); return; }
  let me: { username: string };
  try { me = await botCall<{ username: string }>(newToken, "getMe"); }
  catch { await send("❌ Telegram imekataa TOKEN hii. Hakikisha ni mpya kutoka @BotFather."); return; }
  const { data: used } = await db.from("tenant_bots").select("id,owner_tg_user_id").or(`bot_token.eq.${newToken},bot_username.eq.${me.username}`);
  if (used?.some((u) => u.owner_tg_user_id !== user)) { await send("❌ Bot hii tayari imeunganishwa na mtu mwingine."); return; }
  const { data: office } = await db.from("office_bots").select("office").eq("bot_username", me.username);
  if (office?.length) { await send("❌ Bot hii inatumika kwenye mfumo mwingine."); return; }
  const existing = await myBot(user);
  if (!existing && (await countOwned(user)) >= MAX_BOTS_PER_OWNER) { await send("Kwa sasa unaweza kuwa na bot 1 tu."); return; }
  const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
  let id = existing?.id;
  if (existing) {
    const { error } = await db.from("tenant_bots").update({ bot_token: newToken, bot_username: me.username, webhook_secret: secret, is_active: true, last_error: null, updated_at: new Date().toISOString() }).eq("id", existing.id);
    if (error) throw error;
  } else {
    const { data, error } = await db.from("tenant_bots").insert({ owner_tg_user_id: user, bot_token: newToken, bot_username: me.username, webhook_secret: secret }).select("id").single();
    if (error) throw error;
    id = data.id;
  }
  try {
    await botCall(newToken, "setWebhook", { url: tenantUrl(origin, id!), secret_token: secret, allowed_updates: ["message"], drop_pending_updates: true });
    await botCall(newToken, "setMyCommands", { commands: [{ command: "start", description: "Jiunge na upate namba yako" }] }).catch(() => undefined);
  } catch (e) {
    await db.from("tenant_bots").update({ is_active: false, last_error: e instanceof Error ? e.message.slice(0, 300) : "error" }).eq("id", id!);
    await send("❌ Imeshindikana kuwasha bot. Jaribu tena baadaye.");
    return;
  }
  if (existing && existing.bot_token !== newToken) await botCall(existing.bot_token, "deleteWebhook").catch(() => undefined);
  const bot = await myBot(user);
  await send(`🎉 @${escapeHtml(me.username)} sasa iko hai!\nShiriki link: https://t.me/${me.username}\n\n` + await manageText(bot!), { reply_markup: manageKb(bot!) });
}

/** Handles one community bot: /start allocates a per-bot ID, messages are broadcast anonymously to all its members. */
export async function handleTenantUpdate(bot: TenantRow, update: TgUpdate) {
  const db = await admin();
  const { error: dup } = await db.from("tenant_updates").insert({ bot_id: bot.id, update_id: update.update_id });
  if (dup) { if (dup.code === "23505") return; throw dup; }
  const call = <T,>(method: string, body: Record<string, unknown>) => botCall<T>(bot.bot_token, method, body);
  const c = classifyUpdate(update);
  if (c.kind === "start") {
    const { data, error } = await db.rpc("register_tenant_member", { _bot_id: bot.id, _tg_user_id: c.userId });
    if (error) throw error;
    const row = data?.[0];
    await call("sendMessage", { chat_id: c.chatId, parse_mode: "HTML", text: `${escapeHtml(bot.welcome_message)}\n\nNamba yako: <b>${escapeHtml(row?.label ?? "")}</b>` });
    return;
  }
  if (c.kind !== "private_text" && c.kind !== "private_media") {
    if (c.kind === "private_other") await call("sendMessage", { chat_id: c.chatId, text: "Aina hii ya ujumbe haitumiki." });
    return;
  }
  const { data: mem } = await db.from("tenant_members").select("id,label,status").eq("bot_id", bot.id).eq("tg_user_id", c.userId).maybeSingle();
  if (!mem) { await call("sendMessage", { chat_id: c.chatId, text: "Tuma /start kwanza ili kujiunga." }); return; }
  if (mem.status !== "active") return;
  const media = c.kind === "private_media" ? c.media : null;
  const rejection = contentRejection(parsePolicy(bot.content_policy), false, media, hasLink(c.text), hasPhone(c.text));
  if (rejection) {
    await call("sendMessage", { chat_id: c.chatId, text: rejection === "media" ? "⚠️ Aina hii ya faili/picha hairuhusiwi hapa." : "⚠️ Link na namba za simu haziruhusiwi hapa." });
    return;
  }
  const { data: rows, error } = await db.from("tenant_members").select("tg_user_id").eq("bot_id", bot.id).eq("status", "active").neq("id", mem.id);
  if (error) throw error;
  const content = { sender_label: mem.label, body: c.text || null };
  for (let i = 0; i < (rows ?? []).length; i += 25) {
    await Promise.all(rows!.slice(i, i + 25).map((r) => (media
      ? call("copyMessage", { chat_id: r.tg_user_id, from_chat_id: c.chatId, message_id: c.messageId, ...(media === "sticker" ? {} : { parse_mode: "HTML", caption: buildMessageHtml(content, true, 900) }) })
      : call("sendMessage", { chat_id: r.tg_user_id, parse_mode: "HTML", text: buildMessageHtml(content, true) })
    ).catch(() => undefined)));
  }
}
