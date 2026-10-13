import test from 'node:test';
import assert from 'node:assert/strict';
import { planPublicationTimes } from '../src/modules/settings/domain/publication-scheduling.ts';
import { PublishedWorldContentSchema } from '../src/contracts/published-world-content.ts';
import { compilePublicationGenesis } from '../src/modules/settings/infrastructure/publication-genesis.ts';

const REF = '2026-10-13T10:00:00Z';
const plan = (
  c: Record<string, unknown>,
  sources?: { filename: string; content: string }[],
  referenceAt = REF,
) => planPublicationTimes(c, { referenceAt, ...(sources ? { sources } : {}) });
const source = (content: string) => [{ filename: '测试稿.md', content }];
function fixture() {
  return {
    schemaVersion: 1,
    work: {
      key: 'work',
      title: '雨前的小站',
      hook: '先商量安排',
      description: '一起经营小站',
      experienceNote: '可以拒绝',
    },
    world: {
      publicSetting: '山间小站',
      tone: '平静',
      startAt: '',
      startPlaceKey: 'station',
      hiddenContext: '不预定玩家决定',
    },
    protagonist: { identity: '管理员', situation: '准备交谈', knownFactKeys: ['h1', 'h2'] },
    actors: ['a', 'b'].map((key) => ({
      key,
      name: key === 'a' ? '宁遥' : '路帆',
      knownAtStart: true,
      publicCard: { traits: [] },
      privatePersona: {
        background: '负责记录',
        motivation: '完成本职工作',
        voice: '表达清楚',
        boundaries: '尊重选择',
      },
    })),
    relationships: [],
    places: [{ key: 'station', name: '小站', description: '一座小站', knownAtStart: true }],
    routes: [],
    history: ['h1', 'h2'].map((key) => ({
      key,
      kind: 'established_fact',
      text: key === 'h1' ? '盘点已完成' : '已经讨论过安排',
      occurredAt: '',
      actorKeys: ['a'],
      visibility: { kind: 'world' },
    })),
    initialKnowledge: [{ actorKey: 'a', factKeys: ['h1', 'h2'] }],
    phone: {
      messages: [
        { key: 'm1', actorKey: 'a', origin: 'history', text: '先核账再采购。', at: '' },
        { key: 'm2', actorKey: 'b', origin: 'history', text: '收到，保持联系。', at: '' },
        { key: 'm3', actorKey: 'a', origin: 'incoming', text: '可以谈谈安排吗？', at: '' },
      ],
      notes: [],
      invitations: [
        {
          key: 'i1',
          actorKeys: ['a'],
          placeKey: 'station',
          messageKey: 'm3',
          title: '商量安排',
          at: '',
          status: 'proposed',
        },
      ],
      album: [],
    },
    candidates: [
      {
        key: 'c1',
        kind: 'candidate',
        title: '新的商议',
        editorialIntent: '了解对方想法',
        actorKeys: ['a'],
        prerequisites: [] as Record<string, unknown>[],
        mutuallyExclusiveNodeKeys: [],
        intent: {
          kind: 'offer_invitation',
          actorKeys: ['a'],
          placeKey: 'station',
          title: '讨论分工',
          earliestAt: '',
        },
      },
    ],
    media: [],
    extensions: [],
  };
}
const parsed = (value: Record<string, unknown>) => PublishedWorldContentSchema.parse(value);
function blocked(
  c: Record<string, unknown>,
  code: string,
  sources?: { filename: string; content: string }[],
) {
  const before = structuredClone(c),
    r = plan(c, sources);
  assert.equal(r.status, 'blocked');
  assert.deepEqual(r.changes, []);
  assert.ok(
    r.issues.some((i) => i.code === code),
    JSON.stringify(r.issues),
  );
  assert.deepEqual(r.updatedContent, before);
  assert.deepEqual(c, before);
  return r;
}

test('minimal no-timeline manuscript receives bounded defaults and passes actual schema and compiler', () => {
  const c = fixture(),
    before = structuredClone(c),
    r = plan(c);
  assert.equal(r.status, 'proposed');
  assert.deepEqual(c, before);
  assert.deepEqual(r.issues, []);
  const out = parsed(r.updatedContent);
  assert.equal(out.world.startAt, '2026-10-13T10:00:00.000Z');
  assert.deepEqual(
    out.history.map((h) => h.occurredAt),
    ['2026-10-13T09:58:00.000Z', '2026-10-13T09:59:00.000Z'],
  );
  assert.deepEqual(
    out.phone.messages.map((m) => m.at),
    ['2026-10-13T09:58:00.000Z', '2026-10-13T09:59:00.000Z', '2026-10-13T10:00:00.000Z'],
  );
  assert.equal(out.phone.invitations[0]!.at, '2026-10-13T11:00:00.000Z');
  assert.equal(out.phone.invitations[0]!.status, 'proposed');
  assert.equal(
    out.candidates[0]!.intent.kind === 'offer_invitation' && out.candidates[0]!.intent.earliestAt,
    out.world.startAt,
  );
  assert.equal(out.timeline, undefined);
  let n = 10;
  const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
  const compiled = compilePublicationGenesis({
    content: out,
    originKind: 'trial',
    origin: { workId: id(4), publicationVersion: 0, draftVersion: 0, contentHash: 'a'.repeat(64) },
    worldId: id(1),
    ownerId: id(2),
    seedId: id(3),
    newId: () => id(n++),
  });
  assert.equal(compiled.status, 'compiled');
});
test('same inputs replay identically and applied times never move with a new reference', () => {
  const c = fixture();
  const first = plan(c);
  assert.deepEqual(first, plan(c));
  const second = plan(first.updatedContent, undefined, '2040-01-01T00:00:00Z');
  assert.equal(second.status, 'unchanged');
  assert.deepEqual(second.changes, []);
  assert.deepEqual(second.updatedContent, first.updatedContent);
});
test('explicit timestamps retain spelling and subsecond precision; only whitespace or absent fields fill', () => {
  const c = fixture();
  c.world.startAt = REF;
  c.history[0]!.occurredAt = '2026-10-13T09:30:00.1200Z';
  c.history[1]!.occurredAt = ' \n ';
  delete (c.phone.messages[0] as { at?: string }).at;
  const r = plan(c);
  assert.equal(r.status, 'proposed');
  const out = parsed(r.updatedContent);
  assert.equal(out.world.startAt, REF);
  assert.equal(out.history[0]!.occurredAt, '2026-10-13T09:30:00.1200Z');
  assert.ok(
    !r.changes.some((ch) => JSON.stringify(ch.path) === JSON.stringify(['world', 'startAt'])),
  );
});
test('invalid nonblank values are preserved and block the whole proposal', () => {
  for (const value of [
    null,
    0,
    false,
    {},
    [],
    '待定',
    '2026-02-30T10:00:00Z',
    '2026-10-13T25:00:00Z',
    '2026-10-13T10:00:00',
    '2026-10-13T10:00:00+08:00',
  ]) {
    const c = fixture();
    Object.assign(c.history[0]!, { occurredAt: value });
    blocked(c, 'scheduling_invalid_time');
  }
});
test('global current time is never read', () => {
  const old = Date.now;
  Date.now = () => {
    throw Error('no global clock');
  };
  try {
    assert.equal(plan(fixture()).status, 'proposed');
  } finally {
    Date.now = old;
  }
});
test('reference must be explicit and valid even when wall clock exists', () => {
  const c = fixture();
  const r = plan(c, undefined, 'invalid');
  assert.equal(r.status, 'blocked');
  assert.equal(r.issues[0]!.code, 'scheduling_invalid_reference');
  assert.deepEqual(r.updatedContent, c);
});
test('blank start uses fixed historical lower bounds and invitation upper bounds without moving them', () => {
  const c = fixture();
  c.history = [];
  c.phone.messages = [{ ...c.phone.messages[0]!, at: '2027-01-01T10:00:00Z' }];
  c.phone.invitations = [
    { ...c.phone.invitations[0]!, messageKey: 'm1', at: '2027-01-01T10:00:30Z' },
  ];
  c.candidates = [];
  const r = plan(c);
  assert.equal(r.status, 'proposed');
  assert.equal((r.updatedContent.world as { startAt: string }).startAt, '2027-01-01T10:00:00.001Z');
  assert.equal((r.updatedContent.phone as typeof c.phone).messages[0]!.at, c.phone.messages[0]!.at);
  const late = plan(c, undefined, '2028-01-01T00:00:00Z');
  assert.equal(
    (late.updatedContent.world as { startAt: string }).startAt,
    '2027-01-01T10:00:30.000Z',
  );
});
test('incompatible fixed dates do not partially populate other missing fields', () => {
  const c = fixture();
  c.history[0]!.occurredAt = '2030-01-01T00:00:00Z';
  c.phone.invitations[0]!.at = '2020-01-01T00:00:00Z';
  blocked(c, 'scheduling_no_feasible_start');
});
test('explicit starting time is never moved to rescue history, messages, invitations or candidates', () => {
  for (const [field, code] of [
    ['history', 'scheduling_history_after_start'],
    ['message', 'scheduling_message_not_past'],
    ['invitation', 'scheduling_invitation_before_start'],
    ['candidate', 'scheduling_candidate_before_start'],
  ] as const) {
    const c = fixture();
    c.world.startAt = REF;
    if (field === 'history') c.history[0]!.occurredAt = '2026-10-14T10:00:00Z';
    if (field === 'message') c.phone.messages[0]!.at = REF;
    if (field === 'invitation') c.phone.invitations[0]!.at = '2026-10-12T10:00:00Z';
    if (field === 'candidate') c.candidates[0]!.intent.earliestAt = '2026-10-12T10:00:00Z';
    blocked(c, code);
  }
});
test('past sequence fills between actual neighbors in minute steps and reports insufficient gaps', () => {
  const c = fixture();
  c.world.startAt = REF;
  c.history = [
    { ...c.history[0]!, occurredAt: '2026-10-13T09:50:00Z' },
    { ...c.history[1]! },
    { ...c.history[0]!, key: 'h3', occurredAt: '2026-10-13T09:55:00Z' },
  ];
  const r = plan(c);
  assert.equal(r.status, 'proposed');
  assert.equal(
    (r.updatedContent.history as typeof c.history)[1]!.occurredAt,
    '2026-10-13T09:54:00.000Z',
  );
  c.history[2]!.occurredAt = '2026-10-13T09:50:30Z';
  blocked(c, 'scheduling_no_time_gap');
});
test('unknown ordering in a mixed sequence is not repaired by sorting or changing fixed dates', () => {
  const c = fixture();
  c.world.startAt = REF;
  c.history = [
    { ...c.history[0]!, occurredAt: '2026-10-13T09:55:00Z' },
    { ...c.history[1]! },
    { ...c.history[0]!, key: 'h3', occurredAt: '2026-10-13T09:50:00Z' },
  ];
  blocked(c, 'scheduling_ambiguous_time_order');
});
test('all-fixed historical arrays may use editorial order and remain unchanged', () => {
  const c = parsed(plan(fixture()).updatedContent);
  c.history.reverse();
  c.phone.messages.reverse();
  assert.equal(plan({ ...c }).status, 'unchanged');
});
test('unknown history/message/invitation meanings and dangling message references block safely', () => {
  for (const [kind, code] of [
    ['history', 'scheduling_unknown_history_kind'],
    ['message', 'scheduling_unknown_message_origin'],
    ['invitation', 'scheduling_unknown_invitation_status'],
    ['reference', 'scheduling_unknown_message'],
  ] as const) {
    const c = fixture();
    if (kind === 'history') c.history[0]!.kind = 'candidate';
    if (kind === 'message') c.phone.messages[0]!.origin = '';
    if (kind === 'invitation') c.phone.invitations[0]!.status = 'accepted';
    if (kind === 'reference') c.phone.invitations[0]!.messageKey = 'no_message';
    blocked(c, code);
  }
});
test('duplicate identifiers and malformed collections do not allocate times to ambiguous records', () => {
  const c = fixture();
  c.history[1]!.key = c.history[0]!.key;
  blocked(c, 'scheduling_ambiguous_key');
  const d = fixture();
  Object.assign(d, { history: 'not a list' });
  blocked(d, 'scheduling_invalid_collection');
  const e = fixture();
  delete (e.history[0] as { key?: string }).key;
  blocked(e, 'scheduling_ambiguous_key');
});
test('unknown fields, references, outcomes and original array order survive a successful proposal', () => {
  const c = fixture();
  Object.assign(c, { future: { untouched: [false, 0, null, 'raw'] } });
  Object.assign(c.history[0]!, { extension: { value: 'raw' } });
  const r = plan(c);
  assert.equal(r.status, 'proposed');
  const out = r.updatedContent;
  assert.deepEqual(out.future, (c as unknown as Record<string, unknown>).future);
  assert.deepEqual(
    (out.history as unknown[])[0] && (out.history as Record<string, unknown>[])[0]!.extension,
    { value: 'raw' },
  );
  assert.deepEqual(
    (out.candidates as typeof c.candidates).map((c) => [
      c.key,
      c.prerequisites,
      c.mutuallyExclusiveNodeKeys,
    ]),
    c.candidates.map((c) => [c.key, c.prerequisites, c.mutuallyExclusiveNodeKeys]),
  );
});
function staged() {
  const c = fixture();
  c.world.startAt = REF;
  return {
    ...c,
    timeline: {
      initialStageKey: 's1',
      stages: [
        {
          key: 's1',
          title: '准备',
          order: 0,
          afterStageKeys: [] as string[],
          window: { notBefore: '2026-10-13T09:00:00Z', expiresAt: '2026-10-14T12:00:00Z' },
        },
        { key: 's2', title: '后续', order: 1, afterStageKeys: ['s1'] },
      ],
    },
    candidates: [
      {
        ...c.candidates[0]!,
        prerequisites: [{ kind: 'not_before', at: '2026-10-13T12:00:00Z' }] as Record<
          string,
          unknown
        >[],
        timeline: {
          stageKey: 's1',
          window: { notBefore: '2026-10-13T11:00:00Z', expiresAt: '2026-10-13T13:00:00Z' },
          excludeIfResolved: [],
          alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
        },
      },
    ],
  };
}
test('candidate lower bound uses later existing conditions while optional dates and dependencies remain unchanged', () => {
  const c = staged();
  const r = plan(c);
  assert.equal(r.status, 'proposed');
  const out = parsed(r.updatedContent);
  const intent = out.candidates[0]!.intent;
  assert.equal(intent.kind === 'offer_invitation' && intent.earliestAt, '2026-10-13T12:00:00.000Z');
  assert.deepEqual(out.timeline, c.timeline);
  assert.deepEqual(out.candidates[0]!.prerequisites, c.candidates[0]!.prerequisites);
  assert.deepEqual(out.candidates[0]!.timeline, c.candidates[0]!.timeline);
});
test('default lower bounds cannot land at or after the candidate deadline', () => {
  const c = staged();
  c.candidates[0]!.prerequisites = [{ kind: 'not_before', at: '2026-10-13T13:00:00Z' }];
  blocked(c, 'scheduling_window_conflict');
});
test('explicit optional date constraints are never invented or completed', () => {
  const c = staged();
  delete (c.candidates[0]!.timeline.window as { expiresAt?: string }).expiresAt;
  blocked(c, 'scheduling_invalid_window');
  const d = staged();
  d.candidates[0]!.prerequisites = [{ kind: 'not_before', at: '' }];
  blocked(d, 'scheduling_explicit_constraint_incomplete');
});
test('an existing not_before bounds a missing start without moving the condition or an explicit start', () => {
  const c = fixture();
  c.history = [];
  c.phone.messages = [];
  c.phone.invitations = [];
  c.candidates[0]!.prerequisites = [{ kind: 'not_before', at: '2030-01-01T10:00:00Z' }];
  const r = plan(c, undefined, '2040-01-01T00:00:00Z');
  assert.equal(r.status, 'proposed');
  assert.equal((r.updatedContent.world as { startAt: string }).startAt, '2030-01-01T10:00:00.000Z');
  assert.deepEqual(
    (r.updatedContent.candidates as typeof c.candidates)[0]!.prerequisites,
    c.candidates[0]!.prerequisites,
  );
  c.world.startAt = '2040-01-01T00:00:00Z';
  blocked(c, 'scheduling_candidate_before_start');
});
test('missing start reserves minute space after fixed historical facts and messages', () => {
  for (const kind of ['history', 'messages']) {
    const c = fixture();
    c.history = [];
    c.phone.messages = [];
    c.phone.invitations = [];
    c.candidates = [];
    if (kind === 'history')
      c.history = [
        { ...fixture().history[0]!, occurredAt: '2030-01-01T10:00:00Z' },
        { ...fixture().history[1]! },
      ];
    else
      c.phone.messages = [
        { ...fixture().phone.messages[0]!, at: '2030-01-01T10:00:00Z' },
        { ...fixture().phone.messages[1]! },
        { ...fixture().phone.messages[2]! },
      ];
    const r = plan(c);
    assert.equal(r.status, 'proposed');
    assert.equal(
      (r.updatedContent.world as { startAt: string }).startAt,
      '2030-01-01T10:02:00.000Z',
    );
    if (kind === 'history')
      assert.equal(
        (r.updatedContent.history as typeof c.history)[1]!.occurredAt,
        '2030-01-01T10:01:00.000Z',
      );
    else
      assert.equal(
        (r.updatedContent.phone as typeof c.phone).messages[1]!.at,
        '2030-01-01T10:01:00.000Z',
      );
  }
});
test('fixed upper bounds that leave no minute spacing report no feasible start without moving dates', () => {
  const c = fixture();
  c.phone.messages = [];
  c.phone.invitations = [];
  c.history[0]!.occurredAt = '2030-01-01T10:00:00Z';
  c.candidates[0]!.prerequisites = [{ kind: 'not_before', at: '2030-01-01T10:01:00Z' }];
  blocked(c, 'scheduling_no_feasible_start');
});
test('stage and candidate loops or reverse dependencies cannot be rescued by time scheduling', () => {
  const c = staged();
  c.timeline.stages[0]!.afterStageKeys = ['s2'];
  blocked(c, 'scheduling_dependency_conflict');
  const d = staged();
  d.candidates[0]!.prerequisites = [{ kind: 'after_committed_node', nodeKey: 'c1' }];
  blocked(d, 'scheduling_dependency_conflict');
});
test('initial stage window bounds a missing start and cannot override an explicit one', () => {
  const c = staged();
  c.world.startAt = '';
  c.candidates = [];
  const r = plan(c, undefined, '2020-01-01T00:00:00Z');
  assert.equal(r.status, 'proposed');
  assert.equal((r.updatedContent.world as { startAt: string }).startAt, '2026-10-13T09:00:00.000Z');
  c.world.startAt = '2020-01-01T00:00:00Z';
  blocked(c, 'scheduling_start_outside_window');
});
test('source time cues block only pending defaults and preserve exact UTF16 source locations', () => {
  for (const text of [
    '😀开场2026年10月16日18:30北京时间',
    '昨天宁遥来信',
    '第3天讨论',
    '10月16日商议',
    '17点20分来信',
  ]) {
    const c = fixture();
    const r = blocked(c, 'scheduling_source_time_needs_review', source(text));
    const location = r.issues.find((i) => i.source)!.source!;
    assert.equal(text.slice(location.start, location.end), location.quote);
  }
  const full = plan(fixture()).updatedContent;
  assert.equal(
    plan(full, source('开场2026年10月16日18:30北京时间，昨天有来信')).status,
    'unchanged',
  );
});
test('ages and relationship durations are not mistaken for schedule constraints', () => {
  assert.equal(plan(fixture(), source('宁遥26岁，与主角相识三年，路帆45岁。')).status, 'proposed');
});
test('unrepresented event-relative delay blocks even a completely dated AI result', () => {
  const full = plan(fixture()).updatedContent;
  for (const text of ['拒绝后两天再问', '事件完成后，隔一天再来信', '交谈完成的第二天安排后续']) {
    blocked(full, 'scheduling_unsupported_relative_delay', source(text));
  }
  const c = staged();
  Object.assign(c.candidates[0]!.timeline, { timeNote: '拒绝后隔一天再问' });
  blocked(c, 'scheduling_unsupported_relative_delay');
});
test('body time cues also prevent ungrounded defaults without separate source files', () => {
  const c = fixture();
  c.phone.messages[0]!.text = '明天17:20见';
  blocked(c, 'scheduling_source_time_needs_review');
});
test('unsafe content getters never execute and input budget is enforced', () => {
  const unsafe = Object.defineProperty({}, 'world', {
    enumerable: true,
    get() {
      throw Error('getter');
    },
  });
  const r = plan(unsafe);
  assert.equal(r.status, 'blocked');
  assert.equal(r.issues[0]!.code, 'scheduling_unsafe_content');
  assert.equal(r.updatedContent, unsafe);
  const c = fixture();
  c.world.hiddenContext = 'x'.repeat(70000);
  assert.equal(plan(c).issues[0]!.code, 'scheduling_unsafe_content');
});
test('sources with getters or too much text do not run or silently skip source checks', () => {
  const sources = [
    Object.defineProperty({ filename: 'x' }, 'content', {
      enumerable: true,
      get() {
        throw Error('source getter');
      },
    }),
  ] as { filename: string; content: string }[];
  assert.ok(plan(fixture(), sources).issues.some((i) => i.code === 'scheduling_invalid_sources'));
  assert.ok(
    plan(fixture(), source('x'.repeat(262145))).issues.some(
      (i) => i.code === 'scheduling_source_budget',
    ),
  );
});
test('time underflow blocks atomically rather than producing an invalid extended-year ISO date', () => {
  const c = fixture();
  c.world.startAt = '0000-01-01T00:00:00Z';
  blocked(c, 'scheduling_time_out_of_range');
});

test('incoming messages after an explicit start are reported without changing their origin', () => {
  const c = fixture();
  c.world.startAt = REF;
  c.phone.messages[2]!.at = '2026-10-13T10:00:01Z';
  blocked(c, 'scheduling_message_not_past');
});
test('bounded temporal scanning handles a long numeric manuscript without inventing a time', () => {
  const r = plan(fixture(), source('7'.repeat(100000)));
  assert.equal(r.status, 'proposed');
});
