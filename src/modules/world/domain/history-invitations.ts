import { isoInstant } from './validation.ts';

const OFFSET = 8 * 60 * 60_000;
export type HistoryInvitation = { slotId: string; body: string };
export type HistoryInvitationSlot = {
  slotId: 'soon' | 'next_morning' | 'next_evening';
  label: string;
};
function invalid(): never {
  throw Error('INVALID_HISTORY_INVITATION');
}
// A bounded syntax gate, not a claim to understand every natural-language time reference.
const timeWords =
  /今天|明天|后天|昨天|前天|今晚|明晚|明早|今早|昨晚|本周|这周|下周|上周|周末|周[一二三四五六日天]|星期|礼拜|上午|下午|晚上|早上|中午|凌晨|傍晚|待会|等会|稍后|过几天|下个月|本月|下次|过完年|月底|年底|月末|年末|\b(?:today|tomorrow|tonight|weekend|next\s+week)\b/i;
const explicitTime =
  /\d\s*[年月日号]|\d{1,2}\s*[:：]\s*\d{2}|[0-9一二三四五六七八九十两]+\s*点(?:钟|半)?|\d{1,4}[/-]\d{1,2}|[0-9一二三四五六七八九十两]+\s*(?:天后|小时后)/;
const emptyActivity = new Set([
  '好',
  '好的',
  '好啊',
  '好呀',
  '嗯',
  '哦',
  '你好',
  '随时都行',
  '没问题',
  '谢谢',
  '再说',
  '可以',
  '行',
  '收到',
  '知道了',
  '早安',
  '晚安',
  '一起',
  '来吧',
  '你来吗',
  '愿意吗',
]);
const controlMarker =
  /[{}]|\[(?:slot|time|date)[^\]]*\]|<(?:slot|time|date)[^>]*>|【(?:日期|时间|slot)】/i;

/** One fixed story instant. Model input gets IDs/labels; offsets remain runtime-owned. */
export function historyInvitationSchedule(startAt: string) {
  const start = Date.parse(isoInstant(startAt));
  const local = new Date(start + OFFSET);
  const nextDay = (hour: number) => {
    const target = new Date(0);
    target.setUTCFullYear(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1);
    target.setUTCHours(hour, 0, local.getUTCSeconds(), local.getUTCMilliseconds());
    return target.getTime() - OFFSET;
  };
  const candidates = [
    ['soon', start + 60 * 60_000],
    ['next_morning', nextDay(10)],
    ['next_evening', nextDay(19)],
  ] as const;
  const values = candidates.map(([slotId, at]) => {
    const date = new Date(at + OFFSET);
    const minutes = (at - start) / 60_000;
    if (
      !Number.isFinite(at) ||
      !Number.isInteger(minutes) ||
      minutes < 30 ||
      minutes > 10080 ||
      date.getUTCFullYear() < 0 ||
      date.getUTCFullYear() > 9999
    )
      invalid();
    const label = `${String(date.getUTCFullYear()).padStart(4, '0')}年${date.getUTCMonth() + 1}月${date.getUTCDate()}日 ${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
    return Object.freeze({ slotId, label, minutes, hour: date.getUTCHours() });
  });
  const slots: readonly Readonly<HistoryInvitationSlot>[] = Object.freeze(
    values.map(({ slotId, label }) => Object.freeze({ slotId, label })),
  );
  return Object.freeze({
    slots,
    render(invitation: HistoryInvitation) {
      if (
        !invitation ||
        typeof invitation !== 'object' ||
        Object.keys(invitation).some((k) => !['slotId', 'body'].includes(k)) ||
        typeof invitation.slotId !== 'string' ||
        typeof invitation.body !== 'string'
      )
        invalid();
      const body = invitation.body.trim();
      const scan = body.normalize('NFKC');
      const slot = values.find((s) => s.slotId === invitation.slotId);
      if (
        !slot ||
        !body ||
        emptyActivity.has(scan.replace(/[，。！？?!.,\s]/g, '')) ||
        body.length > 60 ||
        timeWords.test(scan) ||
        explicitTime.test(scan) ||
        controlMarker.test(scan) ||
        /[\p{Cf}\p{Cc}]/u.test(body)
      )
        invalid();
      // A few literal activity periods are checkable; subtle narrative meaning still needs review.
      if (
        (/早餐|早饭|晨跑|晨练|早读/.test(body) && (slot.hour < 5 || slot.hour >= 12)) ||
        (/午餐|午饭|午休/.test(body) && (slot.hour < 11 || slot.hour >= 15)) ||
        (/晚餐|晚饭|看夕阳/.test(body) && (slot.hour < 17 || slot.hour >= 24)) ||
        (/夜宵|夜跑|夜市/.test(body) && slot.hour >= 3 && slot.hour < 17)
      )
        invalid();
      const text = `${slot.label}，${body}`;
      if (text.length > 80 || text.length > 160) invalid();
      return { text, connection: { quote: text, calendar: { minutesAfterStart: slot.minutes } } };
    },
  });
}
