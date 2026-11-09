import { describe, expect, it } from "vitest";
import { checkDbTarget } from "../../scripts/lib/db-target";

const REMOTE = "https://abcdefgh.supabase.co";

describe("checkDbTarget", () => {
  it.each(["http://127.0.0.1:54321", "http://localhost:54321", "http://[::1]:54321"])("allows the local stack %s", (url) => {
    expect(checkDbTarget(url, [])).toMatchObject({ allowed: true, local: true });
  });

  it("refuses a remote database by default", () => {
    expect(checkDbTarget(REMOTE, [])).toEqual({ allowed: false, host: "abcdefgh.supabase.co", local: false });
  });

  it("allows a remote database only when that exact host is confirmed", () => {
    expect(checkDbTarget(REMOTE, ["--confirm-remote=abcdefgh.supabase.co"]).allowed).toBe(true);
    expect(checkDbTarget(REMOTE, ["--confirm-remote=other.supabase.co"]).allowed).toBe(false);
    expect(checkDbTarget(REMOTE, ["--confirm-remote"]).allowed).toBe(false);
    expect(checkDbTarget(REMOTE, ["--confirm-remote=true"]).allowed).toBe(false);
  });

  it.each(["https://127.0.0.1.evil.test", "https://127.0.0.1@evil.test", "https://localhost.evil.test"])(
    "does not mistake the lookalike %s for local",
    (url) => {
      expect(checkDbTarget(url, []).allowed).toBe(false);
    },
  );

  it("refuses a value that is not a URL", () => {
    expect(checkDbTarget("not a url", [])).toEqual({ allowed: false, host: null, local: false });
  });
});
