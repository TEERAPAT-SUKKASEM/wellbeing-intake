import "server-only";
import { db } from "@/lib/supabase/admin";
import type { Identity } from "@/lib/identity/adapter";

// Students are anonymous and have no role. Only seeded staff accounts can be authorized.
export type Role = "practitioner" | "admin";

export type Caller = {
  id: string;
  role: Role;
  displayName: string;
};

/** A verified identity with no seeded staff row gets no role at all. */
export async function resolveCaller(identity: Identity): Promise<Caller | null> {
  const found = await db()
    .from("staff")
    .select("id, role, display_name")
    .eq("identity_ref", identity.identityRef)
    .maybeSingle();

  if (!found.data) return null;
  return {
    id: found.data.id,
    role: found.data.role as Role,
    displayName: found.data.display_name,
  };
}
