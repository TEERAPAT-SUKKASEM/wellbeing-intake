// What this page does: the student home page. It lists the counselling services and links to tracking.
// URL: /
// Talks to: no API calls itself. ServiceFinder loads GET /api/v1/services, and its optional
//   "Get a suggestion" helper calls POST /api/v1/finder/suggest. In preview mode both use fake data.
// Note: students never sign in, and no personal details are needed to book.
import { EmergencyBanner } from "@/components/EmergencyBanner";
import { ServiceFinder } from "@/components/ServiceFinder";
import { uiPreview } from "@/lib/ui-preview";
import Link from "next/link";
import { UiIcon } from "@/components/UiIcon";

// A server component: it reads the preview flag on the server and passes it down as a prop.
export default function HomePage() {
  // Bento grid: emergency banner first, then the service list, then a "check request status" card.
  // The tracking link has no key in it; the student types the key on the /requests page.
  return (
    <div className="student-home bento-home">
      <header className="route-intro"><h1 id="services-heading">Counselling appointments</h1><p>Choose a service and time. No student account or personal details required.</p></header>
      <div className="bento-layout"><EmergencyBanner /><ServiceFinder preview={uiPreview} /><section className="bento-tracking card" aria-labelledby="bento-tracking-heading"><h2 id="bento-tracking-heading">Already sent a request?</h2><p>Check approval, see time changes, or cancel. You’ll need the private access key shown after you submitted your request.</p><Link href="/requests" className="tracking-status-link"><UiIcon name="status" className="size-5" />Check request status</Link></section></div>
      <p className="service-buffer-note">A 15-minute privacy buffer follows every session.</p>
    </div>
  );
}
