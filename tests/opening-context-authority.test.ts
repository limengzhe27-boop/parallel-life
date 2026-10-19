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
          placeRefs: [],
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
  let reviews: any[] = [],
    evidence: any[] = [];
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
      if (q.includes('opening_context_reviews'))
        return { rows: reviewed ? [{ disposition: 'confirm' }] : reviews };
      if (q.includes("r.document->>'kind' IN")) return { rows: evidence };
      if (q.includes('director_pending_reasons')) return { rows: [] };
      if (q.includes('director_runtime_attempts'))
        return {
          rows: q.includes('expected_world_version')
            ? prior.map((attempt) => ({ expected_world_version: 1, ...attempt }))
            : prior,
        };
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
    setReviews: (v: any[]) => (reviews = v),
    setEvidence: (v: any[]) => (evidence = v),
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

test('deferred information reopens only after authenticated participant plan changes, once per evidence', async () => {
  const f = fixture(),
    input = { worldId: 'world', engineEpoch: 2, worldVersion: 4 };
  const read = () => readOpeningContextAuthority(f.sql, 'owner', input, { view: f.view });
  const base = await read();
  assert.ok(base);
  f.setReviews([{ disposition: 'defer', review_key: base.reviewKey, world_version: 1 }]);
  assert.equal(await read(), undefined);
  const reason = {
    id: 'plan-new',
    kind: 'plan_changed',
    eventId: 'event-2',
    worldVersion: 2,
    ref: { kind: 'plan', actorId: 'actor', id: 'plan' },
  };
  const runtime = {
    stateAfter: {
      actorId: 'actor',
      worldId: 'world',
      projectedWorldVersion: 2,
      plans: [{ id: 'plan', status: 'active' }],
    },
  };
  const row = {
    id: reason.id,
    source_event_id: 'event-2',
    source_version: 2,
    document: reason,
    payload: {
      id: 'event-2',
      worldId: 'world',
      version: 2,
      type: 'agent.state_committed',
      data: { actorId: 'actor', agentRuntime: runtime },
    },
    previous_state: { actorId: 'actor', worldId: 'world', plans: [] },
  };
  f.setEvidence([row]);
  const reconsider = await read();
  assert.ok(reconsider);
  assert.notEqual(reconsider.reviewKey, base.reviewKey);
  f.world.version = 5;
  f.view.catalog.world.worldVersion = 5;
  input.worldVersion = 5;
  assert.equal(
    (await read())?.reviewKey,
    reconsider.reviewKey,
    'clock/revision is not new evidence',
  );
  f.setPrior([
    {
      status: 'unknown_after_send',
      sent_at: at,
      response: null,
      response_hash: null,
      decision_id: null,
    },
  ]);
  assert.equal(await read(), undefined, 'same paid unknown evidence cannot be rebought');
  f.setPrior([]);
  f.setReviews([
    { disposition: 'defer', review_key: base.reviewKey, world_version: 1 },
    { disposition: 'defer', review_key: reconsider.reviewKey, world_version: 4 },
  ]);
  assert.equal(await read(), undefined, 'same evidence already reviewed remains fenced');
  f.setReviews([{ disposition: 'confirm', review_key: base.reviewKey, world_version: 1 }]);
  assert.equal(await read(), undefined, 'confirmed information never replays');
});

test('same-transaction direction material reuse preserves authority and actor visibility', async () => {
  const f = fixture();
  const input = { worldId: 'world', engineEpoch: 2, worldVersion: 4 };
  const original = await readOpeningContextAuthority(f.sql, 'owner', input, { view: f.view });
  const read = f.sql.query.bind(f.sql);
  let duplicateModuleReads = 0;
  f.sql.query = (async (query: string, ...args: unknown[]) => {
    if (query.includes('publication_actor_life_modules')) duplicateModuleReads++;
    return (read as any)(query, ...args);
  }) as typeof f.sql.query;
  const reused = await readOpeningContextAuthority(f.sql, 'owner', input, {
    view: f.view,
    actorDirectionMaterials: [
      {
        actorId: 'actor',
        modules: { lifeContext: 'Keeper of the shop; receives notices about its opening hours.' },
      },
      { actorId: 'other', modules: { lifeContext: 'Private knowledge from another character.' } },
    ],
  });
  assert.deepEqual(reused, original);
  assert.equal(duplicateModuleReads, 0);
  f.world.version = 5;
  await assert.rejects(
    () =>
      readOpeningContextAuthority(f.sql, 'owner', input, {
        view: f.view,
        actorDirectionMaterials: [],
      }),
    { code: 'OPENING_CONTEXT_AUTHORITY_CONFLICT' },
  );
});
