import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, MessagesSquare, Brain, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/brand/Logo";
import { TzFlag } from "@/components/brand/TzFlag";
import { MessageList, type PublicMessage } from "@/components/chat/MessageList";
import { Loading, ErrorState } from "@/components/admin/States";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "EL-NINO — Ubongo wa Jamii | Mazungumzo ya Jamii" },
      { name: "description", content: "Jukwaa salama la mazungumzo ya wazi bila kujulikana kwa jamii ya Tanzania." },
      { property: "og:title", content: "EL-NINO — Ubongo wa Jamii" },
      { property: "og:description", content: t.tagline },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const { user } = useAuth();
  const feed = useQuery({
    queryKey: ["public-feed"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_public_messages", { _limit: 50 });
      if (error) throw error;
      return (data ?? []).slice().reverse() as PublicMessage[];
    },
    refetchInterval: 20000,
  });

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Logo />
          <Button asChild variant="outline" size="sm">
            <Link to={user ? "/admin" : "/ingia"}>{t.auth.owner}</Link>
          </Button>
        </div>
        <div className="flag-rule" />
      </header>

      <main className="mx-auto grid max-w-5xl gap-8 px-4 py-8 md:grid-cols-[1fr_1.1fr] md:py-14">
        <section className="flex flex-col gap-6">
          <TzFlag className="h-10 w-auto self-start rounded-md ring-1 ring-border" />
          <h1 className="text-3xl font-bold leading-tight md:text-5xl">
            Ubongo wa <span className="text-primary">Jamii</span>.
          </h1>
          <p className="text-base text-muted-foreground md:text-lg">{t.tagline}</p>
          <ul className="grid gap-3 text-sm">
            {[
              { i: MessagesSquare, h: "Mazungumzo ya wazi", p: "Kila mwanachama anaonekana kwa namba au herufi tu — kama 15, C au 122." },
              { i: ShieldCheck, h: "Usalama kwanza", p: "Utambulisho wako halisi haufichuliwi." },
              { i: Brain, h: "EL-NINO Brain", p: "Uchambuzi wa mahitaji ya jamii — unakuja hivi karibuni." },
            ].map(({ i: Icon, h, p }) => (
              <li key={h} className="flex gap-3 rounded-xl border bg-card p-4">
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-tz-green" />
                <div>
                  <p className="font-semibold">{h}</p>
                  <p className="text-muted-foreground">{p}</p>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            <Send className="h-4 w-4 text-tz-blue" />
            <a href="https://t.me/NinoChatBot" target="_blank" rel="noreferrer">@NinoChatBot</a>
          </div>
        </section>

        <section className="flex min-h-[420px] flex-col rounded-2xl border bg-card">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Mazungumzo ya Jamii</h2>
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-tz-green" /> Moja kwa moja
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {feed.isLoading ? (
              <Loading />
            ) : feed.error ? (
              <ErrorState error={feed.error} />
            ) : (feed.data ?? []).length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 py-12 text-center">
                <p className="font-semibold">Bado hakuna ujumbe uliochapishwa.</p>
                <p className="max-w-xs text-xs text-muted-foreground">
                  @NinoChatBot
                </p>
              </div>
            ) : (
              <MessageList messages={feed.data ?? []} />
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
