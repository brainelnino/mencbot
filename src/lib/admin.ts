import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AdminContext = {
  id: string;
  isOwner: boolean;
  label: string;
  permissions: Set<string>;
} | null;

/** Reads the signed-in user's admin record. UI hint only — the database enforces every permission. */
export function useAdmin(userId: string | undefined) {
  return useQuery({
    queryKey: ["admin-self", userId],
    enabled: !!userId,
    queryFn: async (): Promise<AdminContext> => {
      if (!userId) return null;
      const { data, error } = await supabase
        .from("admin_accounts")
        .select("id,is_owner,display_label,is_active,admin_permission_grants(permission)")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      if (!data || !data.is_active) return null;
      return {
        id: data.id,
        isOwner: data.is_owner,
        label: data.display_label,
        permissions: new Set((data.admin_permission_grants ?? []).map((g) => g.permission)),
      };
    },
  });
}

export function can(admin: AdminContext, perm: string) {
  return !!admin && (admin.isOwner || admin.permissions.has(perm));
}
