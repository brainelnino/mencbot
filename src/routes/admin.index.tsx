import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Loading, ErrorState, Empty, PageHeader, Pill } from "@/components/admin/States";

export const Route = createFileRoute("/admin/")({ component: Overview });

function Overview() {
  const stats = useQuery({
    queryKey: ["stats"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_dashboard_stats");
      if (error) throw error;
      return data as { members: number; active: number; published: number; pending_images: number; active_restrictions: number; activity_window: number };
    },
  });
  const events = useQuery({
    queryKey: ["mod-events"],
    queryFn: async () => {
      const { data, error } = await supabase.from("moderation_events").select("id,decision,reason,automated,created_at").order("created_at", { ascending: false }).limit(10);
      if (error) throw error;
      return data;
    },
  });

  const cards = stats.data ? [
    ["Wanachama", stats.data.members],
    [`Hai (dk ${stats.data.activity_window})`, stats.data.active],
    ["Ujumbe uliochapishwa", stats.data.published],
    ["Picha zinazosubiri", stats.data.pending_images],
    ["Vizuizi hai", stats.data.active_restrictions],
  ] : [];

  return (
    <div>
      <PageHeader title="Muhtasari" desc="Takwimu halisi kutoka kwenye hifadhidata." />
      {stats.isLoading ? <Loading /> : stats.error ? <ErrorState error={stats.error} /> : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {cards.map(([k, v]) => (
            <div key={k} className="rounded-xl border bg-card p-4">
              <p className="text-xs text-muted-foreground">{k}</p>
              <p className="mt-2 font-display text-2xl font-bold">{v}</p>
            </div>
          ))}
        </div>
      )}
      <h2 className="mb-3 mt-8 text-sm font-semibold">Shughuli za udhibiti za karibuni</h2>
      {events.isLoading ? <Loading /> : events.error ? <ErrorState error={events.error} /> : events.data!.length === 0 ? (
        <Empty title="Hakuna maamuzi ya udhibiti bado" hint="Maamuzi yataonekana hapa ujumbe ukianza kuingia kupitia Telegram." />
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {events.data!.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className="truncate">{e.reason ?? "—"}</span>
              <span className="flex items-center gap-2">
                <Pill tone={e.decision === "approved" ? "ok" : e.decision === "rejected" ? "bad" : "warn"}>{e.decision}</Pill>
                <time className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString("sw-TZ")}</time>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
