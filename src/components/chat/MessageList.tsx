export type PublicMessage = {
  id: string;
  sender_label: string;
  kind: "text" | "image";
  body: string | null;
  published_at: string;
};

export type ReactionCount = { emoji: string; total: number };

// Body is rendered as plain text (React escapes it) — never as HTML.
export function MessageList({ messages, reactions }: { messages: PublicMessage[]; reactions?: Record<string, ReactionCount[]> | undefined }) {
  return (
    <ol className="flex flex-col gap-4">
      {messages.map((m) => {
        const counts = reactions?.[m.id] ?? [];
        return (
          <li key={m.id} className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2">
              <span className="identity-chip">{m.sender_label}</span>
              <time className="text-[11px] text-muted-foreground">
                {new Date(m.published_at).toLocaleTimeString("sw-TZ", { hour: "2-digit", minute: "2-digit" })}
              </time>
            </div>
            <p className="quote-bubble px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words">
              {m.kind === "image" ? "[Picha]" : m.body}
            </p>
            {counts.length > 0 && (
              <ul className="flex flex-wrap gap-1.5 pl-1">
                {counts.map((r) => (
                  <li key={r.emoji} className="rounded-full border bg-card px-2 py-0.5 text-xs">
                    {r.emoji} {r.total}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
