import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, type FormEvent } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Logo } from "@/components/brand/Logo";
import { TzFlag } from "@/components/brand/TzFlag";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/ingia")({
  head: () => ({
    meta: [
      { title: "Ingia — EL-NINO Wasimamizi" },
      { name: "description", content: "Ingia kwenye dashibodi ya wasimamizi wa EL-NINO." },
      { property: "og:title", content: "Ingia — EL-NINO Wasimamizi" },
      { property: "og:description", content: "Dashibodi salama ya usimamizi wa jamii." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) nav({ to: "/admin" });
  }, [user, nav]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + "/admin" },
        });
        if (error) throw error;
        toast.success("Angalia barua pepe yako kuthibitisha akaunti.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Imeshindikana");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flag-rule" />
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 px-5 py-10">
        <Logo />
        <div className="flex flex-col gap-2">
          <TzFlag className="h-8 w-auto self-start rounded ring-1 ring-border" />
          <h1 className="text-2xl font-bold">{mode === "in" ? "Karibu tena" : "Fungua akaunti"}</h1>
          <p className="text-sm text-muted-foreground">
            Kwa wasimamizi pekee. Kufungua akaunti hakukupi ruhusa yoyote — mmiliki ndiye anayetoa ruhusa.
          </p>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="email">Barua pepe</Label>
            <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pw">Nenosiri</Label>
            <Input id="pw" type="password" required minLength={8} autoComplete={mode === "in" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <Button type="submit" disabled={busy} size="lg">
            {busy ? "Subiri…" : mode === "in" ? "Ingia" : "Jisajili"}
          </Button>
        </form>
        <button type="button" onClick={() => setMode(mode === "in" ? "up" : "in")} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          {mode === "in" ? "Huna akaunti? Jisajili" : "Una akaunti? Ingia"}
        </button>
      </main>
    </div>
  );
}
