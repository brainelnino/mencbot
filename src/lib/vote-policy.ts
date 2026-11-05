export type VotePolicy = { text: boolean; media: boolean };

export function parseVotePolicy(value: unknown): VotePolicy {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    text: typeof row["text"] === "boolean" ? row["text"] : true,
    media: typeof row["media"] === "boolean" ? row["media"] : true,
  };
}

export function votesEnabled(policy: VotePolicy, media: string | null | undefined) {
  return media ? policy.media : policy.text;
}