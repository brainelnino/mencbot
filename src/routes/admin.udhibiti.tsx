import { adminHead } from "@/lib/route-head";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Loading, ErrorState, Empty, PageHeader } from "@/components/admin/States";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/admin/udhibiti")({ head: () => adminHead("Udhibiti"), component: Moderation });

function Moderation() {
  return (
    <div>
      <PageHeader title="Udhibiti" desc="Foleni ya ukaguzi na sheria za usalama. Ruhusa zinakaguliwa na hifadhidata." />
      <Tabs defaultValue="queue">
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="queue">Foleni</TabsTrigger>
          <TabsTrigger value="terms">Maneno</TabsTrigger>
          <TabsTrigger value="rules">Sheria</TabsTrigger>
        </TabsList>
        <TabsContent value="queue"><Queue /></TabsContent>
        <TabsContent value="terms"><Terms /></TabsContent>
        <TabsContent value="rules"><Rules /></TabsContent>
      </Tabs>
    </div>
  );
}

function Queue() {
  const imgs = useQuery({
    queryKey: ["img-queue"],
    queryFn: async () => {
      const { data, error } = await supabase.from("image_submissions").select("id,created_at").eq("status", "pending").limit(50);
      if (error) throw error;
      return data;
    },
  });
  const pending = useQuery({
    queryKey: ["msg-queue"],
    queryFn: async () => {
      const { data, error } = await supabase.from("messages").select("id").in("moderation_status", ["pending", "flagged"]).limit(50);
      if (error) throw error;
      return data;
    },
  });
  if (imgs.isLoading || pending.isLoading) return <Loading />;
  if (imgs.error) return <ErrorState error={imgs.error} />;
  if (pending.error) return <ErrorState error={pending.error} />;
  if (imgs.data!.length + pending.data!.length === 0)
    return <Empty title="Foleni iko tupu" hint="Ukaguzi wa picha na ujumbe ulioripotiwa utaanza baada ya Telegram bot kuunganishwa." />;
  return <p className="text-sm">{pending.data!.length} ujumbe na {imgs.data!.length} picha zinasubiri ukaguzi.</p>;
}

function Terms() {
  const qc = useQueryClient();
  const [term, setTerm] = useState("");
  const terms = useQuery({
    queryKey: ["terms"],
    queryFn: async () => {
      const { data, error } = await supabase.from("blocked_terms").select("id,term,severity,created_at").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const add = useMutation({
    mutationFn: async (value: string) => {
      const { error } = await supabase.from("blocked_terms").insert({ term: value });
      if (error) throw error;
    },
    onSuccess: () => { setTerm(""); toast.success("Neno limeongezwa"); qc.invalidateQueries({ queryKey: ["terms"] }); },
    onError: (e) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("blocked_terms").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["terms"] }),
    onError: (e) => toast.error(e.message),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    const v = term.trim();
    if (v.length < 2 || v.length > 60) { toast.error("Neno liwe herufi 2–60"); return; }
    add.mutate(v);
  }
  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} className="flex gap-2">
        <Input placeholder="Neno la kuzuia" value={term} onChange={(e) => setTerm(e.target.value)} maxLength={60} />
        <Button type="submit" disabled={add.isPending}>Ongeza</Button>
      </form>
      {terms.isLoading ? <Loading /> : terms.error ? <ErrorState error={terms.error} /> : terms.data!.length === 0 ? (
        <Empty title="Hakuna maneno yaliyozuiliwa" />
      ) : (
        <ul className="flex flex-wrap gap-2">
          {terms.data!.map((t) => (
            <li key={t.id} className="flex items-center gap-1 rounded-full border bg-card py-1 pl-3 pr-1 text-sm">
              {t.term}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Futa"><Trash2 className="h-3.5 w-3.5" /></Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Futa “{t.term}”?</AlertDialogTitle>
                    <AlertDialogDescription>Neno hili halitazuiliwa tena. Kitendo hiki kinarekodiwa.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Ghairi</AlertDialogCancel>
                    <AlertDialogAction onClick={() => del.mutate(t.id)}>Futa</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Rules() {
  const rules = useQuery({
    queryKey: ["rules"],
    queryFn: async () => {
      const { data, error } = await supabase.from("moderation_rules").select("id,rule_type,name,is_enabled");
      if (error) throw error;
      return data;
    },
  });
  if (rules.isLoading) return <Loading />;
  if (rules.error) return <ErrorState error={rules.error} />;
  return (
    <div className="flex flex-col gap-3">
      {rules.data!.length === 0 ? (
        <Empty title="Hakuna sheria maalum bado" hint="Sheria za viungo, faragha (namba za simu) na spam zitasimamiwa hapa. Injini ya udhibiti itazitekeleza upande wa seva." />
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {rules.data!.map((r) => (
            <li key={r.id} className="flex justify-between px-4 py-3 text-sm"><span>{r.name}</span><span className="text-muted-foreground">{r.rule_type}</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}
