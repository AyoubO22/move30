import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, Lock } from "lucide-react";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { PasswordField } from "@/components/arc/password-field/password-field";
import { Switch } from "@/components/arc/switch/switch";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { NumberField } from "@/components/arc/number-field/number-field";
import { TimePicker } from "@/components/arc/time-picker/time-picker";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { Alert } from "@/components/arc/alert/alert";
import { del, post, put, type Settings } from "../api";
import { useAction, useSession } from "../session";

export function SettingsPage() {
  const { me, refresh, setMe } = useSession();
  const run = useAction();
  const navigate = useNavigate();
  const [name, setName] = useState(me?.user.name || "");
  const [pw, setPw] = useState({ current: "", next: "" });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  if (!me) return null;
  const s = me.settings;

  const save = (patch: Partial<Settings>) =>
    run(async () => { await put("/me/settings", patch); await refresh(); });

  return (
    <div className="page narrow">
      <header className="page-head"><div><h1>Settings</h1><p className="muted">{me.user.email} · {me.org.name}</p></div></header>

      <section className="panel form-panel">
        <h3>Profile</h3>
        <div className="row-form">
          <Input label="Display name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          <Button variant="secondary" onClick={() => run(async () => { await put("/me/profile", { name }); await refresh(); }, "Name updated")}>Save</Button>
        </div>
      </section>

      <section className="panel form-panel">
        <div className="panel-head">
          <h3>My timer</h3>
          {s.locked && <span className="muted small"><Lock size={13} className="inline-icon" /> Set by your organization</span>}
        </div>
        <div className="field-row">
          <span className="field-label">Interval</span>
          <SegmentedControl label="Interval" value={String(s.interval)} onValueChange={(v) => !s.locked && save({ interval: Number(v) as Settings["interval"] })}
            options={[20, 30, 45, 60].map((n) => ({ value: String(n), label: `${n} min` }))} />
        </div>
        <Switch label="Only run during work hours" checked={s.enforceWorkHours} disabled={s.locked} onCheckedChange={(v) => save({ enforceWorkHours: v })} />
        <div className="two-col">
          <TimePicker label="Work starts" format="24h" value={s.workStart} disabled={s.locked} onChange={(v) => save({ workStart: v })} />
          <TimePicker label="Work ends" format="24h" value={s.workEnd} disabled={s.locked} onChange={(v) => save({ workEnd: v })} />
        </div>
        <NumberField label="Daily goal" suffix=" breaks" min={1} max={30} value={s.dailyGoal} disabled={s.locked} onValueChange={(v) => save({ dailyGoal: v })} />
      </section>

      <section className="panel form-panel">
        <h3>Alerts</h3>
        <Switch label="Silent desktop notifications" checked={s.notifications} onCheckedChange={(v) => save({ notifications: v })} />
        <Switch label="Soft chime (off by default for open-plan offices)" checked={s.chime} onCheckedChange={(v) => save({ chime: v })} />
      </section>

      <section className="panel form-panel">
        <h3>{me.user.hasPassword ? "Change password" : "Set a password"}</h3>
        {me.user.hasPassword && <PasswordField label="Current password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />}
        <PasswordField label="New password" description="At least 10 characters. Other devices will be signed out." autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
        <div><Button variant="secondary" onClick={() => run(async () => { await post("/me/password", pw); setPw({ current: "", next: "" }); await refresh(); }, "Password updated")}>Update password</Button></div>
      </section>

      <section className="panel form-panel">
        <h3>My data</h3>
        <p className="muted small">Your breaks are visible only to you. Admins see anonymous totals for groups of at least five people, never individual activity.</p>
        <div className="actions start">
          <a className="link-button" href="/api/me/export" download><Download size={16} /> Download my data (JSON)</a>
          <Button variant="danger" onClick={() => setConfirmOpen(true)}>Delete my account</Button>
        </div>
      </section>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent title="Delete your account?" description="Your profile and every break you logged are deleted permanently. This can't be undone.">
          <div className="stack">
            <Alert tone="warning" title="Type DELETE to confirm" />
            <Input label="Confirmation" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
            <div className="actions end">
              <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Cancel</Button>
              <Button variant="danger" disabled={confirmText !== "DELETE"} onClick={() => run(async () => {
                await del("/me", { confirm: "DELETE" }); setMe(null); navigate("/login");
              })}>Delete permanently</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
