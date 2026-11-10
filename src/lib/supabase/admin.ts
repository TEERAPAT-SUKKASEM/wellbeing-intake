// What this file does: creates the one Supabase database client that the server uses.
// Why it exists: all data access goes through our server code with the service-role key; the browser
// never talks to the database directly, so every rule in route() is applied first.
// Used by: every API route and server module that reads or writes data, through db().
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

// RLS (row-level security) is a set of database rules about which rows a user may read or write.
// Our tables deny everything to normal users, so only this server client can use them.
// The service-role client. It bypasses the deny-all RLS backstop, so it must never be
// imported from a client component: `server-only` makes that a build error.
// The client is made once and then reused for every request.
let cached: SupabaseClient | null = null;

/** Returns the shared service-role database client, creating it the first time. */
export function db(): SupabaseClient {
  if (!cached) {
    // No session is saved or refreshed: this client acts as the server, not as a signed-in user.
    cached = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}
