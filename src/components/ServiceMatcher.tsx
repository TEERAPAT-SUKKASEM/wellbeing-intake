"use client";
import Link from "next/link";
import { UiIcon } from "./UiIcon";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import type { Service } from "@/lib/client/contracts";
import { previewSuggestions, resolveSuggestions } from "@/lib/client/service-matching";

export function ServiceMatcher({ services, preview = false }: { services: Service[]; preview?: boolean }) {
  const [text, setText] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ReturnType<typeof resolveSuggestions>>(null);
  const active = useRef<AbortController | null>(null);
  const version = useRef(0);
  useEffect(() => () => { version.current++; active.current?.abort(); }, []);

  function invalidate() {
    version.current++;
    active.current?.abort();
    active.current = null;
    setBusy(false); setError(""); setResult(null);
  }
  function clear() { invalidate(); setText(""); setConsent(false); }

  async function suggest(event: React.FormEvent) {
    event.preventDefault();
    if (!consent || !text.trim() || busy) return;
    const attempt = ++version.current;
    const controller = new AbortController();
    active.current?.abort(); active.current = controller;
    setBusy(true); setError(""); setResult(null);
    const timer = setTimeout(() => controller.abort(), 10000);
    const response = preview
      ? { ok: true, status: 200, data: previewSuggestions(text.trim(), services) }
      : await api("/finder/suggest", {
          method: "POST",
          body: { text: text.trim(), ai_opt_in: true },
          signal: controller.signal,
        });
    clearTimeout(timer);
    if (attempt !== version.current) return;
    active.current = null; setBusy(false);
    const resolved = response.ok ? resolveSuggestions(response.data, services) : null;
    if (!resolved) {
      setError(response.status === 429
        ? "Too many attempts. Please wait a few minutes, or choose a service below."
        : "The service helper is unavailable right now. You can still choose any service below.");
      return;
    }
    setResult(resolved);
  }

  return <details className="service-matcher" onToggle={event => { if (!event.currentTarget.open) clear(); }}>
    <summary>Not sure which service? Get a suggestion</summary>
    <form onSubmit={suggest} className="matcher-form">
      <p id="matcher-help">Optional. Describe what you need without names or identifying details. With your permission, this description is sent to an external AI provider to suggest a service. This is not a diagnosis or urgency assessment.</p>
      {preview && <p className="matcher-preview">Preview uses a local word match, not AI. Nothing is sent to a provider.</p>}
      <label htmlFor="service-match-text">What would you like support with?</label>
      <textarea id="service-match-text" className="textarea w-full" rows={3} maxLength={500} required value={text} aria-describedby="matcher-help matcher-count" onChange={event => { invalidate(); setText(event.target.value); }} />
      <p id="matcher-count" className="matcher-meta">{text.length}/500 characters. This description is not added to your appointment request.</p>
      <label className="matcher-consent"><input type="checkbox" className="checkbox" checked={consent} onChange={event => { invalidate(); setConsent(event.target.checked); }} /><span>I agree to send this description for service matching.</span></label>
      <div className="flex flex-wrap gap-3"><button className="btn" disabled={!consent || !text.trim() || busy} aria-busy={busy}>{busy ? "Finding a service…" : "Suggest a service"}</button><button type="button" className="btn btn-ghost" onClick={clear}>Clear description</button></div>
      <div aria-live="polite" aria-atomic="true">
        {busy && <div className="matcher-feedback matcher-feedback-pending"><p className="matcher-feedback-title">Finding a service…</p><p>Looking for a service that fits your description.</p></div>}
        {error && <div className="alert alert-vertical matcher-feedback matcher-feedback-warning"><div><p className="matcher-feedback-title">Suggestions unavailable</p><p>{error}</p></div></div>}
        {result && <div className={`matcher-feedback ${result.urgentGuidance ? "matcher-feedback-urgent" : result.matches.length ? "matcher-feedback-matched" : "matcher-feedback-empty"}`}>
          {result.urgentGuidance ? <><p className="matcher-feedback-title">Need help now?</p><p>This helper cannot provide immediate help. If you feel unsafe or need help now, use the emergency contacts. Do not wait for an appointment.</p><Link className="link matcher-emergency-link" href="/emergency">View emergency contacts</Link></> : result.matches.length ? <>
            <p className="matcher-feedback-title">{result.matches.length === 1 ? "A service to consider" : "Services to consider"}</p>
            <p className="matcher-feedback-method">{result.mode === "AI_ASSISTED" ? "AI-assisted suggestion" : preview ? "Preview suggestion — local word match" : "Suggested services — keyword fallback"}</p>
            <ul className="matcher-results">{result.matches.map(({ service, reason }) => <li key={service.id}>
              <div className="matcher-service-copy"><h3>{service.name}</h3><p>{reason}</p></div>
              <Link className="btn btn-outline matcher-service-action" aria-label={`Choose a time for ${service.name}`} href={`/request/new?service=${encodeURIComponent(service.id)}`}>Choose a time<UiIcon name="arrow" className="size-5 shrink-0" /></Link>
            </li>)}</ul>
            <p className="matcher-feedback-note">You choose whether to use the suggestion. All services remain available below.</p>
          </> : <><p className="matcher-feedback-title">No clear match yet</p><p>There isn’t a clear match. Browse the service descriptions below and choose what feels right for you.</p></>}
        </div>}
      </div>
    </form>
  </details>;
}
