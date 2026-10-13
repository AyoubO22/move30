import { q } from "./db.js";
import { config } from "./config.js";
import { lastDays } from "./time.js";

const round = (n, d = 1) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);

/**
 * Organization analytics with built-in privacy:
 * - nothing is computed per person for admins;
 * - any group (org, team, single day) with fewer than MIN_GROUP_SIZE active people is suppressed,
 *   and participation rates are only released when enough people are active too;
 * - team statistics only use breaks taken while the person was in that team (no retroactive move),
 *   and a person only counts toward a team's threshold once they have been in it for TEAM_SETTLE_DAYS,
 *   so a team cannot be packed at the last minute around one person.
 */
export async function orgAnalytics(orgId, { days, tz, dailyGoal }) {
  const min = config.minGroupSize;
  const members = (await q("SELECT count(*)::int AS n FROM users WHERE org_id = $1", [orgId])).rows[0].n;
  if (members < min) {
    return { available: false, minGroupSize: min, members, reason: `Team statistics appear once at least ${min} people have joined.` };
  }

  // Per person-day counts, used only inside this function to build group aggregates.
  // `in_team` marks breaks taken while the person already belonged to their current team.
  const { rows: personDays } = await q(
    `SELECT b.user_id, u.team_id,
            (u.team_since <= now() - make_interval(days => $4::int)) AS settled,
            to_char((b.taken_at AT TIME ZONE $3)::date, 'YYYY-MM-DD') AS day,
            count(*)::int AS breaks, sum(b.minutes)::float AS minutes,
            count(*) FILTER (WHERE b.taken_at >= u.team_since)::int AS team_breaks
       FROM breaks b JOIN users u ON u.id = b.user_id
      WHERE b.org_id = $1 AND b.taken_at > now() - make_interval(days => $2::int + 1)
      GROUP BY 1, 2, 3, 4`,
    [orgId, days, tz, config.teamSettleDays]
  );
  const window = new Set(lastDays(tz, days));
  const pd = personDays.filter((r) => window.has(r.day));

  const activeUsers = new Set(pd.map((r) => r.user_id));
  const sum = (arr, k) => arr.reduce((a, r) => a + r[k], 0);
  const enoughActive = activeUsers.size >= min;

  // Daily series: average breaks per active person; days with too few people are simply null.
  const series = [...window].sort().map((day) => {
    const rows = pd.filter((r) => r.day === day);
    return { day, avgBreaks: rows.length >= min ? round(sum(rows, "breaks") / rows.length) : null };
  });

  const overview = {
    members,
    participation: enoughActive ? round(activeUsers.size / members, 2) : null,
    avgBreaksPerDay: enoughActive && pd.length ? round(sum(pd, "breaks") / pd.length) : null,
    avgActiveMinutesPerDay: enoughActive && pd.length ? round(sum(pd, "minutes") / pd.length) : null,
    goalReachedRate: enoughActive && pd.length ? round(pd.filter((r) => r.breaks >= dailyGoal).length / pd.length, 2) : null,
  };

  // When in the day do people move? Only shown with enough active people.
  let byHour = null;
  if (enoughActive) {
    const { rows } = await q(
      `SELECT extract(hour FROM taken_at AT TIME ZONE $3)::int AS hour, count(*)::int AS n
         FROM breaks WHERE org_id = $1 AND taken_at > now() - make_interval(days => $2::int) GROUP BY 1`,
      [orgId, days, tz]
    );
    byHour = Array.from({ length: 24 }, (_, h) => rows.find((r) => r.hour === h)?.n || 0);
  }

  // Teams: listed only with enough settled members, and released only with enough settled active people.
  const { rows: teamRows } = await q(
    `SELECT t.id, t.name, count(u.id)::int AS members,
            count(u.id) FILTER (WHERE u.team_since <= now() - make_interval(days => $2::int))::int AS settled
       FROM teams t LEFT JOIN users u ON u.team_id = t.id WHERE t.org_id = $1 GROUP BY t.id ORDER BY t.name`,
    [orgId, config.teamSettleDays]
  );
  let hiddenTeams = 0;
  const teams = [];
  for (const t of teamRows) {
    if (t.settled < min) { hiddenTeams++; continue; }
    const rows = pd.filter((r) => r.team_id === t.id && r.settled && r.team_breaks > 0);
    const active = new Set(rows.map((r) => r.user_id)).size;
    if (active < min) { teams.push({ name: t.name, members: t.members, participation: null, avgBreaksPerDay: null }); continue; }
    teams.push({
      name: t.name,
      members: t.members,
      participation: round(active / t.settled, 2),
      avgBreaksPerDay: rows.length ? round(sum(rows, "team_breaks") / rows.length) : null,
    });
  }

  return { available: true, minGroupSize: min, days, overview, series, byHour, teams, hiddenTeams };
}
