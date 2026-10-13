import { useEffect, useState } from "react";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { Switch } from "@/components/arc/switch/switch";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { NumberField } from "@/components/arc/number-field/number-field";
import { TimePicker } from "@/components/arc/time-picker/time-picker";
import { get, put, type Accent } from "../../api";
import { useAction, useSession } from "../../session";

interface Policy {
  interval: 20 | 30 | 45 | 60; workStart: string; workEnd: string; workdays: number[]; timezone: string;
  enforceWorkHours: boolean; allowOverride: boolean; dailyGoal: number;
}
interface OrgData { name: string; accent: Accent; logoUrl: string | null; policy: Policy; allowedDomains: string[] }

const ACCENTS: Accent[] = ["green", "blue", "violet", "rose", "coral", "orange", "amber", "neutral"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function AdminPolicy() {
  const { refresh } = useSession();
  const run = useAction();
  const [org, setOrg] = useState<OrgData | null>(null);
  const [domains, setDomains] = useState("");
  useEffect(() => { get<OrgData>("/org").then((o) => { setOrg(o); setDomains(o.allowedDomains.join(", ")); }); }, []);
  if (!org) return <div className="page narrow" aria-busy="true" />;

  const p = org.policy;
  const setP = (patch: Partial<Policy>) => setOrg({ ...org, policy: { ...p, ...patch } });

  const save = () => run(async () => {
    await put("/org", {
      name: org.name, accent: org.accent, logoUrl: org.logoUrl || "", policy: org.policy,
      allowedDomains: domains.split(/[\s,]+/).map((d) => d.trim().toLowerCase()).filter(Boolean),
    });
    await refresh();
  }, "Saved for everyone in your organization");

  return (
    <div className="page narrow">
      <header className="page-head">
        <div><h1>Policy & branding</h1><p className="muted">Defaults for everyone in {org.name}.</p></div>
        <Button onClick={save}>Save changes</Button>
      </header>

      <section className="panel form-panel">
        <h3>Break policy</h3>
        <div className="field-row">
          <span className="field-label">Interval</span>
          <SegmentedControl label="Interval" value={String(p.interval)} onValueChange={(v) => setP({ interval: Number(v) as Policy["interval"] })}
            options={[20, 30, 45, 60].map((n) => ({ value: String(n), label: `${n} min` }))} />
        </div>
        <NumberField label="Daily goal" suffix=" breaks" min={1} max={30} value={p.dailyGoal} onValueChange={(v) => setP({ dailyGoal: v })} />
        <Switch label="Let people adjust their own timer" checked={p.allowOverride} onCheckedChange={(v) => setP({ allowOverride: v })} />
      </section>

      <section className="panel form-panel">
        <h3>Work hours</h3>
        <Switch label="Only run during work hours (timer starts by itself in the morning)" checked={p.enforceWorkHours} onCheckedChange={(v) => setP({ enforceWorkHours: v })} />
        <div className="two-col">
          <TimePicker label="Start" format="24h" value={p.workStart} onChange={(v) => setP({ workStart: v })} />
          <TimePicker label="End" format="24h" value={p.workEnd} onChange={(v) => setP({ workEnd: v })} />
        </div>
        <div className="field-row">
          <span className="field-label">Workdays</span>
          <div className="chips" role="group" aria-label="Workdays">
            {DAYS.map((d, i) => (
              <button key={d} type="button" className="chip" aria-pressed={p.workdays.includes(i)}
                onClick={() => setP({ workdays: p.workdays.includes(i) ? p.workdays.filter((x) => x !== i) : [...p.workdays, i].sort() })}>{d}</button>
            ))}
          </div>
        </div>
        <Input label="Time zone" description="IANA name, for example Europe/Brussels or Europe/Paris." value={p.timezone} onChange={(e) => setP({ timezone: e.target.value })} />
      </section>

      <section className="panel form-panel">
        <h3>Branding</h3>
        <Input label="Organization name" value={org.name} onChange={(e) => setOrg({ ...org, name: e.target.value })} />
        <Input label="Logo URL" description="HTTPS image, shown in the sidebar." placeholder="https://…" value={org.logoUrl || ""} onChange={(e) => setOrg({ ...org, logoUrl: e.target.value })} />
        <div className="field-row">
          <span className="field-label">Accent color</span>
          <div className="swatches" role="radiogroup" aria-label="Accent color">
            {ACCENTS.map((a) => (
              <button key={a} type="button" role="radio" aria-checked={org.accent === a} aria-label={a} className={`swatch swatch-${a}`}
                onClick={() => { setOrg({ ...org, accent: a }); document.documentElement.setAttribute("data-accent", a); }} />
            ))}
          </div>
        </div>
      </section>

      <section className="panel form-panel">
        <h3>Company email domains</h3>
        <p className="muted small">People signing in through your SSO with these domains join automatically. Leave empty to allow invites only.</p>
        <Input label="Domains" placeholder="acme.com, acme.be" value={domains} onChange={(e) => setDomains(e.target.value)} />
      </section>
    </div>
  );
}
