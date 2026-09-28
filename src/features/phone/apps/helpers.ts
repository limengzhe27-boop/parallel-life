/** ISO day keys stay in the supplied world offset; never shift by the viewer's timezone. */
export function dayKey(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}/.exec(iso)?.[0] ?? '';
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
/** Input is edited in the invitation's original offset, not in the host browser timezone. */
export function rescheduleAt(value: string, original: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const d = new Date(value + ':00Z');
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 16) !== value) return null;
  const offset = /(Z|[+-]\d{2}:\d{2})$/.exec(original)?.[0] ?? 'Z';
  return value + ':00' + offset;
}
export function timeText(iso: string): string {
  return iso ? iso.slice(0, 16).replace('T', ' ') : '';
}
export function formatChatTime(iso: string, referenceTime?: string): string {
  if (!iso) return '';
  const timePart = iso.slice(11, 16);
  if (!referenceTime) return timePart;
  const msgDate = new Date(iso);
  const refDate = new Date(referenceTime);
  const diffMs = refDate.getTime() - msgDate.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  const sameDay = iso.slice(0, 10) === referenceTime.slice(0, 10);
  if (sameDay) {
    // A saved world clock may stay at its opening instant across visits. An
    // absolute time is honest; "just now" would repeat on every old message.
    if (diffMins >= 0 && diffMins <= 2) return timePart;
    if (diffMins > 2 && diffMins < 60) return `${diffMins}分钟前`;
    return timePart;
  }
  const calendarDayDelta =
    (Date.parse(dayKey(referenceTime) + 'T00:00:00Z') - Date.parse(dayKey(iso) + 'T00:00:00Z')) /
    86400000;
  if (calendarDayDelta === 1) {
    return `昨天 ${timePart}`;
  }
  return `${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日`;
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
