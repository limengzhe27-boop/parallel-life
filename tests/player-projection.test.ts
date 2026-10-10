import { historyFixture } from './helpers/genesis-fixture.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { projectPlayerActors } from '../src/modules/world/domain/player-projection.ts';
import { actorContext } from '../src/modules/world/application/actor-context.ts';
import { WorldPlanner } from '../src/modules/world/infrastructure/world-planner.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';

const marker = 'PRIVATE_MOTIVE_UNREVEALED';
function fixture(): WorldState {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    ownerId: randomUUID(),
    version: 0,
    title: 'synthetic',
    time: new Date().toISOString(),
    actors: ['a', 'b', 'c'].map((name) => ({
      id: randomUUID(),
      name,
      persona: `${marker}:${name}`,
      relationship: marker,
    })),
    facts: [],
    messages: [],
    appointments: [],
    mediaRequests: [],
  };
}
test('only sourced contacts appear; their persona and private relationship never serialize', () => {
  const state = fixture();
  assert.deepEqual(projectPlayerActors(state, []), []);
  state.messages.push({
    id: randomUUID(),
    actorId: state.actors[0]!.id,
    role: 'assistant',
    text: 'hello',
    at: state.time,
    sourceEventId: `genesis:${state.id}`,
  });
  const phone = projectPlayerActors(state, []);
  assert.equal(phone.length, 1);
  assert.equal(phone[0]!.relationship, '');
  assert.ok(!JSON.stringify(phone).includes(marker));
  assert.ok(JSON.stringify(actorContext(state, state.actors[0]!.id)).includes(`${marker}:a`));
  assert.ok(!JSON.stringify(actorContext(state, state.actors[0]!.id)).includes(`${marker}:b`));
  assert.equal(projectPlayerActors(state, [], [state.actors[1]!.id]).length, 2);
});
test('selected source roles/photo are bound by actor ID and person ID, unaffected by cast order', () => {
  const state = fixture(),
    personId = randomUUID(),
    assetId = randomUUID();
  state.actors[1]!.sourcePersonId = personId;
  const selected = [
    {
      actorId: state.actors[1]!.id,
      personId,
      name: 'selected name',
      relationship: 'selected role',
      photo: { assetId, revision: 2 },
    },
  ];
  const result = projectPlayerActors(state, selected);
  state.actors.reverse();
  assert.deepEqual(projectPlayerActors(state, selected), result);
  assert.deepEqual(result[0]!.photo, { assetId, revision: 2 });
  assert.deepEqual(projectPlayerActors(state, [{ ...selected[0]!, personId: randomUUID() }]), []);
});
test('missing source messages and an unsourced appointment do not introduce actors', () => {
  const state = fixture();
  state.appointments.push({
    id: randomUUID(),
    title: 'not sourced',
    at: state.time,
    participantIds: [state.actors[2]!.id],
    sourceEventId: '',
  });
  assert.deepEqual(projectPlayerActors(state, []), []);
  state.appointments[0]!.sourceEventId = 'saved-but-legacy-ambiguous';
  assert.deepEqual(projectPlayerActors(state, []), []);
  state.appointments[0]!.status = 'proposed';
  assert.equal(projectPlayerActors(state, []).length, 1);
});
test('model self-reported playerActors are stripped, while internal personas are preserved', async () => {
  const seed = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    profileVersion: 0,
    discoveryVersion: 1,
    directionId: randomUUID(),
    story: { title: 'synthetic', premise: 'a workshop', opening: 'today', tradeoff: 'time' },
    facts: [],
    people: [],
    portraitAssetId: null,
    assets: [],
  };
  const opening = await new WorldPlanner({
    complete: async () =>
      JSON.stringify(
        historyFixture({
          identity: 'shop owner',
          setting: 'workshop',
          actors: ['a', 'b', 'c'].map((key) => ({
            key,
            name: key,
            relationship: marker,
            persona: marker,
          })),
          messages: [{ actorKey: 'a', text: 'hello' }],
          notes: [{ title: 'today', text: 'open shop' }],
          playerActors: [
            {
              actorId: randomUUID(),
              source: { kind: 'selected_person', personId: randomUUID() },
              relationship: marker,
            },
          ],
        }),
      ),
  }).propose(seed);
  assert.equal(opening.playerActors, undefined);
  assert.equal(opening.actors[0]!.persona, marker);
});
