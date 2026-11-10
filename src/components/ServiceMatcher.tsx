// What this component shows: the optional "Not sure which service? Get a suggestion" helper.
// The student describes what they need and gets up to two suggested services,
// or emergency guidance if the text sounds like a crisis.
// Used on: the home page (/), inside ServiceFinder.
// Talks to: POST /api/v1/finder/suggest with { text, ai_opt_in: true }.
// In preview mode it uses a local word match and sends nothing.
// Note: the text is sent only after the student ticks the consent box. It is not added to the booking,
// and the suggestion is only a help: every service stays available below.
"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import type { Service } from "@/lib/client/contracts";
import { previewSuggestions, resolveSuggestions } from "@/lib/client/service-matching";

export function ServiceMatcher({ services, preview = false }: { services: Service[]; preview?: boolean }) {
  // text and consent: the form inputs. busy: a request is running.
  // error and result: what to show under the form.
  const [text, setText] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ReturnType<typeof resolveSuggestions>>(null);
  // active holds the AbortController of the running request, so we can stop it.
  // version counts attempts. An answer from an older attempt is ignored.
  const active = useRef<AbortController | null>(null);
  const version = useRef(0);
  // When the component is removed from the page, stop any running request.
  useEffect(() => () => { version.current++; active.current?.abort(); }, []);

  // Called when the text or the consent changes. The old answer no longer matches
  // what is on screen, so stop the old request and hide its result.
  function invalidate() {
    version.current++;
    active.current?.abort();
    active.current = null;
    setBusy(false); setError(""); setResult(null);
  }
  // "Clear description" button, and also used when the panel is closed:
  // removes the text and takes the consent away again.
  function clear() { invalidate(); setText(""); setConsent(false); }

  async function suggest(event: React.FormEvent) {
    event.preventDefault();
    // Do nothing without consent, with empty text, or while a request is already running.
    if (!consent || !text.trim() || busy) return;
    // Start a new attempt: remember its number and abort any older request.
    const attempt = ++version.current;
    const controller = new AbortController();
    active.current?.abort(); active.current = controller;
    setBusy(true); setError(""); setResult(null);
    // Give up after 10 seconds, so the button never stays busy forever.
    const timer = setTimeout(() => controller.abort(), 10000);
    // Preview mode never calls the server. It uses a local word match instead.
    const response = preview
      ? { ok: true, status: 200, data: previewSuggestions(text.trim(), services) }
      : await api("/finder/suggest", {
          method: "POST",
          body: { text: text.trim(), ai_opt_in: true },
          signal: controller.signal,
        });
    clearTimeout(timer);
    // If the text changed or a newer attempt started while we waited, ignore this answer.
    if (attempt !== version.current) return;
    active.current = null; setBusy(false);
    // resolveSuggestions checks the answer's shape and keeps only services that are active now.
    // It returns null if the answer is broken.
    const resolved = response.ok ? resolveSuggestions(response.data, services) : null;
    // 429 means too many attempts (rate limit). Any other failure still lets the student
    // choose a service by hand, so booking never depends on this helper.
    if (!resolved) {
      setError(response.status === 429
        ? "Too many attempts. Please wait a few minutes, or choose a service below."
        : "The service helper is unavailable right now. You can still choose any service below.");
      return;
    }
    setResult(resolved);
  }

  // <details> keeps the helper folded by default. Closing it clears the text and the consent.
  // The aria-live="polite" area reads new results and errors to screen reader users.
  // Result order: crisis text shows only emergency guidance (no services); otherwise up to two
  // suggested services with a reason; otherwise a "no clear match" message.
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
        {error && <p className="matcher-feedback">{error}</p>}
        {result && <div className="matcher-feedback">
          {result.urgentGuidance ? <p>This helper cannot provide immediate help. If you feel unsafe or need help now, use the emergency contacts. Do not wait for an appointment.</p> : result.matches.length ? <><p className="font-semibold">{result.mode === "AI_ASSISTED" ? "Suggested services" : preview ? "Preview suggestion — local word match" : "Suggested services — keyword fallback"}</p><ul className="matcher-results">{result.matches.map(({ service, reason }) => <li key={service.id}><Link className="link font-semibold" href={`/request/new?service=${encodeURIComponent(service.id)}`}>{service.name}</Link><p>{reason}</p></li>)}</ul><p>You choose whether to use the suggestion. All services remain available below.</p></> : <p>There isn’t a clear match. Browse the service descriptions below and choose what feels right for you.</p>}
        </div>}
      </div>
    </form>
  </details>;
}
