/** YYYY-MM-DD for a moment, as seen in a given IANA time zone. */
export function ymdIn(tz, date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** The last `n` calendar days (oldest first) ending today in `tz`. */
export function lastDays(tz, n) {
  const [y, m, d] = ymdIn(tz).split("-").map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const day = new Date(Date.UTC(y, m - 1, d - i));
    out.push(day.toISOString().slice(0, 10));
  }
  return out;
}
