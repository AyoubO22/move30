import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, Users } from "lucide-react";
import { BarChart } from "@/components/arc/bar-chart/bar-chart";
import { MetricCard } from "@/components/arc/metric-card/metric-card";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { EmptyState } from "@/components/arc/empty-state/empty-state";
import { Gauge } from "@/components/arc/gauge/gauge";
import { get } from "../../api";

interface Analytics {
  available: boolean;
  minGroupSize: number;
  members?: number;
  reason?: string;
  days?: number;
  overview?: { members: number; participation: number | null; avgBreaksPerDay: number | null; avgActiveMinutesPerDay: number | null; goalReachedRate: number | null };
  series?: { day: string; avgBreaks: number | null }[];
  byHour?: number[] | null;
  teams?: { name: string; members: number; participation: number | null; avgBreaksPerDay: number | null }[];
  hiddenTeams?: number;
}

const day = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", ...o });

export function AdminOverview() {
  const [range, setRange] = useState("30");
  const [data, setData] = useState<Analytics | null>(null);
  useEffect(() => { get<Analytics>(`/org/analytics?days=${range}`).then(setData).catch(() => setData(null)); }, [range]);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Organization overview</h1>
          <p className="muted"><ShieldCheck size={14} className="inline-icon" /> Anonymous by design: groups under {data?.minGroupSize ?? 5} people are never shown.</p>
        </div>
        <SegmentedControl label="Range" value={range} onValueChange={setRange}
          options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} />
      </header>

      {!data ? <div aria-busy="true" className="panel" /> : !data.available ? (
        <EmptyState icon={<Users />} title="Not enough people yet" description={data.reason || ""}
          action={<Link className="link-button" to="/admin/people">Invite colleagues</Link>} />
      ) : (
        <>
          <div className="metrics">
            <MetricCard label="Members" value={data.overview!.members} context="in the organization" />
            <MetricCard label="Participation" value={Math.round((data.overview!.participation ?? 0) * 100)} suffix="%" context={data.overview!.participation == null ? "hidden, too few active people" : `logged a break in ${range} days`} />
            <MetricCard label="Breaks per person" value={data.overview!.avgBreaksPerDay ?? 0} context={data.overview!.avgBreaksPerDay == null ? "hidden, too few people" : "per active day"} />
            <MetricCard label="Active minutes" value={data.overview!.avgActiveMinutesPerDay ?? 0} suffix=" min" context="per person, per active day" />
          </div>

          <div className="grid-2">
            <div className="panel">
              <h3>Average breaks per person</h3>
              <BarChart label="Average breaks per active person" height={220}
                period={`${day(data.series![0]!.day, { day: "numeric", month: "short" })} – ${day(data.series!.at(-1)!.day, { day: "numeric", month: "short" })}`}
                averageLabel="Average across workdays"
                data={data.series!.filter((d) => d.avgBreaks != null).map((d) => ({
                  key: d.day,
                  label: day(d.day, { weekday: "short", day: "numeric", month: "short" }),
                  axisLabel: range === "7" ? day(d.day, { weekday: "short" }) : undefined,
                  value: d.avgBreaks ?? 0,
                }))} />
              <p className="muted small">Days with fewer than {data.minGroupSize} active people are left out to protect privacy.</p>
            </div>
            <div className="panel center-col">
              <h3>Goal reached</h3>
              <Gauge label="Person-days reaching the daily goal" value={Math.round((data.overview!.goalReachedRate ?? 0) * 100)} detail="% of active days" />
            </div>
          </div>

          {data.byHour && (
            <div className="panel">
              <h3>When people move</h3>
              <BarChart label="Breaks by hour" period={`Total breaks per hour of the day, last ${range} days`} averageLabel="Average per hour" unit="breaks" height={180} showAverage={false}
                data={data.byHour.slice(7, 20).map((n, i) => ({ key: `h${i + 7}`, label: `${i + 7}:00`, axisLabel: `${i + 7}h`, value: n }))} />
            </div>
          )}

          <div className="panel">
            <h3>Teams</h3>
            {data.teams!.length === 0 ? <p className="muted small">No team with at least {data.minGroupSize} members yet.</p> : (
              <table className="table">
                <thead><tr><th>Team</th><th>Members</th><th>Participation</th><th>Breaks / person / day</th></tr></thead>
                <tbody>
                  {data.teams!.map((t) => (
                    <tr key={t.name}><td>{t.name}</td><td>{t.members}</td><td>{t.participation == null ? "—" : `${Math.round(t.participation * 100)}%`}</td><td>{t.avgBreaksPerDay ?? "—"}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
            {!!data.hiddenTeams && <p className="muted small">{data.hiddenTeams} team(s) hidden: a team needs {data.minGroupSize} people who have been in it for at least two weeks.</p>}
          </div>
        </>
      )}
    </div>
  );
}
