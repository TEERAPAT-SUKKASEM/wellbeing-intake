import Link from "next/link";
import type { Service } from "@/lib/client/contracts";
import { UiIcon } from "./UiIcon";

export function ServiceCard({ service }: { service: Service }) {
  return <li id={`service-${service.id}`} className="service-row"><div className="service-identity"><h2>{service.name}</h2><p>{service.duration_minutes}-minute session</p></div><p className="service-description">{service.description}</p><Link href={`/request/new?service=${encodeURIComponent(service.id)}`} className="btn service-request">Choose a time <UiIcon name="arrow" className="size-4" /></Link></li>;
}
