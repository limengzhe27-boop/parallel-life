/** Modern phone policy: fixed UTC+08, independent of browser timezone or historical DST. */
const WORLD_OFFSET_MS = 8 * 60 * 60_000;
const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

/** Reject calendar rollover (e.g. February 30), 24:00 and leap seconds. */
function wallMillis(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
  ms = 0,
): number | null {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, ms);
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
    ? date.getTime()
    : null;
}

/** Only explicit-offset ISO instants; never parse using a host's local timezone. */
function instant(iso: string): number | null {
  if (typeof iso !== 'string') return null;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(
      iso,
    );
  if (!match) return null;
  const [, y, m, d, h, min, sec, fraction, offset] = match;
  const wall = wallMillis(
    Number(y),
    Number(m),
    Number(d),
    Number(h),
    Number(min),
    Number(sec ?? 0),
    Number((fraction ?? '').padEnd(3, '0').slice(0, 3)),
  );
  if (wall === null) return null;
  if (offset === 'Z') return wall;
  const hours = Number(offset!.slice(1, 3));
  const minutes = Number(offset!.slice(4, 6));
  if (hours > 23 || minutes > 59) return null;
  return wall - (offset![0] === '+' ? 1 : -1) * (hours * 60 + minutes) * 60_000;
}

function worldDate(iso: string): Date | null {
  const value = instant(iso);
  if (value === null) return null;
  const date = new Date(value + WORLD_OFFSET_MS);
  return date.getUTCFullYear() >= 0 && date.getUTCFullYear() <= 9999 ? date : null;
}

export function worldDateTimeInput(iso: string): string {
  return worldDate(iso)?.toISOString().slice(0, 16) ?? '';
}
export function worldDayKey(iso: string): string {
  return worldDateTimeInput(iso).slice(0, 10);
}
export function worldMonthKey(iso: string): string {
  return worldDateTimeInput(iso).slice(0, 7);
}
export function worldTimeLabel(iso: string): string {
  return worldDateTimeInput(iso).slice(11, 16);
}
export function worldDateTimeLabel(iso: string): string {
  return worldDateTimeInput(iso).replace('T', ' ');
}
export function worldWeekday(iso: string): string {
  const date = worldDate(iso);
  return date ? weekdays[date.getUTCDay()]! : '';
}

/** A minute-precision UTC+08 wall-clock input becomes a UTC instant, with seconds zeroed. */
export function worldDateTimeToInstant(value: string): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d, h, min] = match;
  const wall = wallMillis(Number(y), Number(m), Number(d), Number(h), Number(min));
  if (wall === null) return null;
  const date = new Date(wall - WORLD_OFFSET_MS);
  if (date.getUTCFullYear() < 0 || date.getUTCFullYear() > 9999) return null;
  return date.toISOString();
}
