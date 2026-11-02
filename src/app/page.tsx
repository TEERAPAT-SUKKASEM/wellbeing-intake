import { EmergencyBanner } from "@/components/EmergencyBanner";
import { ServiceFinder } from "@/components/ServiceFinder";
import { uiPreview } from "@/lib/ui-preview";
import { CampusHero } from "@/components/CampusHero";

export default function HomePage() {
  return (
    <div className="retreat-home space-y-8 sm:space-y-10 lg:space-y-12">
      <CampusHero />
      <EmergencyBanner />
      <ServiceFinder preview={uiPreview} />
      <section aria-labelledby="next-heading" className="home-glass glass card card-border">
        <h2 id="next-heading" className="display-heading text-3xl">A clear path from here</h2>
        <ol className="mt-6 grid gap-6 sm:grid-cols-3">
          {[
            ["01", "Choose your support", "Learn what each service offers and what a first visit looks like."],
            ["02", "Tell us what you need", "Send a private request to the practitioners of your chosen service."],
            ["03", "Find a time that suits", "After a practitioner reviews your request, choose an available appointment."],
          ].map(([number, title, detail]) => <li key={number} className="border-l border-base-300 pl-4"><p className="text-xs font-semibold text-base-content/70">{number}</p><h3 className="mt-2 font-semibold">{title}</h3><p className="mt-1 text-sm text-base-content/70">{detail}</p></li>)}
        </ol>
      </section>
    </div>
  );
}
