import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Logo } from "@/components/brand/Logo";
import { TzFlag } from "@/components/brand/TzFlag";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { unlockWithPin } from "@/lib/pin.functions";

export const Route = createFileRoute("/ingia")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Ingia — EL-NINO Mmiliki" },
      { name: "description", content: "Weka PIN kufungua dashibodi ya EL-NINO." },
      { property: "og:title", content: "Ingia — EL-NINO Mmiliki" },
      { property: "og:description", content: "Dashibodi ya mmiliki mkuu." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PinPage,
});

function PinPage() {
  const nav = useNavigate();
  const { user } = useAuth();
  const unlock = useServerFn(unlockWithPin);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (user) nav({ to: "/admin" }); }, [user, nav]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await unlock({ data: { pin } });
      if (!r.ok) { toast.error("PIN si sahihi"); setPin(""); return; }
      const { error } = await supabase.auth.setSession({ access_token: r.access_token, refresh_token: r.refresh_token });
      if (error) throw error;
      nav({ to: "/admin" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Imeshindikana");
    } finally { setBusy(false); }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flag-rule" />
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 px-5 py-10">
        <Logo />
        <div className="flex flex-col gap-2">
          <TzFlag className="h-8 w-auto self-start rounded ring-1 ring-border" />
          <h1 className="text-2xl font-bold">Mmiliki mkuu</h1>
          <p className="text-sm text-muted-foreground">Weka PIN yako kufungua udhibiti kamili.</p>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Input type="password" inputMode="text" autoComplete="current-password" required aria-label="PIN"
            placeholder="PIN" value={pin} onChange={(e) => setPin(e.target.value)} className="h-12 text-center text-lg tracking-widest" />
          <Button type="submit" size="lg" disabled={busy || !pin}>{busy ? "Subiri…" : "Fungua"}</Button>
        </form>
      </main>
    </div>
  );
}
