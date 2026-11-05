import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useBrand } from "@/hooks/useBrand";
import { parsePolicy, POLICY_LABELS, type ContentPolicy } from "@/lib/content-policy";
import { parseVotePolicy, type VotePolicy } from "@/lib/vote-policy";
import { t } from "@/lib/i18n";
import { Loading, ErrorState } from "@/components/admin/States";

async function saveSetting(key: string, value: unknown) {
  const { error } = await supabase.from("system_settings").upsert({ key, value: value as never, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export function BrandContentPanel() {
  const qc = useQueryClient();
  const brand = useBrand();
  const [name, setName] = useState(brand);
  useEffect(() => setName(brand), [brand]);
  const rename = useMutation({
    mutationFn: async () => { const n = name.trim(); if (n.length < 2 || n.length > 40) throw new Error("Jina liwe herufi 2 hadi 40"); await saveSetting("brand_name", n); },
    onSuccess: () => { toast.success("Jina limebadilishwa kwenye mfumo wote"); qc.invalidateQueries({ queryKey: ["brand-name"] }); },
    onError: (e) => toast.error(e.message),
  });

  const policy = useQuery({ queryKey: ["content-policy"], queryFn: async () => {
    const { data, error } = await supabase.from("system_settings").select("value").eq("key", "content_policy").maybeSingle();
    if (error) throw error;
    return parsePolicy(data?.value);
  } });
  const toggle = useMutation({
    mutationFn: async (next: ContentPolicy) => saveSetting("content_policy", next),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["content-policy"] }),
    onError: (e) => toast.error(e.message),
  });

  const members = useQuery({ queryKey: ["exempt-members"], queryFn: async () => {
    const { data, error } = await supabase.from("members").select("id,can_send_restricted,public_identities(label)").eq("status", "active");
    if (error) throw error;
    return (data ?? []).map((m) => ({ id: m.id, exempt: m.can_send_restricted, label: (m.public_identities as { label: string } | null)?.label ?? "" }))
      .filter((m) => m.label).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  } });
  const [pick, setPick] = useState("");
  const exempt = useMutation({
    mutationFn: async ({ id, on }: { id: string; on: boolean }) => { const { error } = await supabase.rpc("set_member_exempt", { _member_id: id, _exempt: on }); if (error) throw error; },
    onSuccess: () => { setPick(""); qc.invalidateQueries({ queryKey: ["exempt-members"] }); },
    onError: (e) => toast.error(e.message),
  });

  const list = members.data ?? [];
  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-1 text-sm font-semibold">Jina la mfumo</h2>
        <p className="mb-3 text-xs text-muted-foreground">Linaonekana kwenye tovuti na ujumbe wa karibu wa bot.</p>
        <div className="flex flex-wrap gap-2">
          <Input className="max-w-xs" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label="Jina la mfumo" />
          <Button onClick={() => rename.mutate()} disabled={rename.isPending || name.trim() === brand}>Badili jina</Button>
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-sm font-semibold">Vinavyoruhusiwa kutumwa</h2>
        <p className="mb-3 text-xs text-muted-foreground">Kilichozimwa hakitumwi; mtumaji anaarifiwa faraghani.</p>
        {policy.data && (
          <ul className="grid gap-2 sm:grid-cols-3">
            {(Object.keys(POLICY_LABELS) as (keyof ContentPolicy)[]).map((k) => (
              <li key={k} className="flex items-center justify-between rounded-lg border bg-card px-3 py-2 text-sm">
                <span>{POLICY_LABELS[k]}</span>
                <Switch checked={policy.data[k]} disabled={toggle.isPending} onCheckedChange={(v) => toggle.mutate({ ...policy.data, [k]: v })} aria-label={POLICY_LABELS[k]} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <VoteControls />

      <section>
        <h2 className="mb-1 text-sm font-semibold">ID maalumu (zinaruhusiwa kila kitu)</h2>
        <p className="mb-3 text-xs text-muted-foreground">Hawa wanaweza kutuma picha, faili, link na namba hata zikiwa zimezimwa. Maneno yaliyozuiliwa bado yanazuiwa.</p>
        <div className="mb-3 flex flex-wrap gap-2">
          <select value={pick} onChange={(e) => setPick(e.target.value)} className="flex h-9 min-w-32 rounded-md border border-input bg-transparent px-3 text-sm" aria-label="Chagua ID">
            <option value="" disabled>Chagua ID…</option>
            {list.filter((m) => !m.exempt).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <Button disabled={!pick || exempt.isPending} onClick={() => exempt.mutate({ id: pick, on: true })}>Ruhusu</Button>
        </div>
        <ul className="flex flex-wrap gap-2">
          {list.filter((m) => m.exempt).map((m) => (
            <li key={m.id} className="flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-sm">
              <span className="identity-chip">{m.label}</span>
              <Button size="sm" variant="ghost" onClick={() => exempt.mutate({ id: m.id, on: false })}>Ondoa</Button>
            </li>
          ))}
          {!list.some((m) => m.exempt) && <li className="text-xs text-muted-foreground">Hakuna ID maalumu bado.</li>}
        </ul>
      </section>
    </div>
  );
}

function VoteControls() {
  const qc = useQueryClient();
  const policy = useQuery({ queryKey: ["vote-policy"], queryFn: async () => {
    const { data, error } = await supabase.from("system_settings").select("value").eq("key", "vote_policy").maybeSingle();
    if (error) throw error;
    return parseVotePolicy(data?.value);
  } });
  const save = useMutation({
    mutationFn: (next: VotePolicy) => saveSetting("vote_policy", next),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["vote-policy"] });
      await qc.invalidateQueries({ queryKey: ["settings"] });
      toast.success(t.voteControls.saved);
    },
    onError: (e) => toast.error(e.message),
  });
  return <section>
    <h2 className="mb-3 text-sm font-semibold">{t.voteControls.title}</h2>
    {policy.isLoading ? <Loading /> : policy.error ? <ErrorState error={policy.error} /> : policy.data ? (
      <ul className="grid gap-2 sm:grid-cols-2">
        {(["text", "media"] as const).map((key) => <li key={key} className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2 text-sm">
          <span>{t.voteControls[key]}</span>
          <Switch aria-label={`${t.voteControls.title}: ${t.voteControls[key]}`} checked={policy.data[key]} disabled={save.isPending || policy.isFetching} onCheckedChange={(on) => save.mutate({ ...policy.data, [key]: on } as VotePolicy)} />
        </li>)}
      </ul>
    ) : null}
  </section>;
}
