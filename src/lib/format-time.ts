/**
 * A record time in the viewer's locale and time zone, zone included
 * (e.g. "26 Oct 2026, 2:03:04 pm AEDT"), so two people reading the same
 * record never mistake each other's clock. `timeZone` exists for tests.
 */
export function formatLocalTime(ms: number, timeZone?: string): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "long", timeZone });
}

/** ISO 8601 in UTC, or the empty string for an out-of-range timestamp. */
export function toIsoUtc(ms: number): string {
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}
