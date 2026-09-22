import { randomUUID } from 'node:crypto';
import { BuildInputSchema } from '../../../contracts/world-build.ts';
import { ApprovedSeedSchema } from '../../../contracts/seeds.ts';
import type { TaskLease } from '../../tasks/domain/types.ts';
import type { PostgresTaskQueue } from '../../tasks/infrastructure/postgres-task-queue.ts';
import type { WorldState } from '../domain/types.ts';
import { WorldPlanner, WORLD_PROMPT_VERSION } from './world-planner.ts';
export function buildHandler(queue: PostgresTaskQueue, planner: WorldPlanner, model: string) {
  return async (lease: TaskLease, signal: AbortSignal) => {
    const input = BuildInputSchema.parse(lease.input),
      started = Date.now();
    if (input.seedId !== lease.scopeId) throw Error('INVALID_SCOPE');
    const seed = await queue.read(lease, async (sql) => {
      const row = (
        await sql.query(
          'SELECT s.document FROM parallel_life.approved_seeds s JOIN parallel_life.world_builds b ON b.seed_id=s.id WHERE s.id=$1 AND b.world_id=$2 AND b.opening IS NULL',
          [input.seedId, input.worldId],
        )
      ).rows[0];
      if (!row) throw Error('INVALID_BUILD');
      return ApprovedSeedSchema.parse(row.document);
    });
    const opening = await planner.propose(seed, signal),
      time = new Date().toISOString(),
      sourceEventId = `genesis:${input.worldId}`;
    const ids = new Map(opening.actors.map((a) => [a.key, randomUUID()]));
    const state: WorldState = {
      schemaVersion: 1,
      id: input.worldId,
      ownerId: lease.ownerId,
      version: 0,
      title: seed.story.title,
      time,
      actors: opening.actors.map((a) => ({
        id: ids.get(a.key)!,
        name: a.name,
        persona: a.persona,
      })),
      facts: [
        { id: randomUUID(), text: opening.identity, visibility: { kind: 'world' }, sourceEventId },
        { id: randomUUID(), text: opening.setting, visibility: { kind: 'world' }, sourceEventId },
      ],
      messages: opening.messages.map((m) => ({
        id: randomUUID(),
        actorId: ids.get(m.actorKey)!,
        role: 'assistant',
        text: m.text,
        at: time,
        sourceEventId,
      })),
      appointments: [],
      mediaRequests: [],
    };
    await queue.commit(lease, async (sql) => {
      const row = (
        await sql.query(
          'SELECT opening FROM parallel_life.world_builds WHERE seed_id=$1 AND world_id=$2 FOR UPDATE',
          [input.seedId, input.worldId],
        )
      ).rows[0];
      if (!row || row.opening) throw Error('INVALID_BUILD');
      await sql.query(
        'INSERT INTO parallel_life.worlds(id,owner_id,title,state) VALUES($1,$2,$3,$4)',
        [state.id, lease.ownerId, state.title, { ...state, messages: [] }],
      );
      await sql.query(
        'INSERT INTO parallel_life.world_initial_snapshots(world_id,owner_id,state,approved_seed) VALUES($1,$2,$3,$4)',
        [state.id, lease.ownerId, state, seed],
      );
      await sql.query('UPDATE parallel_life.world_builds SET opening=$2 WHERE seed_id=$1', [
        input.seedId,
        opening,
      ]);
      return {
        value: undefined,
        outcome: {
          status: 'succeeded',
          resultVersion: 0,
          model,
          promptVersion: WORLD_PROMPT_VERSION,
          durationMs: Date.now() - started,
        },
      };
    });
  };
}
