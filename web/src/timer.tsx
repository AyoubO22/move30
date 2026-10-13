import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { get, post, type Settings, type Summary } from "./api";
import { useSession } from "./session";
import type { Routine } from "./routines";

export type TimerStatus = "ready" | "sitting" | "paused" | "break" | "offhours";

interface TimerValue {
  remaining: number;
  total: number;
  status: TimerStatus;
  summary: Summary | null;
  start: () => void;
  pause: () => void;
  reset: () => void;
  snooze: () => void;
  /** Log a break and restart the countdown. */
  logBreak: (minutes: number, routine?: Routine["id"] | "quick") => Promise<boolean>;
  refreshSummary: () => Promise<void>;
  pipOpen: boolean;
  pipSupported: boolean;
  togglePip: () => Promise<void>;
}

const TimerContext = createContext<TimerValue | null>(null);

export const fmt = (secs: number) => {
  const s = Math.max(0, Math.ceil(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const toMin = (hhmm: string) => { const [h = 0, m = 0] = hhmm.split(":").map(Number); return h * 60 + m; };

/** Is it a working moment in the organization's time zone? */
export function inWorkHours(s: Settings, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: s.timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  return s.workdays.includes(day) && minutes >= toMin(s.workStart) && minutes < toMin(s.workEnd);
}

const FAVICON = "/favicon.svg";
const FAVICON_ALERT = "/favicon-alert.svg";

function setFavicon(href: string) {
  const link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (link && !link.href.endsWith(href)) link.href = href;
}

function chime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [660, 880, 990].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = ctx.currentTime + i * 0.18;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.55);
    });
  } catch { /* no audio */ }
}

interface PipWindow extends Window { }
declare global {
  interface Window { documentPictureInPicture?: { requestWindow: (o: { width: number; height: number }) => Promise<PipWindow> } }
}

export function TimerProvider({ children }: { children: ReactNode }) {
  const { me, toast } = useSession();
  const settings = me?.settings;
  const total = (settings?.interval || 30) * 60;

  const [remaining, setRemaining] = useState(total);
  const [status, setStatus] = useState<TimerStatus>("ready");
  const [summary, setSummary] = useState<Summary | null>(null);
  const endAt = useRef<number | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  const refreshSummary = useCallback(async () => {
    try { setSummary(await get<Summary>("/me/summary?days=30")); } catch { /* signed out */ }
  }, []);
  useEffect(() => { if (me) refreshSummary(); }, [me, refreshSummary]);

  const start = useCallback(() => {
    if ("Notification" in window && settings?.notifications && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
    setRemaining((r) => {
      const left = r <= 0 ? total : r;
      endAt.current = Date.now() + left * 1000;
      return left;
    });
    setStatus("sitting");
  }, [settings?.notifications, total]);

  const pause = useCallback(() => { endAt.current = null; setStatus("paused"); }, []);
  const reset = useCallback(() => { endAt.current = null; setRemaining(total); setStatus("ready"); }, [total]);
  const snooze = useCallback(() => { endAt.current = Date.now() + 300_000; setRemaining(300); setStatus("sitting"); }, []);

  // A new interval from the org or the user resets an idle timer.
  useEffect(() => { if (statusRef.current !== "sitting") { setRemaining(total); } }, [total]);

  // Tick.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!settings) return;
      const off = settings.enforceWorkHours && !inWorkHours(settings);
      if (off) {
        if (statusRef.current !== "offhours" && statusRef.current !== "break") { endAt.current = null; setRemaining(total); setStatus("offhours"); }
        return;
      }
      if (statusRef.current === "offhours") { endAt.current = Date.now() + total * 1000; setRemaining(total); setStatus("sitting"); return; }
      if (statusRef.current !== "sitting" || endAt.current == null) return;
      const left = (endAt.current - Date.now()) / 1000;
      if (left <= 0) {
        endAt.current = null;
        setRemaining(0);
        setStatus("break");
        if (settings.chime) chime();
        if (settings.notifications && "Notification" in window && Notification.permission === "granted") {
          // Silent by design: no sound in an open-plan office.
          try { new Notification("Time to move", { body: "Stand up for a few minutes.", tag: "move30", silent: true }); } catch { /* ignore */ }
        }
      } else {
        setRemaining(left);
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [settings, total]);

  // Auto-start on load when work hours are enforced and we are inside them.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!settings || autoStarted.current) return;
    autoStarted.current = true;
    if (settings.enforceWorkHours && inWorkHours(settings)) start();
  }, [settings, start]);

  // Silent visual cues: blinking title + orange favicon while a break is due.
  useEffect(() => {
    if (status !== "break") {
      setFavicon(FAVICON);
      document.title = status === "sitting" || status === "paused" ? `${fmt(remaining)} · Move30` : "Move30";
      return;
    }
    setFavicon(FAVICON_ALERT);
    let on = true;
    const id = window.setInterval(() => { document.title = on ? "● Time to move" : "Move30"; on = !on; }, 1000);
    return () => window.clearInterval(id);
  }, [status, remaining]);

  const logBreak = useCallback(async (minutes: number, routine?: Routine["id"] | "quick") => {
    try {
      await post("/me/breaks", { minutes: Math.max(0.5, Math.min(30, Math.round(minutes * 10) / 10)), routine });
      await refreshSummary();
      return true;
    } catch (err) {
      toast("Break not saved", err instanceof Error ? err.message : undefined);
      return false;
    } finally {
      endAt.current = Date.now() + total * 1000;
      setRemaining(total);
      setStatus(settings?.enforceWorkHours && settings && !inWorkHours(settings) ? "offhours" : "sitting");
    }
  }, [refreshSummary, toast, total, settings]);

  // ---------- Floating mini timer (Document Picture-in-Picture, Chrome & Edge) ----------
  const pipSupported = typeof window !== "undefined" && "documentPictureInPicture" in window;
  const pip = useRef<{ win: PipWindow; root: Root } | null>(null);
  const [pipOpen, setPipOpen] = useState(false);

  const togglePip = useCallback(async () => {
    if (pip.current) { pip.current.win.close(); return; }
    if (!window.documentPictureInPicture) return;
    const win = await window.documentPictureInPicture.requestWindow({ width: 240, height: 170 });
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        const style = win.document.createElement("style");
        style.textContent = Array.from(sheet.cssRules).map((r) => r.cssText).join("\n");
        win.document.head.appendChild(style);
      } catch {
        if (sheet.href) { const l = win.document.createElement("link"); l.rel = "stylesheet"; l.href = sheet.href; win.document.head.appendChild(l); }
      }
    }
    win.document.documentElement.setAttribute("data-theme", document.documentElement.getAttribute("data-theme") || "light");
    win.document.documentElement.setAttribute("data-accent", document.documentElement.getAttribute("data-accent") || "green");
    win.document.title = "Move30";
    const host = win.document.createElement("div");
    win.document.body.appendChild(host);
    pip.current = { win, root: createRoot(host) };
    setPipOpen(true);
    win.addEventListener("pagehide", () => { pip.current?.root.unmount(); pip.current = null; setPipOpen(false); });
  }, []);

  const value = useMemo<TimerValue>(() => ({
    remaining, total, status, summary, start, pause, reset, snooze, logBreak, refreshSummary, pipOpen, pipSupported, togglePip,
  }), [remaining, total, status, summary, start, pause, reset, snooze, logBreak, refreshSummary, pipOpen, pipSupported, togglePip]);

  // Render the mini timer into the floating window on every change.
  useEffect(() => {
    pip.current?.root.render(<PipView value={value} />);
  }, [value]);

  return <TimerContext.Provider value={value}>{children}</TimerContext.Provider>;
}

function PipView({ value }: { value: TimerValue }) {
  const due = value.status === "break";
  return (
    <div className={`pip ${due ? "pip-alert" : ""}`}>
      <div className="pip-time">{due ? "Move!" : fmt(value.remaining)}</div>
      <div className="pip-status">{STATUS_LABEL[value.status]}</div>
      <button className="pip-btn" onClick={() => {
        if (due) void value.logBreak(3, "quick");
        else if (value.status === "sitting") value.pause();
        else value.start();
      }}>{due ? "I moved" : value.status === "sitting" ? "Pause" : "Start"}</button>
    </div>
  );
}

export const STATUS_LABEL: Record<TimerStatus, string> = {
  ready: "Ready",
  sitting: "Sitting",
  paused: "Paused",
  break: "Time to move",
  offhours: "Outside work hours",
};

export function useTimer() {
  const v = useContext(TimerContext);
  if (!v) throw new Error("useTimer outside provider");
  return v;
}
