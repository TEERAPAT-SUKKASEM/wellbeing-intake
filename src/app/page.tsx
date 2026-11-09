import { EmergencyBanner } from "@/components/EmergencyBanner";
import { ServiceFinder } from "@/components/ServiceFinder";
import { uiPreview } from "@/lib/ui-preview";
import Link from "next/link";
import { UiIcon } from "@/components/UiIcon";

export default function HomePage() {
  return (
    <div className="student-home bento-home">
      <header className="route-intro"><h1 id="services-heading">Counselling appointments</h1><p>Choose a service and time. No student account or personal details required.</p></header>
      <div className="bento-layout"><EmergencyBanner /><ServiceFinder preview={uiPreview} /><section className="bento-tracking card" aria-labelledby="bento-tracking-heading"><h2 id="bento-tracking-heading">Already sent a request?</h2><p>Check approval, see time changes, or cancel. You’ll need the private access key shown after you submitted your request.</p><Link href="/requests" className="tracking-status-link"><UiIcon name="status" className="size-5" />Check request status</Link></section></div>
      <p className="service-buffer-note">A 15-minute privacy buffer follows every session.</p>
    </div>
  );
}
