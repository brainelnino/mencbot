import { Link } from "@tanstack/react-router";
import { TzFlag } from "./TzFlag";
import { useBrand } from "@/hooks/useBrand";

export function Logo({ compact = false }: { compact?: boolean }) {
  const brand = useBrand();
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <TzFlag className="h-5 w-auto rounded-[3px] ring-1 ring-border" />
      <span className="flex flex-col leading-none">
        <span className="font-display text-base font-bold tracking-tight">{brand}</span>
        {!compact && (
          <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Ubongo wa Jamii
          </span>
        )}
      </span>
    </Link>
  );
}
