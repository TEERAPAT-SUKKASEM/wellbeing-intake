import { UiIcon } from "@/components/UiIcon";

export function CampusHero() {
  return (
    <section className="campus-scene" aria-label="Campus health and wellbeing services">
      <div className="hero-copy">
        <h1>Campus support.<br />All in <em>one place.</em></h1>
        <p>Your student life comes with a lot to navigate. Find campus health, counselling, and wellbeing services, and take the next step privately.</p>
        <div className="hero-actions">
          <a href="#services-heading" className="btn btn-primary">Find your support <UiIcon name="arrow" /></a>
          <a href="#helper-heading" className="btn btn-ghost hero-secondary">Help me choose</a>
        </div>
        <p className="hero-note">For students. Browse freely. Sign in when you’re ready to request support.</p>
      </div>
    </section>
  );
}
