import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Loading, ErrorState, Pill } from "@/components/admin/States";
import { getTelegramStatus, registerWebhook, createGroupLinkCode } from "@/lib/telegram.functions";

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString("sw-TZ") : "—");

export function TelegramPanel() {
  const qc = useQueryClient();
  const fetchStatus = useServerFn(getTelegramStatus);
  const doRegister = useServerFn(registerWebhook);
  const doCode = useServerFn(createGroupLinkCode);
  const status = useQuery({ queryKey: ["tg-status"], queryFn: () => fetchStatus() });
  const refresh = () => qc.invalidateQueries({ queryKey: ["tg-status"] });
  const reg = useMutation({ mutationFn: () => doRegister(), onSuccess: () => { toast.success("Webhook imesajiliwa"); refresh(); }, onError: (e) => toast.error(e.message) });
  const code = useMutation({ mutationFn: () => doCode(), onSuccess: refresh, onError: (e) => toast.error(e.message) });

  if (status.isLoading) return <Loading />;
  if (status.error) return <ErrorState error={status.error} />;
  const s = status.data!;
  const rows: [string, React.ReactNode][] = [
    ["Bot", s.bot ? <span>@{s.bot} <Pill tone="ok">Imeunganishwa</Pill></span> : <Pill tone="bad">{s.botError ?? "Haijaunganishwa"}</Pill>],
    ["Webhook", s.webhookUrl ? <Pill tone="ok">Imesajiliwa</Pill> : <Pill tone="warn">Haijasajiliwa</Pill>],
    ["Masasisho yanayosubiri", s.pending],
    ["Sasisho la mwisho lililofanikiwa", fmt(s.lastUpdateAt)],
    ["Hitilafu ya mwisho", s.lastError ? <span className="text-destructive">{s.lastError} ({fmt(s.lastErrorAt)})</span> : "—"],
    ["Hitilafu ya Telegram", s.telegramWebhookError ?? "—"],
    ["Kikundi cha umma", s.groupConfigured ? <span>{s.groupTitle ?? "Kimeunganishwa"} <Pill tone="ok">Kimethibitishwa {fmt(s.groupVerifiedAt)}</Pill></span> : <Pill tone="warn">Hakijaunganishwa</Pill>],
  ];

  return (
    <div className="flex flex-col gap-4">
      <ul className="divide-y rounded-xl border bg-card text-sm">
        {rows.map(([k, v]) => (
          <li key={k} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:justify-between">
            <span className="text-muted-foreground">{k}</span><span className="break-all">{v}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => reg.mutate()} disabled={reg.isPending || !s.bot}>{s.webhookUrl ? "Sajili webhook upya" : "Sajili webhook"}</Button>
        <Button size="sm" variant="secondary" onClick={() => code.mutate()} disabled={code.isPending || !s.bot}>Tengeneza msimbo wa kikundi</Button>
        <Button size="sm" variant="ghost" onClick={refresh}>Onyesha upya</Button>
      </div>
      {s.linkCode && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
          Tuma ujumbe huu ndani ya kikundi (unaisha baada ya dakika 15):
          <code className="mt-2 block font-mono text-base">/unganisha {s.linkCode}</code>
        </div>
      )}
      <details className="rounded-xl border bg-card p-4 text-sm">
        <summary className="cursor-pointer font-semibold">Jinsi ya kuunganisha kikundi cha umma</summary>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>Unda au chagua kikundi cha umma kwenye Telegram.</li>
          <li>Ongeza bot @{s.bot ?? "…"} kama mwanachama.</li>
          <li>Ifanye bot kuwa msimamizi mwenye ruhusa ya kutuma ujumbe tu (na kufuta ujumbe, kwa udhibiti wa baadaye). Usiipe ruhusa nyingine.</li>
          <li>Bonyeza "Tengeneza msimbo wa kikundi", kisha tuma amri hiyo ndani ya kikundi.</li>
          <li>Bot itajibu ndani ya kikundi kuthibitisha kuwa inaweza kuchapisha.</li>
        </ol>
      </details>
    </div>
  );
}
