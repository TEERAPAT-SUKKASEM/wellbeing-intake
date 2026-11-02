"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api } from "@/lib/client/api";

const HOME = { student: "/requests", practitioner: "/practitioner", coordinator: "/coordinator" } as const;

function SignInForm() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await api("/session", { method: "POST", body: { email, password } });
    if (!r.ok) {
      setBusy(false);
      setError(
        r.status === 429
          ? "Too many attempts. Please wait a minute and try again."
          : r.status === 404
            ? "Sign-in here is for demo accounts only. Please sign in through the campus Identity service."
            : "That email and password did not match a demo account.",
      );
      return;
    }
    const me = await api<{ role: keyof typeof HOME }>("/me");
    // Only same-origin targets are honoured. Resolve first, then compare origins: a prefix test
    // is bypassed by "/\evil.example" or a tab, which browsers resolve to another host.
    let safe: string | null = null;
    if (next) {
      try {
        const u = new URL(next, window.location.origin);
        if (u.origin === window.location.origin) safe = u.pathname + u.search + u.hash;
      } catch {
        safe = null;
      }
    }
    const target = safe ?? (me.data ? HOME[me.data.role] : "/");
    router.replace(target);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Sign in</h1>
      <p className="text-base-content/70">
        Demo accounts only. We keep just your campus identity reference, name and email — nothing else your identity
        provider offers is stored.
      </p>
      <form onSubmit={onSubmit} className="space-y-4 card card-border bg-base-100 p-5" noValidate>
        <div>
          <label htmlFor="email" className="block font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input mt-1 w-full"
          />
        </div>
        <div>
          <label htmlFor="password" className="block font-medium">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby={error ? "sign-in-error" : undefined}
            className="input mt-1 w-full"
          />
        </div>
        {error && (
          <p id="sign-in-error" role="alert" className="alert alert-error alert-soft block p-3">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="btn btn-primary w-full"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <SignInForm />
    </Suspense>
  );
}
