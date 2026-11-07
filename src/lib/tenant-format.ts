import { escapeHtml, buildMessageHtml, voteKeyboard, withReactionFooter } from './telegram-format';
import { parseVotePolicy, votesEnabled } from './vote-policy';

export type TenantContent = { sender_label: string; body: string | null; media: string | null; metadata_notice: string | null; reply_label?: string | null; reply_body?: string | null };
export function tenantMessageHtml(row: TenantContent, fallback = true, counts: Array<{emoji: string; total: number}> = []) {
  const max = row.media ? 900 : 3900;
  const notice = row.metadata_notice ? `<tg-spoiler>${escapeHtml(row.metadata_notice.slice(0, 250))}</tg-spoiler>\n` : '';
  const text = buildMessageHtml({ ...row, body: null }, fallback, max);
  return withReactionFooter(`${text}${notice}${escapeHtml(Array.from(row.body ?? '').slice(0, max - 450).join(''))}`, counts.filter(c => c.emoji !== '✅' && c.emoji !== '❌'));
}
export function tenantKeyboard(policy: unknown, media: string | null, counts: Array<{emoji: string; total: number}> = []) {
  return votesEnabled(parseVotePolicy(policy), media) ? voteKeyboard(counts) : { inline_keyboard: [] };
}

/** Metadata is editable evidence, never a certified AI determination. Personal fields are excluded. */
export function metadataNotice(tags: Record<string, string>): string | null {
  const ai = /trainedAlgorithmicMedia/i.test(tags['DigitalSourceType'] ?? '') || /\b(DALL-E|Midjourney|Stable Diffusion|ComfyUI|AUTOMATIC1111|Adobe Firefly)\b/i.test(tags['Software'] ?? tags['CreatorTool'] ?? '');
  const date = tags['DateTimeOriginal'] ?? tags['CreateDate'];
  const safeDate = date?.match(/^\d{4}[:-]\d{2}[:-]\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?$/)?.[0];
  const parts = [ai ? 'Metadata inaashiria picha ya AI (haijathibitishwa).' : '', safeDate ? `Tarehe/muda kwenye metadata: ${safeDate} (haijathibitishwa).` : ''].filter(Boolean);
  return parts.length ? parts.join('\n') : null;
}