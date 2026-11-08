import { adminHead } from "@/lib/route-head";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Loading, ErrorState, Empty, PageHeader, Pill } from "@/components/admin/States";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { POLICY_LABELS } from "@/lib/content-policy";
import { PLATFORM_POLICY_KEY, parsePlatformPolicy, type PlatformPolicy } from "@/lib/platform-policy";
import { getFeedbackPhoto } from "@/lib/platform.functions";

export const Route = createFileRoute("/admin/jukwaa")({ head: () => adminHead("Jukwaa la bot"), component: PlatformPage });

type BotRow = { id: string; bot_username: string; is_active: boolean; platform_suspended: boolean; created_at: string; last_error: string | null; members: number; today: number; week: number; month: number; messages: number };

function PlatformPage() {
  const bots = useQuery({
    queryKey: ["platform-bots"],
    queryFn: async () => { const { data, error } = await supabase.rpc("get_platform_bots"); if (error) throw error; return data as BotRow[]; },
  });
  const sum = (k: keyof BotRow) => (bots.data ?? []).reduce((a, b) => a + Number(b[k]), 0);
  return (
    <div className="space-y-8">
      <PageHeader title="Jukwaa la bot" desc="Bot zote zilizounganishwa kupitia Bot Kuu — takwimu za jumla tu, bila taarifa binafsi." />
      {bots.isLoading ? <Loading /> : bots.error ? <ErrorState error={bots.error} /> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {([["Bot", bots.data!.length], ["Wanachama", sum("members")], ["Hai leo", sum("today")], ["Siku 7", sum("week")], ["Siku 30", sum("month")]] as const).map(([k, v]) => (
              <div key={k} className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">{k}</p><p className="mt-2 font-display text-2xl font-bold">{v}</p></div>
            ))}
          </div>
          {bots.data!.length === 0 ? <Empty title="Hakuna bot iliyounganishwa bado" hint="Bot zitaonekana hapa mtu akiunganisha TOKEN kwenye Bot Kuu." /> : (
            <div className="space-y-3">{bots.data!.map((b) => <BotCard key={b.id} b={b} />)}</div>
          )}
        </>
      )}
      <GlobalSettings />
      <Feedback />
    </div>
  );
}

function BotCard({ b }: { b: BotRow }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function toggle() {
    setBusy(true);
    const { error } = await supabase.rpc("set_bot_suspended", { _bot: b.id, _suspended: !b.platform_suspended });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(b.platform_suspended ? "Bot imewashwa" : "Bot imesimamishwa");
    qc.invalidateQueries({ queryKey: ["platform-bots"] });
  }
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold">@{b.bot_username}</p>
          <p className="text-xs text-muted-foreground">Imesajiliwa {new Date(b.created_at).toLocaleDateString("sw-TZ")}</p>
        </div>
        <div className="flex items-center gap-2">
          {b.platform_suspended ? <Pill tone="bad">Imesimamishwa</Pill> : b.is_active ? <Pill tone="ok">Hai</Pill> : <Pill tone="warn">Mmiliki ameizima</Pill>}
          <Button size="sm" variant={b.platform_suspended ? "default" : "outline"} disabled={busy} onClick={toggle}>{b.platform_suspended ? "Washa" : "Simamisha"}</Button>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-5 gap-2 text-center text-xs">
        {([["Wanachama", b.members], ["Leo", b.today], ["Siku 7", b.week], ["Siku 30", b.month], ["Ujumbe", b.messages]] as const).map(([k, v]) => (
          <div key={k} className="rounded-lg bg-muted/40 p-2"><p className="font-display text-base font-bold">{v}</p><p className="text-muted-foreground">{k}</p></div>
        ))}
      </div>
      {b.last_error && <p className="mt-2 truncate text-xs text-destructive">Hitilafu ya mwisho: {b.last_error}</p>}
    </div>
  );
}

const EXTRA_LABELS: Record<"votes" | "new_bots", string> = { votes: "✅/❌ Vitufe vya kura", new_bots: "➕ Usajili wa bot mpya" };

function GlobalSettings() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["platform-policy"],
    queryFn: async () => { const { data, error } = await supabase.from("system_settings").select("value").eq("key", PLATFORM_POLICY_KEY).maybeSingle(); if (error) throw error; return parsePlatformPolicy(data?.value); },
  });
  async function set(k: keyof PlatformPolicy, v: boolean) {
    const next = { ...q.data!, [k]: v };
    const { error } = await supabase.from("system_settings").upsert({ key: PLATFORM_POLICY_KEY, value: next, updated_at: new Date().toISOString() });
    if (error) { toast.error(error.message); return; }
    qc.setQueryData(["platform-policy"], next);
  }
  const labels = { ...POLICY_LABELS, ...EXTRA_LABELS } as Record<keyof PlatformPolicy, string>;
  return (
    <section className="rounded-2xl border bg-card p-5">
      <h2 className="text-sm font-semibold">Mipangilio ya jumla (bot zote)</h2>
      <p className="mt-1 text-xs text-muted-foreground">Ukizima kipengele hapa, kinazimwa kwenye bot zote mara moja — hata kama mmiliki wa bot amekiruhusu.</p>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {(Object.keys(labels) as (keyof PlatformPolicy)[]).map((k) => (
            <label key={k} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
              {labels[k]}<Switch checked={q.data![k]} onCheckedChange={(v) => set(k, v)} />
            </label>
          ))}
        </div>
      )}
    </section>
  );
}

const KIND: Record<string, string> = { idea: "💡 Pendekezo", problem: "⚠️ Changamoto", praise: "🌟 Pongezi" };

function Feedback() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["platform-feedback"],
    queryFn: async () => {
      const { data, error } = await supabase.from("platform_feedback").select("id,kind,body,photo_file_id,status,created_at,tenant_bots(bot_username)").order("created_at", { ascending: false }).limit(100);
      if (error) throw error; return data;
    },
  });
  async function seen(id: string) {
    await supabase.from("platform_feedback").update({ status: "seen" }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["platform-feedback"] });
  }
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">Ripoti kutoka kwa wamiliki wa bot</h2>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : q.data!.length === 0 ? <Empty title="Hakuna ripoti bado" hint="Wamiliki wakituma mapendekezo, changamoto au pongezi kupitia Bot Kuu, zitaonekana hapa." /> : (
        <ul className="space-y-2">
          {q.data!.map((f) => (
            <li key={f.id} className="rounded-xl border bg-card p-4 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{KIND[f.kind]}{f.tenant_bots?.bot_username ? ` · @${f.tenant_bots.bot_username}` : ""}</span>
                <span className="flex items-center gap-2">
                  {f.status === "new" ? <Button size="sm" variant="outline" onClick={() => seen(f.id)}>Nimeiona</Button> : <Pill tone="ok">Imeonwa</Pill>}
                </span>
              </div>
              {f.body && <p className="mt-2 whitespace-pre-wrap">{f.body}</p>}
              {f.photo_file_id && <FeedbackPhoto id={f.id} />}
              <time className="mt-2 block text-xs text-muted-foreground">{new Date(f.created_at).toLocaleString("sw-TZ")}</time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FeedbackPhoto({ id }: { id: string }) {
  const fetchPhoto = useServerFn(getFeedbackPhoto);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (url) return <img src={url} alt="Picha ya ripoti" className="mt-2 max-h-80 rounded-lg" />;
  return <Button size="sm" variant="ghost" className="mt-2" disabled={busy} onClick={async () => { setBusy(true); try { const r = await fetchPhoto({ data: { id } }); if (r.url) setUrl(r.url); else toast.error("Picha haipatikani"); } catch (e) { toast.error((e as Error).message); } setBusy(false); }}>🖼 Onyesha picha</Button>;
}
