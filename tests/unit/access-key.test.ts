import { describe, expect, it } from "vitest";
import { deriveAccessKey, generateAccessKey, hashAccessKey, normalizeAccessKey } from "@/lib/access-key";
import { addHit, clientAddress, isLimited } from "@/lib/rate-limit";

const FORMAT = /^WB-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/;

describe("access keys", () => {
  it("look like WB-XXXX-XXXX-XXXX and avoid confusable characters", () => {
    for (let i = 0; i < 200; i++) expect(generateAccessKey()).toMatch(FORMAT);
  });

  it("do not repeat", () => {
    const keys = new Set(Array.from({ length: 2000 }, generateAccessKey));
    expect(keys.size).toBe(2000);
  });

  it("use every symbol, so no entropy is lost in formatting", () => {
    const seen = new Set(Array.from({ length: 500 }, generateAccessKey).join("").replaceAll(/WB|-/g, ""));
    expect(seen.size).toBe(32);
  });

  it("a derived key is repeatable for one submission, and differs by submission and by secret", () => {
    const a = deriveAccessKey("11111111-1111-4111-8111-111111111111", "secret-one");
    expect(a).toMatch(FORMAT);
    expect(deriveAccessKey("11111111-1111-4111-8111-111111111111", "secret-one")).toBe(a);
    expect(deriveAccessKey("22222222-2222-4222-8222-222222222222", "secret-one")).not.toBe(a);
    expect(deriveAccessKey("11111111-1111-4111-8111-111111111111", "secret-two")).not.toBe(a);
  });

  it("normalize forgives case and spaces and refuses anything else", () => {
    const key = "WB-7K3M-9QXP-2ZTF";
    expect(normalizeAccessKey(key)).toBe(key);
    expect(normalizeAccessKey("  wb-7k3m-9qxp-2ztf ")).toBe(key);
    for (const bad of ["WB-9842-X", "WB-7K3M-9QXP-2ZT", "WB-7K3M-9QXP-2ZT0", "", null, undefined, 42, "WB-7K3M-9QXP-2ZTF' OR 1=1"]) {
      expect(normalizeAccessKey(bad)).toBeNull();
    }
  });

  it("hash is a fixed one-way digest", () => {
    expect(hashAccessKey("WB-7K3M-9QXP-2ZTF")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashAccessKey("WB-7K3M-9QXP-2ZTF")).toBe(hashAccessKey("WB-7K3M-9QXP-2ZTF"));
    expect(hashAccessKey("WB-7K3M-9QXP-2ZTF")).not.toBe(hashAccessKey("WB-7K3M-9QXP-2ZTG"));
  });
});

describe("rate limiter", () => {
  it("limits after the allowed number of hits and frees up after the window", () => {
    const t0 = 1_000_000;
    expect(isLimited("scope-a", "ip", 2, t0)).toBe(false);
    addHit("scope-a", "ip", t0, 1000);
    addHit("scope-a", "ip", t0, 1000);
    expect(isLimited("scope-a", "ip", 2, t0)).toBe(true);
    expect(isLimited("scope-a", "other-ip", 2, t0)).toBe(false);
    expect(isLimited("scope-b", "ip", 2, t0)).toBe(false);
    expect(isLimited("scope-a", "ip", 2, t0 + 2000)).toBe(false);
  });

  it("reads the first forwarded address", () => {
    const req = (value?: string) => new Request("http://x/", { headers: value ? { "x-forwarded-for": value } : {} });
    expect(clientAddress(req("203.0.113.1, 10.0.0.1"))).toBe("203.0.113.1");
    expect(clientAddress(req())).toBe("unknown");
  });
});
