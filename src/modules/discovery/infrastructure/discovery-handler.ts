import { DiscoveryInputSchema } from '../../../contracts/discovery.ts';
import type { TaskLease } from '../../tasks/domain/types.ts';
import type { PostgresTaskQueue } from '../../tasks/infrastructure/postgres-task-queue.ts';
import { DiscoveryPlanner, DISCOVERY_PROMPT_VERSION } from './discovery-planner.ts';
export function discoveryHandler(
  queue: PostgresTaskQueue,
  planner: DiscoveryPlanner,
  model: string,
) {
  return async (lease: TaskLease, signal: AbortSignal) => {
    const input = DiscoveryInputSchema.parse(lease.input),
      started = Date.now();
    if (lease.scopeId !== input.profileId) throw Error('INVALID_SCOPE');
    const current = await queue.read(
      lease,
      async (sql) =>
        (
          await sql.query('SELECT version FROM parallel_life.profiles WHERE id=$1', [
            input.profileId,
          ])
        ).rows[0],
    );
    if (current?.version !== input.profileVersion) {
      await queue.finish(lease, { status: 'conflict', errorCode: 'VERSION_CONFLICT' });
      return;
    }
    const directions = await planner.propose(input, signal);
    await queue.commit(lease, async (sql) => {
      const profile = (
        await sql.query('SELECT version FROM parallel_life.profiles WHERE id=$1 FOR UPDATE', [
          input.profileId,
        ])
      ).rows[0];
      const row = (
        await sql.query(
          'SELECT version FROM parallel_life.discoveries WHERE profile_id=$1 FOR UPDATE',
          [input.profileId],
        )
      ).rows[0];
      if (profile?.version !== input.profileVersion || row?.version !== input.expectedVersion)
        return { value: undefined, outcome: { status: 'conflict', errorCode: 'VERSION_CONFLICT' } };
      await sql.query(
        'UPDATE parallel_life.discoveries SET version=version+1,profile_version=$2,document=$3,updated_at=now() WHERE profile_id=$1',
        [input.profileId, input.profileVersion, { brief: input.brief, directions }],
      );
      return {
        value: undefined,
        outcome: {
          status: 'succeeded',
          resultVersion: row.version + 1,
          model,
          promptVersion: DISCOVERY_PROMPT_VERSION,
          durationMs: Date.now() - started,
        },
      };
    });
  };
}
