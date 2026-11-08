// Browser-safe: platform-wide switches the owner sets once for every connected community bot.
import { DEFAULT_POLICY, type ContentPolicy } from "./content-policy";
import type { VotePolicy } from "./vote-policy";

export type PlatformPolicy = ContentPolicy & { votes: boolean; new_bots: boolean };
export const PLATFORM_POLICY_KEY = "platform_policy";
export const PLATFORM_DEFAULT: PlatformPolicy = {
  ...(Object.fromEntries(Object.keys(DEFAULT_POLICY).map((k) => [k, true])) as ContentPolicy),
  votes: true, new_bots: true,
};

export function parsePlatformPolicy(value: unknown): PlatformPolicy {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const out = { ...PLATFORM_DEFAULT };
  for (const k of Object.keys(out) as (keyof PlatformPolicy)[]) if (typeof row[k] === "boolean") out[k] = row[k] as boolean;
  return out;
}

/** A feature works on a community bot only when both its owner and the platform allow it. */
export function effectiveContent(tenant: ContentPolicy, platform: PlatformPolicy): ContentPolicy {
  const out = { ...tenant };
  for (const k of Object.keys(out) as (keyof ContentPolicy)[]) out[k] = tenant[k] && platform[k];
  return out;
}

export function effectiveVotes(tenant: VotePolicy, platform: PlatformPolicy): VotePolicy {
  return platform.votes ? tenant : { text: false, media: false };
}
