// Browser-safe content policy shared by the settings page and the webhook.
import type { MediaType } from "./telegram-parse";

export type ContentPolicy = Record<MediaType | "links" | "phones", boolean>;

export const DEFAULT_POLICY: ContentPolicy = { photo: false, video: false, document: false, voice: false, audio: false, sticker: false, animation: false, links: false, phones: false };

export const POLICY_LABELS: Record<keyof ContentPolicy, string> = {
  photo: "🖼 Picha", video: "🎬 Video", document: "📄 Faili", voice: "🎙 Sauti (voice)", audio: "🎵 Muziki", sticker: "😀 Stika", animation: "🎞 GIF", links: "🔗 Link", phones: "📞 Namba za simu",
};

export function parsePolicy(value: unknown): ContentPolicy {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_POLICY };
  for (const k of Object.keys(out) as (keyof ContentPolicy)[]) if (typeof v[k] === "boolean") out[k] = v[k] as boolean;
  return out;
}

/** Why a message must be rejected, or null when it may be sent. Exempt members bypass media/link/phone rules. */
export function contentRejection(policy: ContentPolicy, exempt: boolean, media: MediaType | null, hasLink: boolean, hasPhone: boolean): "media" | "link" | null {
  if (exempt) return null;
  if (media && !policy[media]) return "media";
  if ((hasLink && !policy.links) || (hasPhone && !policy.phones)) return "link";
  return null;
}
