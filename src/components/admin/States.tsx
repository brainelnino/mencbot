import { Loader2, Inbox, AlertTriangle, Lock } from "lucide-react";
import type { ReactNode } from "react";

export function Loading() {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Inapakia…
    </div>
  );
}
export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center">
      <Inbox className="h-6 w-6 text-muted-foreground" />
      <p className="text-sm font-semibold">{title}</p>
      {hint && <p className="max-w-sm text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
export function ErrorState({ error }: { error: unknown }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
      <span>{error instanceof Error ? error.message : "Hitilafu imetokea."}</span>
    </div>
  );
}
export function NoAccess() {
  return (
    <div className="flex items-center gap-2 rounded-xl border p-4 text-sm text-muted-foreground">
      <Lock className="h-4 w-4" /> Huna ruhusa ya kuona sehemu hii.
    </div>
  );
}
export function PageHeader({ title, desc, children }: { title: string; desc?: string; children?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold md:text-2xl">{title}</h1>
        {desc && <p className="mt-1 text-sm text-muted-foreground">{desc}</p>}
      </div>
      {children}
    </header>
  );
}
export function Pill({ tone = "muted", children }: { tone?: "muted" | "ok" | "warn" | "bad"; children: ReactNode }) {
  const cls = {
    muted: "bg-muted text-muted-foreground",
    ok: "bg-success/15 text-success",
    warn: "bg-warning/15 text-warning",
    bad: "bg-destructive/15 text-destructive",
  }[tone];
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{children}</span>;
}
