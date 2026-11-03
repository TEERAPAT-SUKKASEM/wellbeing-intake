// Guards scripts that write with the service-role key. A local Supabase stack needs no ceremony;
// any other database must be named on the command line for that one run. It is a flag rather than
// an env var so it cannot be left behind in an .env file, or be inherited by a child process such
// as the `pnpm seed` that the integration tests run.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const CONFIRM_FLAG = "--confirm-remote";

export type DbTarget = { allowed: boolean; host: string | null; local: boolean };

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
