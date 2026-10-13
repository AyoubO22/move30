import { Link } from "react-router-dom";

export function PrivacyPage() {
  return (
    <div className="page narrow privacy">
      <header className="page-head"><div><h1>Privacy</h1><p className="muted">How Move30 handles your data.</p></div></header>
      <section className="panel">
        <h3>What we store</h3>
        <p>Your name, work email, team, role, timer preferences, and for each break: when it happened, how long it lasted and which routine you followed. Nothing else: no location, no screen activity, no health measurements.</p>
        <h3>Who sees it</h3>
        <p>Only you see your own breaks. Administrators of your organization see anonymous totals for groups of at least five people, never an individual's activity.</p>
        <h3>Your rights</h3>
        <p>You can download all your data or delete your account at any time from your settings. Deleting your account erases your break history immediately.</p>
        <h3>No ads, no trackers</h3>
        <p>Move30 shows no advertising, loads no third-party trackers and never sells data. Your organization decides where the service is hosted.</p>
      </section>
      <p className="muted small"><Link to="/">Back to Move30</Link></p>
    </div>
  );
}
