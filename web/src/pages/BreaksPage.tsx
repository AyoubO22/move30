import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/arc/button/button";
import { Progress } from "@/components/arc/progress/progress";
import { Badge } from "@/components/arc/badge/badge";
import { ROUTINES, type Routine } from "../routines";
import { fmt, useTimer } from "../timer";
import { useSession } from "../session";

interface PlayerState { routine: Routine; index: number; left: number; paused: boolean; elapsed: number }

export function BreaksPage() {
  const [params, setParams] = useSearchParams();
  const [player, setPlayer] = useState<PlayerState | null>(null);
  const stepEnd = useRef(0);
  const timer = useTimer();
  const { toast } = useSession();
  const navigate = useNavigate();

  const begin = (routine: Routine) => {
    stepEnd.current = Date.now() + routine.steps[0]!.secs * 1000;
    setPlayer({ routine, index: 0, left: routine.steps[0]!.secs, paused: false, elapsed: 0 });
  };

  // Deep link from the dashboard: /breaks?start=desk-reset
  useEffect(() => {
    const id = params.get("start");
    const r = ROUTINES.find((x) => x.id === id);
    if (r) { begin(r); setParams({}, { replace: true }); }
  }, [params, setParams]);

  const playerRef = useRef(player);
  playerRef.current = player;

  // Side effects (logging the break) stay outside state updaters so they run exactly once.
  function advance(completed: boolean) {
    const p = playerRef.current;
    if (!p) return;
    const step = p.routine.steps[p.index]!;
    const elapsed = p.elapsed + (completed ? step.secs : step.secs - Math.max(0, p.left));
    const next = p.index + 1;
    if (next >= p.routine.steps.length) {
      playerRef.current = null;
      setPlayer(null);
      void finish(p.routine, elapsed);
      return;
    }
    stepEnd.current = Date.now() + p.routine.steps[next]!.secs * 1000;
    const np = { ...p, index: next, left: p.routine.steps[next]!.secs, elapsed };
    playerRef.current = np;
    setPlayer(np);
  }

  useEffect(() => {
    if (!player || player.paused) return;
    const id = window.setInterval(() => {
      const p = playerRef.current;
      if (!p || p.paused) return;
      const left = (stepEnd.current - Date.now()) / 1000;
      if (left > 0) setPlayer({ ...p, left });
      else advance(true);
    }, 200);
    return () => window.clearInterval(id);
  }, [player?.paused, player?.routine]); // eslint-disable-line react-hooks/exhaustive-deps

  async function finish(routine: Routine, elapsedSecs: number) {
    const ok = await timer.logBreak(Math.max(1, elapsedSecs / 60), routine.id);
    if (ok) { toast("Break logged", `${routine.name} · nice work.`); navigate("/"); }
  }

  const step = player ? player.routine.steps[player.index]! : null;

  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>Guided breaks</h1>
          <p className="muted">No equipment, no changing clothes, nothing that looks odd in an open-plan office.</p>
        </div>
      </header>

      {player && step && (
        <div className="player" aria-live="polite">
          <div className="player-head">
            <span className="muted">{player.routine.name}</span>
            <span className="muted">Step {player.index + 1} / {player.routine.steps.length}</span>
          </div>
          <h2>{step.name}</h2>
          <p className="muted">{step.cue}</p>
          <div className="countdown big">{fmt(player.left)}</div>
          <Progress value={step.secs - player.left} max={step.secs} label="Step progress" />
          <div className="actions">
            <Button variant="secondary" onClick={() => setPlayer((p) => {
              if (!p) return p;
              if (p.paused) stepEnd.current = Date.now() + p.left * 1000;
              return { ...p, paused: !p.paused };
            })}>{player.paused ? "Resume" : "Pause"}</Button>
            <Button variant="secondary" onClick={() => advance(false)}>Skip step</Button>
            <Button variant="ghost" onClick={() => setPlayer(null)}>Stop</Button>
          </div>
        </div>
      )}

      <div className="cards">
        {ROUTINES.map((r) => (
          <button key={r.id} className="routine-card" onClick={() => begin(r)}>
            <div className="routine-top"><Badge size="sm">{r.tag}</Badge><span className="muted small">{r.minutes} min</span></div>
            <h3>{r.name}</h3>
            <p className="muted small">{r.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
