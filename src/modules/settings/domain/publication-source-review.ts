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
type Slice = {
  row: SourceReviewRow;
  subjects: Set<string>;
  ambiguous: boolean;
  comparison: string;
  slot: string;
  instruction: boolean;
};
const sourceSlot = (v: string) => {
  const label = /^([^：:]{1,12})[：:]/u.exec(v)?.[1];
  return (
    (
      {
        年龄: 'age',
        身份: 'identity',
        主角身份: 'protagonist',
        外貌: 'appearance',
        回复机制: 'voice',
        核心欲望: 'motivation',
        眼前想法: 'motivation',
        底线: 'boundaries',
        与主角: 'relationship',
      } as Record<string, string>
    )[label ?? ''] ?? ''
  );
};
const slotAccepts = (slot: string, id: string) => {
  if (!slot) return true;
  if (slot === 'age')
    return /^actor:.*:(?:publicCard:identity|privatePersona:background)$/u.test(id);
  if (slot === 'relationship')
    return id.startsWith('relationship:') || id.endsWith(':privatePersona:background');
  if (slot === 'protagonist') return id === 'protagonist:identity';
  return id.endsWith(`:${slot}`);
};
// Table offsets are taken from the original string; never rebuild a normalized document.
const cells = (v: string) =>
  [...v.matchAll(/(?:\\.|[^|])+/gu)]
    .map((m) => ({ text: m[0], offset: m.index! }))
    .filter((c) => c.text.trim());

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
    (
      v.match(
        /-?\d+(?:\.\d+)?(?:\s*(?:岁|个月|年|月|天|日|小时|分钟|分|秒|元|次|盒|件|点|%))?|[一二三四五六七八九十百千万两零〇]+(?:岁|个月|年|月|天|小时|分钟|元|次)/gu,
      ) ?? []
    ).map((token) => token.replace(/\s/gu, '')),
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
  baselineContent?: Record<string, unknown>,
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
  const baselineSafe =
    baselineContent !== undefined && publicationStorageIssues(baselineContent).length === 0;
  if (baselineContent !== undefined && !baselineSafe)
    warn('原有草稿未通过安全读取限制，字段来源暂不能判断。');
  const baseline = baselineSafe ? baselineContent! : {};
  const uniqueItem = (value: unknown, key: string): Data | undefined => {
    const found = list(value)
      .map(obj)
      .filter((v) => v.key === key);
    return found.length === 1 ? found[0] : undefined;
  };
  function previous(id: string): { value: unknown; ambiguous?: boolean } {
    const fixed = /^(work|world|protagonist):([^:]+)$/u.exec(id);
    if (fixed) return { value: obj(baseline[fixed[1]!])[fixed[2]!] };
    const a = /^actor:(.*):(publicCard|privatePersona|trait):([^:]+)$/u.exec(id);
    if (a) {
      const item = uniqueItem(baseline.actors, a[1]!);
      if (!item && list(baseline.actors).some((v) => obj(v).key === a[1]))
        return { value: undefined, ambiguous: true };
      return {
        value:
          a[2] === 'trait'
            ? list(obj(item?.publicCard).traits)[Number(a[3])]
            : obj(item?.[a[2]!])[a[3]!],
      };
    }
    const entity =
      /^(relationship|place|history|message|note|invitation|stage|candidate):(.*):([^:]+)$/u.exec(
        id,
      );
    if (!entity) return { value: undefined, ambiguous: true };
    const [, kind, key, field] = entity;
    const arrays: Record<string, unknown> = {
      relationship: baseline.relationships,
      place: baseline.places,
      history: baseline.history,
      message: obj(baseline.phone).messages,
      note: obj(baseline.phone).notes,
      invitation: obj(baseline.phone).invitations,
      stage: obj(baseline.timeline).stages,
      candidate: baseline.candidates,
    };
    const item = uniqueItem(arrays[kind!], key!);
    if (!item && list(arrays[kind!]).some((v) => obj(v).key === key))
      return { value: undefined, ambiguous: true };
    if (kind === 'candidate' && ['message', 'invitation', 'timeNote'].includes(field!))
      return {
        value:
          field === 'timeNote'
            ? obj(item?.timeline).timeNote
            : obj(item?.intent)[field === 'message' ? 'text' : 'title'],
      };
    return { value: item?.[field!] };
  }
  function provenance(
    id: string,
    value: string,
  ): Pick<SourceReviewTarget, 'origin' | 'previousValue'> {
    if (!baselineSafe) return { origin: 'unknown' };
    const old = previous(id);
    if (old.ambiguous) return { origin: 'unknown' };
    const trait = /^actor:(.*):trait:\d+$/u.exec(id);
    if (trait) {
      const values = list(obj(uniqueItem(baseline.actors, trait[1]!)?.publicCard).traits);
      const current = list(obj(uniqueItem(doc.actors, trait[1]!)?.publicCard).traits);
      if (
        values.filter((v) => v === value).length === 1 &&
        current.filter((v) => v === value).length === 1
      )
        return { origin: 'existing' };
      if (current.filter((v) => v === value).length > 1) return { origin: 'unknown' };
      if (values.filter((v) => v === value).length > 1) return { origin: 'unknown' };
    }
    if (old.value === value) return { origin: 'existing' };
    if (old.value === undefined) return { origin: 'added' };
    return {
      origin: 'modified',
      ...(typeof old.value === 'string' ? { previousValue: old.value } : {}),
    };
  }
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
  function currentAges(text: string, subjects: Set<string>) {
    if (subjects.size !== 1) return [];
    return text.split(/[，,。；;]/u).flatMap((part) => {
      let clause = part.trim();
      if (/不是|并非|不满|不到|如果|假如|假设|可能|曾经|当年|那年|差|[？?]/u.test(clause))
        return [];
      for (const [name, keys] of actorNames) {
        if (keys.size === 1 && shared(keys, subjects) && clause.startsWith(name))
          clause = clause.slice(name.length);
      }
      const age =
        /^(?:年龄[：:]?\s*|今年|现年)?((?:\d{1,3}|[一二三四五六七八九十百两零〇]+)\s*岁)(?!时|那年|的时候|以前|以后|之前|之后)/u.exec(
          clause,
        );
      return age ? [age[1]!.replace(/\s/gu, '')] : [];
    });
  }
  const relationClaims = (text: string) =>
    text
      .split(/[，,。；;]/u)
      .flatMap((clause) =>
        /不|未|如果|假如|假设|可能/u.test(clause)
          ? []
          : [...clause.matchAll(/(相识|认识|共事|合作)([一二三四五六七八九十百两\d]+年)/gu)],
      );
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
      view: { id, section, label, value, ...provenance(id, value) },
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
      ['introduction', '角色介绍'],
      ['identity', '公开身份'],
      ['appearance', '外貌'],
    ])
      add(`actor:${k}:publicCard:${field}`, '人物', `${name} · ${label}`, card[field!], [k]);
    for (const [field, label] of [
      ['lifeContext', '人生背景'],
      ['traits', '人格特质'],
      ['drives', '动机与价值观'],
      ['behavior', '行为模式'],
      ['relationships', '关系模型'],
    ])
      add(
        `actor:${k}:lifeModules:${field}`,
        '人物',
        `${name} · ${label}`,
        obj(a.lifeModules)[field!],
        [k],
      );
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
  entities(phone.messages, '来信', (m, k) => {
    add(`message:${k}:at`, '来信', '消息发送时间', m.at, [str(m.actorKey)].filter(Boolean));
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
    );
  });
  entities(phone.moments, '朋友圈', (m, k) =>
    add(`moment:${k}:text`, '朋友圈', '动态正文', m.text, [str(m.actorKey)].filter(Boolean)),
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

  function assess(slice: Slice, candidates: SourceReviewMatch[]) {
    const row = slice.row;
    const set = (kind: NonNullable<SourceReviewRow['assessment']>['kind'], reason: string) => {
      row.assessment = { kind, reason };
    };
    if (slice.ambiguous)
      return set('unresolved', '原稿涉及同名人物，无法确定是哪一个人物；未合并或猜测对应。');
    if (!safe || warnings.some((w) => w.includes('实际字段超过512')))
      return set('unresolved', '最终字段未完整读取，不能判断遗漏或改写。');
    if (slice.instruction)
      return set('instruction', '这段是导入或后台操作说明，不直接作为世界事实。');
    const owned = targets.filter(
      (t) => slice.subjects.size === 1 && shared(slice.subjects, t.subjects),
    );
    const ages = currentAges(slice.comparison, slice.subjects);
    const issues: string[] = [],
      uncertain: string[] = [];
    let changed = false;
    if (ages.length === 1 && slice.subjects.size === 1) {
      const ageTargets = owned.filter((t) => slotAccepts('age', t.view.id));
      const actual = ageTargets.flatMap((t) => currentAges(t.view.value, slice.subjects));
      if (
        slice.slot === 'age' &&
        actual.length &&
        actual.every((a) => a === ages[0]) &&
        /^\d+岁$/u.test(norm(slice.comparison))
      )
        return set('covered', '原稿明确年龄与该人物身份或经历字段中的年龄一致。');
      if (!actual.length) issues.push(`明确年龄${ages[0]}未出现在该人物的身份或经历字段中。`);
      else if (
        !actual.includes(ages[0]!) &&
        [...actual, ...ages].some((v) => /[一二三四五六七八九十百两零〇]/u.test(v))
      )
        uncertain.push('年龄存在中文与数字等不同写法，暂不能据此判定遗漏或改写。');
      else if (!actual.includes(ages[0]!)) {
        changed = true;
        issues.push(`原稿年龄${ages[0]}与该人物字段中的${[...new Set(actual)].join('、')}不同。`);
      }
    }
    const relation = relationClaims(slice.comparison)[0];
    if (relation && slice.subjects.size === 1) {
      const relations = owned
        .filter((t) => slotAccepts('relationship', t.view.id))
        .flatMap((t) => {
          if (t.view.id.startsWith('relationship:')) {
            const key = t.view.id.slice('relationship:'.length, -':description'.length);
            const r = uniqueItem(doc.relationships, key);
            if (obj(r?.from).kind !== 'player' && obj(r?.to).kind !== 'player') return [];
          }
          return relationClaims(t.view.value);
        });
      if (
        relations.length &&
        !relations.some((r) => r[1] === relation[1] && r[2] === relation[2])
      ) {
        if (
          relations.some(
            (r) => r[1] === relation[1] && /[一二三四五六七八九十百两]/u.test(r[2]! + relation[2]!),
          )
        )
          uncertain.push('关系年数存在中文与数字等不同写法，暂不能据此判定改写。');
        else {
          changed = true;
          issues.push(
            `原稿“${relation[0]}”与对应关系中的“${relations.map((r) => r[0]).join('、')}”不同。`,
          );
        }
      }
    }
    if (issues.length)
      return set(
        changed ? 'possible_change' : 'possible_omission',
        issues.join('') + uncertain.join(''),
      );
    if (uncertain.length) return set('unresolved', uncertain.join(''));
    // Time is checked only against the same sender's exact quoted message, never arbitrary numbers in prose.
    const quote = /“([^”]+)”/u.exec(row.quote)?.[1];
    const clock = /(今天|昨天)?\s*(\d{1,2}):(\d{2})/u.exec(row.quote);
    if (quote && clock && slice.subjects.size === 1) {
      const messages = owned.filter(
        (t) => /^message:.*:text$/u.test(t.view.id) && norm(t.view.value) === norm(quote),
      );
      if (messages.length === 1) {
        const message = messages[0]!;
        const time = targets.find((t) => t.view.id === message.view.id.replace(/:text$/u, ':at'));
        row.matches = [
          { target: message.view, kind: 'candidate', missingNumbers: [], addedNumbers: [] },
          ...(time
            ? [
                {
                  target: time.view,
                  kind: 'candidate' as const,
                  missingNumbers: [],
                  addedNumbers: [],
                },
              ]
            : []),
        ];
        row.status = 'possible_rewrite';
        const anchors = [
          ...sources[row.fileIndex]!.content.matchAll(
            /开场\s*(\d{4})年(\d{1,2})月(\d{1,2})日\s*\d{1,2}:\d{2}北京时间/gu,
          ),
        ];
        const anchor = anchors.length === 1 ? anchors[0] : undefined;
        if (!anchor || !clock[1] || !time)
          return set(
            'unresolved',
            '消息正文对应；时间缺少明确日期、时区或实际时间字段，未猜测时间。',
          );
        const hour = Number(clock[2]),
          minute = Number(clock[3]);
        const date = Date.UTC(Number(anchor[1]), Number(anchor[2]) - 1, Number(anchor[3]));
        const check = new Date(date);
        if (
          hour > 23 ||
          minute > 59 ||
          check.getUTCFullYear() !== Number(anchor[1]) ||
          check.getUTCMonth() + 1 !== Number(anchor[2]) ||
          check.getUTCDate() !== Number(anchor[3])
        )
          return set('unresolved', '原稿时间格式不明确，需人工确认。');
        const expected =
          date + (clock[1] === '昨天' ? -86400000 : 0) + (hour - 8) * 3600000 + minute * 60000;
        if (
          !/T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(time.view.value) ||
          !Number.isFinite(Date.parse(time.view.value))
        )
          return set('unresolved', '实际消息时间缺少可核对的时区或格式。');
        let wrapper = norm(row.quote.slice(0, row.quote.indexOf('“')))
          .replace(/^(?:原有聊天|聊天)[：:]/u, '')
          .replace(/^(?:昨天|今天)\d{1,2}:\d{2}/u, '');
        for (const [name, keys] of actorNames)
          if (keys.size === 1 && shared(keys, slice.subjects) && wrapper.startsWith(name))
            wrapper = wrapper.slice(name.length);
        if (!['说', '来信'].includes(wrapper))
          return set('unresolved', '消息正文与时间可核对，但本片段还含其他描述，需要逐项确认。');
        return set(
          Date.parse(time.view.value) === expected ? 'covered' : 'possible_change',
          Date.parse(time.view.value) === expected
            ? '同一发送人的消息正文及原稿明确日期、北京时间均对应。'
            : '同一发送人的消息正文对应，但发送时间与原稿明确日期、北京时间不同。',
        );
      }
    }
    if (row.status === 'literal_match') {
      if (
        /可能|可选|将会|尚未|未来/u.test(row.quote) &&
        row.matches.some((m) => m.target.section === '历史')
      )
        return set('unresolved', '文字相同，但可能发生的内容出现在已发生历史中，需要核对。');
      if (/只有.*知道|仅.*知道|不知道|不知/u.test(row.quote))
        return set(
          'unresolved',
          '文字对应；知情范围还需结合可见权限核对，文字匹配不能证明权限正确。',
        );
      return set('covered', '已找到相同文字或明确字段值；不代表整段含义与全部设定均已验证。');
    }
    if (candidates.some((m) => m.missingNumbers.length || m.addedNumbers.length))
      return set('possible_change', '同一人物对应信息中的同单位数值不同，请核对具体字段。');
    if (/昨天.*(?:约好|约定)/u.test(row.quote))
      return set(
        'unresolved',
        '尚未确认原稿中已发生的约定对应哪条历史；未来候选事件不能证明这项约定已保留。',
      );
    set(
      'unresolved',
      row.matches.length
        ? '找到相近文字，尚不足以确认所有信息已保留或发生改写。'
        : '尚未找到能确认这一片段的对应字段。',
    );
  }

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
    const headings: {
      level: number;
      subjects: Set<string>;
      ambiguous: boolean;
      instruction: boolean;
    }[] = [];
    let tableColumns: string[] = [];
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
        headings.push({
          level,
          subjects: found.keys,
          ambiguous: found.ambiguous,
          instruction: /^(?:导入后还要补全|导入说明|使用说明)$/u.test(heading[2]!.trim()),
        });
        tableColumns = [];
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
      ) {
        tableColumns = cells(text).map((c) => c.text.trim());
        continue;
      }
      if (!text.includes('|')) tableColumns = [];
      const prefix = /^\s*(?:>\s*|[-+*]\s+|\d+[.)、]\s+)/u.exec(text);
      if (prefix) {
        lineOffset += prefix[0].length;
        text = text.slice(prefix[0].length);
      }
      const tableCells = tableColumns.length ? cells(text) : [];
      const valueColumns = tableColumns
        .map((name, i) => (/^(?:设定|内容|描述|说明|正文|值)$/u.test(name) ? i : -1))
        .filter((i) => i >= 0);
      // Only known presentation columns are omitted. Unknown tables retain every cell.
      const chunks = tableCells.length
        ? tableCells.filter((_, i) =>
            valueColumns.length
              ? valueColumns.includes(i) || !/^(?:层级|模块)$/u.test(tableColumns[i] ?? '')
              : !/^(?:层级|模块)$/u.test(tableColumns[i] ?? ''),
          )
        : [{ text, offset: 0 }];
      for (const chunk of chunks) {
        for (const segment of chunk.text.matchAll(
          /<br\s*\/?\s*>|(?:(?!<br\s*\/?\s*>)[\s\S])+/giu,
        )) {
          if (/^<br\s*\/?\s*>$/iu.test(segment[0])) continue;
          for (const part of segment[0].matchAll(
            /[^“。！？!?；;]*(?:说|来信)“[^”]*”[。！？!?；;]*|(?:“[^”]*”|[^。！？!?；;“])+[。！？!?；;]*/gu,
          )) {
            const leading = part[0].length - part[0].trimStart().length,
              quote = part[0].trim();
            if (!quote || !norm(quote).replace(/[”'|]/gu, '')) continue;
            if (slices.length >= MAX_ROWS) {
              warn(
                `正文超过400片段，余下原文未核对（从第${fileIndex + 1}份文件第${line}行起）；不能据此判断全稿无遗漏。`,
              );
              break;
            }
            const start = lineOffset + chunk.offset + segment.index! + part.index! + leading,
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
              slot: sourceSlot(quote),
              comparison: sourceSlot(quote) ? quote.replace(/^[^：:]+[：:]\s*/u, '') : quote,
              instruction:
                headings.some((h) => h.instruction) ||
                /^(?:请在后台(?:填写|选择|补全)|本模板(?:不替你|用于)|请补齐所缺设定供作者核对)/u.test(
                  quote,
                ),
              ambiguous: explicit.keys.size ? explicit.ambiguous : (inherited?.ambiguous ?? false),
            });
          }
        }
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
      normalized = norm(slice.comparison),
      sourceGrams = grams(normalized),
      numbers = numberTokens(slice.comparison);
    row.assessment = { kind: 'unresolved', reason: '尚未找到能确认这一片段的对应字段。' };
    if (normalized.length > MAX_COMPARE_CHARS) {
      row.notices.push('此片段超过8192字符，原文已完整保留，未进行文字匹配。');
      warn('部分超长原文片段未进行匹配。');
      rows.push(row);
      continue;
    }
    if (normalized.length < 6 && !slice.slot) {
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
      ([i]) =>
        (!slice.subjects.size || shared(slice.subjects, targets[i]!.subjects)) &&
        slotAccepts(slice.slot, targets[i]!.view.id) &&
        !targets[i]!.view.id.endsWith(':at'),
    );
    const ranked = eligible.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    if (ranked.length > MAX_CANDIDATES)
      row.notices.push('相近字段较多，仅比较文字线索最接近的48项。');
    const matches: { match: SourceReviewMatch; score: number; negation: boolean }[] = [];
    for (const [i, overlap] of ranked.slice(0, MAX_CANDIDATES)) {
      const target = targets[i]!;
      const literal =
        (normalized.length >= 6 ||
          (!!slice.slot && slice.subjects.size === 1 && normalized.length >= 2)) &&
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
      // Compare one candidate clause, not unrelated figures/negations elsewhere in the field.
      const clauses = target.view.value.split(/[。！？!?；;\r\n]+/u).filter(Boolean);
      const clause = literal
        ? (clauses.find((c) => norm(c) === normalized) ?? target.view.value)
        : (clauses.sort(
            (a, b) =>
              [...grams(norm(b))].filter((g) => sourceGrams.has(g)).length -
              [...grams(norm(a))].filter((g) => sourceGrams.has(g)).length,
          )[0] ?? '');
      const targetNumbers = numberTokens(clause);
      const comparableNumbers =
        slice.subjects.size === 1 && !slice.ambiguous
          ? numbers.filter((n) => {
              const unit = numberUnit(n);
              const explicitSlot =
                slice.slot &&
                !['age', 'relationship'].includes(slice.slot) &&
                unit !== '岁' &&
                slotAccepts(slice.slot, target.view.id);
              const ageSlot =
                unit === '岁' &&
                slotAccepts('age', target.view.id) &&
                currentAges(slice.comparison, slice.subjects).includes(n) &&
                currentAges(clause, slice.subjects).length > 0;
              const relationshipSlot =
                unit === '年' &&
                relationClaims(slice.comparison).some((r) =>
                  relationClaims(clause).some((t) => t[1] === r[1]),
                ) &&
                slotAccepts('relationship', target.view.id);
              return (
                (explicitSlot || ageSlot || relationshipSlot) &&
                /^-?\d/u.test(n) &&
                targetNumbers
                  .filter((t) => numberUnit(t) === unit)
                  .every((t) => /^-?\d/u.test(t)) &&
                !!unit &&
                targetNumbers.some((t) => numberUnit(t) === unit)
              );
            })
          : [];
      const units = new Set(comparableNumbers.map(numberUnit));
      const missingNumbers = comparableNumbers.filter((n) => !targetNumbers.includes(n)),
        addedNumbers = targetNumbers.filter(
          (n) => units.has(numberUnit(n)) && !numbers.includes(n),
        );
      matches.push({
        match: {
          target: target.view,
          kind: literal ? 'literal' : 'candidate',
          missingNumbers,
          addedNumbers,
        },
        score: literal ? 10 : coverage + reverse + Math.min(overlap, 20) / 100,
        negation: !literal && negations(slice.comparison) !== negations(clause),
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
    assess(
      slice,
      matches.map((m) => m.match),
    );
    for (const match of row.matches) linked.add(match.target.id);
    rows.push(row);
  }
  return {
    rows,
    unlinkedTargets: targets.filter((t) => !linked.has(t.view.id)).map((t) => t.view),
    warnings,
  };
}
