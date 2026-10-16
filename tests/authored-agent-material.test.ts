import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  compileAuthoredAgentMaterials,
  authoredMaterialCanonicalJson,
  type AuthoredMaterialSourceDocument,
} from '../src/modules/world/domain/authored-agent-material.ts';
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
function source(): AuthoredMaterialSourceDocument {
  return {
    origin: { workId: 'work', publicationVersion: 1, draftVersion: 7, contentHash: 'a'.repeat(64) },
    openingEventKey: 'start',
    timeline: null,
    conditions: [],
    actorKeys: ['a', 'b'],
    contacts: [
      { actorKey: 'a', actorId: 'actual-A' },
      { actorKey: 'b', actorId: 'actual-B' },
    ],
    initialActorIds: ['actual-A', 'actual-B'],
    initialPlaceKeys: ['home'],
    places: [
      { key: 'home', name: '家' },
      { key: 'hidden', name: '隐藏地点' },
    ],
    history: [{ key: 'prior' }],
    nodes: [
      {
        key: 'start',
        kind: 'candidate',
        title: ' 开场标题 ',
        editorialIntent: '编导原意\n保留全部。',
        script: '  第一行\n第二行\t「原文」  ',
        sceneText: '场景原文',
        scenePlaceKeys: ['home', 'hidden'],
        actorKeys: ['a', 'b'],
        settingPlaceKey: 'hidden',
        placeKey: 'home',
        conditionKeys: [],
        prerequisites: [],
        mutuallyExclusiveNodeKeys: [],
        intent: { kind: 'director_event' },
        direction: {
          mode: 'optional',
          expectedImpact: '这是预期，不是结果',
          experience: '体验原文',
          progress: {
            pace: 'extended',
            refusal: 'defer',
            completion: {
              mode: 'all',
              criteria: [
                { key: 'line', kind: 'npc_exact_message', actorKey: 'b', phrase: '自然形成' },
              ],
            },
          },
        },
      },
    ],
  };
}
const compile = (s: AuthoredMaterialSourceDocument | null) =>
  compileAuthoredAgentMaterials(
    {
      scope: { worldId: 'world', engineEpoch: 2, worldVersion: 0 },
      source: s,
      actualActorIds: ['actual-A', 'actual-B'],
      actualPlaceIds: ['home'],
    },
    digest,
  );
test('author text and optional prerequisites are unchanged, all material is director-only and participants are not knowledge grants', () => {
  const raw = source(),
    result = compile(raw),
    m = result.materials[0]!;
  assert.equal(result.scope, 'director_only');
  assert.deepEqual(m.node, raw.nodes[0]);
  assert.deepEqual(m.node.prerequisites, []);
  assert.equal(m.role, 'opening');
  assert.deepEqual(
    m.participantRefs.map((a) => a.actorId),
    ['actual-A', 'actual-B'],
  );
  assert.equal('knownByActorIds' in m, false);
  assert.equal('actorId' in m, false);
  assert.equal(m.placeRefs.find((p) => p.placeKey === 'hidden')!.availableInWorld, false);
  assert.equal(m.placeRefs.find((p) => p.placeKey === 'hidden')!.status, 'resolved');
  raw.nodes[0]!.script = 'later caller mutation';
  assert.notEqual(m.node.script, raw.nodes[0]!.script);
});
test('no source is an explicit empty directory', () => {
  const c = compile(null);
  assert.equal(c.source, null);
  assert.deepEqual(c.materials, []);
  assert.deepEqual(c.unresolvedRefs, []);
});
for (const count of [0, 1, 9, 32])
  test(`actual variable author material count ${count}, no fixed story or people count`, () => {
    const s = source(),
      base = s.nodes[0]!;
    s.nodes = Array.from({ length: count }, (_, i) => ({
      ...structuredClone(base),
      key: 'node_' + i,
    }));
    delete s.openingEventKey;
    assert.equal(compile(s).materials.length, count);
  });
test('canonical material/source hash ignores JSONB object key ordering and retains array semantics', () => {
  const s = source();
  const reorder = (v: any): any =>
    Array.isArray(v)
      ? v.map(reorder)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .reverse()
              .map(([k, x]) => [k, reorder(x)]),
          )
        : v;
  assert.deepEqual(compile(s), compile(reorder(s)));
  const changed = source();
  changed.nodes[0]!.actorKeys.reverse();
  assert.notEqual(
    compile(s).materials[0]!.ref.nodeHash,
    compile(changed).materials[0]!.ref.nodeHash,
  );
});
test('title, script and editorial text independently affect immutable fingerprints', () => {
  const first = compile(source());
  for (const field of ['title', 'script', 'editorialIntent'] as const) {
    const s = source();
    s.nodes[0]![field] += ' changed';
    const result = compile(s);
    assert.notEqual(result.source!.sourceHash, first.source!.sourceHash);
    assert.notEqual(result.materials[0]!.ref.nodeHash, first.materials[0]!.ref.nodeHash);
  }
});
test('unknown actor is not assigned to a similarly named or first contact', () => {
  const s = source();
  s.nodes[0]!.actorKeys = ['unknown'];
  const c = compile(s),
    ref = c.materials[0]!.participantRefs.find((a) => a.actorKey === 'unknown')!;
  assert.equal(ref.actorId, null);
  assert.equal(ref.status, 'unknown_key');
  assert.ok(c.materials[0]!.unresolvedRefs.some((r) => r.kind === 'actor' && r.key === 'unknown'));
});
test('real author mapping missing from world is retained as unresolved, not silently authorized', () => {
  const s = source();
  s.contacts[0]!.actorId = 'other-A';
  s.initialActorIds.push('other-A');
  const m = compile(s).materials[0]!;
  assert.equal(m.participantRefs[0]!.actorId, 'other-A');
  assert.equal(m.participantRefs[0]!.status, 'not_in_world');
});
test('ambiguous contact keys and reused actor IDs have no guessed mapping', () => {
  for (const duplicateId of [false, true]) {
    const s = source();
    if (duplicateId) s.contacts[1]!.actorId = 'actual-A';
    else s.contacts.push({ actorKey: 'a', actorId: 'other-A' });
    const r = compile(s).materials[0]!.participantRefs[0]!;
    assert.equal(r.status, 'ambiguous');
    assert.equal(r.actorId, null);
  }
});
test('unknown places and unresolved author/node/condition/history references stay explicit', () => {
  const s = source();
  s.openingEventKey = 'missing_start';
  s.nodes[0]!.scenePlaceKeys!.push('missing_place');
  s.nodes[0]!.conditionKeys = ['missing_condition'];
  s.nodes[0]!.prerequisites = [
    { kind: 'history_fact', factKey: 'missing_fact' },
    { kind: 'after_presented_node', nodeKey: 'missing_node' },
  ];
  const c = compile(s),
    m = c.materials[0]!;
  assert.equal(m.placeRefs.find((p) => p.placeKey === 'missing_place')!.placeId, null);
  assert.ok(c.unresolvedRefs.some((r) => r.key === 'missing_start'));
  for (const k of ['missing_condition', 'missing_fact', 'missing_node'])
    assert.ok(m.unresolvedRefs.some((r) => r.key === k));
  assert.deepEqual(m.node.prerequisites, s.nodes[0]!.prerequisites);
});
test('shared conditions and full timeline are retained, unknown group references are not treated as satisfied', () => {
  const s = source();
  s.conditions = [
    {
      key: 'group',
      title: '可选条件组',
      match: 'any',
      prerequisites: [
        { kind: 'after_resolved_node', nodeKey: 'bad', outcomes: ['declined'] },
        { kind: 'not_before', at: '2026-10-15T08:00:00Z' },
      ],
    },
  ];
  s.timeline = {
    initialStageKey: 'phase',
    stages: [
      {
        key: 'phase',
        title: '阶段',
        order: 0,
        afterStageKeys: [],
        window: { notBefore: '2026-10-15T08:00:00Z', expiresAt: '2026-10-16T08:00:00Z' },
      },
    ],
  };
  const c = compile(s);
  assert.deepEqual(c.conditions, s.conditions);
  assert.deepEqual(c.timeline, s.timeline);
  assert.ok(c.unresolvedRefs.some((r) => r.key === 'bad'));
});
test('unsupported extra root, node, participant and nested private attributes are never passed through', () => {
  const s: any = source();
  s.privateInterview = { body: 'PRIVATE_ROOT_SENTINEL' };
  s.nodes[0].privateData = 'PRIVATE_NODE_SENTINEL';
  s.nodes[0].direction.privateSecret = 'PRIVATE_NESTED_SENTINEL';
  s.contacts[0].privateTranscript = 'PRIVATE_CONTACT_SENTINEL';
  const c = compile(s);
  assert.doesNotMatch(JSON.stringify(c), /PRIVATE_.*SENTINEL/);
  assert.deepEqual(c, compile(source()));
});
test('source version changes and source identity never alias another bound world', () => {
  const s = source(),
    c = compile(s);
  s.origin.draftVersion++;
  assert.notEqual(c.source!.sourceHash, compile(s).source!.sourceHash);
  const other = compileAuthoredAgentMaterials(
    {
      scope: { worldId: 'other', engineEpoch: 2, worldVersion: 0 },
      source: source(),
      actualActorIds: ['actual-A', 'actual-B'],
      actualPlaceIds: ['home'],
    },
    digest,
  );
  assert.notDeepEqual(c.materials[0]!.ref, other.materials[0]!.ref);
});
test('invalid epoch, source identity, malformed data and digest fail explicitly', () => {
  const s = source();
  s.origin.contentHash = 'not-a-hash';
  assert.throws(() => compile(s), { code: 'INVALID_AUTHORED_MATERIAL' });
  assert.throws(
    () =>
      compileAuthoredAgentMaterials(
        {
          scope: { worldId: 'world', engineEpoch: 1, worldVersion: 0 },
          source: null,
          actualActorIds: [],
          actualPlaceIds: [],
        },
        digest,
      ),
    { code: 'INVALID_AUTHORED_MATERIAL' },
  );
  assert.throws(
    () =>
      compileAuthoredAgentMaterials(
        {
          scope: { worldId: 'world', engineEpoch: 2, worldVersion: 0 },
          source: source(),
          actualActorIds: [],
          actualPlaceIds: [],
        },
        () => 'bad',
      ),
    { code: 'INVALID_AUTHORED_MATERIAL' },
  );
});
test('canonical JSON refuses cycles and non-JSON primitives instead of making misleading hashes', () => {
  const cyclic: any = {};
  cyclic.self = cyclic;
  for (const value of [cyclic, () => {}, NaN, new Date()])
    assert.throws(() => authoredMaterialCanonicalJson(value), {
      code: 'INVALID_AUTHORED_MATERIAL',
    });
});
