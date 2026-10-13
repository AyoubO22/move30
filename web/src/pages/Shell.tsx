import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Activity, BarChart3, BookOpen, Building2, Footprints, LogOut, Settings, ShieldCheck, Sliders, Timer, Users } from "lucide-react";
import { useEffect } from "react";
import { Avatar } from "@/components/arc/avatar/avatar";
import { post } from "../api";
import { useSession } from "../session";
import { fmt, useTimer } from "../timer";

const MAIN = [
  { to: "/", label: "Timer", icon: Timer, end: true, key: "1" },
  { to: "/breaks", label: "Breaks", icon: Footprints, key: "2" },
  { to: "/history", label: "My history", icon: Activity, key: "3" },
  { to: "/science", label: "Science", icon: BookOpen, key: "4" },
];
const ADMIN = [
  { to: "/admin", label: "Overview", icon: BarChart3, end: true },
  { to: "/admin/people", label: "People & teams", icon: Users },
  { to: "/admin/policy", label: "Policy & branding", icon: Sliders },
  { to: "/admin/security", label: "Sign-in & data", icon: ShieldCheck },
];

export function Shell() {
  const { me, setMe } = useSession();
  const timer = useTimer();
  const navigate = useNavigate();

  // Global keyboard shortcuts for desktop use.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable], [role='combobox'], [role='dialog']") || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === " " && t.tagName !== "BUTTON") {
        e.preventDefault();
        if (timer.status === "break") void timer.logBreak(3, "quick");
        else if (timer.status === "sitting") timer.pause();
        else timer.start();
      } else if (k === "m") void timer.logBreak(3, "quick");
      else if (k === "s" && timer.status === "break") timer.snooze();
      else if (k === "b") navigate("/breaks");
      else { const item = MAIN.find((i) => i.key === k); if (item) navigate(item.to); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [timer, navigate]);

  if (!me) return null;
  const logout = async () => { await post("/auth/logout").catch(() => {}); setMe(null); navigate("/login"); };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="org">
          {me.org.logoUrl
            ? <img src={me.org.logoUrl} alt="" className="org-logo" referrerPolicy="no-referrer" />
            : <span className="org-logo org-logo-fallback"><Building2 size={16} /></span>}
          <div className="org-text">
            <strong>{me.org.name}</strong>
            <span>Move30</span>
          </div>
        </div>

        <NavLink to="/" className={`mini-status status-${timer.status}`}>
          <span className="dot" />
          {timer.status === "break" ? "Time to move" : timer.status === "offhours" ? "Off hours" : fmt(timer.remaining)}
        </NavLink>

        <nav className="nav">
          {MAIN.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className="nav-item"><Icon size={17} /> <span>{label}</span></NavLink>
          ))}
        </nav>

        {me.user.role === "admin" && (
          <nav className="nav">
            <div className="nav-heading">Admin</div>
            {ADMIN.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} className="nav-item"><Icon size={17} /> <span>{label}</span></NavLink>
            ))}
          </nav>
        )}

        <div className="sidebar-foot">
          <NavLink to="/settings" className="nav-item user">
            <Avatar name={me.user.name} size="sm" />
            <span className="user-text"><strong>{me.user.name}</strong><span>{me.user.team?.name || me.user.email}</span></span>
            <Settings size={16} />
          </NavLink>
          <button className="nav-item" onClick={logout}><LogOut size={17} /> <span>Sign out</span></button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
