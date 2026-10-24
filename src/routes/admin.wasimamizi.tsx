import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Loading, ErrorState, PageHeader, Pill, Empty } from "@/components/admin/States";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { adminHead } from "@/lib/route-head";

export const Route = createFileRoute("/admin/wasimamizi")({ head: () => adminHead("Wasimamizi wa Telegram"), component: Admins });
function Admins() {
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [slot, setSlot] = useState("1");
  const q = useQuery({ queryKey: ["telegram-admins"], queryFn: async () => {
    const { data, error } = await supabase.from("telegram_admins").select("id,admin_slot,is_active,members(public_identities(label))").order("admin_slot");
    if (error) throw error;
    return data ?? [];
  } });
  const members = useQuery({ queryKey: ["active-member-labels"], queryFn: async () => {
    const { data, error } = await supabase.from("members").select("id,public_identities(label)").eq("status", "active");
    if (error) throw error;
    return (data ?? [])
      .map((m) => ({ id: m.id, label: (m.public_identities as { label: string } | null)?.label }))
      .filter((m): m is { id: string; label: string } => !!m.label)
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  } });
  const appoint = useMutation({ mutationFn: async () => {
    const { error } = await supabase.rpc("appoint_telegram_admin", { _label: label, _slot: Number(slot) });
    if (error) throw error;
  }, onSuccess: () => { setLabel(""); toast.success(t.assistants.success); qc.invalidateQueries({ queryKey: ["telegram-admins"] }); }, onError: (e) => toast.error(e.message) });
  const toggle = useMutation({ mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
    const { error } = await supabase.rpc("set_telegram_admin_active", { _id: id, _active: active });
    if (error) throw error;
  }, onSuccess: () => qc.invalidateQueries({ queryKey: ["telegram-admins"] }), onError: (e) => toast.error(e.message) });
  function submit(e: FormEvent) { e.preventDefault(); appoint.mutate(); }
  return <div>
    <PageHeader title={t.assistants.title} />
    <form onSubmit={submit} className="mb-6 flex flex-wrap items-end gap-3">
      <div className="grid gap-2"><Label htmlFor="member-label">{t.assistants.label}</Label>
        <select id="member-label" required value={label} onChange={(e) => setLabel(e.target.value)} className="flex h-9 min-w-32 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
          <option value="" disabled>{t.assistants.choose}</option>
          {(members.data ?? []).map((m) => <option key={m.id} value={m.label}>{m.label}</option>)}
        </select>
      </div>
      <div className="grid gap-2"><Label htmlFor="admin-slot">{t.assistants.slot}</Label><Input id="admin-slot" className="w-20" type="number" min={1} max={9} required value={slot} onChange={(e) => setSlot(e.target.value)} /></div>
      <Button type="submit" disabled={appoint.isPending}>{t.assistants.appoint}</Button>
    </form>
    {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : !q.data?.length ? <Empty title={t.assistants.empty} /> :
      <ul className="grid gap-3 md:grid-cols-2">{q.data.map((a) => <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
        <span className="identity-chip">{a.admin_slot} <span className="text-xs text-muted-foreground">({a.members?.public_identities?.label ?? "—"})</span></span>
        <Pill tone={a.is_active ? "ok" : "bad"}>{a.is_active ? t.assistants.active : t.assistants.inactive}</Pill>
        <Button size="sm" variant="outline" disabled={toggle.isPending} onClick={() => toggle.mutate({ id: a.id, active: !a.is_active })}>{a.is_active ? t.assistants.disable : t.assistants.enable}</Button>
      </li>)}</ul>}
  </div>;
}
