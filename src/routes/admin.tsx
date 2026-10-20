import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, MessagesSquare, ShieldAlert, Users, UserCog, Brain, Settings, LogOut, Crown } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAdmin } from "@/lib/admin";
import { Logo } from "@/components/brand/Logo";
import { TzFlag } from "@/components/brand/TzFlag";
import { Loading } from "@/components/admin/States";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "@/lib/i18n";

export const Route = createFileRoute("/admin")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Dashibodi — EL-NINO" },
      { name: "description", content: "Dashibodi ya mmiliki na wasimamizi wa EL-NINO." },
      { property: "og:title", content: "Dashibodi — EL-NINO" },
      { property: "og:description", content: "Usimamizi wa jamii ya EL-NINO." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminLayout,
});

const NAV = [
  { to: "/admin", label: t.nav.overview, icon: LayoutDashboard },
  { to: "/admin/jamii", label: t.nav.community, icon: MessagesSquare },
  { to: "/admin/udhibiti", label: t.nav.moderation, icon: ShieldAlert },
  { to: "/admin/wanachama", label: t.nav.members, icon: Users },
  { to: "/admin/wasimamizi", label: t.nav.admins, icon: UserCog },
  { to: "/admin/brain", label: t.nav.brain, icon: Brain },
  { to: "/admin/mipangilio", label: t.nav.settings, icon: Settings },
] as const;

function AdminLayout() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const admin = useAdmin(user?.id);

  useEffect(() => {
    if (!loading && !user) nav({ to: "/ingia" });
  }, [loading, user, nav]);

  if (loading || !user || admin.isLoading) return <div className="p-6"><Loading /></div>;
  if (!admin.data?.isOwner) return <NotAdmin />;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar p-4 md:flex">
        <Logo />
        <div className="flag-rule mt-4 rounded-full" />
        <nav className="mt-6 flex flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to} activeOptions={{ exact: to === "/admin" }}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground data-[status=active]:bg-sidebar-accent data-[status=active]:text-foreground">
              <Icon className="h-4 w-4" /> {label}
            </Link>
          ))}
        </nav>
        <SelfCard label={admin.data.label} owner={admin.data.isOwner} />
      </aside>

      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <Logo compact />
          <SignOut />
        </div>
        <div className="flag-rule" />
      </header>

      <main className="flex-1 px-4 pb-24 pt-6 md:px-8 md:pb-10">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-10 flex justify-around border-t bg-sidebar py-1.5 md:hidden">
        {NAV.map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to} activeOptions={{ exact: to === "/admin" }}
            className="flex flex-col items-center gap-0.5 rounded-md px-1.5 py-1 text-[9px] text-muted-foreground data-[status=active]:text-primary">
            <Icon className="h-5 w-5" />
            <span className="max-w-14 truncate">{label.replace("EL-NINO ", "")}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

function SelfCard({ label, owner }: { label: string; owner: boolean }) {
  return (
    <div className="mt-auto flex items-center justify-between rounded-xl border bg-card p-3">
      <div className="flex items-center gap-2">
        {owner && <Crown className="h-4 w-4 text-primary" />}
        <div>
          <p className="identity-chip">{label}</p>
          <p className="text-[11px] text-muted-foreground">{owner ? "Mmiliki" : "Msimamizi"}</p>
        </div>
      </div>
      <SignOut />
    </div>
  );
}

function SignOut() {
  const nav = useNavigate();
  const qc = useQueryClient();
  return (
    <Button variant="ghost" size="icon" aria-label="Toka" onClick={async () => { await qc.cancelQueries(); qc.clear(); await supabase.auth.signOut(); nav({ to: "/ingia", replace: true }); }}>
      <LogOut className="h-4 w-4" />
    </Button>
  );
}

function NotAdmin() {
  const qc = useQueryClient();
  const ownerExists = useQuery({
    queryKey: ["owner-exists"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("owner_exists");
      if (error) throw error;
      return data as boolean;
    },
  });
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  async function claim(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.rpc("claim_ownership", { _display_label: label });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Wewe sasa ni mmiliki wa mfumo.");
    qc.invalidateQueries();
  }

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flag-rule" />
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-5">
        <TzFlag className="h-8 w-auto self-start rounded ring-1 ring-border" />
        {ownerExists.isLoading ? <Loading /> : ownerExists.data === false ? (
          <form onSubmit={claim} className="flex flex-col gap-4">
            <h1 className="text-2xl font-bold">Sanidi mmiliki</h1>
            <p className="text-sm text-muted-foreground">
              Mfumo hauna mmiliki bado. Akaunti ya kwanza kudai umiliki itakuwa mmiliki pekee. Chagua utambulisho wako wa umma (k.m. 1 au EL).
            </p>
            <Input required maxLength={12} placeholder="Utambulisho wa umma" value={label} onChange={(e) => setLabel(e.target.value)} />
            <Button type="submit" disabled={busy}>{busy ? "Subiri…" : "Dai umiliki"}</Button>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            <h1 className="text-2xl font-bold">Huna ruhusa</h1>
            <p className="text-sm text-muted-foreground">Akaunti yako haijapewa nafasi ya usimamizi. Wasiliana na mmiliki.</p>
            <SignOut />
          </div>
        )}
      </div>
    </div>
  );
}
