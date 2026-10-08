import type { WorldOpening } from '../src/contracts/world-build.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ApprovedSeedSchema, SeedRequestSchema } from '../src/contracts/seeds.ts';
import { WorldPlanner } from '../src/modules/world/infrastructure/world-planner.ts';
const person = { id: randomUUID(), name: '李一', relationship: '老板', assetId: randomUUID() };
const seed = {
  id: randomUUID(),
  createdAt: new Date().toISOString(),
  profileVersion: 0,
  discoveryVersion: 1,
  directionId: randomUUID(),
  story: {
    title: '自己的工作室',
    premise: '成立工作室',
    opening: '准备开张',
    tradeoff: '需要招人',
  },
  facts: [],
  people: [person],
  personRoles: [{ personId: person.id, role: '我的下属，负责剪辑' }],
  portraitAssetId: null,
  assets: [{ assetId: person.assetId, revision: 1 }],
};
const opening: WorldOpening = {
  identity: '导演',
  setting: '杭州的工作室',
  actors: [
    {
      key: 'a',
      name: '模型另起的名字',
      relationship: '老板',
      persona: '认真负责',
      sourcePersonId: person.id,
    },
    ...['b', 'c'].map((key) => ({ key, name: key, relationship: '同事', persona: '在筹备拍摄' })),
  ],
  messages: [{ actorKey: 'a', text: '初剪发你了，你看一下？' }],
  notes: [{ title: '今天', text: '看初剪' }],
};
test('selected identities and branch roles are fixed without exposing images or changing reality', async () => {
  let sent = '';
  const result = await new WorldPlanner({
    async complete(messages) {
      sent = messages[1]!.content;
      return JSON.stringify(opening);
    },
  }).propose(ApprovedSeedSchema.parse(seed));
  assert.equal(result.actors[0]!.name, person.name);
  assert.equal(result.actors[0]!.relationship, seed.personRoles[0]!.role);
  assert.equal(person.relationship, '老板');
  assert.equal(sent.includes(person.assetId), false);
  assert.equal(sent.includes('assets'), false);
  assert.equal(JSON.parse(sent).people[0].realRelationship, '老板');
});
test('missing, repeated and foreign person mappings fail closed', async () => {
  for (const actors of [
    opening.actors.map(({ sourcePersonId, ...a }) => a),
    opening.actors.map((a, i) => (i === 1 ? { ...a, sourcePersonId: person.id } : a)),
    opening.actors.map((a, i) => (i === 0 ? { ...a, sourcePersonId: randomUUID() } : a)),
  ]) {
    await assert.rejects(
      new WorldPlanner({
        async complete() {
          return JSON.stringify({ ...opening, actors });
        },
      }).propose(ApprovedSeedSchema.parse(seed)),
      { code: 'INVALID_RESPONSE' },
    );
  }
});
test('roles can only reference selected people and cannot be repeated', () => {
  const request = {
    commandId: randomUUID(),
    discoveryVersion: 1,
    profileVersion: 0,
    directionId: seed.directionId,
    factIds: [],
    personIds: [person.id],
    includePortrait: false,
    personRoles: seed.personRoles,
  };
  assert.equal(SeedRequestSchema.safeParse(request).success, true);
  assert.equal(
    SeedRequestSchema.safeParse({
      ...request,
      personRoles: [{ personId: randomUUID(), role: '同事' }],
    }).success,
    false,
  );
  assert.equal(
    SeedRequestSchema.safeParse({
      ...request,
      personRoles: [...seed.personRoles, ...seed.personRoles],
    }).success,
    false,
  );
  assert.equal(
    SeedRequestSchema.safeParse({
      ...request,
      personIds: Array.from({ length: 9 }, () => randomUUID()),
      personRoles: [],
    }).success,
    false,
  );
});
test('legacy snapshots remain unmapped, no-photo and same-name people remain usable', async () => {
  const { personRoles, ...legacy } = seed;
  assert.equal('personRoles' in ApprovedSeedSchema.parse(legacy), false);
  await assert.rejects(
    new WorldPlanner({
      async complete() {
        return JSON.stringify(opening);
      },
    }).propose(ApprovedSeedSchema.parse(legacy)),
    { code: 'INVALID_RESPONSE' },
  );
  const second = { ...person, id: randomUUID(), assetId: null };
  const noImage = {
    ...seed,
    people: [{ ...person, assetId: null }, second],
    personRoles: [],
    assets: [],
  };
  const result = await new WorldPlanner({
    async complete() {
      return JSON.stringify({
        ...opening,
        actors: opening.actors.map((a, i) =>
          i === 1 ? { ...a, name: person.name, sourcePersonId: second.id } : a,
        ),
      });
    },
  }).propose(ApprovedSeedSchema.parse(noImage));
  assert.equal(result.actors[0]!.name, result.actors[1]!.name);
});
