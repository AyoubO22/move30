import { useNavigate } from "react-router-dom";
import { Clock, Lock, PictureInPicture2 } from "lucide-react";
import { Button } from "@/components/arc/button/button";
import { Progress } from "@/components/arc/progress/progress";
import { Badge } from "@/components/arc/badge/badge";
import { useSession } from "../session";
import { fmt, STATUS_LABEL, useTimer } from "../timer";
import { ROUTINES } from "../routines";

export function TimerPage() {
  const { me } = useSession();
  const t = useTimer();
  const navigate = useNavigate();
  if (!me) return null;
  const s = me.settings;
  const R = 52;
  const C = 2 * Math.PI * R;
  const progress = t.status === "break" ? 1 : 1 - t.remaining / t.total;
  const today = t.summary?.today;
  const goal = s.dailyGoal;

  return (
    <div className="page dash">
      <section className="dash-main">
        <header className="page-head">
          <div>
            <h1>Stand up every {s.interval} minutes</h1>
            <p className="muted">Short, frequent breaks lower blood sugar and blood pressure more than one long one.</p>
          </div>
          {s.locked && <Badge icon={<Lock size={12} />} tone="info">Set by {me.org.name}</Badge>}
        </header>

        <div className={`timer-card status-${t.status}`}>
          <div className="ring-wrap">
            <svg className="ring" viewBox="0 0 120 120" aria-hidden="true">
              <circle className="ring-bg" cx="60" cy="60" r={R} />
              <circle className="ring-fg" cx="60" cy="60" r={R} style={{ strokeDasharray: C, strokeDashoffset: C * (1 - progress) }} />
            </svg>
            <div className="ring-text" role="timer" aria-live="off">
              <div className="countdown">{t.status === "break" ? "Move!" : fmt(t.remaining)}</div>
              <div className="muted">{STATUS_LABEL[t.status]}</div>
            </div>
          </div>

          {t.status === "break" ? (
            <div className="break-due">
              <strong>Time to move.</strong>
              <span className="muted">Pick a guided break or just walk for a few minutes.</span>
              <div className="actions">
                <Button onClick={() => navigate("/breaks")}>Start a guided break</Button>
                <Button variant="secondary" onClick={() => t.logBreak(3, "quick")}>I moved</Button>
                <Button variant="ghost" onClick={t.snooze}>Snooze 5 min</Button>
              </div>
            </div>
          ) : (
            <div className="actions">
              {t.status === "sitting"
                ? <Button onClick={t.pause}>Pause</Button>
                : <Button onClick={t.start} disabled={t.status === "offhours"}>Start</Button>}
              <Button variant="secondary" onClick={t.reset}>Reset</Button>
              <Button variant="ghost" onClick={() => t.logBreak(3, "quick")}>I just moved</Button>
            </div>
          )}

          <p className="muted small center">
            {s.enforceWorkHours
              ? <><Clock size={13} className="inline-icon" /> Runs on workdays from {s.workStart} to {s.workEnd}. </>
              : null}
            Silent by default: the tab blinks and its icon turns orange when it's time.
          </p>
        </div>

        <p className="shortcuts">
          <kbd>Space</kbd> start / pause · <kbd>M</kbd> I moved · <kbd>S</kbd> snooze · <kbd>B</kbd> breaks · <kbd>1</kbd>–<kbd>4</kbd> pages
        </p>
      </section>

      <aside className="dash-side">
        <div className="panel">
          <div className="panel-head"><h3>Today</h3><span className="muted small">{today?.breaks ?? 0} / {goal} breaks</span></div>
          <Progress value={Math.min(today?.breaks ?? 0, goal)} max={goal} label="Daily goal" />
          <p className="muted small">{Math.round(today?.minutes ?? 0)} active minutes</p>
        </div>

        <div className="panel desktop-only">
          <h3>Mini timer</h3>
          <p className="muted small">A small window that floats above Outlook, Excel or Teams.</p>
          {t.pipSupported
            ? <Button variant="secondary" onClick={t.togglePip}><PictureInPicture2 size={16} /> {t.pipOpen ? "Close mini timer" : "Open mini timer"}</Button>
            : <p className="muted small">Available in Chrome and Edge.</p>}
        </div>

        <div className="panel">
          <h3>Quick breaks</h3>
          <div className="quick-list">
            {ROUTINES.map((r) => (
              <button key={r.id} className="quick" onClick={() => navigate(`/breaks?start=${r.id}`)}>
                <span>{r.name}</span><span className="muted">{r.minutes} min</span>
              </button>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}
