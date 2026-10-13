import { publicationStorageIssues } from './publication-content.ts';

type Data = Record<string, unknown>;
type Path = (string | number)[];
type Source = { filename: string; content: string };
export type PublicationTimePlan = {
  status: 'unchanged' | 'proposed' | 'blocked';
  updatedContent: Data;
  changes: { path: Path; value: string; reason: string }[];
  issues: {
    path: Path;
    code: string;
    source?: { filename: string; start: number; end: number; quote: string };
  }[];
};
type Row = { value: Data; path: Path; key: string };
type Slot = { row: Row; field: string; path: Path; time?: number; blank: boolean };
type Window = { begin: number; end: number; path: Path };
const MINUTE = 60_000;
const data = (v: unknown): v is Data => !!v && typeof v === 'object' && !Array.isArray(v);
const blank = (v: unknown) => v === undefined || (typeof v === 'string' && !v.trim());
const strings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');
const instant = (v: unknown): number | undefined => {
  if (typeof v !== 'string') return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/u.exec(v);
  if (!m) return undefined;
  const n = Date.parse(v),
    d = new Date(n);
  return Number.isFinite(n) &&
    d.getUTCFullYear() === Number(m[1]) &&
    d.getUTCMonth() + 1 === Number(m[2]) &&
    d.getUTCDate() === Number(m[3]) &&
    d.getUTCHours() === Number(m[4]) &&
    d.getUTCMinutes() === Number(m[5]) &&
    d.getUTCSeconds() === Number(m[6])
    ? n
    : undefined;
};
const iso = (n: number) => {
  if (!Number.isFinite(n)) return undefined;
  const d = new Date(n);
  if (!Number.isFinite(d.getTime()) || d.getUTCFullYear() < 0 || d.getUTCFullYear() > 9999)
    return undefined;
  return d.toISOString();
};
const temporal =
  /\d{4}\s*(?:年|[-/]\d{1,2})|\d{1,2}[:：]\d{2}|\d{1,2}月\d{1,2}日|(?:\d{1,2}|[一二三四五六七八九十两]+)(?:点|时)(?:\d{1,2}|[一二三四五六七八九十两]+)?分?|第(?:\d{1,6}|[一二三四五六七八九十百两]{1,8})(?:天|日)|(?:今天|明天|昨天|今晚|明晚|昨晚|后天|前天|次日|翌日|隔天|第二天)|(?:\d{1,6}|[一二三四五六七八九十百两]{1,8})\s*(?:天|日|小时|分钟|周|星期|个月|月|年)(?:后|前|内)|(?:周|星期)[一二三四五六日天]|(?:凌晨|早上|上午|中午|下午|傍晚|晚上)\s*(?:\d{1,6}|[一二三四五六七八九十两]+)\s*点/gu;
const dynamic =
  /(?:完成|发生|结束|拒绝|同意|接受|落实|跳过|过期|事件|剧情|邀约|节点)[^。！？!?；;\r\n]{0,32}?(?:后|之后|以后)(?:再|隔|过|等|的|，|,|\s){0,6}(?:\d{1,6}|[一二三四五六七八九十百两]{1,8})\s*(?:天|日|小时|分钟|周|星期|个月)|(?:完成|发生|结束|拒绝|同意|接受|落实|跳过|过期|事件|剧情|邀约|节点)[^。！？!?；;\r\n]{0,24}?(?:次日|翌日|第二天|隔天)/gu;

/** Proposes only missing runtime timestamps. No clock, model, persistence or semantic approval. */
export function planPublicationTimes(
  content: Data,
  options: { referenceAt: string; sources?: Source[] },
): PublicationTimePlan {
  const issues: PublicationTimePlan['issues'] = [],
    changes: PublicationTimePlan['changes'] = [];
  const issue = (
    path: Path,
    code: string,
    source?: PublicationTimePlan['issues'][number]['source'],
  ) => {
    if (
      !issues.some(
        (i) =>
          i.code === code &&
          JSON.stringify(i.path) === JSON.stringify(path) &&
          i.source?.filename === source?.filename &&
          i.source?.start === source?.start,
      )
    )
      issues.push({ path: [...path], code, ...(source ? { source } : {}) });
  };
  // Unsafe values cannot be cloned without reading accessors. Return them untouched, never inspect.
  if (publicationStorageIssues(content).length)
    return {
      status: 'blocked',
      updatedContent: content,
      changes: [],
      issues: [{ path: [], code: 'scheduling_unsafe_content' }],
    };
  const original = JSON.parse(JSON.stringify(content)) as Data;
  const next = JSON.parse(JSON.stringify(content)) as Data;
  const result = (): PublicationTimePlan =>
    issues.length
      ? { status: 'blocked', updatedContent: original, changes: [], issues }
      : {
          status: changes.length ? 'proposed' : 'unchanged',
          updatedContent: next,
          changes,
          issues,
        };
  const reference = instant(options.referenceAt);
  if (reference === undefined) issue([], 'scheduling_invalid_reference');
  if (!data(next.world)) {
    issue(['world'], 'scheduling_invalid_container');
    return result();
  }
  function rows(raw: unknown, path: Path, max: number): Row[] {
    if (raw === undefined) return [];
    if (!Array.isArray(raw) || raw.length > max) {
      issue(path, 'scheduling_invalid_collection');
      return [];
    }
    const seen = new Set<string>();
    return raw.flatMap((v, i) => {
      const p = [...path, i];
      if (!data(v)) {
        issue(p, 'scheduling_invalid_entry');
        return [];
      }
      if (typeof v.key !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/u.test(v.key) || seen.has(v.key)) {
        issue([...p, 'key'], 'scheduling_ambiguous_key');
        return [];
      }
      seen.add(v.key);
      return [{ value: v, path: p, key: v.key }];
    });
  }
  function slot(row: Row, field: string): Slot {
    const value = row.value[field],
      path = [...row.path, field];
    const empty = blank(value),
      time = instant(value);
    if (!empty && time === undefined) issue(path, 'scheduling_invalid_time');
    return { row, field, path, time, blank: empty };
  }
  function fill(s: Slot, n: number, reason: string) {
    if (!s.blank) return;
    const value = iso(n);
    if (!value) {
      issue(s.path, 'scheduling_time_out_of_range');
      return;
    }
    s.row.value[s.field] = value;
    s.time = n;
    s.blank = false;
    changes.push({ path: [...s.path], value, reason });
  }
  const startSlot = slot({ value: next.world, path: ['world'], key: '' }, 'startAt');
  const history = rows(next.history, ['history'], 64);
  if (next.phone !== undefined && !data(next.phone))
    issue(['phone'], 'scheduling_invalid_container');
  const phone = data(next.phone) ? next.phone : {};
  const messages = rows(phone.messages, ['phone', 'messages'], 40);
  const moments = rows(phone.moments, ['phone', 'moments'], 48);
  const invitations = rows(phone.invitations, ['phone', 'invitations'], 12);
  const candidates = rows(next.candidates, ['candidates'], 32);
  if (next.timeline !== undefined && !data(next.timeline))
    issue(['timeline'], 'scheduling_invalid_container');
  const timeline = data(next.timeline) ? next.timeline : undefined;
  const stages = rows(timeline?.stages, ['timeline', 'stages'], 16);
  const histories = history.map((r) => {
    if (r.value.kind !== 'established_fact')
      issue([...r.path, 'kind'], 'scheduling_unknown_history_kind');
    return slot(r, 'occurredAt');
  });
  const messageSlots = messages.map((r) => {
    if (!['history', 'incoming'].includes(String(r.value.origin)))
      issue([...r.path, 'origin'], 'scheduling_unknown_message_origin');
    return slot(r, 'at');
  });
  const momentSlots = moments.map((r) => slot(r, 'at'));
  const inviteSlots = invitations.map((r) => {
    if (r.value.status !== 'proposed')
      issue([...r.path, 'status'], 'scheduling_unknown_invitation_status');
    if (!messages.some((m) => m.key === r.value.messageKey))
      issue([...r.path, 'messageKey'], 'scheduling_unknown_message');
    return slot(r, 'at');
  });
  const candidateSlots = new Map<string, Slot>();
  for (const r of candidates) {
    if (data(r.value.intent) && r.value.intent.kind === 'offer_invitation')
      candidateSlots.set(
        r.key,
        slot({ value: r.value.intent, path: [...r.path, 'intent'], key: r.key }, 'earliestAt'),
      );
  }
  function readWindow(raw: unknown, path: Path): Window | undefined {
    if (raw === undefined) return undefined;
    if (!data(raw)) {
      issue(path, 'scheduling_invalid_window');
      return undefined;
    }
    const begin = instant(raw.notBefore),
      end = instant(raw.expiresAt);
    if (begin === undefined || end === undefined || begin >= end) {
      issue(path, 'scheduling_invalid_window');
      return undefined;
    }
    return { begin, end, path };
  }
  const stageWindows = new Map<string, Window>();
  for (const r of stages) {
    const w = readWindow(r.value.window, [...r.path, 'window']);
    if (w) stageWindows.set(r.key, w);
  }
  const nodeWindows = new Map<string, Window>();
  const conditions = new Map<string, { value: Data; path: Path }[]>();
  for (const r of candidates) {
    if (r.value.timeline !== undefined && !data(r.value.timeline))
      issue([...r.path, 'timeline'], 'scheduling_invalid_container');
    const t = data(r.value.timeline) ? r.value.timeline : undefined;
    if (t && (!timeline || !stages.some((s) => s.key === t.stageKey)))
      issue([...r.path, 'timeline', 'stageKey'], 'scheduling_unknown_stage');
    const ownWindow = readWindow(t?.window, [...r.path, 'timeline', 'window']);
    const stageWindow = typeof t?.stageKey === 'string' ? stageWindows.get(t.stageKey) : undefined;
    if (
      ownWindow &&
      stageWindow &&
      (ownWindow.begin < stageWindow.begin || ownWindow.end > stageWindow.end)
    )
      issue(ownWindow.path, 'scheduling_window_conflict');
    const w = ownWindow ?? stageWindow;
    if (w) nodeWindows.set(r.key, w);
    const raw = r.value.prerequisites;
    if (raw !== undefined && (!Array.isArray(raw) || raw.length > 16))
      issue([...r.path, 'prerequisites'], 'scheduling_invalid_conditions');
    const ps: { value: Data; path: Path }[] = [];
    if (Array.isArray(raw))
      raw.forEach((p, i) => {
        const path = [...r.path, 'prerequisites', i];
        if (!data(p)) {
          issue(path, 'scheduling_invalid_conditions');
          return;
        }
        ps.push({ value: p, path });
        if (p.kind === 'not_before' && instant(p.at) === undefined)
          issue([...path, 'at'], 'scheduling_explicit_constraint_incomplete');
      });
    conditions.set(r.key, ps);
  }
  function graph(rowsToCheck: Row[], edges: (r: Row) => string[], code: string) {
    const visiting = new Set<string>(),
      done = new Set<string>(),
      map = new Map(rowsToCheck.map((r) => [r.key, r]));
    function visit(r: Row) {
      if (done.has(r.key)) return;
      if (visiting.has(r.key)) {
        issue(r.path, code);
        return;
      }
      visiting.add(r.key);
      for (const key of edges(r)) {
        const prior = map.get(key);
        if (!prior || key === r.key) issue(r.path, code);
        else visit(prior);
      }
      visiting.delete(r.key);
      done.add(r.key);
    }
    rowsToCheck.forEach(visit);
  }
  graph(
    stages,
    (r) => {
      if (r.value.afterStageKeys !== undefined && !strings(r.value.afterStageKeys)) {
        issue([...r.path, 'afterStageKeys'], 'scheduling_invalid_dependency');
        return [];
      }
      const keys = strings(r.value.afterStageKeys) ? r.value.afterStageKeys : [];
      for (const key of keys) {
        const prior = stages.find((s) => s.key === key);
        if (
          prior &&
          typeof prior.value.order === 'number' &&
          typeof r.value.order === 'number' &&
          prior.value.order >= r.value.order
        )
          issue(r.path, 'scheduling_dependency_conflict');
        const p = stageWindows.get(key),
          w = stageWindows.get(r.key);
        if (p && w && w.end <= p.begin) issue(r.path, 'scheduling_window_conflict');
      }
      return keys;
    },
    'scheduling_dependency_conflict',
  );
  graph(
    candidates,
    (r) =>
      (conditions.get(r.key) ?? []).flatMap((p) => {
        if (!['after_committed_node', 'after_resolved_node'].includes(String(p.value.kind)))
          return [];
        if (typeof p.value.nodeKey !== 'string') {
          issue(p.path, 'scheduling_invalid_dependency');
          return [];
        }
        const prior = candidates.find((n) => n.key === p.value.nodeKey);
        const stage = stages.find(
          (s) => s.key === (data(r.value.timeline) ? r.value.timeline.stageKey : undefined),
        );
        const priorStage = stages.find(
          (s) =>
            s.key === (data(prior?.value.timeline) ? prior.value.timeline.stageKey : undefined),
        );
        if (
          stage &&
          priorStage &&
          typeof stage.value.order === 'number' &&
          typeof priorStage.value.order === 'number' &&
          priorStage.value.order > stage.value.order
        )
          issue(p.path, 'scheduling_dependency_conflict');
        return [p.value.nodeKey];
      }),
    'scheduling_dependency_conflict',
  );
  const pending = [
    startSlot,
    ...histories,
    ...messageSlots,
    ...momentSlots,
    ...inviteSlots,
    ...candidateSlots.values(),
  ].some((s) => s.blank);
  function scan(text: string, path: Path, filename?: string) {
    const ds = [...text.matchAll(dynamic)];
    const ms = ds.length ? ds : pending ? [...text.matchAll(temporal)] : [];
    for (const m of ms.slice(0, 8)) {
      const start = Math.max(0, m.index! - 20),
        end = Math.min(text.length, m.index! + m[0].length + 30);
      issue(
        path,
        ds.length ? 'scheduling_unsupported_relative_delay' : 'scheduling_source_time_needs_review',
        filename ? { filename, start, end, quote: text.slice(start, end) } : undefined,
      );
    }
  }
  if (options.sources !== undefined) {
    if (!Array.isArray(options.sources) || options.sources.length > 64)
      issue([], 'scheduling_invalid_sources');
    else {
      let chars = 0;
      options.sources.forEach((source, i) => {
        if (!data(source)) {
          issue(['sources', i], 'scheduling_invalid_sources');
          return;
        }
        const descriptors = Object.getOwnPropertyDescriptors(source);
        if (
          Object.values(descriptors).some((d) => d.get || d.set) ||
          typeof descriptors.filename?.value !== 'string' ||
          typeof descriptors.content?.value !== 'string'
        ) {
          issue(['sources', i], 'scheduling_invalid_sources');
          return;
        }
        const text = descriptors.content.value as string;
        chars += text.length;
        if (chars > 262144) {
          issue(['sources', i], 'scheduling_source_budget');
          return;
        }
        scan(text, ['sources', i], descriptors.filename.value as string);
      });
    }
  }
  // Text belongs to its real record; metadata/keys/numerical ages are never temporal evidence.
  for (const row of [...history, ...messages, ...moments, ...invitations, ...candidates]) {
    for (const key of ['text', 'title', 'editorialIntent'])
      if (typeof row.value[key] === 'string') scan(row.value[key] as string, [...row.path, key]);
    if (data(row.value.timeline) && typeof row.value.timeline.timeNote === 'string')
      scan(row.value.timeline.timeNote, [...row.path, 'timeline', 'timeNote']);
  }
  for (const key of ['publicSetting', 'hiddenContext'])
    if (typeof next.world[key] === 'string') scan(next.world[key] as string, ['world', key]);
  if (issues.length || reference === undefined) return result();
  let lower = -Infinity,
    upper = Infinity;
  for (const s of histories) if (s.time !== undefined) lower = Math.max(lower, s.time);
  for (const s of momentSlots) if (s.time !== undefined) lower = Math.max(lower, s.time);
  for (const s of messageSlots)
    if (s.time !== undefined)
      lower = Math.max(lower, s.time + (s.row.value.origin === 'history' ? 1 : 0));
  for (const s of [...inviteSlots, ...candidateSlots.values()])
    if (s.time !== undefined) upper = Math.min(upper, s.time);
  // Reserve minute slots after a fixed tail before choosing a missing opening clock.
  for (const sequence of [histories, messageSlots]) {
    let lastFixed = -1;
    sequence.forEach((s, i) => {
      if (s.time !== undefined) lastFixed = i;
    });
    if (lastFixed >= 0) {
      const trailing = sequence
        .slice(lastFixed + 1)
        .filter((s) => s.blank && s.row.value.origin !== 'incoming').length;
      if (trailing) lower = Math.max(lower, sequence[lastFixed]!.time! + (trailing + 1) * MINUTE);
    }
  }
  // The runtime requires every not_before constraint to be at or after the opening.
  for (const ps of conditions.values())
    for (const p of ps)
      if (p.value.kind === 'not_before') upper = Math.min(upper, instant(p.value.at)!);

  const initialKey = timeline?.initialStageKey;
  if (timeline && (typeof initialKey !== 'string' || !stages.some((s) => s.key === initialKey)))
    issue(['timeline', 'initialStageKey'], 'scheduling_unknown_stage');
  const initialWindow = typeof initialKey === 'string' ? stageWindows.get(initialKey) : undefined;
  if (initialWindow) {
    lower = Math.max(lower, initialWindow.begin);
    upper = Math.min(upper, initialWindow.end - 1);
  }
  for (const w of nodeWindows.values()) upper = Math.min(upper, w.end - 1);
  if (startSlot.blank) {
    if (lower > upper) issue(['world', 'startAt'], 'scheduling_no_feasible_start');
    else fill(startSlot, Math.max(lower, Math.min(reference, upper)), 'default_start');
  }
  const start = startSlot.time;
  if (start === undefined || issues.length) return result();
  for (const s of histories)
    if (s.time !== undefined && s.time > start) issue(s.path, 'scheduling_history_after_start');
  for (const s of momentSlots)
    if (s.time !== undefined && s.time > start) issue(s.path, 'scheduling_history_after_start');
  for (const s of messageSlots)
    if (
      s.time !== undefined &&
      (s.time > start || (s.row.value.origin === 'history' && s.time >= start))
    )
      issue(s.path, 'scheduling_message_not_past');
  for (const s of inviteSlots)
    if (s.time !== undefined && s.time < start) issue(s.path, 'scheduling_invitation_before_start');
  for (const s of candidateSlots.values())
    if (s.time !== undefined && s.time < start) issue(s.path, 'scheduling_candidate_before_start');
  if (initialWindow && (start < initialWindow.begin || start >= initialWindow.end))
    issue(initialWindow.path, 'scheduling_start_outside_window');
  for (const [key, w] of nodeWindows)
    if (w.end <= start)
      issue(candidates.find((c) => c.key === key)!.path, 'scheduling_expired_window');
  for (const ps of conditions.values())
    for (const p of ps)
      if (p.value.kind === 'not_before') {
        const at = instant(p.value.at)!;
        if (at < start) issue([...p.path, 'at'], 'scheduling_candidate_before_start');
        const key = candidates.find(
          (c) => JSON.stringify(c.path) === JSON.stringify(p.path.slice(0, 2)),
        )?.key;
        const w = key ? nodeWindows.get(key) : undefined;
        if (w && at >= w.end) issue(p.path, 'scheduling_window_conflict');
      }
  if (issues.length) return result();
  function fillPast(slots: Slot[], reason: string) {
    if (!slots.some((s) => s.blank)) return;
    let previous = -Infinity;
    for (const s of slots)
      if (s.time !== undefined) {
        if (s.time < previous) issue(s.path, 'scheduling_ambiguous_time_order');
        previous = s.time;
      }
    for (let i = 0; i < slots.length;) {
      if (!slots[i]!.blank) {
        i++;
        continue;
      }
      let end = i;
      while (end < slots.length && slots[end]!.blank) end++;
      const upperAt = slots[end]?.time ?? start;
      if (upperAt === undefined) {
        issue(slots[i]!.path, 'scheduling_no_time_gap');
        return;
      }
      const first = upperAt - (end - i) * MINUTE;
      const before = i > 0 ? slots[i - 1]!.time : undefined;
      if (before !== undefined && first <= before) {
        issue(slots[i]!.path, 'scheduling_no_time_gap');
        i = end;
        continue;
      }
      for (let k = i; k < end; k++) fill(slots[k]!, first + (k - i) * MINUTE, reason);
      i = end;
    }
  }
  fillPast(histories, 'default_history_order');
  const messagesHadMissing = messageSlots.some((s) => s.blank);
  for (const s of messageSlots)
    if (s.row.value.origin === 'incoming') fill(s, start, 'default_opening_message');
  fillPast(messageSlots, 'default_history_message_order');
  // A feed need not be stored chronologically. Preserve authored dates and order,
  // and give only undated ordinary posts a stable past slot.
  momentSlots.forEach((s, i) => fill(s, start - (i + 1) * MINUTE, 'default_past_moment'));
  if (messagesHadMissing)
    for (let i = 1; i < messageSlots.length; i++)
      if (
        messageSlots[i]!.time !== undefined &&
        messageSlots[i - 1]!.time !== undefined &&
        messageSlots[i]!.time! < messageSlots[i - 1]!.time!
      )
        issue(messageSlots[i]!.path, 'scheduling_ambiguous_time_order');
  for (const s of inviteSlots) fill(s, start + 60 * MINUTE, 'default_proposed_invitation');
  for (const [key, s] of candidateSlots) {
    const dates = (conditions.get(key) ?? [])
      .filter((p) => p.value.kind === 'not_before')
      .map((p) => instant(p.value.at)!);
    const earliest = Math.max(start, nodeWindows.get(key)?.begin ?? start, ...dates);
    const window = nodeWindows.get(key);
    if (s.blank && window && earliest >= window.end) issue(s.path, 'scheduling_window_conflict');
    else fill(s, earliest, 'default_invitation_lower_bound');
  }
  if (publicationStorageIssues(next).length) issue([], 'scheduling_content_budget');
  return result();
}
