<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- Tenant chat RPCs enforce owner scope, sender identity, local replies and durable delivery/reaction retries; metadata uses bounded ExifReader with nonpersonal fields only — why: isolate communities and avoid false provenance claims.
- All permission checks live in the database (RLS + `has_permission`/`is_owner` security-definer functions); UI hiding is cosmetic only — why: spec forbids UI-only security.
- Public chat is read only through the `get_public_messages` RPC, never the `messages` table — why: keeps member IDs and private fields out of public responses.
- Public identities are allocated only by `allocate_identity` (service_role only) — why: uniqueness and stable, non-recycled identities.
- Admin pages are client-rendered under `/admin` and query with the browser client — why: they depend on the signed-in session.
- UI strings live in `src/lib/i18n.ts` (Kiswahili first) — why: English is planned later.
- Telegram updates enter only via `/api/public/telegram/webhook` (secret token derived from TELEGRAM_API_KEY) and are deduplicated by `telegram_updates.update_id` — why: Telegram retries deliveries.
- Private member broadcasting happens through `publishMessage`, with database recipient snapshots and atomic six-row delivery claims; failed webhook responses drive Telegram retries — why: direct delivery survives partial failure without deliberately resending recorded successes.
- Telegram reply resolution uses recipient-scoped sent delivery IDs or the sender's stored original message reference; outgoing HTML is escaped and native replies target recipient-local IDs — why: private chat message IDs are not globally interchangeable and user text must not inject formatting.
- Owner web access is a server-verified PIN (ADMIN_PIN) that mints a session for one hidden owner account, so RLS stays intact without user signup. Website permissions resolve to owner-only database helpers; Telegram assistants use a separate member-linked role table and service-only RPCs — why: assistants need no web credentials and cannot gain web access.
- Telegram config is owner-only (RLS `is_owner`); the group is linked by a one-time `/unganisha CODE` command — why: the group reference stays private.
- Message filtering (links, phone numbers, owner-managed `blocked_terms`) runs in the webhook before storage; blocked text is never stored or broadcast, and only the sender is warned — why: no moderation queue by design.
- Reactions are stored in `message_reactions` via the service-only `record_telegram_reaction` RPC (resolved through recipient-scoped deliveries); counts reach members by editing each delivered copy (`editMessageText` with an anonymous aggregate footer) and reach the public feed only through `get_public_reactions` — never summary broadcast messages; ✅/❌ inline buttons (`callback_query`) are stored as reactions (pressing again removes) and show counts on the buttons — why: reactions must appear on the message itself without revealing who reacted or spamming chats.
- Leadership office bots (raisi, mbunge, polisi, mwenyekiti, ulinzi) each use their own owner-supplied bot token stored in `office_bots` (token/secret columns readable only by service_role), call the Bot API directly, and enter via `/api/public/telegram/ofisi/$office` with a per-bot random secret; office→slot mapping lives in `src/lib/office-config.ts` — why: tokens can be swapped from the web without code changes and offices stay isolated.
- Office interaction parsing is browser-safe in `office-interaction.ts`; office webhooks accept callbacks, recheck database roles on every input, and use bot-authored reply prompts and confirmation cards instead of volatile in-memory sessions — why: guided Telegram workflows survive worker restarts without granting new permissions.
- The display name is the `brand_name` system setting read via the public `get_brand_name` RPC (web `useBrand`, bot welcome); media/link/phone allowances are the `content_policy` setting enforced in the webhook by `contentRejection`, and members with `can_send_restricted` (set only via owner `set_member_exempt`) bypass them — why: one-click owner changes without code edits.
- Vote button visibility uses the owner-managed `vote_policy` system setting with separate text/media switches, checked during sending, reaction edits and callback handling — why: disabled buttons cannot reappear or accept stale votes.
- Multi-tenant platform: the master bot is the `jukwaa` row in `office_bots` (token set from the owner web panel); anyone connects their own bot by pasting its TOKEN in Telegram, stored in service-only `tenant_bots` (limit set by MAX_BOTS_PER_OWNER), with per-bot members/IDs in `tenant_members` (allocated by service-only `register_tenant_member`) and updates via `/api/public/telegram/kikundi/$botId` with a per-bot random secret — why: owners manage only their own bot inside Telegram, never the web.
