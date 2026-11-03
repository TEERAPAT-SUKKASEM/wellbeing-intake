"use client";

import { ServiceCard } from "@/components/ServiceCard";
import { useEffect, useId, useState } from "react";
import { api } from "@/lib/client/api";
import { previewServices } from "@/lib/client/preview-services";
import { UiIcon } from "@/components/UiIcon";

type Service = { id: string; slug: string; name: string; whatFor: string; firstSession: string; whoWillKnow: string };
type Suggestion = { mode: "ai" | "fallback" | "sample"; serviceIds: string[] };

export function ServiceFinder({ preview = false }: { preview?: boolean }) {
  const [services, setServices] = useState<Service[] | null>(preview ? previewServices : null);
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);

  // FR-23 helper state. Nothing here is written to browser storage.
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [helperError, setHelperError] = useState(false);
  const helpId = useId();

  useEffect(() => {
    if (preview) return;
    let alive = true;
    api<{ services: Service[] }>("/services").then((r) => {
      if (!alive) return;
      if (r.ok && r.data) setServices(r.data.services);
      else setLoadError(true);
    });
    return () => {
      alive = false;
    };
  }, [preview, reload]);

  useEffect(() => {
    if (!services) return;
    if (reload > 0) document.getElementById("services-heading")?.focus({ preventScroll: true });
    const target = window.location.hash.slice(1);
    if (services.some(service => target === `service-${service.slug}`)) {
      document.getElementById(target)?.scrollIntoView({ block: "start" });
    }
  }, [services, reload]);

  async function onSuggest(e: React.FormEvent) {
    e.preventDefault();
    if (text.trim().length < 2) return;
    if (preview) {
      const words = text.toLowerCase().trim().split(/\s+/).filter(word => word.length > 2);
      const matches = previewServices.filter(service => words.some(word => `${service.name} ${service.whatFor}`.toLowerCase().includes(word)));
      setSuggestion({ mode: "sample", serviceIds: matches.map(service => service.id) });
      return;
    }
    setBusy(true);
    setHelperError(false);
    const r = await api<Suggestion>("/finder/suggest", { method: "POST", body: { text } });
    setBusy(false);
    if (r.ok && r.data) setSuggestion(r.data);
    else setHelperError(true);
  }

  const suggested = suggestion && services ? suggestion.serviceIds.map((id) => services.find((s) => s.id === id)).filter(Boolean) as Service[] : [];

  return (
    <div className="finder-layout">
      <section aria-labelledby="services-heading">
        <div className="section-intro">
        <h2 id="services-heading" tabIndex={-1} className="display-heading text-4xl">
          Support for every part of you.
        </h2>
        <p className="mt-2 text-sm text-base-content/70">See what each service offers before you decide. No sign-in needed to browse.</p>
        </div>
        {loadError && (
          <div role="alert" className="mt-5 space-y-3 rounded-box border border-base-300 bg-base-100 p-5">
            <p>We could not load the services just now. The emergency contacts above are always available.</p>
            <button type="button" className="btn" onClick={() => { setLoadError(false); setReload(value => value + 1); }}>Try loading services again</button>
          </div>
        )}
        {!services && !loadError && <div role="status" aria-label="Loading services" aria-busy="true" className="mt-6 space-y-4 sm:space-y-5">{[0, 1, 2].map(key => <div key={key} className="skeleton h-40 w-full" />)}</div>}
        {services && (
          <ul className="service-grid mt-7 grid gap-5 md:grid-cols-2">
            {services.map((service) => <ServiceCard key={service.id} service={service} />)}
          </ul>
        )}
      </section>

      <section aria-labelledby="helper-heading" className="finder-panel home-glass card p-5 sm:p-8">
        <h2 id="helper-heading" tabIndex={-1} className="display-heading text-4xl">
          Not sure where to start?
        </h2>
        <p id={helpId} className="mt-2 max-w-prose text-sm text-base-content/70">
          {preview ? "Type a few words to explore the sample services. This preview matches words on this page only. It does not use AI, send your text, or assess urgency." : <>
          Optional. Type a few words and we will point you to services from the catalogue. What you type is sent to an
          AI matching service when it is available, is <strong>not stored</strong>, and is{" "}
          <strong>not linked to you</strong>. This helper{" "}
          <strong>cannot judge how urgent something is</strong>; if you need help now, use the emergency contacts
          above. You can always skip it and browse the full list.</>}
        </p>
        <form onSubmit={onSuggest} className="mt-6 flex flex-col gap-3 sm:flex-row">
          <label htmlFor="helper-text" className="helper-label">
            What are you looking for?
          </label>
          <input
            id="helper-text"
            aria-describedby={helpId}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={300}
            autoComplete="off"
            placeholder="e.g. trouble sleeping before exams"
            className="input min-w-0 w-full"
          />
          <button
            type="submit"
            disabled={busy || text.trim().length < 2}
            aria-busy={busy}
            className="btn shrink-0"
          >
            {busy ? <span aria-hidden="true" className="loading loading-spinner loading-sm" /> : null}
            {busy ? "Finding services…" : "Find matching services"}
            {!busy && <UiIcon name="arrow" className="size-4" />}
          </button>
        </form>
        {preview && <p className="mt-3 text-sm text-base-content/70">Try “sleep”, “stress”, or “injury”. You can also browse the service catalogue.</p>}

        <div aria-live="polite" className="mt-4">
          {helperError && (
            <p className="text-sm text-base-content/70">The helper is unavailable right now. You can still browse the service catalogue.</p>
          )}
          {suggestion && !helperError && (
            <div>
              {suggested.length > 0 ? (
                <>
                  <p className="text-sm font-medium">
                    These might fit ({suggestion.mode === "ai" ? "AI match" : suggestion.mode === "sample" ? "sample word match" : "keyword match"}):
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {suggested.map((s) => (
                      <li key={s.id}>
                        <a href={`#service-${s.slug}`} className="btn min-h-11 text-sm">
                          {s.name}
                        </a>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-sm text-base-content/70">
                  No clear match — that is fine. Have a look through the service catalogue, or ask at the counselling
                  front desk.
                </p>
              )}
            </div>
          )}
        </div>
      </section>

    </div>
  );
}
