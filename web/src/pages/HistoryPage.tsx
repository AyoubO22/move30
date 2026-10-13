import { useMemo, useState } from "react";
import { BarChart } from "@/components/arc/bar-chart/bar-chart";
import { MetricCard } from "@/components/arc/metric-card/metric-card";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { EmptyState } from "@/components/arc/empty-state/empty-state";
import { Footprints } from "lucide-react";
import { useTimer } from "../timer";
import { useSession } from "../session";

const fmtDay = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", ...opts });

export function HistoryPage() {
  const { summary } = useTimer();
  const { me } = useSession();
  const [range, setRange] = useState("7");
  const [metric, setMetric] = useState("breaks");

  const series = useMemo(() => (summary?.series || []).slice(-Number(range)), [summary, range]);
  const goal = me?.settings.dailyGoal || 12;
  const total = series.reduce((a, d) => a + d.breaks, 0);
  const activeDays = series.filter((d) => d.breaks > 0);
  const goalDays = series.filter((d) => d.breaks >= goal).length;
  const minutes = series.reduce((a, d) => a + d.minutes, 0);

  if (!summary) return <div className="page narrow" aria-busy="true" />;

  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>My history</h1>
          <p className="muted">Only you can see this. Your employer only ever sees anonymous team totals.</p>
        </div>
        <SegmentedControl label="Range" value={range} onValueChange={setRange} options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }]} />
      </header>

      <div className="metrics">
        <MetricCard label="Breaks" value={total} context={`last ${range} days`} />
        <MetricCard label="Active minutes" value={Math.round(minutes)} suffix=" min" context={`last ${range} days`} />
        <MetricCard label="Goal reached" value={goalDays} suffix={` / ${series.length}`} context={`days with ${goal}+ breaks`} />
        <MetricCard label="Per active day" value={activeDays.length ? Math.round((total / activeDays.length) * 10) / 10 : 0} context="average breaks" />
      </div>

      {total === 0 ? (
        <EmptyState icon={<Footprints />} title="No breaks yet" description="Start the timer and log your first break. Your history will build up here." />
      ) : (
        <div className="panel">
          <div className="panel-head">
            <h3>{metric === "breaks" ? "Breaks per day" : "Active minutes per day"}</h3>
            <SegmentedControl label="Measure" value={metric} onValueChange={setMetric} options={[{ value: "breaks", label: "Breaks" }, { value: "minutes", label: "Minutes" }]} />
          </div>
          <BarChart
            label={metric === "breaks" ? "Breaks" : "Active minutes"}
            period={`${fmtDay(series[0]!.day, { day: "numeric", month: "short" })} – ${fmtDay(series[series.length - 1]!.day, { day: "numeric", month: "short", year: "numeric" })}`}
            unit={metric === "breaks" ? "" : "min"}
            height={220}
            data={series.map((d) => ({
              key: d.day,
              label: fmtDay(d.day, { weekday: "short", day: "numeric", month: "short" }),
              axisLabel: range === "7" ? fmtDay(d.day, { weekday: "short" }) : undefined,
              value: metric === "breaks" ? d.breaks : d.minutes,
            }))}
          />
        </div>
      )}
    </div>
  );
}
