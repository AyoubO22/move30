const STUDIES = [
  {
    title: "5 minutes of walking every 30 minutes",
    meta: "Diaz et al., Medicine & Science in Sports & Exercise, 2023 · 11 adults",
    body: "Researchers compared walking 1 or 5 minutes every 30 or 60 minutes during an 8-hour sitting day. Five minutes every half hour was the only pattern that significantly lowered both blood sugar and blood pressure, cutting post-meal glucose spikes by about 58%. Breaks taken only once an hour did not help blood sugar.",
    href: "https://doi.org/10.1249/MSS.0000000000003109",
  },
  {
    title: "Simple leg exercises at your desk",
    meta: "Activity-break trials in adults with excess weight",
    body: "Three minutes of half-squats, calf raises, glute squeezes and knee raises every 30 minutes reduced the insulin response to meals by around a quarter. A meta-analysis of 13 crossover trials found breaks at least every 30 minutes beat less frequent ones for glucose control.",
    href: "https://thesouthfirst.com/health/movement-breaks-why-you-should-move-every-30-minutes/",
  },
  {
    title: "A 15-minute walk after meals",
    meta: "DiPietro et al., Diabetes Care, 2013 · 10 older adults",
    body: "Three 15-minute walks, starting 30 minutes after each meal, controlled 24-hour blood sugar as well as one 45-minute walk, and worked better after the evening meal.",
    href: "https://doi.org/10.2337/dc13-0084",
  },
  {
    title: "One-minute bursts of vigorous activity",
    meta: "Stamatakis et al., Nature Medicine, 2022 · ~25,000 non-exercisers",
    body: "People who did around three short bursts a day of intense everyday activity, like taking the stairs fast, had markedly lower risk of death from all causes and from heart disease. This is an observational study: it shows an association, not proof of cause.",
    href: "https://doi.org/10.1038/s41591-022-02100-x",
  },
];

export function SciencePage() {
  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>The science</h1>
          <p className="muted">What the research says about breaking up sitting, in plain words.</p>
        </div>
      </header>
      <div className="studies">
        {STUDIES.map((s) => (
          <article key={s.title} className="panel study">
            <h3>{s.title}</h3>
            <p className="muted small">{s.meta}</p>
            <p>{s.body}</p>
            <a href={s.href} target="_blank" rel="noopener noreferrer">Read the source</a>
          </article>
        ))}
      </div>
      <p className="disclaimer">Move30 is not medical advice. Most of these studies are small or observational. If you have a health condition, talk to a professional before changing your activity.</p>
    </div>
  );
}
