import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { Select } from "@/components/arc/select/select";
import { CopyButton } from "@/components/arc/copy-button/copy-button";
import { Badge } from "@/components/arc/badge/badge";
import { Avatar } from "@/components/arc/avatar/avatar";
import { Alert } from "@/components/arc/alert/alert";
import { del, get, patch, post } from "../../api";
import { useAction, useSession } from "../../session";

interface Member { id: string; name: string; email: string; role: "member" | "admin"; teamId: string | null; joinedAt: string; sso: boolean }
interface Team { id: string; name: string; members: number }
interface InviteRow { id: string; email: string | null; role: string; teamId: string | null; expiresAt: string; createdBy: string | null }

const NO_TEAM = "__none";

export function AdminPeople() {
  const { me } = useSession();
  const run = useAction();
  const [members, setMembers] = useState<Member[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [inv, setInv] = useState({ email: "", role: "member", teamId: NO_TEAM });
  const [link, setLink] = useState<string | null>(null);
  const [teamName, setTeamName] = useState("");

  const load = useCallback(async () => {
    const [m, t, i] = await Promise.all([
      get<{ members: Member[] }>("/org/members"), get<{ teams: Team[] }>("/org/teams"), get<{ invites: InviteRow[] }>("/org/invites"),
    ]);
    setMembers(m.members); setTeams(t.teams); setInvites(i.invites);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const teamOptions = [{ value: NO_TEAM, label: "No team" }, ...teams.map((t) => ({ value: t.id, label: t.name }))];
  const teamName_ = (id: string | null) => teams.find((t) => t.id === id)?.name || "No team";

  return (
    <div className="page">
      <header className="page-head"><div><h1>People & teams</h1><p className="muted">{members.length} members · {teams.length} teams</p></div></header>

      <div className="grid-2">
        <section className="panel form-panel">
          <h3>Invite someone</h3>
          <p className="muted small">Each link works once and expires after 7 days. Leave the email empty to share the link in a chat.</p>
          <Input label="Email (optional)" type="email" value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} />
          <div className="two-col">
            <Select label="Role" value={inv.role} onValueChange={(v) => setInv({ ...inv, role: v })} options={[{ value: "member", label: "Member" }, { value: "admin", label: "Admin" }]} />
            <Select label="Team" value={inv.teamId} onValueChange={(v) => setInv({ ...inv, teamId: v })} options={teamOptions} />
          </div>
          <div>
            <Button onClick={() => run(async () => {
              const r = await post<{ url: string }>("/org/invites", {
                ...(inv.email ? { email: inv.email } : {}), role: inv.role, teamId: inv.teamId === NO_TEAM ? null : inv.teamId,
              });
              setLink(r.url); setInv({ ...inv, email: "" }); await load();
            })}>Create invite link</Button>
          </div>
          {link && (
            <Alert tone="success" title="Invite link ready. It is shown only once.">
              <div className="copy-row"><code>{link}</code><CopyButton value={link} /></div>
            </Alert>
          )}
          {invites.length > 0 && (
            <ul className="list">
              {invites.map((i) => (
                <li key={i.id}>
                  <span>{i.email || "Open link"} · {i.role} · {teamName_(i.teamId)}</span>
                  <span className="muted small">by {i.createdBy || "former admin"} · expires {new Date(i.expiresAt).toLocaleDateString("en-GB")}</span>
                  <button className="icon-btn" aria-label="Revoke invite" onClick={() => run(async () => { await del(`/org/invites/${i.id}`); await load(); })}><Trash2 size={15} /></button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel form-panel">
          <h3>Teams</h3>
          <p className="muted small">Team statistics appear once a team has at least 5 members who joined it more than two weeks ago.</p>
          <div className="row-form">
            <Input label="New team" value={teamName} onChange={(e) => setTeamName(e.target.value)} maxLength={60} />
            <Button variant="secondary" disabled={!teamName.trim()} onClick={() => run(async () => { await post("/org/teams", { name: teamName }); setTeamName(""); await load(); })}>Add team</Button>
          </div>
          <ul className="list">
            {teams.map((t) => (
              <li key={t.id}>
                <span>{t.name}</span>
                <Badge size="sm" tone={t.members >= 5 ? "success" : "neutral"}>{t.members} members</Badge>
                <button className="icon-btn" aria-label={`Delete ${t.name}`} onClick={() => run(async () => { await del(`/org/teams/${t.id}`); await load(); })}><Trash2 size={15} /></button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="panel">
        <h3>Members</h3>
        <table className="table">
          <thead><tr><th>Name</th><th>Team</th><th>Role</th><th>Sign-in</th><th /></tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td><div className="person"><Avatar name={m.name} size="sm" /><div><strong>{m.name}</strong><div className="muted small">{m.email}</div></div></div></td>
                <td>
                  <select className="native-select" aria-label={`Team for ${m.name}`} value={m.teamId || NO_TEAM}
                    onChange={(e) => run(async () => { await patch(`/org/members/${m.id}`, { teamId: e.target.value === NO_TEAM ? null : e.target.value }); await load(); })}>
                    {teamOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </td>
                <td>
                  <select className="native-select" aria-label={`Role for ${m.name}`} value={m.role}
                    onChange={(e) => run(async () => { await patch(`/org/members/${m.id}`, { role: e.target.value }); await load(); })}>
                    <option value="member">Member</option><option value="admin">Admin</option>
                  </select>
                </td>
                <td><Badge size="sm" tone={m.sso ? "info" : "neutral"}>{m.sso ? "SSO" : "Password"}</Badge></td>
                <td className="right">
                  {m.id !== me?.user.id && (
                    <button className="icon-btn" aria-label={`Remove ${m.name}`} onClick={() => {
                      if (window.confirm(`Remove ${m.name}? Their account and break history are deleted.`)) {
                        void run(async () => { await del(`/org/members/${m.id}`); await load(); });
                      }
                    }}><Trash2 size={15} /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
