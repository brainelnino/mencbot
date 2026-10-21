import { adminHead } from "@/lib/route-head";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Loading, ErrorState, Empty, PageHeader, Pill } from "@/components/admin/States";

export const Route = createFileRoute("/admin/wanachama")({ head: () => adminHead("Wanachama"), component: Members });

function Members() {
  // Never selects telegram_user_id — private identifiers stay out of the UI.
  const q = useQuery({
    queryKey: ["members"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("members")
        .select("id,status,registered_at,last_active_at,public_identities(label,identity_generations(label))")
        .order("registered_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  return (
    <div>
      <PageHeader title="Wanachama" desc="Utambulisho wa umma pekee. Taarifa za Telegram hazionyeshwi." />
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : q.data!.length === 0 ? (
        <Empty title="Hakuna wanachama bado" hint="Wanachama watasajiliwa wakianza kutumia Telegram bot. Utambulisho utatolewa kiotomatiki kwa kizazi kinachofuata." />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr><th className="p-3">Utambulisho</th><th className="p-3">Kizazi</th><th className="p-3">Alisajiliwa</th><th className="p-3">Mara ya mwisho</th><th className="p-3">Hali</th></tr>
            </thead>
            <tbody className="divide-y">
              {q.data!.map((m) => {
                const pid = Array.isArray(m.public_identities) ? m.public_identities[0] : m.public_identities;
                return (
                  <tr key={m.id}>
                    <td className="p-3 identity-chip">{pid?.label ?? "—"}</td>
                    <td className="p-3">{pid?.identity_generations?.label ?? "—"}</td>
                    <td className="p-3">{new Date(m.registered_at).toLocaleDateString("sw-TZ")}</td>
                    <td className="p-3">{m.last_active_at ? new Date(m.last_active_at).toLocaleString("sw-TZ") : "—"}</td>
                    <td className="p-3"><Pill tone={m.status === "active" ? "ok" : m.status === "banned" ? "bad" : "warn"}>{m.status}</Pill></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
