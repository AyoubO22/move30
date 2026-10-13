import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download } from "lucide-react";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { PasswordField } from "@/components/arc/password-field/password-field";
import { Switch } from "@/components/arc/switch/switch";
import { CopyButton } from "@/components/arc/copy-button/copy-button";
import { Badge } from "@/components/arc/badge/badge";
import { Alert } from "@/components/arc/alert/alert";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { del, get, put } from "../../api";
import { useAction, useSession } from "../../session";

interface OrgData {
  name: string; slug: string; minGroupSize: number; ssoLoginUrl: string; ssoRedirectUri: string;
  sso: { enabled: boolean; enforced: boolean; issuer: string | null; clientId: string | null; hasSecret: boolean };
}

function teamsManifest(appUrl: string, orgName: string) {
  const host = new URL(appUrl).host;
  return {
    $schema: "https://developer.microsoft.com/json-schemas/teams/v1.17/MicrosoftTeams.schema.json",
    manifestVersion: "1.17",
    version: "1.0.0",
    id: crypto.randomUUID(),
    developer: { name: orgName, websiteUrl: appUrl, privacyUrl: `${appUrl}/privacy`, termsOfUseUrl: `${appUrl}/privacy` },
    name: { short: "Move30", full: "Move30 break timer" },
    description: { short: "Silent reminders to stand up every 30 minutes.", full: "Silent reminders to stand up every 30 minutes, guided micro-breaks and anonymous team insights." },
    icons: { outline: "outline.png", color: "color.png" },
    accentColor: "#0DB879",
    staticTabs: [{ entityId: "move30", name: "Move30", contentUrl: `${appUrl}/`, websiteUrl: `${appUrl}/`, scopes: ["personal"] }],
    permissions: ["identity"],
    validDomains: [host],
  };
}

export function AdminSecurity() {
  const run = useAction();
  const navigate = useNavigate();
  const { setMe } = useSession();
  const [org, setOrg] = useState<OrgData | null>(null);
  const [form, setForm] = useState({ enabled: false, enforced: false, issuer: "", clientId: "", clientSecret: "" });
  const [delOpen, setDelOpen] = useState(false);
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    get<OrgData>("/org").then((o) => {
      setOrg(o);
      setForm({ enabled: o.sso.enabled, enforced: o.sso.enforced, issuer: o.sso.issuer || "", clientId: o.sso.clientId || "", clientSecret: "" });
    });
  }, []);
  if (!org) return <div className="page narrow" aria-busy="true" />;

  const appUrl = new URL(org.ssoRedirectUri).origin;
  const downloadManifest = () => {
    const blob = new Blob([JSON.stringify(teamsManifest(appUrl, org.name), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "manifest.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="page narrow">
      <header className="page-head"><div><h1>Sign-in & data</h1><p className="muted">Single sign-on, Microsoft Teams and data controls.</p></div></header>

      <section className="panel form-panel">
        <div className="panel-head"><h3>Single sign-on (OpenID Connect)</h3><Badge tone={org.sso.enabled ? "success" : "neutral"}>{org.sso.enabled ? "On" : "Off"}</Badge></div>
        <p className="muted small">Works with Microsoft Entra ID, Google Workspace, Okta and any OpenID Connect provider. Register an app with this redirect URI:</p>
        <div className="copy-row"><code>{org.ssoRedirectUri}</code><CopyButton value={org.ssoRedirectUri} /></div>
        <Input label="Issuer URL" placeholder="https://login.microsoftonline.com/<tenant-id>/v2.0" description="Use your tenant-specific issuer, not a shared 'common' endpoint."
          value={form.issuer} onChange={(e) => setForm({ ...form, issuer: e.target.value })} />
        <div className="two-col">
          <Input label="Client ID" value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} />
          <PasswordField label="Client secret" placeholder={org.sso.hasSecret ? "Saved. Leave empty to keep it." : ""} autoComplete="off"
            value={form.clientSecret} onChange={(e) => setForm({ ...form, clientSecret: e.target.value })} />
        </div>
        <Switch label="Enable single sign-on" checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
        <Switch label="Require SSO for members (admins keep password access as a fallback)" checked={form.enforced} disabled={!form.enabled}
          onCheckedChange={(v) => setForm({ ...form, enforced: v })} />
        <div className="actions start">
          <Button onClick={() => run(async () => {
            await put("/org/sso", { enabled: form.enabled, enforced: form.enforced, ...(form.issuer ? { issuer: form.issuer } : {}), ...(form.clientId ? { clientId: form.clientId } : {}), ...(form.clientSecret ? { clientSecret: form.clientSecret } : {}) });
            setForm({ ...form, clientSecret: "" });
            setOrg(await get<OrgData>("/org"));
          }, "Single sign-on saved")}>Save SSO</Button>
        </div>
        <p className="muted small">Your people sign in at <code>{org.ssoLoginUrl}</code> or with organization ID <strong>{org.slug}</strong>.</p>
      </section>

      <section className="panel form-panel">
        <h3>Microsoft Teams</h3>
        <p className="muted small">Add Move30 as a personal tab in Teams. Download the manifest, zip it with two icons (color.png 192×192, outline.png 32×32) and upload it in the Teams admin center. The server needs <code>FRAME_ANCESTORS</code> set to the Teams domains (see the README).</p>
        <div><Button variant="secondary" onClick={downloadManifest}><Download size={16} /> Download Teams manifest</Button></div>
      </section>

      <section className="panel form-panel">
        <h3>Privacy</h3>
        <ul className="checks">
          <li>Admins never see an individual's breaks, only totals for groups of at least {org.minGroupSize} people.</li>
          <li>Everyone can download or delete their own data from their settings (GDPR articles 15, 17 and 20).</li>
          <li>Passwords are hashed with Argon2id; SSO client secrets are encrypted at rest.</li>
          <li>No ads, no third-party trackers, no data sold.</li>
        </ul>
      </section>

      <section className="panel form-panel danger-zone">
        <h3>Delete organization</h3>
        <p className="muted small">Deletes every account, team, invite and break in {org.name}. This can't be undone.</p>
        <div><Button variant="danger" onClick={() => setDelOpen(true)}>Delete organization</Button></div>
      </section>

      <Dialog open={delOpen} onOpenChange={setDelOpen}>
        <DialogContent title={`Delete ${org.name}?`} description="All data for everyone in your organization will be erased permanently.">
          <div className="stack">
            <Alert tone="danger" title={`Type "${org.name}" to confirm`} />
            <Input label="Organization name" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <div className="actions end">
              <Button variant="ghost" onClick={() => setDelOpen(false)}>Cancel</Button>
              <Button variant="danger" disabled={confirm !== org.name} onClick={() => run(async () => { await del("/org", { confirm }); setMe(null); navigate("/login"); })}>Delete everything</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
