import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Id, Version, ProfileSchema, type Profile } from '../../../contracts/api.ts';
import type { TaskLease } from '../../tasks/domain/types.ts';
import type { PostgresTaskQueue } from '../../tasks/infrastructure/postgres-task-queue.ts';
import { InterviewPlanner, INTERVIEW_PROMPT_VERSION } from './interview-planner.ts';
import { readWorkspace } from './interview-repository.ts';
const Input = z.strictObject({
  interviewId: Id,
  inputMessageId: Id,
  expectedInterviewVersion: Version,
});
export function interviewHandler(
  queue: PostgresTaskQueue,
  planner: InterviewPlanner,
  modelName: string,
) {
  return async (lease: TaskLease, signal: AbortSignal) => {
    const input = Input.parse(lease.input),
      started = Date.now();
    if (input.interviewId !== lease.scopeId) throw Error('INVALID_SCOPE');
    const base = await queue.read(lease, (sql) => readWorkspace(sql, lease.ownerId));
    if (
      base.interview.version !== input.expectedInterviewVersion ||
      base.interview.messages.at(-1)?.id !== input.inputMessageId
    ) {
      await queue.finish(lease, { status: 'conflict', errorCode: 'VERSION_CONFLICT' });
      return;
    }
    const proposal = await planner.propose(base.profile, base.interview.messages, signal);
    await queue.commit(lease, async (sql) => {
      const current = (
        await sql.query('SELECT version FROM parallel_life.interviews WHERE id=$1 FOR UPDATE', [
          input.interviewId,
        ])
      ).rows[0];
      if (!current || current.version !== input.expectedInterviewVersion)
        return { value: undefined, outcome: { status: 'conflict', errorCode: 'VERSION_CONFLICT' } };
      const row = (
        await sql.query(
          'SELECT document,version FROM parallel_life.profiles WHERE owner_id=$1 FOR UPDATE',
          [lease.ownerId],
        )
      ).rows[0];
      if (!row) throw Error('MISSING_PROFILE');
      // Conservative merge: if anything was edited while the model ran, keep every user edit.
      if (row.version === base.profile.version) {
        const profile: Profile = ProfileSchema.parse({ ...row.document, version: row.version });
        let added = 0;
        for (const fact of proposal.facts) {
          if (
            profile.facts.length >= 200 ||
            profile.facts.some((f) => f.category === fact.category && f.value === fact.value)
          )
            continue;
          profile.facts.push({
            ...fact,
            id: randomUUID(),
            status: 'suggested',
            updatedAt: new Date().toISOString(),
          });
          added++;
        }
        for (const event of proposal.events) {
          if (
            profile.events.length >= 100 ||
            profile.events.some((e) => e.title === event.title && e.date === event.date)
          )
            continue;
          profile.events.push({ ...event, id: randomUUID(), feeling: null });
          added++;
        }
        if (added) {
          profile.version++;
          profile.updatedAt = new Date().toISOString();
          await sql.query(
            'UPDATE parallel_life.profiles SET version=$2,document=$3,updated_at=now() WHERE owner_id=$1',
            [lease.ownerId, profile.version, ProfileSchema.parse(profile)],
          );
        }
      }
      await sql.query(
        "INSERT INTO parallel_life.interview_messages(id,owner_id,interview_id,role,text,task_id) VALUES($1,$2,$3,'assistant',$4,$5)",
        [randomUUID(), lease.ownerId, input.interviewId, proposal.reply, lease.id],
      );
      await sql.query('UPDATE parallel_life.interviews SET version=version+1 WHERE id=$1', [
        input.interviewId,
      ]);
      return {
        value: undefined,
        outcome: {
          status: 'succeeded',
          resultVersion: current.version + 1,
          model: modelName,
          promptVersion: INTERVIEW_PROMPT_VERSION,
          durationMs: Date.now() - started,
        },
      };
    });
  };
}
