import { adminHead } from "@/lib/route-head";
import { createFileRoute } from "@tanstack/react-router";
import { Brain } from "lucide-react";
import { PageHeader, Pill } from "@/components/admin/States";

export const Route = createFileRoute("/admin/brain")({ head: () => adminHead("EL-NINO Brain"), component: BrainPage });

const PLANNED = [
  "Kutambua mada zinazojirudia",
  "Kuelewa mahitaji ya wanachama",
  "Kugundua mijadala inayoibuka",
  "Kubaini fursa za huduma au biashara",
  "Mifumo ya ushiriki (jumla, si ya mtu mmoja)",
  "Mapendekezo ya kuboresha udhibiti",
];
const EVIDENCE = [
  "Idadi ya wanachama tofauti (si ujumbe unaojirudia wa mtu mmoja)",
  "Marudio ya mada na mabadiliko kwa muda",
  "Maonyesho yanayojirudia ya hitaji",
  "Nguvu na mipaka ya ushahidi",
  "Hatua za kuthibitisha fursa",
];

function BrainPage() {
  return (
    <div>
      <PageHeader title="EL-NINO Brain" desc="Injini ya uchambuzi wa jamii.">
        <Pill tone="warn">Haifanyi kazi bado</Pill>
      </PageHeader>
      <div className="rounded-2xl border bg-card p-6">
        <Brain className="h-8 w-8 text-tz-blue" />
        <p className="mt-3 max-w-xl text-sm text-muted-foreground">
          Hakuna uchambuzi unaofanyika kwa sasa. Sehemu hii imeandaliwa tu. Ripoti zitatofautisha wazi ushahidi ulioonekana na makisio.
        </p>
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <section>
            <h2 className="mb-2 text-sm font-semibold">Majukumu ya baadaye</h2>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{PLANNED.map((p) => <li key={p}>{p}</li>)}</ul>
          </section>
          <section>
            <h2 className="mb-2 text-sm font-semibold">Vigezo vya ushahidi</h2>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{EVIDENCE.map((p) => <li key={p}>{p}</li>)}</ul>
          </section>
        </div>
      </div>
    </div>
  );
}
