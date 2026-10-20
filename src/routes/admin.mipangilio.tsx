import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Loading, ErrorState, PageHeader, Pill } from "@/components/admin/States";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/admin/mipangilio")({ component: SettingsPage });

function SettingsPage() {
  const gens = useQuery({
    queryKey: ["generations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("identity_generations").select("*").order("sort_order");
      if (error) throw error;
      return data;
    },
  });
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("system_settings").select("key,value");
      if (error) throw error;
      return data;
    },
  });
  const tg = useQuery({
    queryKey: ["tg"],
    queryFn: async () => {
      const { data, error } = await supabase.from("telegram_config").select("bot_username,webhook_registered").maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Mipangilio" desc="Mabadiliko yote yanarekodiwa kwenye kumbukumbu za ukaguzi." />

      <section>
        <h2 className="mb-1 text-sm font-semibold">Vizazi vya utambulisho</h2>
        <p className="mb-3 text-xs text-muted-foreground">Namba 1–9 zimehifadhiwa kwa wasimamizi. Utambulisho uliotolewa hautarudishwa kwa mtu mwingine.</p>
        {gens.isLoading ? <Loading /> : gens.error ? <ErrorState error={gens.error} /> : (
          <div className="flex flex-col gap-3">{gens.data!.map((g) => <GenRow key={g.id} g={g} />)}</div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Mipangilio ya mfumo</h2>
        {settings.isLoading ? <Loading /> : settings.error ? <ErrorState error={settings.error} /> : (
          <ul className="divide-y rounded-xl border bg-card text-sm">
            {settings.data!.map((s) => (
              <li key={s.key} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:justify-between">
                <span className="font-medium">{s.key}</span>
                <code className="text-xs text-muted-foreground">{JSON.stringify(s.value)}</code>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Telegram</h2>
        <div className="flex items-center justify-between rounded-xl border bg-card p-4 text-sm">
          <span>{tg.data?.bot_username ? `@${tg.data.bot_username}` : "Bot haijasanidiwa"}</span>
          <Pill tone={tg.data?.webhook_registered ? "ok" : "warn"}>{tg.data?.webhook_registered ? "Imeunganishwa" : "Haijaunganishwa"}</Pill>
        </div>
      </section>
    </div>
  );
}

type Gen = { id: string; label: string; kind: "numeric" | "alpha"; range_start: number | null; range_end: number | null; is_active: boolean };

function GenRow({ g }: { g: Gen }) {
  const qc = useQueryClient();
  const [start, setStart] = useState(String(g.range_start ?? ""));
  const [end, setEnd] = useState(String(g.range_end ?? ""));
  const save = useMutation({
    mutationFn: async () => {
      const s = Number(start), e = Number(end);
      if (!Number.isInteger(s) || !Number.isInteger(e) || s < 10 || e < s) throw new Error("Masafa si sahihi (kuanzia 10, mwisho ≥ mwanzo)");
      const { error } = await supabase.from("identity_generations").update({ range_start: s, range_end: e }).eq("id", g.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Imehifadhiwa"); qc.invalidateQueries({ queryKey: ["generations"] }); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4">
      <span className="w-28 font-semibold">{g.label}</span>
      {g.kind === "alpha" ? (
        <span className="text-sm text-muted-foreground">Herufi A–Z</span>
      ) : (
        <>
          <Input className="w-24" inputMode="numeric" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Mwanzo" />
          <span className="text-muted-foreground">–</span>
          <Input className="w-24" inputMode="numeric" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="Mwisho" />
          <Button size="sm" variant="secondary" onClick={() => save.mutate()} disabled={save.isPending}>Hifadhi</Button>
        </>
      )}
      <Pill tone={g.is_active ? "ok" : "muted"}>{g.is_active ? "Hai" : "Imezimwa"}</Pill>
    </div>
  );
}
