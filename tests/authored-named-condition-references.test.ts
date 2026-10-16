import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  compileAuthoredAgentMaterials,
  type AuthoredMaterialSourceDocument,
} from '../src/modules/world/domain/authored-agent-material.ts';
test('named conditions retain certified place bindings and node-local unresolved references without changing authored text', () => {
  const source: AuthoredMaterialSourceDocument = {
    origin: { workId: 'work', publicationVersion: 1, draftVersion: 0, contentHash: 'a'.repeat(64) },
    actorKeys: ['a'],
    contacts: [{ actorKey: 'a', actorId: 'actor' }],
    initialActorIds: ['actor'],
    initialPlaceKeys: ['home'],
    places: [
      { key: 'home', name: '家' },
      { key: 'cafe', name: '咖啡馆' },
    ],
    history: [],
    timeline: null,
    conditions: [
      {
        key: 'visit',
        title: '已经到访',
        match: 'all',
        prerequisites: [{ kind: 'at_place', placeKey: 'cafe' }],
      },
    ],
    nodes: [
      {
        key: 'conversation',
        kind: 'candidate',
        title: '碰面后的交谈',
        editorialIntent: '未来机会，仍由各人物自行决定。',
        actorKeys: ['a'],
        conditionKeys: ['visit'],
        prerequisites: [],
        mutuallyExclusiveNodeKeys: [],
        intent: { kind: 'director_event' },
      },
    ],
  };
  const before = structuredClone(source);
  const compile = () =>
    compileAuthoredAgentMaterials(
      {
        scope: { worldId: 'w', engineEpoch: 2, worldVersion: 3 },
        source,
        actualActorIds: ['actor'],
        actualPlaceIds: ['home', 'cafe'],
      },
      (s) => createHash('sha256').update(s).digest('hex'),
    );
  const valid = compile().materials[0]!;
  assert.deepEqual(valid.placeRefs, [
    { placeKey: 'cafe', placeId: 'cafe', status: 'resolved', availableInWorld: true },
  ]);
  assert.deepEqual(valid.unresolvedRefs, []);
  assert.deepEqual(source, before);
  source.conditions![0]!.prerequisites.push({ kind: 'history_fact', factKey: 'not-authored' });
  assert.ok(
    compile().materials[0]!.unresolvedRefs.some(
      (r) => r.kind === 'history' && r.key === 'not-authored' && r.path.includes('.conditions.'),
    ),
  );
});
