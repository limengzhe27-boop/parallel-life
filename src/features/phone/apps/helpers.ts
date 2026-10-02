import {
  worldDayKey,
  worldTimeLabel,
  worldDateTimeLabel,
  worldDateTimeInput,
  worldDateTimeToInstant,
} from '../../../modules/world/domain/display-time.ts';
export { worldDateTimeInput };
/** Date-only photo labels are already calendar dates; timestamps use the world clock policy. */
export function dayKey(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : worldDayKey(iso);
}
export function monthDays(month: string): (string | null)[] {
  if (!/^\d{4}-\d{2}$/.test(month)) return [];
  const year = Number(month.slice(0, 4)),
    m = Number(month.slice(5, 7));
  if (m < 1 || m > 12) return [];
  const first = new Date(`${month}-01T00:00:00Z`);
  const count = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return [
    ...Array.from({ length: (first.getUTCDay() + 6) % 7 }, () => null),
    ...Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`),
  ];
}
export function shiftMonth(month: string, delta: number): string {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 7);
}
/** Form wall-clock values use the world policy, never the source string's offset. */
export function rescheduleAt(value: string, original: string): string | null {
  if (value && value === worldDateTimeInput(original)) return original;
  return worldDateTimeToInstant(value);
}
export function timeText(iso: string): string {
  return worldDateTimeLabel(iso);
}
export function formatChatTime(iso: string, referenceTime?: string): string {
  const time = worldTimeLabel(iso),
    day = dayKey(iso);
  if (!time || !day) return '';
  if (!referenceTime || day === dayKey(referenceTime)) return time;
  const delta =
    (Date.parse(dayKey(referenceTime) + 'T00:00:00Z') - Date.parse(day + 'T00:00:00Z')) / 86400000;
  if (delta === 1) return `昨天 ${time}`;
  return `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日`;
}
export function errorText(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
  switch (code) {
    case 'VERSION_CONFLICT':
      return '内容已在别处更新。草稿还在，请刷新后核对，再重新提交。';
    case 'UNKNOWN':
      return '提交结果尚未确认。请先刷新核对；如需重试，请明确点击重试。';
    case 'NOT_FOUND':
      return '这项内容已不可访问，请刷新查看。';
    case 'UNAVAILABLE':
      return '暂时无法连接，写好的内容还在。';
    case 'INVALID_INPUT':
      return '内容未被接受，请检查后再试。';
    default:
      return '刚才没能完成，写好的内容还在。请稍后重试。';
  }
}
export function searchable(query: string, ...values: string[]) {
  const q = query.trim().toLocaleLowerCase();
  return !q || values.some((v) => v.toLocaleLowerCase().includes(q));
}

/** Do not expose legacy model envelopes as a character's words. User text is unchanged. */
export function dialogueText(text: string, role?: string): string {
  if (role !== 'user' && /"(?:schemaVersion|effects)"\s*:/.test(text)) {
    return '这条历史回复格式异常，请重新询问。';
  }
  return text;
}
