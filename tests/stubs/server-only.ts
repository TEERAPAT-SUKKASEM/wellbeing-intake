// What this file does: it is an empty stand-in for the `server-only` package during tests.
// Why it matters: the real package throws an error outside a Next.js server build, so without this stub
// the tests could not import server code. vitest.config.mts points `server-only` to this file.
// How to run it: it is not run by itself; `pnpm test` and `pnpm test:integration` use it automatically.
export {};
