export type PublicMessage = {
  id: string;
  sender_label: string;
  kind: "text" | "image";
  body: string | null;
  published_at: string;
};

// Body is rendered as plain text (React escapes it) — never as HTML.
export function MessageList({ messages }: { messages: PublicMessage[] }) {
  return (
    <ol className="flex flex-col gap-4">
      {messages.map((m) => (
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
        </li>
      ))}
    </ol>
  );
}
