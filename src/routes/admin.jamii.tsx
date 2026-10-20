import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loading, ErrorState, Empty, PageHeader, Pill } from "@/components/admin/States";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/admin/jamii")({ component: Community });

type Status = "all" | "pending" | "approved" | "rejected" | "flagged";

function Community() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Status>("all");
  const msgs = useQuery({
    queryKey: ["admin-messages", status],
    queryFn: async () => {
      let query = supabase.from("messages").select("id,sender_label,kind,body,moderation_status,publication_status,created_at").order("created_at", { ascending: false }).limit(200);
      if (status !== "all") query = query.eq("moderation_status", status);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
  const rows = (msgs.data ?? []).filter((m) => !q || m.sender_label.toLowerCase().includes(q.toLowerCase()) || (m.body ?? "").toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <PageHeader title="Jamii" desc="Ujumbe wote pamoja na hali ya udhibiti na uchapishaji." />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <Input placeholder="Tafuta utambulisho au maandishi" value={q} onChange={(e) => setQ(e.target.value)} maxLength={100} />
        <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
          <SelectTrigger className="sm:w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Zote</SelectItem>
            <SelectItem value="pending">Zinasubiri</SelectItem>
            <SelectItem value="approved">Zimeidhinishwa</SelectItem>
            <SelectItem value="flagged">Zimewekwa alama</SelectItem>
            <SelectItem value="rejected">Zimekataliwa</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {msgs.isLoading ? <Loading /> : msgs.error ? <ErrorState error={msgs.error} /> : rows.length === 0 ? (
        <Empty title="Hakuna ujumbe" hint="Ujumbe utaingia kupitia Telegram bot, ambayo bado haijaunganishwa." />
      ) : (
        <ol className="flex flex-col gap-3">
          {rows.map((m) => (
            <li key={m.id} className="rounded-xl border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="identity-chip">{m.sender_label}</span>
                <span className="flex gap-1.5">
                  <Pill tone={m.moderation_status === "approved" ? "ok" : m.moderation_status === "rejected" ? "bad" : "warn"}>{m.moderation_status}</Pill>
                  <Pill>{m.publication_status}</Pill>
                </span>
              </div>
              <p className="quote-bubble mt-2 px-3 py-2 text-sm whitespace-pre-wrap break-words">{m.kind === "image" ? "[Picha]" : m.body}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
