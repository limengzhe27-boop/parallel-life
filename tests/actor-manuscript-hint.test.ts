import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  compileAuthoredAgentMaterials,
  type AuthoredAgentMaterial,
  type AuthoredMaterialNode,
  type AuthoredMaterialSourceDocument,
} from '../src/modules/world/domain/authored-agent-material.ts';
import {
  ACTOR_MANUSCRIPT_HINT_PROTOCOL,
  projectActorManuscriptHint,
  type ManuscriptHintIdentity,
} from '../src/modules/world/domain/actor-manuscript-hint.ts';

const header = ':::人物演绎提示';
const actorA = 'actor-a';
const actorB = 'actor-b';
const identities = [
  { id: actorA, name: '青青' },
  { id: actorB, name: '小林' },
];
const block = (lines = ['青青：请考虑邀请主角一起看书。', '小林：可考虑先问问近况。']) =>
  [header, ...lines, ':::', '全局正文：导演秘密、他人私聊和未来结果。'].join('\n');

function material(body = block()): AuthoredAgentMaterial {
  const source: AuthoredMaterialSourceDocument = {
    origin: { workId: 'work', publicationVersion: 4, draftVersion: 8, contentHash: 'a'.repeat(64) },
    openingEventKey: 'opening',
    timeline: null,
    actorKeys: ['author-a', 'author-b'],
    contacts: [
      { actorKey: 'author-a', actorId: actorA },
      { actorKey: 'author-b', actorId: actorB },
    ],
    initialActorIds: [actorA, actorB],
    initialPlaceKeys: [],
    places: [],
    history: [],
    nodes: [
      {
        key: 'opening',
        kind: 'candidate',
        title: '秘密标题',
        script: body,
        editorialIntent: '全局导演动机',
        sceneText: '未发生的真实结果不可下传',
        actorKeys: ['author-a', 'author-b'],
        prerequisites: [],
        mutuallyExclusiveNodeKeys: [],
        intent: { kind: 'editorial_only' },
      },
    ],
  };
  return compileAuthoredAgentMaterials(
    {
      scope: { worldId: 'world', engineEpoch: 2, worldVersion: 9 },
      source,
      actualActorIds: [actorA, actorB],
      actualPlaceIds: [],
    },
    (json) => createHash('sha256').update(json).digest('hex'),
  ).materials[0]!;
}

function project(
  input: AuthoredAgentMaterial,
  actorId = actorA,
  initial: readonly ManuscriptHintIdentity[] = identities,
  current: readonly ManuscriptHintIdentity[] = identities,
) {
  return projectActorManuscriptHint(input, actorId, initial, current);
}

function assertDenied(input: AuthoredAgentMaterial) {
  for (const id of [actorA, actorB]) assert.equal(project(input, id), null, id);
}

test('a real compiled manuscript projects only the explicitly addressed future suggestion', () => {
  const input = material();
  assert.equal(input.participantRefs[0]!.status, 'resolved');
  const text = '请考虑邀请主角一起看书。';
  const start = input.node.script!.indexOf(text);
  assert.deepEqual(project(input), {
    directive: { kind: 'task_suggestion', text },
    provenance: {
      protocol: ACTOR_MANUSCRIPT_HINT_PROTOCOL,
      field: 'script',
      start,
      end: start + text.length,
    },
  });
  assert.equal(project(input, actorB)!.directive.text, '可考虑先问问近况。');
  assert.equal(project(input, 'outsider'), null);
});

for (const kind of ['editorial_only', 'director_event'] as const)
  test(`${kind} permits an explicit block without requiring a fictional action`, () => {
    const input = material();
    input.node.intent = { kind };
    assert.equal(project(input)!.directive.kind, 'task_suggestion');
  });

test('an unaddressed participant receives no other actor hint', () => {
  const input = material(block(['青青：请考虑独立决定。']));
  assert.equal(project(input, actorB), null);
  assert.equal(project(input)!.directive.text, '请考虑独立决定。');
});

test('CRLF, leading blank lines and non-BMP text retain exact original UTF-16 offsets', () => {
  const textA = '  请考虑发一句🙂问候。  ';
  const textB = '可以先等等🪷。';
  const body = `\r\n \t\r\n${header}\r\n青青：${textA}\r\n\r\n小林:${textB}\r\n:::\r\n全局私密`;
  const input = material(body);
  for (const [id, text] of [
    [actorA, textA],
    [actorB, textB],
  ]) {
    const result = project(input, id)!;
    assert.deepEqual(result.directive, { kind: 'task_suggestion', text });
    assert.equal(result.provenance.start, body.indexOf(text!));
    assert.equal(result.provenance.end, body.indexOf(text!) + text!.length);
    assert.equal(body.slice(result.provenance.start, result.provenance.end), text);
    assert.equal(body[result.provenance.end], '\r');
  }
});

for (const prefix of [
  '```text\n',
  '> ',
  '- ',
  '1. ',
  '<div>\n',
  '<!-- 示例 -->\n',
  '正文\n',
  '\uFEFF',
  '    ',
])
  test(`a preceding ${JSON.stringify(prefix)} cannot authorize a later marker`, () => {
    assertDenied(material(prefix + block()));
  });

for (const marker of [
  ` ${header}`,
  `${header} `,
  `\t${header}`,
  `${header}\t`,
  `${header} 示例`,
  ':::人物演绎提示：',
])
  test(`the opening marker ${JSON.stringify(marker)} is never trimmed or approximated`, () => {
    assertDenied(material(block().replace(header, marker)));
  });

for (const close of [' :::', '::: ', '\t:::', '::::', '::: 结束'])
  test(`the closing marker ${JSON.stringify(close)} is not accepted`, () => {
    assertDenied(material(`${header}\n青青：请考虑问候。\n${close}`));
  });

test('missing closure rejects an otherwise valid first directive', () => {
  assertDenied(material(`${header}\n青青：请考虑问候。`));
});

test('a later closed block cannot rescue an invalid or absent first block', () => {
  assertDenied(material(`无授权的正文\n${block()}`));
  assertDenied(material(`${header}\n青青：有效建议\n损坏行\n${block()}`));
});

for (const damaged of [
  '无标签续行',
  '未知：未知角色',
  '小林：   ',
  '青青：重复提示',
  '> 小林：引用',
  '- 小林：列表',
  '<小林>：HTML',
  ' 小林：前置空格',
  '小林 ：尾随空格',
])
  test(`a malformed later line ${JSON.stringify(damaged)} rejects the entire block`, () => {
    assertDenied(material(block(['青青：原本有效的建议', damaged])));
  });

test('blank lines inside the closed block do not become hints or global text', () => {
  const input = material(block(['', '\t ', '青青：有效建议', '']));
  assert.equal(project(input)!.directive.text, '有效建议');
  assert.equal(project(input, actorB), null);
});

test('nothing after the first exact close is parsed or appended', () => {
  const input = material(
    `${header}\n青青：有效建议\n:::\n未知：幕后秘密\n${header}\n小林：其他段\n:::`,
  );
  assert.equal(project(input)!.directive.text, '有效建议');
  assert.equal(project(input, actorB), null);
});

test('script is the sole selected visible body even when editorialIntent has a valid block', () => {
  const input = material('普通剧本，没有授权标记');
  input.node.editorialIntent = block();
  assertDenied(input);
});

for (const script of [undefined, '', ' \t\r\n'])
  test(`an absent or blank script ${JSON.stringify(script)} selects editorialIntent`, () => {
    const input = material();
    input.node.script = script;
    input.node.editorialIntent = `\n${block()}`;
    const result = project(input)!;
    assert.equal(result.provenance.field, 'editorialIntent');
    assert.equal(
      input.node.editorialIntent.slice(result.provenance.start, result.provenance.end),
      result.directive.text,
    );
  });

for (const intent of [
  { kind: 'offer_message', actorKey: 'author-a', text: '既有消息路径' },
  {
    kind: 'offer_invitation',
    actorKeys: ['author-a'],
    placeKey: 'cafe',
    title: '既有邀请路径',
    earliestAt: '2040-01-01T00:00:00Z',
  },
] satisfies AuthoredMaterialNode['intent'][])
  test(`${intent.kind} never reads or overrides a typed intent with script hints`, () => {
    const input = material();
    input.node.intent = intent;
    Object.defineProperty(input.node, 'script', {
      get() {
        throw Error('typed script must not be read');
      },
    });
    Object.defineProperty(input.node, 'editorialIntent', {
      get() {
        throw Error('typed editorial must not be read');
      },
    });
    assertDenied(input);
  });

for (const variant of [
  'opening_duplicate_name',
  'opening_duplicate_id',
  'opening_missing',
  'current_renamed',
  'current_duplicate_name',
  'current_duplicate_id',
  'current_missing',
  'swapped_names',
] as const)
  test(`immutable identity ${variant} rejects the entire block`, () => {
    const initial = structuredClone(identities);
    const current = structuredClone(identities);
    if (variant === 'opening_duplicate_name') initial.push({ id: 'other', name: '小林' });
    if (variant === 'opening_duplicate_id') initial.push({ id: actorB, name: '别名' });
    if (variant === 'opening_missing') initial.pop();
    if (variant === 'current_renamed') current[1]!.name = '小林新名';
    if (variant === 'current_duplicate_name') current.push({ id: 'other', name: '小林' });
    if (variant === 'current_duplicate_id') current.push({ id: actorB, name: '别名' });
    if (variant === 'current_missing') current.pop();
    if (variant === 'swapped_names')
      [current[0]!.name, current[1]!.name] = [current[1]!.name, current[0]!.name];
    for (const id of [actorA, actorB])
      assert.equal(project(material(), id, initial, current), null);
  });

for (const variant of [
  'missing_ref',
  'wrong_actor',
  'unresolved',
  'duplicate_ref',
  'duplicate_key',
  'outside_node',
  'duplicate_node_key',
] as const)
  test(`participant authority ${variant} cannot yield even an earlier valid hint`, () => {
    const input = material();
    if (variant === 'missing_ref') input.participantRefs.pop();
    if (variant === 'wrong_actor') input.participantRefs[1]!.actorId = 'other';
    if (variant === 'unresolved') input.participantRefs[1]!.status = 'not_in_world';
    if (variant === 'duplicate_ref') input.participantRefs.push({ ...input.participantRefs[1]! });
    if (variant === 'duplicate_key')
      input.participantRefs.push({ ...input.participantRefs[1]!, actorId: 'other' });
    if (variant === 'outside_node') input.node.actorKeys.pop();
    if (variant === 'duplicate_node_key') input.node.actorKeys.push('author-b');
    assertDenied(input);
  });

test('names containing separator or Markdown-control syntax cannot be used as routes', () => {
  for (const name of [
    '青：青',
    '青:青',
    '>青青',
    '#青青',
    '`青青',
    '~青青',
    '+青青',
    '-青青',
    '<青青>',
    '青\t青',
    '青'.repeat(121),
  ]) {
    const actors = [{ id: actorA, name }];
    assert.equal(project(material(block([`${name}：提示`])), actorA, actors, actors), null, name);
  }
});

test('per-person 2000-character bound is exact and never truncates an oversized later actor', () => {
  const text = '文'.repeat(2000);
  assert.equal(project(material(block([`青青：${text}`])))!.directive.text, text);
  assertDenied(material(block(['青青：先前有效', `小林：${text}越界`])));
});

test('12000 total characters are permitted, and 12001 rejects every earlier hint', () => {
  const input = material();
  const actors = Array.from({ length: 7 }, (_, i) => ({ id: `actor-${i}`, name: `人物${i}` }));
  input.node.actorKeys = actors.map((a) => a.id);
  input.participantRefs = actors.map((a) => ({
    actorKey: a.id,
    actorId: a.id,
    status: 'resolved',
  }));
  input.node.script = block(actors.slice(0, 6).map((a) => `${a.name}：${'文'.repeat(2000)}`));
  assert.equal(project(input, actors[0]!.id, actors, actors)!.directive.text.length, 2000);
  input.node.script = input.node.script.replace('\n:::', `\n${actors[6]!.name}：文\n:::`);
  for (const actor of actors) assert.equal(project(input, actor.id, actors, actors), null);
});

test('identity and full-body safety bounds reject instead of returning a partial result', () => {
  const extra = Array.from({ length: 63 }, (_, i) => ({ id: `extra-${i}`, name: `额外${i}` }));
  assert.equal(project(material(), actorA, [...identities, ...extra], identities), null);
  assert.equal(project(material(), actorA, identities, [...identities, ...extra]), null);
  const input = material();
  const prefix = `${header}\n青青：有效建议\n:::\n`;
  input.node.script = prefix + '文'.repeat(65536 - prefix.length);
  assert.equal(project(input)!.directive.text, '有效建议');
  input.node.script += '文';
  assertDenied(input);
});

test('the author text is a raw future suggestion, never promoted to facts or execution authority', () => {
  const text = '主角已同意，事件已发生；请去尚未开放的秘密地点。';
  const input = material(block([`青青：${text}`]));
  Object.assign(input, { directorAudit: '幕后审计', privateTranscript: ['他人私聊'] });
  Object.assign(input.node, { secret: '额外元数据', arrived: true, completed: true });
  const result = project(input)!;
  assert.deepEqual(result.directive, { kind: 'task_suggestion', text });
  assert.deepEqual(Object.keys(result).sort(), ['directive', 'provenance']);
  assert.deepEqual(Object.keys(result.directive).sort(), ['kind', 'text']);
  assert.deepEqual(Object.keys(result.provenance).sort(), ['end', 'field', 'protocol', 'start']);
  for (const secret of [
    '秘密标题',
    '全局导演动机',
    '未发生的真实结果',
    '幕后审计',
    '他人私聊',
    '额外元数据',
  ])
    assert.equal(JSON.stringify(result).includes(secret), false, secret);
});

test('projection never mutates input and returns independently detached directive/provenance objects', () => {
  const input = material();
  const initial = structuredClone(identities);
  const current = structuredClone(identities);
  const before = structuredClone({ input, initial, current });
  const first = project(input, actorA, initial, current)!;
  const second = project(input, actorA, initial, current)!;
  assert.notEqual(first, second);
  assert.notEqual(first.directive, second.directive);
  assert.notEqual(first.provenance, second.provenance);
  assert.deepEqual(first, second);
  first.directive.text = 'caller mutation';
  first.provenance.start = -1;
  assert.deepEqual({ input, initial, current }, before);
  assert.deepEqual(project(input, actorA, initial, current), second);
  input.node.script = 'source mutation';
  initial[0]!.name = 'identity mutation';
  assert.equal(second.directive.text, '请考虑邀请主角一起看书。');
});

test('an empty authorized section and an unmarked manuscript add no unsolicited default', () => {
  assertDenied(material(`${header}\n\n:::`));
  assertDenied(material('青青：参与名单本身不能授权这行。'));
  assertDenied(material(''));
});

test('an exact close at EOF needs no final newline and includes neither delimiter nor name', () => {
  const text = '  原样保留:文本中的冒号：并非新目标  ';
  const body = `${header}\n青青:${text}\n:::`;
  const result = project(material(body))!;
  assert.equal(result.directive.text, text);
  assert.equal(body.slice(result.provenance.start, result.provenance.end), text);
  assert.equal(result.provenance.end, body.indexOf('\n:::'));
});

test('deeply frozen material and identity inputs remain usable', () => {
  function freeze(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  const input = material();
  const initial = structuredClone(identities);
  const current = structuredClone(identities);
  freeze(input);
  freeze(initial);
  freeze(current);
  assert.equal(
    project(input, actorA, initial, current)!.directive.text,
    '请考虑邀请主角一起看书。',
  );
});
