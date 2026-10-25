import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/admin/States";
import { OFFICES, SLOT_TITLES, type OfficeKey } from "@/lib/office-config";
import { saveOfficeToken, setOfficeActive } from "@/lib/office.functions";

export function OfficesPanel() {
  const qc = useQueryClient();
  const save = useServerFn(saveOfficeToken);
  const toggle = useServerFn(setOfficeActive);
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const bots = useQuery({ queryKey: ["office-bots"], queryFn: async () => {
    const { data, error } = await supabase.from("office_bots").select("office,bot_username,is_active,last_error,last_update_at");
    if (error) throw error;
    return data ?? [];
  } });
  const log = useQuery({ queryKey: ["office-log"], queryFn: async () => {
    const { data, error } = await supabase.from("audit_events").select("id,action,details,created_at")
      .or("action.like.raisi.%,action.like.office.%").order("created_at", { ascending: false }).limit(15);
    if (error) throw error;
    return data ?? [];
  } });
  const saveM = useMutation({
    mutationFn: (office: OfficeKey) => save({ data: { office, token: tokens[office] ?? "" } }),
    onSuccess: (r, office) => { toast.success(`@${r.username} sasa iko hai`); setTokens((t) => ({ ...t, [office]: "" })); qc.invalidateQueries({ queryKey: ["office-bots"] }); qc.invalidateQueries({ queryKey: ["office-log"] }); },
    onError: (e) => toast.error(e.message),
  });
  const toggleM = useMutation({
    mutationFn: (v: { office: OfficeKey; active: boolean }) => toggle({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["office-bots"] }),
    onError: (e) => toast.error(e.message),
  });

  return <section className="mt-10">
    <h2 className="mb-1 text-lg font-semibold">Ofisi za Uongozi (Bots)</h2>
    <p className="mb-4 text-sm text-muted-foreground">Tengeneza bot kwa @BotFather, bandika TOKEN hapa. Bot ikifungwa, weka TOKEN mpya — ofisi inahamia bot mpya papo hapo.</p>
    <ul className="grid gap-3 md:grid-cols-2">
      {OFFICES.map((o) => {
        const b = bots.data?.find((x) => x.office === o.key);
        return <li key={o.key} className="rounded-lg border bg-card p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{o.title}</span>
            <Pill tone={b?.is_active ? "ok" : "bad"}>{b?.is_active ? "Hai" : b?.bot_username ? "Imezimwa" : "Haijaunganishwa"}</Pill>
          </div>
          <p className="text-xs text-muted-foreground">Nafasi: {o.slots.map((s) => `${s} ${SLOT_TITLES[s]}`).join(", ")}</p>
          {b?.bot_username && <p className="mt-1 text-sm">@{b.bot_username}</p>}
          {!o.ready && <p className="mt-1 text-xs text-muted-foreground">Zana za ofisi hii zinaandaliwa; kwa sasa bot inamkaribisha kiongozi tu.</p>}
          {b?.last_error && <p className="mt-1 text-xs text-destructive">{b.last_error}</p>}
          <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); saveM.mutate(o.key); }}>
            <Input type="password" autoComplete="off" placeholder={b?.bot_username ? "TOKEN mpya" : "TOKEN ya bot"} aria-label={`TOKEN ${o.title}`}
              value={tokens[o.key] ?? ""} onChange={(e) => setTokens((t) => ({ ...t, [o.key]: e.target.value }))} />
            <Button type="submit" size="sm" disabled={saveM.isPending || !(tokens[o.key] ?? "").trim()}>Hifadhi</Button>
          </form>
          {b?.bot_username && <Button className="mt-2" size="sm" variant="outline" disabled={toggleM.isPending}
            onClick={() => toggleM.mutate({ office: o.key, active: !b.is_active })}>{b.is_active ? "Zima ofisi" : "Washa ofisi"}</Button>}
        </li>;
      })}
    </ul>
    <h3 className="mb-2 mt-6 font-medium">Vitendo vya hivi karibuni</h3>
    {!log.data?.length ? <p className="text-sm text-muted-foreground">Bado hakuna vitendo.</p> :
      <ul className="grid gap-1 text-sm">{log.data.map((e) => <li key={e.id} className="flex justify-between gap-3 border-b py-1">
        <span>{e.action} <span className="text-muted-foreground">{JSON.stringify(e.details)}</span></span>
        <span className="shrink-0 text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString("sw-TZ")}</span>
      </li>)}</ul>}
  </section>;
}
