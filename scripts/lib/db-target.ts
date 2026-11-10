// What this file does: it decides if a script may write to the database that SUPABASE_URL points at.
// A database on this computer is always allowed; any other host must be confirmed on the command line.
// Why it matters: it stops `pnpm seed` from wiping a real, hosted database by mistake.
// tests/unit/script-safety.test.ts proves this rule.
// How to run it: it is not run by itself. scripts/seed.ts uses it, and `pnpm test` tests it.
//
// Guards scripts that write with the service-role key. A local Supabase stack needs no ceremony;
// any other database must be named on the command line for that one run. It is a flag rather than
// an env var so it cannot be left behind in an .env file, or be inherited by a child process such
// as the `pnpm seed` that the integration tests run.

// Only these exact host names count as local. A look-alike such as "localhost.evil.test" does not.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const CONFIRM_FLAG = "--confirm-remote";

// allowed: may the script run? host: the database host name (null if the URL is broken).
// local: is the database on this computer?
export type DbTarget = { allowed: boolean; host: string | null; local: boolean };

// The check only, with no side effects: read the host from the URL, then allow it if it is local or if
// the arguments contain exactly --confirm-remote=<that host>. A broken URL is never allowed.
export function checkDbTarget(supabaseUrl: string, argv: readonly string[]): DbTarget {
  let host: string;
  try {
    host = new URL(supabaseUrl).hostname;
  } catch {
    return { allowed: false, host: null, local: false };
  }
  if (LOCAL_HOSTS.has(host)) return { allowed: true, host, local: true };
  return { allowed: argv.includes(`${CONFIRM_FLAG}=${host}`), host, local: false };
}

/** Exits the process unless the target is local or was confirmed. Returns the host otherwise. */
export function requireDbTarget(options: {
  supabaseUrl: string;
  argv: readonly string[];
  command: string;
  danger: string;
}): string {
  const { allowed, host, local } = checkDbTarget(options.supabaseUrl, options.argv);
  if (!host) {
    console.error(`Refusing to run ${options.command}: SUPABASE_URL is not a valid URL.`);
    process.exit(1);
  }
  if (!allowed) {
    console.error(`Refusing to run ${options.command}: SUPABASE_URL points at a remote database (${host}).`);
    console.error(options.danger);
    console.error(`If that is really what you want, run it again with: ${CONFIRM_FLAG}=${host}`);
    process.exit(1);
  }
  if (!local) console.warn(`Confirmed remote database: ${host}`);
  return host;
}
