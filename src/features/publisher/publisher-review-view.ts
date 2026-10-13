import { createElement as h } from 'react';
import s from './publisher-import-dialog.module.css';

type Data = Record<string, unknown>;
export type ReviewField = { label: string; value: string };
export type ReviewCard = { title: string; fields: ReviewField[] };
export type ReviewGroup = { title: string; cards: ReviewCard[] };
const object = (value: unknown): Data =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Data) : {};
const own = (value: unknown, key: string): unknown =>
  Object.hasOwn(object(value), key) ? object(value)[key] : undefined;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string =>
  typeof value === 'string'
    ? value.trim()
      ? value
      : '未填写'
    : value === undefined || value === null
      ? '未填写'
      : '格式需核对，请核对原稿或到对应页面修改';
const bool = (value: unknown): string =>
  value === true ? '是' : value === false ? '否' : '未填写或格式需核对';
const field = (label: string, value: string): ReviewField => ({ label, value });
const strings = (value: unknown, empty = '未列出'): string =>
  Array.isArray(value) ? (value.length ? value.map(text).join('、') : empty) : '未填写或格式需核对';
/** Fixed authoring UTC+08 display; malformed dates are shown verbatim rather than repaired. */
export function reviewTime(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return text(value);
  const n = Date.parse(value);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) ||
    !Number.isFinite(n) ||
    new Date(n).toISOString().slice(0, 19) !== value.slice(0, 19)
  )
    return `${value}（时间格式待核对，未换算）`;
  return `${new Date(n + 8 * 60 * 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.000Z$/, '')
    .replace(/Z$/, '')}（北京时间）`;
}

/** Read-only presentation of final content, deliberately accepts no model notes or source claims. */
export function buildPublisherReview(content: Data): ReviewGroup[] {
  const actors = list(own(content, 'actors')),
    places = list(own(content, 'places'));
  const history = list(own(content, 'history')),
    candidates = list(own(content, 'candidates'));
  const world = own(content, 'world'),
    protagonist = own(content, 'protagonist');
  const timeline = own(content, 'timeline'),
    phone = own(content, 'phone');
  const stages = list(own(timeline, 'stages'));
  function reference(rows: unknown[], key: unknown, label: string, name = 'name'): string {
    if (typeof key !== 'string' || !key) return `${label}未填写或格式需核对`;
    const matches = rows.filter((row) => own(row, 'key') === key);
    if (matches.length !== 1)
      return matches.length ? `${label}有重复条目，请核对` : `${label}未找到，请核对关联内容`;
    const value = own(matches[0], name);
    return typeof value === 'string' && value.trim() ? value : `${label}名称未填写`;
  }
  const actor = (key: unknown) => reference(actors, key, '人物');
  const place = (key: unknown) => reference(places, key, '地点');
  const node = (key: unknown) => reference(candidates, key, '剧情', 'title');
  const stage = (key: unknown) => reference(stages, key, '阶段', 'title');
  const fact = (key: unknown) => reference(history, key, '事实', 'text');
  function refs(value: unknown, resolve: (key: unknown) => string, empty = '未列出'): string {
    return Array.isArray(value)
      ? value.length
        ? value.map(resolve).join('；')
        : empty
      : '未填写或格式需核对';
  }
  function participant(value: unknown): string {
    return own(value, 'kind') === 'player'
      ? '玩家（主角）'
      : own(value, 'kind') === 'actor'
        ? actor(own(value, 'actorKey'))
        : '关系一方未填写或格式需核对';
  }
  function visibility(value: unknown): string {
    switch (own(value, 'kind')) {
      case 'world':
        return '玩家与所有人物均在可见范围内（开场知情还需相应引用）';
      case 'player':
        return '仅玩家';
      case 'actors':
        return `指定人物：${refs(own(value, 'actorKeys'), actor)}`;
      default:
        return '未填写或格式需核对';
    }
  }
  function knowledge(row: unknown): ReviewField[] {
    const key = own(row, 'key'),
      visible = own(row, 'visibility');
    const kind = own(visible, 'kind');
    const knowledgeRows = own(content, 'initialKnowledge'),
      playerRefs = own(protagonist, 'knownFactKeys');
    if (
      typeof key !== 'string' ||
      history.filter((f) => own(f, 'key') === key).length !== 1 ||
      !Array.isArray(knowledgeRows) ||
      !Array.isArray(playerRefs) ||
      !['world', 'player', 'actors'].includes(String(kind))
    )
      return [field('开场知情核对', '知情安排不完整或事实有重复条目，请到待确认问题中检查。')];
    const referenced = knowledgeRows
      .filter((k) => Array.isArray(own(k, 'factKeys')) && list(own(k, 'factKeys')).includes(key))
      .map((k) => own(k, 'actorKey'));
    const allowed = (actorKey: unknown) =>
      kind === 'world' || (kind === 'actors' && list(own(visible, 'actorKeys')).includes(actorKey));
    const recipients = referenced.filter(allowed);
    const blocked = referenced.filter((k) => !allowed(k));
    const playerListed = playerRefs.includes(key);
    const fields = [
      field(
        '玩家开场知情',
        playerListed
          ? kind === 'actors'
            ? '已列为知情，但与可见范围冲突，请核对'
            : '已列为知情'
          : '未列为知情',
      ),
      field(
        '人物开场知情',
        refs([...new Set(recipients)], actor, '未列出同时满足可见范围与知情引用的人物'),
      ),
    ];
    if (blocked.length)
      fields.push(
        field('知情冲突', `${refs(blocked, actor)}被列为知情，但不在该事实的可见范围内。`),
      );
    if (knowledgeRows.some((k) => !Array.isArray(own(k, 'factKeys'))))
      fields.push(
        field('知情安排提醒', '部分人物的知情列表格式需核对，当前显示不能替代完整检查。'),
      );
    return fields;
  }
  function collection(
    title: string,
    raw: unknown,
    render: (row: unknown, index: number) => ReviewCard,
  ): ReviewGroup {
    if (!Array.isArray(raw))
      return {
        title,
        cards: [
          {
            title: '内容待核对',
            fields: [
              field(
                '当前提案',
                raw === undefined
                  ? '未填写这组内容。'
                  : '这组内容的格式不完整，请核对原稿或到对应页面修改。',
              ),
            ],
          },
        ],
      };
    if (!raw.length) return { title, cards: [{ title: '当前提案未列出条目', fields: [] }] };
    return {
      title,
      cards: raw.map((row, index) =>
        row && typeof row === 'object' && !Array.isArray(row)
          ? render(row, index)
          : { title: `第 ${index + 1} 项格式需核对`, fields: [field('当前内容', text(row))] },
      ),
    };
  }
  const outcomes = (value: unknown) =>
    refs(
      value,
      (v) =>
        ({ committed: '已发生', declined: '已拒绝', skipped: '已跳过', expired: '已过期' })[
          String(v)
        ] ?? '结果类型待核对',
    );
  function prerequisite(raw: unknown): string {
    switch (own(raw, 'kind')) {
      case 'history_fact':
        return `已有事实：${fact(own(raw, 'factKey'))}`;
      case 'after_committed_node':
        return `剧情「${node(own(raw, 'nodeKey'))}」发生之后`;
      case 'after_resolved_node':
        return `剧情「${node(own(raw, 'nodeKey'))}」的结果为：${outcomes(own(raw, 'outcomes'))}`;
      case 'at_place':
        return `所在地点：${place(own(raw, 'placeKey'))}`;
      case 'not_before':
        return `不早于：${reviewTime(own(raw, 'at'))}`;
      default:
        return '发生条件未识别，请核对原稿或到对应页面修改。';
    }
  }
  const windowFields = (window: unknown): ReviewField[] =>
    window === undefined ||
    (typeof window === 'object' &&
      window !== null &&
      !Array.isArray(window) &&
      Object.keys(window).length === 0)
      ? []
      : [
          field('可发生时间起点', reviewTime(own(window, 'notBefore'))),
          field('截止时间', reviewTime(own(window, 'expiresAt'))),
        ];
  function intentFields(intent: unknown): ReviewField[] {
    switch (own(intent, 'kind')) {
      case 'editorial_only':
        return [field('事件方式', '仅剧情说明，尚未设置可执行事件')];
      case 'offer_message':
        return [
          field('事件方式', '候选消息（尚未发生）'),
          field('拟发送人', actor(own(intent, 'actorKey'))),
          field('拟发送正文', text(own(intent, 'text'))),
        ];
      case 'offer_invitation':
        return [
          field('事件方式', '候选邀约（尚未接受或发生）'),
          field('拟邀请人物', refs(own(intent, 'actorKeys'), actor)),
          field('拟邀约内容', text(own(intent, 'title'))),
          field('拟邀约地点', place(own(intent, 'placeKey'))),
          field('最早邀约时间', reviewTime(own(intent, 'earliestAt'))),
        ];
      default:
        return [field('事件方式', '未填写或暂未识别，请核对原稿或到对应页面修改')];
    }
  }
  const work = own(content, 'work');
  return [
    {
      title: '世界与主角',
      cards: [
        {
          title: text(own(work, 'title')),
          fields: [
            field('一句话简介', text(own(work, 'hook'))),
            field('作品简介', text(own(work, 'description'))),
            field('体验说明', text(own(work, 'experienceNote'))),
          ],
        },
        {
          title: '世界设定',
          fields: [
            field('公开设定', text(own(world, 'publicSetting'))),
            field('幕后设定', text(own(world, 'hiddenContext'))),
            field('叙事氛围', text(own(world, 'tone'))),
            field('开场时间', reviewTime(own(world, 'startAt'))),
            field('开场地点', place(own(world, 'startPlaceKey'))),
          ],
        },
        {
          title: '玩家（主角）',
          fields: [
            field('身份', text(own(protagonist, 'identity'))),
            field('当前处境', text(own(protagonist, 'situation'))),
            field('开场已知的事', refs(own(protagonist, 'knownFactKeys'), fact)),
          ],
        },
      ],
    },
    collection('人物', own(content, 'actors'), (row, index) => {
      const card = own(row, 'publicCard'),
        persona = own(row, 'privatePersona');
      return {
        title:
          typeof own(row, 'name') === 'string' ? text(own(row, 'name')) : `第 ${index + 1} 位人物`,
        fields: [
          field('身份', text(own(card, 'identity'))),
          field('人物背景', text(own(persona, 'background'))),
          field('性格特点', strings(own(card, 'traits'))),
          field('外貌', text(own(card, 'appearance'))),
          field('动机与诉求', text(own(persona, 'motivation'))),
          field('说话方式', text(own(persona, 'voice'))),
          field('人物边界', text(own(persona, 'boundaries'))),
          field('开场是否已认识', bool(own(row, 'knownAtStart'))),
        ],
      };
    }),
    collection('人物关系', own(content, 'relationships'), (row) => ({
      title: `${participant(own(row, 'from'))} → ${participant(own(row, 'to'))}`,
      fields: [
        field('关系原句（最终提案）', text(own(row, 'description'))),
        field('关系可见范围', visibility(own(row, 'visibility'))),
      ],
    })),
    collection('过去经历与已作出的约定', own(content, 'history'), (row, index) => ({
      title: `第 ${index + 1} 条已发生事实`,
      fields: [
        field('事实原句', text(own(row, 'text'))),
        field('发生时间', reviewTime(own(row, 'occurredAt'))),
        field('参与人物（不等于知情人）', refs(own(row, 'actorKeys'), actor)),
        ...(own(row, 'placeKey') === undefined
          ? []
          : [field('发生地点', place(own(row, 'placeKey')))]),
        field('可见范围', visibility(own(row, 'visibility'))),
        ...knowledge(row),
      ],
    })),
    collection('开场手机消息', own(phone, 'messages'), (row, index) => ({
      title: `第 ${index + 1} 条 · ${actor(own(row, 'actorKey'))}`,
      fields: [
        field(
          '消息类型',
          own(row, 'origin') === 'history'
            ? '过去的对话'
            : own(row, 'origin') === 'incoming'
              ? '开场收到的消息'
              : '未填写或格式需核对',
        ),
        field('发送时间', reviewTime(own(row, 'at'))),
        field('消息正文', text(own(row, 'text'))),
      ],
    })),
    collection('地点', own(content, 'places'), (row) => ({
      title: text(own(row, 'name')),
      fields: [
        field('地点说明', text(own(row, 'description'))),
        field('开场是否已知', bool(own(row, 'knownAtStart'))),
      ],
    })),
    collection('地点之间的路线', own(content, 'routes'), (row) => ({
      title: `${place(own(row, 'fromPlaceKey'))} → ${place(own(row, 'toPlaceKey'))}`,
      fields: [
        field(
          '单向移动耗时',
          typeof own(row, 'minutes') === 'number'
            ? `${own(row, 'minutes')} 分钟`
            : text(own(row, 'minutes')),
        ),
      ],
    })),
    collection('剧情阶段', own(timeline, 'stages'), (row) => ({
      title: text(own(row, 'title')),
      fields: [
        field(
          '是否开场阶段',
          own(timeline, 'initialStageKey') === own(row, 'key') &&
            typeof own(row, 'key') === 'string'
            ? '是'
            : '否',
        ),
        field(
          '阶段顺序',
          typeof own(row, 'order') === 'number'
            ? `第 ${(own(row, 'order') as number) + 1} 阶段`
            : '未填写或格式需核对',
        ),
        field('前置阶段', refs(own(row, 'afterStageKeys'), stage, '未设置前置阶段')),
        ...windowFields(own(row, 'window')),
      ],
    })),
    collection('未来可能发生的剧情', own(content, 'candidates'), (row) => {
      const timing = own(row, 'timeline'),
        alternatives = own(timing, 'alternatives');
      return {
        title: text(own(row, 'title')),
        fields: [
          field('剧情原文', text(own(row, 'editorialIntent'))),
          field('参与人物', refs(own(row, 'actorKeys'), actor)),
          ...(own(row, 'placeKey') === undefined
            ? []
            : [field('发生地点', place(own(row, 'placeKey')))]),
          field(
            '所属阶段',
            !own(timing, 'stageKey') ? '未设置阶段' : stage(own(timing, 'stageKey')),
          ),
          field('发生条件', refs(own(row, 'prerequisites'), prerequisite, '未设置前置条件')),
          field(
            '与这些剧情不能同时发生',
            refs(own(row, 'mutuallyExclusiveNodeKeys') ?? [], node, '未设置'),
          ),
          ...intentFields(own(row, 'intent')),
          ...windowFields(own(timing, 'window')),
          ...(own(timing, 'timeNote') === undefined
            ? []
            : [field('时间说明', text(own(timing, 'timeNote')))]),
          ...(timing === undefined
            ? []
            : [
                field(
                  '不再出现的条件',
                  refs(
                    own(timing, 'excludeIfResolved') ?? [],
                    (r) => `「${node(own(r, 'nodeKey'))}」结果为${outcomes(own(r, 'outcomes'))}`,
                    '未列出',
                  ),
                ),
                field(
                  '被拒绝后的候选',
                  refs(own(alternatives, 'onDeclined') ?? [], node, '未设置'),
                ),
                field('被跳过后的候选', refs(own(alternatives, 'onSkipped') ?? [], node, '未设置')),
                field('过期后的候选', refs(own(alternatives, 'onExpired') ?? [], node, '未设置')),
              ]),
        ],
      };
    }),
  ];
}

export function PublisherReviewView({
  content,
  mode = 'proposal',
}: {
  content: Data;
  mode?: 'proposal' | 'draft';
}) {
  const groups = buildPublisherReview(content);
  return h(
    'section',
    {
      className: s.reviewContent,
      'aria-label': mode === 'draft' ? '当前草稿故事概览' : '最终提案实际内容',
    },
    h('h3', null, mode === 'draft' ? '这段故事现在是什么样' : '将填入的实际内容'),
    h(
      'p',
      { className: s.reviewNotice },
      mode === 'draft'
        ? '这里展示当前编辑稿；修改后请保存。未填写的内容不会自动补齐。'
        : '以下为实际整理稿，请核对事实与补充；未填写不代表原稿没有提及。',
    ),
    h(
      'details',
      { className: s.reviewGroup },
      h('summary', null, '如何核对这段故事'),
      h(
        'p',
        { className: s.help },
        mode === 'draft'
          ? '先读故事，再到人物与剧情发展调整。概览只读取当前编辑稿，不使用模型说明补齐未填写的内容。'
          : '原稿可在导入区展开查看；文字对应检查不能代替语义核对，也不能保证无遗漏。请特别核对年龄、人物关系和已经作出的约定。',
      ),
      h(
        'p',
        { className: s.help },
        '人物背景等长文本完整展示；可见范围与开场知情情况分开列出。未来剧情仍是候选，不代表已经发生。',
      ),
    ),
    ...groups.map((group) =>
      h(
        'details',
        {
          key: group.title,
          className: s.reviewGroup,
          open: group.title === '世界与主角',
        },
        h('summary', null, group.title),
        h(
          'div',
          { className: s.reviewCards },
          ...group.cards.map((card, index) =>
            h(
              'article',
              { key: index, className: s.reviewCard },
              h('h4', null, card.title),
              h(
                'dl',
                null,
                ...card.fields.map((item, i) =>
                  h(
                    'div',
                    { key: i, className: s.reviewField },
                    h('dt', null, item.label),
                    h('dd', null, item.value),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
