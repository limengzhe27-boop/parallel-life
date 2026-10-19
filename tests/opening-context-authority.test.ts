import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readOpeningContextAuthority,
  commitOpeningContextInTransaction,
} from '../src/modules/world/infrastructure/opening-context-repository.ts';
import { agentDefinitionRef } from '../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import type { SqlClient } from '../src/modules/storage/infrastructure/postgres.ts';
import type { AuthoredEligibilityView } from '../src/modules/world/infrastructure/authored-event-eligibility-repository.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';
const at = '2026-10-20T08:00:00.000Z';
function fixture() {
  const world = {
    id: 'world',
    ownerId: 'owner',
    version: 4,
    time: at,
    actors: [{ id: 'actor', name: 'A', persona: 'fictional' }],
  } as WorldState;
  const view = {
    catalog: {
      world: { worldId: 'world', engineEpoch: 2, worldVersion: 4 },
      source: { sourceHash: 'b'.repeat(64) },
      materials: [
        {
          role: 'opening',
          ref: { nodeKey: 'opening', nodeHash: 'a'.repeat(64) },
          unresolvedRefs: [],
          participantRefs: [{ status: 'resolved', actorId: 'actor' }],
          node: {
            title: 'Opening',
            script: 'The shop is closed today; its keeper received this information.',
            editorialIntent: 'unused',
          },
        },
      ],
    },
    eligibility: [{ ref: { nodeKey: 'opening', nodeHash: 'a'.repeat(64) }, status: 'eligible' }],
    occupiedEventKeys: ['opening'],
  } as unknown as AuthoredEligibilityView;
  let reviewed = false,
    prior: any[] = [];
  const sql = {
    query: async (q: string) => {
      if (q.includes('SELECT w.state'))
        return {
          rows: [
            {
              state: world,
              version: world.version,
              engine_epoch: 2,
              initial_state: { ...world, version: 0 },
              initial_hash: 'initial',
              genesis_hash: 'initial',
              admission_epoch: 2,
            },
          ],
        };
      if (q.includes('opening_context_reviews')) return { rows: [], rowCount: reviewed ? 1 : 0 };
      if (q.includes('director_runtime_attempts')) return { rows: prior };
      if (q.includes('actor_agent_states'))
        return {
          rows: [
            {
              actor_id: 'actor',
              document: {
                worldId: 'world',
                actorId: 'actor',
                definitionRef: agentDefinitionRef(world, 'actor'),
              },
            },
          ],
        };
      if (q.includes('publication_actor_life_modules'))
        return {
          rows: [
            {
              actor_id: 'actor',
              modules: {
                lifeContext: 'Keeper of the shop; receives notices about its opening hours.',
              },
            },
          ],
        };
      throw Error('Unexpected query ' + q);
    },
  } as unknown as SqlClient;
  return {
    world,
    view,
    sql,
    setReviewed: () => (reviewed = true),
    setPrior: (v: any[]) => (prior = v),
  };
}
test('eligible occupied opening retains one source-bound authority and only exact own modules', async () => {
  const f = fixture();
  const a = await readOpeningContextAuthority(
    f.sql,
    'owner',
    { worldId: 'world', engineEpoch: 2, worldVersion: 4 },
    { view: f.view },
  );
  assert.ok(a);
  assert.equal(a.nodeKey, 'opening');
  assert.equal(a.sourceField, 'script');
  assert.equal(a.initialAt, at);
  assert.equal(a.actorKnowledge.length, 1);
  assert.equal(a.actorKnowledge[0]!.actorId, 'actor');
  assert.match(a.actorKnowledge[0]!.definitionSourceId, /^definition:/);
  assert.ok(a.actorKnowledge[0]!.modules.lifeContext!.length <= 900);
  f.world.version = 5;
  f.view.catalog.world.worldVersion = 5;
  const b = await readOpeningContextAuthority(
    f.sql,
    'owner',
    { worldId: 'world', engineEpoch: 2, worldVersion: 5 },
    { view: f.view },
  );
  assert.equal(b?.reviewKey, a.reviewKey, 'world revision is not a new paid grant');
});
test('terminal/blocked and already paid opening authority do not create replacement grants', async () => {
  const f = fixture();
  const input = { worldId: 'world', engineEpoch: 2, worldVersion: 4 };
  f.view.eligibility[0]!.status = 'blocked';
  assert.equal(
    await readOpeningContextAuthority(f.sql, 'owner', input, { view: f.view }),
    undefined,
  );
  f.view.eligibility[0]!.status = 'eligible';
  f.setPrior([
    {
      status: 'unknown_after_send',
      sent_at: at,
      response: null,
      response_hash: null,
      decision_id: null,
    },
  ]);
  assert.equal(
    await readOpeningContextAuthority(f.sql, 'owner', input, { view: f.view }),
    undefined,
  );
  f.setPrior([]);
  f.setReviewed();
  assert.equal(
    await readOpeningContextAuthority(f.sql, 'owner', input, { view: f.view }),
    undefined,
  );
});
test('protected legacy decisions without review neither read nor write new authority', async () => {
  const db = {
    query: async () => {
      throw Error('No legacy side effects');
    },
  } as unknown as SqlClient;
  assert.deepEqual(
    await commitOpeningContextInTransaction(db, 'owner', {
      world: {} as any,
      attempt: {} as any,
      snapshot: {} as any,
      decision: {} as any,
    }),
    { changed: false },
  );
});
