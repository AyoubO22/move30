import "@fontsource-variable/inter";
import "@fontsource-variable/geist";
import "@/components/arc/foundation.css";
import "./app.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { SessionProvider, useSession } from "./session";
import { TimerProvider } from "./timer";
import { Shell } from "./pages/Shell";
import { Login, Signup, Invite } from "./pages/Auth";
import { TimerPage } from "./pages/TimerPage";
import { BreaksPage } from "./pages/BreaksPage";
import { HistoryPage } from "./pages/HistoryPage";
import { SciencePage } from "./pages/SciencePage";
import { SettingsPage } from "./pages/SettingsPage";
import { AdminOverview } from "./pages/admin/Overview";
import { AdminPeople } from "./pages/admin/People";
import { AdminPolicy } from "./pages/admin/Policy";
import { AdminSecurity } from "./pages/admin/Security";
import { PrivacyPage } from "./pages/PrivacyPage";

function Gate() {
  const { me, loading } = useSession();
  if (loading) return <div className="splash" aria-busy="true" />;
  if (!me) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/invite/:token" element={<Invite />} />
        <Route path="/privacy" element={<div className="content"><PrivacyPage /></div>} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  const admin = me.user.role === "admin";
  return (
    <TimerProvider>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<TimerPage />} />
          <Route path="breaks" element={<BreaksPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="science" element={<SciencePage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="privacy" element={<PrivacyPage />} />
          {admin && <Route path="admin" element={<AdminOverview />} />}
          {admin && <Route path="admin/people" element={<AdminPeople />} />}
          {admin && <Route path="admin/policy" element={<AdminPolicy />} />}
          {admin && <Route path="admin/security" element={<AdminSecurity />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </TimerProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <Gate />
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>
);
