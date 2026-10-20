import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Crown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Loading, ErrorState, PageHeader, Pill } from "@/components/admin/States";
import { permissionLabels } from "@/lib/i18n";

export const Route = createFileRoute("/admin/wasimamizi")({ component: Admins });

function Admins() {
  const q = useQuery({
    queryKey: ["admins"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_accounts")
        .select("id,is_owner,admin_slot,display_label,is_active,admin_permission_grants(permission)")
        .order("is_owner", { ascending: false })
        .order("admin_slot");
      if (error) throw error;
      return data;
    },
  });

  return (
    <div>
      <PageHeader title="Wasimamizi" desc="Mmiliki mmoja na hadi wasaidizi 9 (nafasi 1–9). Namba haitoi ruhusa — ruhusa hutolewa moja moja." />
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : (
        <ul className="grid gap-3 md:grid-cols-2">
          {q.data!.map((a) => (
            <li key={a.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  {a.is_owner && <Crown className="h-4 w-4 text-primary" />}
                  <span className="identity-chip text-sm">{a.display_label}</span>
                  {a.admin_slot && <span className="text-xs text-muted-foreground">Nafasi {a.admin_slot}</span>}
                </span>
                <Pill tone={a.is_active ? "ok" : "bad"}>{a.is_active ? "Hai" : "Imezimwa"}</Pill>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {a.is_owner ? <Pill>Ruhusa zote</Pill> : a.admin_permission_grants.length === 0 ? (
                  <span className="text-xs text-muted-foreground">Hakuna ruhusa</span>
                ) : a.admin_permission_grants.map((g) => <Pill key={g.permission}>{permissionLabels[g.permission]}</Pill>)}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-6 text-xs text-muted-foreground">
        Kuongeza wasaidizi kutawezeshwa hatua inayofuata (mwaliko + uthibitisho wa Telegram). Muundo wa ruhusa tayari unalindwa na hifadhidata.
      </p>
    </div>
  );
}
