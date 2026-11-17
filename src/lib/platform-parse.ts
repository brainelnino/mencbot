// Browser-safe helpers for the platform (master) bot and community (tenant) bots.
import type { ContentPolicy } from "./content-policy";

export const TOKEN_RE = /^\d{5,15}:[A-Za-z0-9_-]{30,60}$/;
export const PROMPT_TOKEN = "🔑 Tuma TOKEN ya bot yako";
export const PROMPT_WELCOME = "✏️ Tuma ujumbe mpya wa karibu";
export const MAX_BOTS_PER_OWNER = 1;
export const WELCOME_MAX = 1000;

export const TENANT_TOGGLES: { key: keyof ContentPolicy; label: string }[] = [
  { key: "photo", label: "Picha" }, { key: "video", label: "Video" }, { key: "document", label: "Faili" },
  { key: "voice", label: "Sauti" }, { key: "audio", label: "Muziki" }, { key: "animation", label: "GIF" }, { key: "sticker", label: "Stika" }, { key: "links", label: "Link" }, { key: "phones", label: "Namba za simu" },
];

export function isToken(text: string) { return TOKEN_RE.test(text.trim()); }

export function togglePolicy(policy: ContentPolicy, key: keyof ContentPolicy): ContentPolicy {
  return { ...policy, [key]: !policy[key] };
}
