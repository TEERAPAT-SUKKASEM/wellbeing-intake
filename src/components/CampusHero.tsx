import { UiIcon } from "@/components/UiIcon";

export function CampusHero() {
  return (
    <section className="campus-scene" aria-label="Campus health and wellbeing services">
      <div className="hero-copy">
        <h1>A little support.<br />A lot more <em>possibility.</em></h1>
        <p>Student life can be a lot. Taking care of yourself shouldn’t be. Find the right campus support, at your own pace.</p>
        <div className="hero-actions">
          <a href="#services-heading" className="btn btn-primary">Find my support <UiIcon name="arrow" /></a>
          <a href="#helper-heading" className="btn btn-ghost">Help me choose <UiIcon name="arrow" className="size-4" /></a>
        </div>
        <div className="hero-reassurance"><UiIcon name="shield" /><span>Browse freely. Request support privately.</span></div>
      </div>
    </section>
  );
}
