// What this file does: turns a checked sign-in into a staff "caller" with a role (practitioner or admin).
// Why it exists: the role comes only from our own `staff` table, never from the sign-in token, so being
// able to sign in is not enough. An account with no staff row gets no access at all (default deny).
// Used by: route() in src/lib/http.ts, for every route that lists staff roles.
import "server-only";
import { db } from "@/lib/supabase/admin";
import type { Identity } from "@/lib/identity/adapter";

// Students are anonymous and have no role. Only seeded staff accounts can be authorized.
export type Role = "practitioner" | "admin";

// What a route handler learns about the signed-in staff member: the staff id, role and name only.
export type Caller = {
  id: string;
  role: Role;
  displayName: string;
};

/** A verified identity with no seeded staff row gets no role at all. */
export async function resolveCaller(identity: Identity): Promise<Caller | null> {
  // identity_ref links a staff row to a sign-in account: the Supabase Auth user id in fixture mode,
  // or the token's "sub" (subject) claim in campus mode.
  const found = await db()
    .from("staff")
    .select("id, role, display_name")
    .eq("identity_ref", identity.identityRef)
    .maybeSingle();

  // No staff row means no role. route() then answers with the same 404 as a missing resource.
  if (!found.data) return null;
  return {
    id: found.data.id,
    role: found.data.role as Role,
    displayName: found.data.display_name,
  };
}
