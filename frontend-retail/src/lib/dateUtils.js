// .toISOString() converts a Date to UTC first, which can shift the
// calendar date by one day for timezones ahead of UTC (like Saudi Arabia,
// UTC+3) — most noticeably in the early hours after midnight local time,
// when it's still "yesterday" in UTC. This uses the Date object's LOCAL
// getters instead, so the date string always matches what the person's
// own clock and calendar say "today" is.
export function toLocalDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayLocalStr() {
  return toLocalDateStr(new Date());
}
