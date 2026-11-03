import Link from "next/link";
import { UiIcon } from "@/components/UiIcon";

export type ServiceCardData = { id: string; slug: string; name: string; whatFor: string; firstSession: string; whoWillKnow: string };

const marks: Record<string, "talk" | "health" | "movement" | "wellbeing"> = { counselling: "talk", "health-clinic": "health", physiotherapy: "movement", "wellbeing-advising": "wellbeing" };
const actions: Record<string, string> = { counselling: "Request counselling", "health-clinic": "Request a health visit", physiotherapy: "Request physiotherapy", "wellbeing-advising": "Request wellbeing advice" };

export function ServiceCard({ service }: { service: ServiceCardData }) {
  return (
    <li id={`service-${service.slug}`} data-service={service.slug} className="service-card home-glass card card-border p-5 sm:p-8">
      <div className="service-overview">
        <div className="flex items-center gap-3">
          <span className="service-icon flex size-11 shrink-0 items-center justify-center rounded-field bg-base-200"><UiIcon name={marks[service.slug] ?? "health"} className="size-6" /></span>
          <div><h3 className="card-title text-xl font-semibold">{service.name}</h3></div>
        </div>
        <p className="text-sm text-base-content/80">{service.whatFor}</p>
      </div>
      <details className="service-disclosure collapse collapse-arrow mt-5 border-t border-base-300">
        <summary className="collapse-title">Your first visit &amp; privacy</summary>
        <div className="service-details collapse-content grid gap-4 text-sm sm:grid-cols-2 sm:gap-6">
        <div><p className="font-medium">Your first visit</p><p className="mt-1 text-base-content/70">{service.firstSession}</p></div>
        <div><p className="font-medium">Who will know</p><p className="mt-1 text-base-content/70">{service.whoWillKnow}</p></div>
        </div>
      </details>
      <Link href={`/request/new?service=${service.id}`} className="service-request btn btn-outline mt-3 w-full"><span>{actions[service.slug] ?? `Request ${service.name.toLowerCase()}`}</span><UiIcon name="arrow" className="size-4" /></Link>
    </li>
  );
}
