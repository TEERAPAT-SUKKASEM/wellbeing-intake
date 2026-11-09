"use client";
import { useEffect, useState } from "react";
import { studentApi } from "@/lib/client/booking-preview";
import type { Service } from "@/lib/client/contracts";
import { ServiceCard } from "./ServiceCard";
import { ServiceMatcher } from "./ServiceMatcher";

export function ServiceFinder({ preview = false }: { preview?: boolean }) {
  const [services, setServices] = useState<Service[] | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    studentApi(preview)<Service[]>("/services").then(result => {
      if (!alive) return;
      setError(!result.ok);
      if (result.ok) setServices(result.data ?? []);
    });
    return () => { alive = false; };
  }, [preview, reload]);

  return <section className="bento-services" aria-label="Counselling services">
    {error && <div role="alert" className="card gap-3 p-5"><p>We could not load services.</p><button className="btn self-start" onClick={() => { setError(false); setReload(value => value + 1); }}>Try again</button></div>}
    {!services && !error && <div role="status" aria-label="Loading services" className="space-y-4"><div className="skeleton h-32 w-full" /><div className="skeleton h-32 w-full" /></div>}
    {services?.length === 0 && <p className="card p-5">No services are currently available. Emergency contacts remain available.</p>}
    {services && services.length > 0 && <><ServiceMatcher services={services} preview={preview} /><ul className="service-list">{services.map(service => <ServiceCard key={service.id} service={service} />)}</ul></>}
  </section>;
}
