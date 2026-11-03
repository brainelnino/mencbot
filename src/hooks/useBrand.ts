import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const DEFAULT_BRAND = "Live Chat bot";

/** System-wide display name, editable by the owner in Mipangilio. */
export function useBrand() {
  const q = useQuery({ queryKey: ["brand-name"], queryFn: async () => {
    const { data, error } = await supabase.rpc("get_brand_name");
    if (error) throw error;
    return data || DEFAULT_BRAND;
  }, staleTime: 60_000 });
  return q.data ?? DEFAULT_BRAND;
}
