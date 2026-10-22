import { createServerFn } from "@tanstack/react-start";

const OWNER_EMAIL = "owner@el-nino.internal";

async function sha(s: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}

/** Verifies the owner PIN server-side and returns a session for the single hidden owner account. */
export const unlockWithPin = createServerFn({ method: "POST" })
  .inputValidator((d: { pin: string }) => ({ pin: String(d?.pin ?? "").slice(0, 128) }))
  .handler(async ({ data }) => {
    const expected = process.env["ADMIN_PIN"];
    if (!expected) throw new Error("PIN haijawekwa");
    const [a, b] = await Promise.all([sha(data.pin), sha(expected)]);
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
    if (diff !== 0) {
      await new Promise((r) => setTimeout(r, 1000));
      return { ok: false as const };
    }

    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: owner } = await db.from("admin_accounts").select("user_id").eq("is_owner", true).maybeSingle();
    let email = OWNER_EMAIL;
    if (owner) {
      const { data: u, error } = await db.auth.admin.getUserById(owner.user_id);
      if (error || !u.user?.email) throw new Error("Akaunti ya mmiliki haipatikani");
      email = u.user.email;
    } else {
      const { data: created, error } = await db.auth.admin.createUser({ email, email_confirm: true });
      if (error || !created.user) throw new Error(error?.message ?? "Imeshindikana");
      const { error: insErr } = await db.from("admin_accounts").insert({ user_id: created.user.id, is_owner: true, display_label: "1" });
      if (insErr) throw insErr;
    }

    const { data: link, error: linkErr } = await db.auth.admin.generateLink({ type: "magiclink", email });
    if (linkErr || !link.properties?.hashed_token) throw new Error(linkErr?.message ?? "Imeshindikana");
    const { data: s, error: vErr } = await db.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
    if (vErr || !s.session) throw new Error(vErr?.message ?? "Imeshindikana");
    return { ok: true as const, access_token: s.session.access_token, refresh_token: s.session.refresh_token };
  });
