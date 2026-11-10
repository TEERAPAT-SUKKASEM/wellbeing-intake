// What this component shows: the list of active counselling services on the home page,
// with the optional "Get a suggestion" helper above the list.
// Used on: the home page (/).
// Talks to: GET /api/v1/services. Preview mode (UI_PREVIEW=true) uses fictional in-memory data instead.
// Note: if loading fails, the student sees a "Try again" button. Emergency contacts stay on the page anyway.
"use client";
import { useEffect, useState } from "react";
import { studentApi } from "@/lib/client/booking-preview";
import type { Service } from "@/lib/client/contracts";
import { ServiceCard } from "./ServiceCard";
import { ServiceMatcher } from "./ServiceMatcher";

export function ServiceFinder({ preview = false }: { preview?: boolean }) {
  // services is null while loading. error is true when loading failed.
  // reload is a counter: adding 1 runs the loading effect again (the "Try again" button).
  const [services, setServices] = useState<Service[] | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  // Load the services. studentApi(preview) picks the real API or the preview data.
  // "alive" becomes false on cleanup, so a late answer from an old request is ignored.
  useEffect(() => {
    let alive = true;
    studentApi(preview)<Service[]>("/services").then(result => {
      if (!alive) return;
      setError(!result.ok);
      if (result.ok) setServices(result.data ?? []);
    });
    return () => { alive = false; };
  }, [preview, reload]);

  // Four possible states: an error with "Try again", a loading skeleton, an empty list,
  // or the suggestion helper followed by one ServiceCard per service.
  return <section className="bento-services" aria-label="Counselling services">
    {error && <div role="alert" className="card gap-3 p-5"><p>We could not load services.</p><button className="btn self-start" onClick={() => { setError(false); setReload(value => value + 1); }}>Try again</button></div>}
    {!services && !error && <div role="status" aria-label="Loading services" className="space-y-4"><div className="skeleton h-32 w-full" /><div className="skeleton h-32 w-full" /></div>}
    {services?.length === 0 && <p className="card p-5">No services are currently available. Emergency contacts remain available.</p>}
    {services && services.length > 0 && <><ServiceMatcher services={services} preview={preview} /><ul className="service-list">{services.map(service => <ServiceCard key={service.id} service={service} />)}</ul></>}
  </section>;
}
