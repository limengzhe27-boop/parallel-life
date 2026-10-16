import test from 'node:test';
import assert from 'node:assert/strict';
import { PublishedWorldContentSchema } from '../src/contracts/published-world-content.ts';
import { PublisherDraftContentSchema } from '../src/contracts/world-publisher.ts';
import {
  addPlotRow,
  clonePlot,
  patchPlotField,
  setPlotEventLead,
  removePlotField,
  setPlotInitialStage,
  deletePlotRow,
  plotRows,
  plotRecord,
  plotChoices,
  plotRowEditable,
  plotDeletionReferences,
  plotCollectionEditable,
  plotIssues,
  type PlotRecord,
} from '../src/features/publisher/publisher-plot-model.ts';

test('one explicit event speaker yields a valid no-date event and retains the other participants and metadata', () => {
  const original = fixture();
  delete original.timeline;
  original.candidates = [];
  let next = addPlotRow(original, 'candidates');
  const key = String(plotRecord(plotRows(next, 'candidates')[0]).key);
  const blank = plotRecord(plotRows(next, 'candidates')[0]);
  assert.deepEqual(blank.intent, { kind: 'director_event', actorKey: '' });
  assert.deepEqual(blank.actorKeys, []);
  next = patchPlotField(next, 'candidates', key, ['title'], '讨论一件事');
  next = patchPlotField(next, 'candidates', key, ['editorialIntent'], '完整描述'.repeat(60));
  const ready = setPlotEventLead(next, key, 'alice');
  const doc = PublishedWorldContentSchema.parse(ready);
  assert.deepEqual(doc.candidates[0]!.prerequisites, []);
  assert.equal(doc.candidates[0]!.timeline, undefined);
  assert.deepEqual(doc.candidates[0]!.intent, { kind: 'director_event', actorKey: 'alice' });
  assert.deepEqual(doc.candidates[0]!.actorKeys, ['alice']);
  assert.deepEqual(doc.history, original.history);
  const before = structuredClone(ready);
  const changed = setPlotEventLead(ready, key, 'bob');
  assert.deepEqual(plotRecord(plotRows(changed, 'candidates')[0]).actorKeys, ['alice', 'bob']);
  assert.deepEqual(plotRecord(plotRows(changed, 'candidates')[0]).direction, { mode: 'required' });
  assert.deepEqual(changed.extensions, before.extensions);
  assert.deepEqual(ready, before);
  const cleared = setPlotEventLead(changed, key, '');
  assert.deepEqual(plotRecord(plotRows(cleared, 'candidates')[0]).actorKeys, ['alice', 'bob']);
  assert.equal(PublishedWorldContentSchema.safeParse(cleared).success, false);
});

test('speaker choice rejects unknown or ambiguous people and malformed legacy branches without replacing source data', () => {
  for (const variant of ['unknown', 'duplicate', 'malformed', 'fixed', 'extension']) {
    const source = fixture();
    const node = plotRecord(plotRows(source, 'candidates')[0]);
    node.intent = { kind: 'director_event', actorKey: 'alice' };
    if (variant === 'duplicate') (source.actors as unknown[]).push({ key: 'bob', name: '另一人' });
    if (variant === 'malformed') node.actorKeys = { raw: '保留' };
    if (variant === 'fixed')
      node.intent = { kind: 'offer_message', actorKey: 'alice', text: '原来信' };
    if (variant === 'extension')
      node.intent = { kind: 'director_event', actorKey: 'alice', custom: '保留' };
    const before = structuredClone(source);
    assert.throws(() =>
      setPlotEventLead(source, 'node_a', variant === 'unknown' ? 'missing' : 'bob'),
    );
    assert.deepEqual(source, before);
  }
});

test('independent event editing keeps more than twelve events and has no two-hundred-character validation', () => {
  const source = fixture();
  delete source.timeline;
  source.candidates = [];
  let result = source;
  for (let i = 0; i < 14; i++) {
    result = addPlotRow(result, 'candidates');
    const key = String(plotRecord(plotRows(result, 'candidates').at(-1)).key);
    result = patchPlotField(result, 'candidates', key, ['title'], `独立事件${i + 1}`);
    result = patchPlotField(
      result,
      'candidates',
      key,
      ['editorialIntent'],
      i === 13 ? '甲'.repeat(201) : '简短概述',
    );
    result = setPlotEventLead(result, key, 'bob');
  }
  assert.equal(PublishedWorldContentSchema.parse(result).candidates.length, 14);
  assert.equal(plotRecord(plotRows(result, 'candidates')[13]).editorialIntent, '甲'.repeat(201));
});
function fixture(): PlotRecord {
  return {
    schemaVersion: 1,
    work: {
      key: 'work_local',
      title: '合成表单验证',
      hook: '检查字段',
      description: '纯数据测试，不是生产剧本。',
      experienceNote: '由玩家选择',
    },
    world: {
      publicSetting: '两人准备开店',
      tone: '日常',
      startAt: '2026-10-12T09:00:00Z',
      startPlaceKey: 'home',
      hiddenContext: '不公开的原稿',
    },
    protagonist: { identity: '开店者', situation: '准备讨论', knownFactKeys: ['fact_a'] },
    actors: ['alice', 'bob'].map((key) => ({
      key,
      name: '同名人物',
      knownAtStart: true,
      publicCard: { traits: ['谨慎'] },
      privatePersona: { background: '背景', motivation: '动机', voice: '语气', boundaries: '底线' },
    })),
    relationships: [],
    places: [{ key: 'home', name: '已有店铺', description: '世界中的店铺', knownAtStart: true }],
    routes: [],
    history: [
      {
        key: 'fact_a',
        kind: 'established_fact',
        text: '双方上周讨论过开店',
        occurredAt: '2026-10-11T09:00:00Z',
        actorKeys: ['alice'],
        visibility: { kind: 'world' },
      },
    ],
    initialKnowledge: [
      { actorKey: 'alice', factKeys: ['fact_a'] },
      { actorKey: 'bob', factKeys: ['fact_a'] },
    ],
    phone: { messages: [], notes: [], invitations: [], album: [] },
    media: [],
    timeline: {
      initialStageKey: 'stage_a',
      stages: [
        { key: 'stage_a', title: '准备', order: 0, afterStageKeys: [] },
        { key: 'stage_b', title: '后来', order: 1, afterStageKeys: ['stage_a'] },
      ],
    },
    candidates: [
      {
        key: 'node_a',
        kind: 'candidate',
        title: '一条来信',
        editorialIntent: '讨论可能性',
        actorKeys: ['alice'],
        prerequisites: [{ kind: 'history_fact', factKey: 'fact_a' }],
        mutuallyExclusiveNodeKeys: [],
        intent: { kind: 'offer_message', actorKey: 'alice', text: '一起讨论一下好吗' },
        timeline: {
          stageKey: 'stage_a',
          excludeIfResolved: [],
          alternatives: { onDeclined: ['node_b'], onSkipped: [], onExpired: [] },
        },
      },
      {
        key: 'node_b',
        kind: 'candidate',
        title: '另一种可能',
        editorialIntent: '收到拒绝后再问',
        actorKeys: ['bob'],
        prerequisites: [{ kind: 'after_resolved_node', nodeKey: 'node_a', outcomes: ['declined'] }],
        mutuallyExclusiveNodeKeys: [],
        intent: { kind: 'editorial_only' },
        timeline: {
          stageKey: 'stage_b',
          excludeIfResolved: [],
          alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
        },
      },
    ],
    extensions: [
      {
        namespace: 'author.future',
        version: 1,
        purpose: 'editorial',
        description: '未来字段',
        data: { raw: '  原字句\n不可裁剪  ', nested: { phase: '未核对' } },
      },
    ],
  };
}
test('fixture exercises the actual strict publication contract', () => {
  assert.ok(PublishedWorldContentSchema.safeParse(fixture()).success);
});
test('editing one fact preserves all other raw text, knowledge, phone, stages and unknown extensions', () => {
  const c = fixture();
  const before = clonePlot(c);
  const n = patchPlotField(c, 'history', 'fact_a', ['text'], '新标题');
  const expected = clonePlot(c);
  plotRecord(plotRows(expected, 'history')[0]).text = '新标题';
  assert.deepEqual(n, expected);
  assert.deepEqual(c, before);
});
test('editing one node title retains its old key and unknown unedited subtree', () => {
  const c = fixture();
  plotRecord(plotRows(c, 'candidates')[0]).future = { secret: '原始未知字段' };
  const n = patchPlotField(c, 'candidates', 'node_a', ['title'], '新的同名');
  assert.deepEqual(plotRecord(plotRows(n, 'candidates')[0]).future, { secret: '原始未知字段' });
  assert.equal(plotRecord(plotRows(n, 'candidates')[0]).key, 'node_a');
  assert.equal(plotRecord(plotRows(n, 'candidates')[1]).title, '另一种可能');
});
test('stable keys and discriminator cannot be changed through a field patch', () => {
  for (const path of [['key'], ['kind'], ['__proto__', 'leak'], ['constructor', 'name']])
    assert.throws(() => patchPlotField(fixture(), 'history', 'fact_a', path, 'x'));
  assert.equal(({} as PlotRecord).leak, undefined);
});
test('duplicate or absent identifiers disable ambiguous edits instead of choosing first', () => {
  const c = fixture();
  plotRows(c, 'history').push(clonePlot(plotRows(c, 'history')[0]));
  assert.equal(plotRowEditable(c, 'history', 'fact_a'), false);
  assert.throws(() => patchPlotField(c, 'history', 'fact_a', ['text'], 'x'));
  assert.equal(plotChoices(c, 'history').length, 0);
});
test('new identifiers avoid keys reserved in unknown extensions or dangling references', () => {
  const c = fixture();
  c.extensions = [{ future: { nodeKey: 'node_1', factKeys: ['fact_1'], stageKey: 'stage_1' } }];
  for (const [section, key] of [
    ['history', 'fact_2'],
    ['stages', 'stage_2'],
    ['candidates', 'node_2'],
  ] as const) {
    const n = addPlotRow(c, section);
    assert.equal(plotRecord(plotRows(n, section).at(-1)).key, key);
  }
});
test('new items are honest incomplete private drafts with no invented facts or timestamps', () => {
  const c = fixture();
  const n = addPlotRow(c, 'history');
  const last = plotRecord(plotRows(n, 'history').at(-1));
  assert.equal(last.text, '');
  assert.equal(last.occurredAt, '');
  assert.deepEqual(last.visibility, { kind: 'player' });
  assert.ok(PublisherDraftContentSchema.safeParse(n).success);
  assert.equal(PublishedWorldContentSchema.safeParse(n).success, false);
});
test('adding a stage does not migrate or rewrite old node timelines', () => {
  const c = fixture(),
    before = clonePlot(c.candidates),
    n = addPlotRow(c, 'stages');
  assert.deepEqual(n.candidates, before);
  assert.equal(plotRecord(n.timeline).initialStageKey, 'stage_a');
});
test('first stage creates precisely initialStageKey and stages but leaves old candidates untouched', () => {
  const c = fixture();
  delete c.timeline;
  const n = addPlotRow(c, 'stages');
  assert.equal(plotRecord(n.timeline).initialStageKey, 'stage_1');
  assert.equal(plotRows(n, 'stages').length, 1);
  assert.deepEqual(n.candidates, c.candidates);
});
test('node timeline is created with exact required resolution and alternative fields', () => {
  const c = fixture();
  delete plotRecord(plotRows(c, 'candidates')[0]).timeline;
  const n = patchPlotField(c, 'candidates', 'node_a', ['timeline', 'stageKey'], 'stage_a');
  assert.deepEqual(plotRecord(plotRows(n, 'candidates')[0]).timeline, {
    stageKey: 'stage_a',
    excludeIfResolved: [],
    alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
  });
  assert.ok(PublishedWorldContentSchema.safeParse(n).success);
});
test('all five prerequisite structures and three intents match the actual strict contract', () => {
  let c = fixture();
  const variants = [
    { kind: 'history_fact', factKey: 'fact_a' },
    { kind: 'after_committed_node', nodeKey: 'node_a' },
    { kind: 'after_resolved_node', nodeKey: 'node_a', outcomes: ['declined', 'skipped'] },
    { kind: 'at_place', placeKey: 'home' },
    { kind: 'not_before', at: '2026-10-12T10:00:00Z' },
  ];
  for (const condition of variants) {
    c = patchPlotField(fixture(), 'candidates', 'node_b', ['prerequisites'], [condition]);
    assert.ok(PublishedWorldContentSchema.safeParse(c).success, JSON.stringify(condition));
  }
  for (const intent of [
    { kind: 'editorial_only' },
    { kind: 'offer_message', actorKey: 'bob', text: '另一种可能' },
    {
      kind: 'offer_invitation',
      actorKeys: ['bob'],
      placeKey: 'home',
      title: '到店里讨论',
      earliestAt: '2026-10-12T10:00:00Z',
    },
  ]) {
    c = patchPlotField(fixture(), 'candidates', 'node_b', ['intent'], intent);
    assert.ok(PublishedWorldContentSchema.safeParse(c).success, JSON.stringify(intent));
  }
});
test('windows and node resolution exclusions keep the actual nested shape', () => {
  let c = patchPlotField(fixture(), 'candidates', 'node_b', ['timeline', 'window'], {
    notBefore: '2026-10-12T09:00:00Z',
    expiresAt: '2026-10-13T09:00:00Z',
  });
  c = patchPlotField(
    c,
    'candidates',
    'node_b',
    ['timeline', 'excludeIfResolved'],
    [{ nodeKey: 'node_a', outcomes: ['committed'] }],
  );
  assert.ok(PublishedWorldContentSchema.safeParse(c).success);
});
test('fact deletion blocks known facts, authored notes, album anchors, prerequisites and future refs', () => {
  const c = fixture();
  plotRecord(c.phone).notes = [
    { key: 'note_a', title: '便签', text: '原话', factKeys: ['fact_a'] },
  ];
  c.extensions = [{ data: { historyFactKey: 'fact_a' } }];
  const refs = plotDeletionReferences(c, 'history', 'fact_a');
  for (const wanted of [
    'protagonist.knownFactKeys',
    'initialKnowledge.0.factKeys',
    'phone.notes.0.factKeys',
    'candidates.0.prerequisites.0.factKey',
    'extensions.0.data.historyFactKey',
  ])
    assert.ok(refs.includes(wanted), wanted);
  const before = clonePlot(c);
  assert.throws(() => deletePlotRow(c, 'history', 'fact_a'), { code: 'REFERENCED' });
  assert.deepEqual(c, before);
});
test('stage deletion blocks initial selection, later-stage prerequisites and node stage', () => {
  const c = fixture();
  const refs = plotDeletionReferences(c, 'stages', 'stage_a');
  for (const p of [
    'timeline.initialStageKey',
    'timeline.stages.1.afterStageKeys',
    'candidates.0.timeline.stageKey',
  ])
    assert.ok(refs.includes(p));
  assert.throws(() => deletePlotRow(c, 'stages', 'stage_a'));
});
test('node deletion blocks resolution prerequisites, mutual exclusion and all alternative outcomes', () => {
  const c = fixture();
  const a = plotRecord(plotRows(c, 'candidates')[0]),
    b = plotRecord(plotRows(c, 'candidates')[1]);
  a.mutuallyExclusiveNodeKeys = ['node_b'];
  plotRecord(a.timeline).alternatives = {
    onDeclined: ['node_b'],
    onSkipped: ['node_b'],
    onExpired: ['node_b'],
  };
  assert.equal(plotDeletionReferences(c, 'candidates', 'node_b').length, 4);
  assert.throws(() => deletePlotRow(c, 'candidates', 'node_b'));
  assert.ok(
    plotDeletionReferences(c, 'candidates', 'node_a').includes(
      'candidates.1.prerequisites.0.nodeKey',
    ),
  );
  b.title = '保留';
});
test('deleting an unreferenced node changes only the selected collection row', () => {
  let c = addPlotRow(fixture(), 'candidates');
  const n = deletePlotRow(c, 'candidates', 'node_1');
  assert.deepEqual(n, fixture());
  assert.equal(plotRows(c, 'candidates').length, 3);
});
test('malformed collections and nested branches are never silently replaced with defaults', () => {
  const c = fixture();
  c.timeline = '未知原稿';
  assert.equal(plotCollectionEditable(c, 'stages'), false);
  assert.throws(() => addPlotRow(c, 'stages'));
  plotRecord(plotRows(c, 'candidates')[0]).timeline = '未来原文';
  assert.throws(() => patchPlotField(c, 'candidates', 'node_a', ['timeline', 'stageKey'], 'x'));
  assert.equal(plotRecord(plotRows(c, 'candidates')[0]).timeline, '未来原文');
});
test('optional removals are explicit and leave unrelated content or absent parents alone', () => {
  let c = fixture();
  const original = clonePlot(c);
  c = removePlotField(c, 'candidates', 'node_a', ['timeline', 'window']);
  assert.deepEqual(c, original);
  delete plotRecord(plotRows(c, 'candidates')[0]).timeline;
  const n = removePlotField(c, 'candidates', 'node_a', ['timeline', 'window']);
  assert.deepEqual(n, c);
});
test('row limits reject overflow without mutating the draft', () => {
  for (const [section, limit] of [
    ['history', 64],
    ['stages', 16],
    ['candidates', 32],
  ] as const) {
    const c = fixture();
    const values = Array.from({ length: limit }, (_, i) => ({ key: `item_${i}` }));
    if (section === 'stages') plotRecord(c.timeline).stages = values;
    else c[section] = values;
    assert.throws(() => addPlotRow(c, section), { code: 'ROW_LIMIT' });
    assert.equal(plotRows(c, section).length, limit);
  }
});
test('same-name actors stay distinguishable by stable identifiers', () => {
  const options = plotChoices(fixture(), 'actors');
  assert.deepEqual(
    options.map((o) => o.key),
    ['alice', 'bob'],
  );
  assert.equal(options[0]!.label, options[1]!.label);
});
test('initial stage changes never rewrite histories, node stages or window bounds', () => {
  const c = fixture();
  const n = setPlotInitialStage(c, 'stage_b');
  const expected = clonePlot(c);
  plotRecord(expected.timeline).initialStageKey = 'stage_b';
  assert.deepEqual(n, expected);
  assert.throws(() => setPlotInitialStage(c, 'missing'));
});
test('future history warns even when unrelated metadata is incomplete', () => {
  let c = patchPlotField(fixture(), 'history', 'fact_a', ['occurredAt'], '2026-10-13T09:00:00Z');
  plotRecord(c.work).title = '';
  assert.ok(plotIssues(c).some((v) => v.includes('事实时间晚于')));
});
test('actual contract reports reversed windows and stage dependencies rather than ready status', () => {
  let c = patchPlotField(fixture(), 'stages', 'stage_b', ['window'], {
    notBefore: '2026-10-13T09:00:00Z',
    expiresAt: '2026-10-12T09:00:00Z',
  });
  assert.equal(PublishedWorldContentSchema.safeParse(c).success, false);
  assert.ok(plotIssues(c).length);
  c = patchPlotField(fixture(), 'stages', 'stage_a', ['afterStageKeys'], ['stage_b']);
  assert.equal(PublishedWorldContentSchema.safeParse(c).success, false);
});
test('safe cloning does not turn a JSON __proto__ key into inherited application properties', () => {
  const raw = JSON.parse(
    '{"extensions":{"__proto__":{"leak":true},"constructor":{"text":"original"}}}',
  );
  const n = clonePlot(raw);
  assert.ok(Object.hasOwn(n.extensions, '__proto__'));
  assert.equal(({} as PlotRecord).leak, undefined);
  assert.deepEqual(n, raw);
});
