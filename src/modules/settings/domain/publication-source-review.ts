import { publicationStorageIssues } from './publication-content.ts';
import type {
  ManuscriptSource,
  SourceReview,
  SourceReviewRow,
  SourceReviewTarget,
  SourceReviewMatch,
} from './publication-source-review-types.ts';

type Data = Record<string, unknown>;
type Target = {
  view: SourceReviewTarget;
  subjects: Set<string>;
  normalized: string;
  sentences: Set<string>;
  grams: Set<string>;
  numbers: string[];
};
type Slice = { row: SourceReviewRow; subjects: Set<string>; ambiguous: boolean };
const MAX_ROWS = 400,
  MAX_TARGETS = 512,
  MAX_SOURCE_CHARS = 262144,
  MAX_FILES = 64;
const MAX_COMPARE_CHARS = 8192,
  MAX_CANDIDATES = 48;
const obj = (v: unknown): Data =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Data) : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
// Keep digits, minus signs, date separators, negation and every word. This is typography only.
const norm = (v: string) => v.replace(/[\s\u3000，,。！？!?；;、“”"|]/gu, '');
const grams = (v: string) => {
  const points = Array.from(v),
    result = new Set<string>();
  for (let i = 0; i + 1 < points.length; i++) result.add(points[i]! + points[i + 1]!);
  return result;
};
const numberTokens = (v: string) => [
  ...new Set(
    v.match(
      /-?\d+(?:\.\d+)?(?:\s*(?:岁|个月|年|月|天|日|小时|分钟|分|秒|元|次|盒|件|点|%))?|[一二三四五六七八九十百千万两零〇]+(?:岁|个月|年|月|天|小时|分钟|元|次)/gu,
    ) ?? [],
  ),
];
const numberUnit = (v: string) => v.replace(/^-?[\d.\s一二三四五六七八九十百千万两零〇]+/u, '');
const negations = (v: string) =>
  [...new Set(v.match(/没有|不是|并非|从未|未曾|不|未|无/gu) ?? [])].sort().join('|');
const shared = (a: Set<string>, b: Set<string>) => [...a].some((x) => b.has(x));

/** Author-only textual hints, never semantic entailment, facts, or publication permission. */
export function buildPublicationSourceReview(
  sources: ManuscriptSource[],
  content: Record<string, unknown>,
): SourceReview {
  const warnings: string[] = [],
    targets: Target[] = [],
    rows: SourceReviewRow[] = [];
  const warn = (text: string) => {
    if (!warnings.includes(text)) warnings.push(text);
  };
  const safe = publicationStorageIssues(content).length === 0;
  if (!safe) warn('最终稿不符合安全文字读取或容量限制，本次未核对其中的字段。');
  const doc = safe ? content : {};
  const actorNames = new Map<string, Set<string>>();
  for (const value of list(doc.actors)) {
    const actor = obj(value),
      key = str(actor.key),
      name = str(actor.name).trim();
    if (key && name) {
      const keys = actorNames.get(name) ?? new Set<string>();
      keys.add(key);
      actorNames.set(name, keys);
    }
  }
  function subjectsIn(text: string) {
    const keys = new Set<string>();
    let ambiguous = false;
    for (const [name, actors] of actorNames) {
      if (
        name.length < 2
          ? text.trim() !== name && !text.startsWith(name + '：') && !text.startsWith(name + ':')
          : !text.includes(name)
      )
        continue;
      for (const key of actors) keys.add(key);
      if (actors.size > 1) ambiguous = true;
    }
    return { keys, ambiguous };
  }
  function add(
    id: string,
    section: string,
    label: string,
    value: unknown,
    actorKeys: string[] = [],
  ) {
    if (typeof value !== 'string' || !value.trim()) return;
    if (targets.length >= MAX_TARGETS) {
      warn('实际字段超过512项，后续字段未参与核对；未找到对应不代表原稿没有来源。');
      return;
    }
    const subjects = actorKeys.length ? new Set(actorKeys) : subjectsIn(value).keys;
    const normalized = norm(value);
    const comparable = normalized.length <= MAX_COMPARE_CHARS;
    if (!comparable) warn('存在超过8192字符的字段，全文已保留展示，但未参与相似文字比较。');
    targets.push({
      view: { id, section, label, value },
      subjects,
      normalized: comparable ? normalized : '',
      sentences: comparable
        ? new Set(
            value
              .split(/[。！？!?；;\r\n]+/u)
              .map(norm)
              .filter(Boolean),
          )
        : new Set(),
      grams: comparable ? grams(normalized) : new Set(),
      numbers: comparable ? numberTokens(value) : [],
    });
  }
  function entities(
    value: unknown,
    section: string,
    run: (item: Data, key: string, label: string) => void,
  ) {
    const array = list(value),
      counts = new Map<string, number>();
    for (const v of array) {
      const k = str(obj(v).key);
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    for (const v of array) {
      const item = obj(v),
        key = str(item.key);
      if (!key || counts.get(key)! > 1) {
        warn(`${section}中存在缺失或重复编号的条目，未用名字猜测对应字段。`);
        continue;
      }
      run(item, key, str(item.name) || str(item.title) || key);
    }
  }
  const work = obj(doc.work),
    world = obj(doc.world),
    protagonist = obj(doc.protagonist);
  for (const [field, label] of [
    ['title', '作品名称'],
    ['hook', '开场引子'],
    ['description', '作品简介'],
    ['experienceNote', '体验说明'],
  ])
    add(`work:${field}`, '作品', label!, work[field!]);
  for (const [field, label] of [
    ['publicSetting', '公开背景'],
    ['tone', '基调'],
    ['hiddenContext', '幕后设定'],
  ])
    add(`world:${field}`, '世界', label!, world[field!]);
  for (const [field, label] of [
    ['identity', '主角身份'],
    ['situation', '开场处境'],
  ])
    add(`protagonist:${field}`, '主角', label!, protagonist[field!]);
  entities(doc.actors, '人物', (a, k, name) => {
    const card = obj(a.publicCard),
      persona = obj(a.privatePersona);
    for (const [field, label] of [
      ['identity', '公开身份'],
      ['appearance', '外貌'],
    ])
      add(`actor:${k}:publicCard:${field}`, '人物', `${name} · ${label}`, card[field!], [k]);
    list(card.traits).forEach((value, i) =>
      add(`actor:${k}:trait:${i}`, '人物', `${name} · 性格特点`, value, [k]),
    );
    for (const [field, label] of [
      ['background', '个人经历'],
      ['motivation', '动机'],
      ['voice', '说话方式'],
      ['boundaries', '行为边界'],
    ])
      add(`actor:${k}:privatePersona:${field}`, '人物', `${name} · ${label}`, persona[field!], [k]);
  });
  entities(doc.relationships, '关系', (r, k) =>
    add(
      `relationship:${k}:description`,
      '关系',
      '人物关系',
      r.description,
      [str(obj(r.from).actorKey), str(obj(r.to).actorKey)].filter(Boolean),
    ),
  );
  entities(doc.places, '地点', (p, k, name) =>
    add(`place:${k}:description`, '地点', `${name} · 地点说明`, p.description),
  );
  entities(doc.history, '历史', (h, k) =>
    add(
      `history:${k}:text`,
      '历史',
      '已发生的事情',
      h.text,
      list(h.actorKeys).filter((v): v is string => typeof v === 'string'),
    ),
  );
  const phone = obj(doc.phone);
  entities(phone.messages, '来信', (m, k) =>
    add(
      `message:${k}:text`,
      '来信',
      `${
        str(m.actorKey)
          ? str(
              list(doc.actors)
                .map(obj)
                .find((a) => a.key === m.actorKey)?.name,
            ) || '人物'
          : '人物'
      } · 消息`,
      m.text,
      [str(m.actorKey)].filter(Boolean),
    ),
  );
  entities(phone.notes, '便签', (n, k, title) => {
    add(`note:${k}:title`, '便签', `${title} · 标题`, n.title);
    add(`note:${k}:text`, '便签', `${title} · 正文`, n.text);
  });
  entities(phone.invitations, '邀约', (i, k, title) =>
    add(
      `invitation:${k}:title`,
      '邀约',
      title,
      i.title,
      list(i.actorKeys).filter((v): v is string => typeof v === 'string'),
    ),
  );
  entities(obj(doc.timeline).stages, '阶段', (s, k, title) =>
    add(`stage:${k}:title`, '阶段', title, s.title),
  );
  entities(doc.candidates, '候选剧情', (n, k, title) => {
    const subjects = list(n.actorKeys).filter((v): v is string => typeof v === 'string'),
      intent = obj(n.intent);
    add(`candidate:${k}:title`, '候选剧情', `${title} · 标题`, n.title, subjects);
    add(
      `candidate:${k}:editorialIntent`,
      '候选剧情',
      `${title} · 剧情说明`,
      n.editorialIntent,
      subjects,
    );
    if (intent.kind === 'offer_message')
      add(
        `candidate:${k}:message`,
        '候选剧情',
        `${title} · 消息提议`,
        intent.text,
        [str(intent.actorKey)].filter(Boolean),
      );
    if (intent.kind === 'offer_invitation')
      add(`candidate:${k}:invitation`, '候选剧情', `${title} · 邀约提议`, intent.title, subjects);
    add(
      `candidate:${k}:timeNote`,
      '候选剧情',
      `${title} · 时间说明`,
      obj(n.timeline).timeNote,
      subjects,
    );
  });

  // Tokenize each target once. Candidate retrieval never scans/retokenizes every full field per row.
  const index = new Map<string, number[]>(),
    numberIndex = new Map<string, number[]>();
  targets.forEach((target, i) => {
    for (const gram of target.grams) {
      const posting = index.get(gram) ?? [];
      posting.push(i);
      index.set(gram, posting);
    }
    for (const unit of new Set(target.numbers.map(numberUnit).filter(Boolean))) {
      const posting = numberIndex.get(unit) ?? [];
      posting.push(i);
      numberIndex.set(unit, posting);
    }
  });
  const slices: Slice[] = [];
  let totalChars = 0;
  for (let fileIndex = 0; fileIndex < Math.min(sources.length, MAX_FILES); fileIndex++) {
    const source = sources[fileIndex]!;
    if (typeof source.content !== 'string' || typeof source.filename !== 'string') {
      warn('存在不能读取的原稿文件，未进行文字核对。');
      continue;
    }
    totalChars += source.content.length;
    if (totalChars > MAX_SOURCE_CHARS) {
      warn(`原稿合计超过262144字符，从第${fileIndex + 1}份文件起未核对；未检查部分仍需人工核对。`);
      break;
    }
    let line = 0;
    const headings: { level: number; subjects: Set<string>; ambiguous: boolean }[] = [];
    const lines = [...source.content.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/gu)];
    for (const match of lines) {
      if (!match[0]) continue;
      line++;
      let text = match[0].replace(/[\r\n]+$/u, ''),
        lineOffset = match.index!;
      if (
        /^\s*(?:\|?\s*:?-{3,}:?\s*)+(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/u.test(text) ||
        /^\s*(?:```|~~~)/u.test(text)
      )
        continue;
      if (/^\s*[-*_]{3,}\s*$/u.test(text)) continue;
      const heading = /^\s*(#{1,6})\s+(.+)$/u.exec(text);
      if (heading) {
        const level = heading[1]!.length,
          found = subjectsIn(heading[2]!);
        while (headings.length && headings.at(-1)!.level >= level) headings.pop();
        headings.push({ level, subjects: found.keys, ambiguous: found.ambiguous });
        // Pure titles are layout; headings that contain factual punctuation/quantities remain text.
        if (!/[，。！？；;]|\d+\s*(?:岁|年|月|日|元|分钟)/u.test(heading[2]!)) continue;
        const offset = text.indexOf(heading[2]!);
        lineOffset += offset;
        text = heading[2]!;
      }
      const nextLine = lines[line]?.[0]?.replace(/[\r\n]+$/u, '') ?? '';
      if (
        text.includes('|') &&
        /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/u.test(nextLine)
      )
        continue;
      const prefix = /^\s*(?:>\s*|[-+*]\s+|\d+[.)、]\s+)/u.exec(text);
      if (prefix) {
        lineOffset += prefix[0].length;
        text = text.slice(prefix[0].length);
      }
      for (const part of text.matchAll(/[^。！？!?；;]+[。！？!?；;]*/gu)) {
        const leading = part[0].length - part[0].trimStart().length,
          quote = part[0].trim();
        if (!quote || !norm(quote)) continue;
        if (slices.length >= MAX_ROWS) {
          warn(
            `正文超过400片段，余下原文未核对（从第${fileIndex + 1}份文件第${line}行起）；不能据此判断全稿无遗漏。`,
          );
          break;
        }
        const start = lineOffset + part.index! + leading,
          end = start + quote.length;
        const explicit = subjectsIn(quote),
          inherited = [...headings].reverse().find((h) => h.subjects.size);
        const subjects = explicit.keys.size
          ? explicit.keys
          : (inherited?.subjects ?? new Set<string>());
        slices.push({
          row: {
            id: `source:${fileIndex}:${start}:${end}`,
            fileIndex,
            filename: source.filename,
            start,
            end,
            line,
            quote,
            status: 'unmapped',
            matches: [],
            notices: [],
          },
          subjects,
          ambiguous: explicit.keys.size ? explicit.ambiguous : (inherited?.ambiguous ?? false),
        });
      }
      if (slices.length >= MAX_ROWS) {
        if (line < lines.length - 1)
          warn(`正文超过400片段，第${fileIndex + 1}份文件余下行未核对。`);
        break;
      }
    }
    if (slices.length >= MAX_ROWS) {
      if (fileIndex + 1 < sources.length) warn('后续文件未核对：已达到400个正文片段的容量限制。');
      break;
    }
  }
  if (sources.length > MAX_FILES) warn('文件超过64份，后续文件未核对。');
  const linked = new Set<string>();
  for (const slice of slices) {
    const row = slice.row,
      normalized = norm(row.quote),
      sourceGrams = grams(normalized),
      numbers = numberTokens(row.quote);
    if (normalized.length > MAX_COMPARE_CHARS) {
      row.notices.push('此片段超过8192字符，原文已完整保留，未进行文字匹配。');
      warn('部分超长原文片段未进行匹配。');
      rows.push(row);
      continue;
    }
    if (normalized.length < 6) {
      row.notices.push('片段较短，仅供人工核对，不据此判断已保留。');
    }
    const scores = new Map<number, number>();
    for (const gram of sourceGrams)
      for (const i of index.get(gram) ?? []) scores.set(i, (scores.get(i) ?? 0) + 1);
    // Units with an explicit subject can identify an age/quantity candidate despite changed digits.
    if (slice.subjects.size)
      for (const token of numbers) {
        const unit = numberUnit(token);
        if (unit)
          for (const i of numberIndex.get(unit) ?? [])
            if (shared(slice.subjects, targets[i]!.subjects)) scores.set(i, scores.get(i) ?? 0);
      }
    const eligible = [...scores].filter(
      ([i]) => !slice.subjects.size || shared(slice.subjects, targets[i]!.subjects),
    );
    const ranked = eligible.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    if (ranked.length > MAX_CANDIDATES)
      row.notices.push('相近字段较多，仅比较文字线索最接近的48项。');
    const matches: { match: SourceReviewMatch; score: number; negation: boolean }[] = [];
    for (const [i, overlap] of ranked.slice(0, MAX_CANDIDATES)) {
      const target = targets[i]!;
      const literal =
        normalized.length >= 6 &&
        !slice.ambiguous &&
        (normalized === target.normalized || target.sentences.has(normalized));
      const coverage = sourceGrams.size ? overlap / sourceGrams.size : 0;
      const reverse = target.grams.size ? overlap / target.grams.size : 0;
      const sameUnit =
        slice.subjects.size > 0 &&
        numbers.some(
          (n) => numberUnit(n) && target.numbers.some((t) => numberUnit(t) === numberUnit(n)),
        );
      const related =
        (overlap >= 3 && coverage >= 0.34 && (reverse >= 0.1 || overlap >= 8)) ||
        (sameUnit && (normalized.length <= 32 || overlap >= 2));
      if (!literal && !related) continue;
      const missingNumbers = numbers.filter((n) => !target.numbers.includes(n)),
        addedNumbers = target.numbers.filter((n) => !numbers.includes(n));
      matches.push({
        match: {
          target: target.view,
          kind: literal ? 'literal' : 'candidate',
          missingNumbers,
          addedNumbers,
        },
        score: literal ? 10 : coverage + reverse + Math.min(overlap, 20) / 100,
        negation: negations(row.quote) !== negations(target.view.value),
      });
    }
    matches.sort((a, b) => b.score - a.score || a.match.target.id.localeCompare(b.match.target.id));
    const literal = matches.filter((m) => m.match.kind === 'literal');
    const selected = (literal.length ? literal : matches).slice(0, 2);
    row.matches = selected.map((m) => m.match);
    row.status = literal.length
      ? 'literal_match'
      : selected.length
        ? 'possible_rewrite'
        : 'unmapped';
    for (const match of matches) linked.add(match.match.target.id);
    if (slice.ambiguous) row.notices.push('原文出现同名人物，不能仅凭名字确认对应人物。');
    if (literal.length > 1)
      row.notices.push('多处字段有相同文字，不代表已确认唯一来源或语义一致。');
    if ((literal.length || matches.length) > 2)
      row.notices.push('存在更多可能对应的字段，仅展示前2项；其他字段仍需核对。');
    if (selected.some((m) => m.negation))
      row.notices.push('原文与候选字段的否定用语不同，请核对实际意思。');
    if (selected.some((m) => m.match.missingNumbers.length || m.match.addedNumbers.length))
      row.notices.push('原文与候选字段的数字或数量表述不同，请结合单位、人物和上下文核对。');
    if (
      /不知道|不能|没有|并非|不替|不(?:会|可|能|知|是)|仅.*知道|只有.*知道|可能|可选|将会|尚未|未来/u.test(
        row.quote,
      )
    )
      row.notices.push(
        '原文含知情限制、否定或未来条件；即使文字相同，也请核对实际知情范围及是否放在合适的事实或候选栏目。',
      );
    rows.push(row);
  }
  return {
    rows,
    unlinkedTargets: targets.filter((t) => !linked.has(t.view.id)).map((t) => t.view),
    warnings,
  };
}
