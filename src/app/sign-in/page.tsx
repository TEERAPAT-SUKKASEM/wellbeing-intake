"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api } from "@/lib/client/api";
import Link from "next/link";
import { UiIcon } from "@/components/UiIcon";

const HOME = { practitioner: "/practitioner", admin: "/admin" } as const;

function SignInForm() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError("Enter your staff email and password to sign in.");
      return;
    }
    setBusy(true);
    setError(null);
    const r = await api("/session", {
      method: "POST",
      body: { email, password },
    });
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
    if (!me.ok || !me.data || !HOME[me.data.role]) {
      setBusy(false);
      setError(
        "This sign-in is for authorised staff accounts. Students can request and track appointments without signing in.",
      );
      return;
    }
    // Only same-origin targets are honoured. Resolve first, then compare origins: a prefix test
    // is bypassed by "/\evil.example" or a tab, which browsers resolve to another host.
    let safe: string | null = null;
    if (next) {
      try {
        const u = new URL(next, window.location.origin);
        if (
          u.origin === window.location.origin &&
          u.pathname === HOME[me.data.role]
        )
          safe = u.pathname + u.search + u.hash;
      } catch {
        safe = null;
      }
    }
    const target = safe ?? (me.data ? HOME[me.data.role] : "/");
    router.replace(target);
    router.refresh();
  }

  return (
    <div className="auth-layout">
      <form
        onSubmit={onSubmit}
        className="space-y-4 card card-border bg-base-100 p-5"
        noValidate
      >
        <div className="mb-2">
          <h1 className="text-2xl font-semibold">Staff sign in</h1>
          <p className="mt-2 text-sm text-base-content/70">
            For practitioners and administrators. Use your staff account to manage appointments, services, or opening hours.
          </p>
        </div>
        <div>
          <label htmlFor="email" className="block font-medium">
            Staff email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            aria-invalid={!!error}
            aria-describedby={error ? "sign-in-error" : undefined}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input mt-1 w-full"
          />
        </div>
        <div>
          <label htmlFor="password" className="block font-medium">
            Password
          </label>
          <div className="password-field">
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              aria-invalid={!!error}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-describedby={error ? "sign-in-error" : undefined}
              className="input mt-1 w-full"
            />
            <button
              type="button"
              className="password-toggle"
              aria-controls="password"
              aria-pressed={showPassword}
              onClick={() => setShowPassword((value) => !value)}
            >
              {showPassword ? "Hide" : "Show"}
              <span className="sr-only"> password</span>
            </button>
          </div>
        </div>
        {error && (
          <p
            id="sign-in-error"
            role="alert"
            className="alert alert-error alert-soft block p-3"
          >
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          aria-busy={busy}
          className="btn btn-primary w-full"
        >
          {busy && (
            <span
              aria-hidden="true"
              className="loading loading-spinner loading-sm"
            />
          )}
          {busy ? "Signing you in…" : "Sign in to staff workspace"}
          {!busy && <UiIcon name="arrow" className="size-4" />}
        </button>
        <div className="staff-student-help"><h2>Looking for counselling?</h2><p>Students can book and track requests without signing in.</p><Link href="/" className="link">Book an appointment</Link><Link href="/requests" className="link">Track a request</Link></div>
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
