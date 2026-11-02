import Link from "next/link";
import { UiIcon } from "@/components/UiIcon";

export type ServiceCardData = { id: string; slug: string; name: string; whatFor: string; firstSession: string; whoWillKnow: string };

const marks: Record<string, "talk" | "health" | "movement" | "wellbeing"> = { counselling: "talk", "health-clinic": "health", physiotherapy: "movement", "wellbeing-advising": "wellbeing" };

export function ServiceCard({ service }: { service: ServiceCardData }) {
  return (
    <li id={`service-${service.slug}`} className="service-card home-glass glass card card-border p-5 sm:p-8">
      <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)_auto] lg:items-start lg:gap-6">
        <div className="flex items-center gap-3 lg:items-start">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-field bg-base-200"><UiIcon name={marks[service.slug] ?? "health"} className="size-6" /></span>
          <div><h3 className="card-title text-xl font-semibold">{service.name}</h3><p className="mt-1 text-xs text-base-content/70">Campus support</p></div>
        </div>
        <p className="text-sm text-base-content/80">{service.whatFor}</p>
        <Link href={`/request/new?service=${service.id}`} className="btn btn-neutral w-full lg:w-auto lg:self-start" aria-label={`Request ${service.name.toLowerCase()}`}>Request support <UiIcon name="arrow" className="size-4" /></Link>
      </div>
      <div className="mt-6 grid gap-5 border-t border-base-300 pt-5 text-sm sm:grid-cols-2 sm:gap-8 lg:ml-14">
        <div><p className="font-medium">Your first visit</p><p className="mt-1 text-base-content/70">{service.firstSession}</p></div>
        <div><p className="font-medium">Who will know</p><p className="mt-1 text-base-content/70">{service.whoWillKnow}</p></div>
      </div>
    </li>
  );
}
