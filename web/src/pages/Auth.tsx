import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { PasswordField } from "@/components/arc/password-field/password-field";
import { Alert } from "@/components/arc/alert/alert";
import { get, post } from "../api";
import { useSession } from "../session";

const SSO_ERRORS: Record<string, string> = {
  sso_expired: "The sign-in took too long. Please try again.",
  sso_failed: "Single sign-on failed. Ask your admin to check the configuration.",
  sso_no_email: "Your identity provider did not share a verified email.",
  sso_not_allowed: "Your account isn't allowed in this organization yet. Ask your admin for an invite.",
  sso_conflict: "This email is already used by another account.",
};

function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="auth">
      <section className="auth-side" aria-hidden="true">
        <div className="auth-brand"><span className="logo-dot">30</span> Move30</div>
        <h2>Healthier desk days, without the noise.</h2>
        <p>Silent reminders to stand up every 30 minutes, guided micro-breaks, and team insights that never expose individuals.</p>
        <ul>
          <li>Single sign-on with Microsoft or Google</li>
          <li>Company-wide work hours and break policy</li>
          <li>Anonymous team statistics, GDPR by design</li>
        </ul>
      </section>
      <section className="auth-main">
        <div className="auth-card">
          <h1>{title}</h1>
          <p className="muted">{subtitle}</p>
          {children}
        </div>
      </section>
    </div>
  );
}

export function Login() {
  const { refresh } = useSession();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [org, setOrg] = useState("");
  const [error, setError] = useState(params.get("error") ? SSO_ERRORS[params.get("error")!] || "Sign-in failed." : "");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    try { await post("/auth/login", { email, password }); await refresh(); navigate("/"); }
    catch (err) { setError(err instanceof Error ? err.message : "Sign-in failed."); }
    finally { setBusy(false); }
  };

  const sso = (e: FormEvent) => {
    e.preventDefault();
    const slug = org.trim().toLowerCase();
    if (/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) window.location.href = `/api/auth/sso/${slug}`;
    else setError("Enter your organization ID, for example acme-corp.");
  };

  return (
    <AuthLayout title="Sign in" subtitle="Welcome back. Your desk misses you less than your legs do.">
      {error && <Alert tone="danger" title={error} />}
      <form onSubmit={submit} className="stack">
        <Input label="Work email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <PasswordField label="Password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit" loading={busy}>Sign in</Button>
      </form>
      <div className="divider"><span>or with your company account</span></div>
      <form onSubmit={sso} className="row-form">
        <Input label="Organization ID" placeholder="acme-corp" value={org} onChange={(e) => setOrg(e.target.value)} />
        <Button type="submit" variant="secondary">Continue with SSO</Button>
      </form>
      <p className="muted small">New company? <Link to="/signup">Create an organization</Link></p>
    </AuthLayout>
  );
}

export function Signup() {
  const { refresh } = useSession();
  const [form, setForm] = useState({ orgName: "", name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    try { await post("/auth/signup", form); await refresh(); navigate("/admin/people"); }
    catch (err) { setError(err instanceof Error ? err.message : "Signup failed."); }
    finally { setBusy(false); }
  };

  return (
    <AuthLayout title="Create your organization" subtitle="You'll be the first admin. Invite your colleagues next.">
      {error && <Alert tone="danger" title={error} />}
      <form onSubmit={submit} className="stack">
        <Input label="Company name" required value={form.orgName} onChange={set("orgName")} />
        <Input label="Your name" required autoComplete="name" value={form.name} onChange={set("name")} />
        <Input label="Work email" type="email" required autoComplete="email" value={form.email} onChange={set("email")} />
        <PasswordField label="Password" description="At least 10 characters." required minLength={10} autoComplete="new-password" value={form.password} onChange={set("password")} />
        <Button type="submit" loading={busy}>Create organization</Button>
      </form>
      <p className="muted small">Already have an account? <Link to="/login">Sign in</Link></p>
    </AuthLayout>
  );
}

export function Invite() {
  const { token = "" } = useParams();
  const { refresh } = useSession();
  const navigate = useNavigate();
  const [info, setInfo] = useState<{ orgName: string; email: string | null; ssoEnabled: boolean; orgSlug: string } | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    get<typeof info>(`/auth/invite/${encodeURIComponent(token)}`).then(setInfo).catch((e) => setError(e.message));
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const body: Record<string, string> = { name: form.name, password: form.password };
      if (!info?.email) body.email = form.email;
      await post(`/auth/invite/${encodeURIComponent(token)}/accept`, body);
      await refresh(); navigate("/");
    } catch (err) { setError(err instanceof Error ? err.message : "Couldn't join."); }
    finally { setBusy(false); }
  };

  if (!info) {
    return <AuthLayout title="Join your team" subtitle="Checking your invite…">{error && <Alert tone="danger" title={error} />}</AuthLayout>;
  }
  return (
    <AuthLayout title={`Join ${info.orgName}`} subtitle="Set up your account to start taking smarter breaks.">
      {error && <Alert tone="danger" title={error} />}
      {info.ssoEnabled && (
        <>
          <Button onClick={() => { window.location.href = `/api/auth/sso/${info.orgSlug}?invite=${encodeURIComponent(token)}`; }}>
            Continue with your company account
          </Button>
          <div className="divider"><span>or create a password</span></div>
        </>
      )}
      <form onSubmit={submit} className="stack">
        <Input label="Your name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        {info.email
          ? <Input label="Work email" value={info.email} readOnly />
          : <Input label="Work email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}
        <PasswordField label="Password" description="At least 10 characters." required minLength={10} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <Button type="submit" loading={busy}>Join {info.orgName}</Button>
      </form>
    </AuthLayout>
  );
}
