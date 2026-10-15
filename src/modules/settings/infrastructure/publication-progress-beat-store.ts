import { createHash, randomUUID } from 'node:crypto';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import { TaskError } from '../../tasks/infrastructure/task-repository.ts';
import {
  nextStoryMove,
  ownGoalBrief,
  storyPacePolicy,
  type NextStoryMove,
} from '../domain/story-event-progress.ts';
import {
  PublicationEventProgressRepository,
  type PersistedStoryEventProgress,
  type ProgressLedgerDefinition,
} from './publication-event-progress-repository.ts';

export type PendingPublicationBeat = {
  claimId: string;
  commandId: string;
  actorId: string;
  channel?: 'phone' | 'scene';
  expectedVersion: number;
  storyAt: string;
  status: 'claimed' | 'unknown' | 'failed';
  move: NextStoryMove;
};
type State = PersistedStoryEventProgress & { pendingBeat?: PendingPublicationBeat };
const hash = (v: ProgressLedgerDefinition) =>
  createHash('sha256')
    .update(JSON.stringify([v.definition, v.spec, [...v.actorIdsByKey].sort()]))
    .digest('hex');

/** Independent continuation claims. The original node claim and introduction are immutable. */
export class PublicationProgressBeatStore {
  private async save(
    sql: SqlClient,
    value: ProgressLedgerDefinition,
    old: State,
    next: State,
    version: number,
  ) {
    const d = value.definition;
    const changed = await sql.query(
      'UPDATE parallel_life.publication_story_progress SET revision=$4,world_version=$5,state=$6,updated_at=now() WHERE world_id=$1 AND owner_id=$2 AND node_key=$3 AND revision=$7 AND definition_hash=$8',
      [
        d.worldId,
        d.ownerId,
        d.nodeKey,
        old.revision + 1,
        version,
        { ...next, revision: old.revision + 1 },
        old.revision,
        hash(value),
      ],
    );
    if (changed.rowCount !== 1) throw new TaskError('VERSION_CONFLICT');
    return { ...next, revision: old.revision + 1 };
  }
  private async audit(
    sql: SqlClient,
    value: ProgressLedgerDefinition,
    p: PendingPublicationBeat,
    kind: 'claim' | 'retry' | 'unknown' | 'failure' | 'message_presented',
    sourceEventId: string | null = null,
    reason?: 'goal_closed' | 'world_version_changed',
  ) {
    const d = value.definition;
    await sql.query(
      'INSERT INTO parallel_life.publication_story_receipts(id,world_id,owner_id,node_key,command_id,kind,story_at,source_event_id,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        randomUUID(),
        d.worldId,
        d.ownerId,
        d.nodeKey,
        p.commandId,
        kind,
        p.storyAt,
        sourceEventId,
        {
          scope: 'event_progress',
          claimId: p.claimId,
          actorId: p.actorId,
          expectedVersion: p.expectedVersion,
          move: p.move,
          ...(reason ? { reason } : {}),
        },
      ],
    );
  }
  async mayFollowUp(
    sql: SqlClient,
    value: ProgressLedgerDefinition,
    worldVersion: number,
    speaker: string,
  ): Promise<boolean> {
    const evidence = (
      await sql.query(
        `SELECT e.id,e.payload,p.signal_kind FROM parallel_life.publication_story_progress_evidence p
      JOIN parallel_life.world_events e ON e.world_id=p.world_id AND e.owner_id=p.owner_id AND e.id=p.source_event_id
      JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
      WHERE p.world_id=$1 AND p.owner_id=$2 AND p.node_key=$3 AND e.version<=$4
      ORDER BY e.version DESC,p.signal_kind LIMIT 64`,
        [
          value.definition.worldId,
          value.definition.ownerId,
          value.definition.nodeKey,
          worldVersion,
        ],
      )
    ).rows;
    const seen = new Set<string>();
    let unsolicited = 0;
    for (const item of evidence) {
      const event = item.payload;
      if (event.type !== 'turn.resolved') break;
      if (event.data?.actorId !== speaker) continue;
      if (
        event.data.origin !== 'director' &&
        ['engaged', 'reopened', 'declined'].includes(item.signal_kind)
      )
        break;
      if (
        event.data.origin === 'director' &&
        !value.openingPresentationEventIds?.includes(item.id) &&
        item.signal_kind !== 'introduced' &&
        !seen.has(item.id)
      ) {
        unsolicited++;
        seen.add(item.id);
      }
    }
    return unsolicited < 2;
  }
  async prepare(
    sql: SqlClient,
    value: ProgressLedgerDefinition,
    input: {
      worldVersion: number;
      storyAt: string;
      autonomousActionAvailable: boolean;
      trigger?: 'idle' | 'world_change';
      actorId?: string;
      channel?: 'phone' | 'scene';
    },
  ) {
    const world = (
      await sql.query(
        'SELECT version FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2 FOR UPDATE',
        [value.definition.worldId, value.definition.ownerId],
      )
    ).rows[0];
    if (!world) throw new TaskError('NOT_FOUND');
    if (world.version !== input.worldVersion) throw new TaskError('VERSION_CONFLICT');
    const old = (await new PublicationEventProgressRepository().load(sql, value)) as State | null;
    if (!old || old.phase === 'pending' || old.phase === 'resolved')
      return { status: 'none' as const };
    if (old.pendingBeat)
      return {
        status: old.pendingBeat.status === 'claimed' ? ('busy' as const) : ('unknown' as const),
        pending: old.pendingBeat,
      };
    const other = (
      await sql.query(
        "SELECT 1 FROM parallel_life.publication_story_progress WHERE world_id=$1 AND owner_id=$2 AND node_key<>$3 AND state->'pendingBeat'->>'status' IN ('claimed','unknown') AND (state->'pendingBeat'->>'expectedVersion')::int=$4 LIMIT 1",
        [
          value.definition.worldId,
          value.definition.ownerId,
          value.definition.nodeKey,
          input.worldVersion,
        ],
      )
    ).rowCount;
    if (other) return { status: 'busy' as const };
    const wake = old.lastSourceEventId
      ? (
          await sql.query(
            'SELECT payload FROM parallel_life.world_events WHERE world_id=$1 AND owner_id=$2 AND id=$3 AND version<=$4',
            [
              value.definition.worldId,
              value.definition.ownerId,
              old.lastSourceEventId,
              old.cursorVersion,
            ],
          )
        ).rows[0]
      : undefined;
    const trigger =
      wake && ['travel.completed', 'invitation.responded'].includes(wake.payload.type)
        ? ('world_change' as const)
        : ('idle' as const);
    if (trigger === 'idle' && old.lastSourceEventId && old.lastRelevantAt) {
      const recent = (
        await sql.query(
          'SELECT signal_kind FROM parallel_life.publication_story_progress_evidence WHERE world_id=$1 AND owner_id=$2 AND node_key=$3 AND source_event_id=$4 ORDER BY created_at DESC LIMIT 1',
          [
            value.definition.worldId,
            value.definition.ownerId,
            value.definition.nodeKey,
            old.lastSourceEventId,
          ],
        )
      ).rows[0];
      if (
        recent &&
        ['npc_progress', 'nudge', 'introduced'].includes(recent.signal_kind) &&
        Date.parse(input.storyAt) - Date.parse(old.lastRelevantAt) <
          storyPacePolicy(value.definition.pace).idleMinutes * 60000
      )
        return { status: 'none' as const };
    }
    if (input.actorId && !value.definition.goals.some((goal) => goal.actorId === input.actorId))
      throw new TaskError('INVALID_INPUT');
    const speaker = input.actorId ?? value.boundNode?.actorId ?? value.definition.goals[0]!.actorId;
    if (!(await this.mayFollowUp(sql, value, input.worldVersion, speaker)))
      return { status: 'none' as const };
    const own = input.actorId ? ownGoalBrief(value.definition, old, input.actorId) : null;
    const selectedProgress = own
      ? { ...old, participation: own.participation ?? ('unknown' as const) }
      : old;
    const move = nextStoryMove({
      definition: value.definition,
      progress:
        value.definition.pace === 'extended'
          ? {
              ...selectedProgress,
              productiveBeats: selectedProgress.productiveBeats - old.segmentStartBeat,
            }
          : selectedProgress,
      storyNow: input.storyAt,
      autonomousActionAvailable: input.autonomousActionAvailable,
      trigger,
    });
    if (move === 'wait' || move === 'finished' || move === 'introduce')
      return { status: 'none' as const };
    const pending: PendingPublicationBeat = {
      claimId: randomUUID(),
      commandId: randomUUID(),
      actorId: speaker,
      expectedVersion: input.worldVersion,
      storyAt: input.storyAt,
      status: 'claimed',
      channel: input.channel ?? 'phone',
      move,
    };
    await this.audit(sql, value, pending, 'claim');
    await this.save(sql, value, old, { ...old, pendingBeat: pending }, input.worldVersion);
    return { status: 'claimed' as const, pending };
  }
  async reconcile(sql: SqlClient, value: ProgressLedgerDefinition, worldVersion: number) {
    const ledger = new PublicationEventProgressRepository();
    let old = (await ledger.load(sql, value)) as State | null;
    if (!old?.pendingBeat) return old;
    const pending = old.pendingBeat;
    const command = (
      await sql.query(
        'SELECT status,result_event_id FROM parallel_life.commands WHERE world_id=$1 AND owner_id=$2 AND id=$3',
        [value.definition.worldId, value.definition.ownerId, pending.commandId],
      )
    ).rows[0];
    if (command?.status === 'succeeded') {
      const event = (
        await sql.query(
          'SELECT version,payload FROM parallel_life.world_events WHERE world_id=$1 AND owner_id=$2 AND id=$3',
          [value.definition.worldId, value.definition.ownerId, command.result_event_id],
        )
      ).rows[0];
      if (!event || event.version <= pending.expectedVersion || event.version > worldVersion)
        throw new TaskError('INVALID_STATE');
      if (event.version !== pending.expectedVersion + 1) {
        if (event.payload.type !== 'scene.reaction_recorded') throw new TaskError('INVALID_STATE');
        const changed = (
          await sql.query(
            "SELECT 1 FROM parallel_life.world_events WHERE world_id=$1 AND owner_id=$2 AND version>$3 AND version<$4 AND payload->>'type'<>'scene.view_changed' AND NOT(payload->>'type'='scene.input_recorded' AND coalesce(payload->'data'->>'privateThought','false')='true') LIMIT 1",
            [
              value.definition.worldId,
              value.definition.ownerId,
              pending.expectedVersion,
              event.version,
            ],
          )
        ).rowCount;
        if (changed) throw new TaskError('INVALID_STATE');
      }
      const message = (
        await sql.query(
          "SELECT id,document FROM parallel_life.world_messages WHERE world_id=$1 AND owner_id=$2 AND actor_id=$3 AND document->>'sourceEventId'=$4 AND document->>'role'='assistant' ORDER BY ordinal LIMIT 1",
          [
            value.definition.worldId,
            value.definition.ownerId,
            pending.actorId,
            command.result_event_id,
          ],
        )
      ).rows[0];
      // Scene assessments are applied by its successful transaction; no phone source is fabricated.
      if (message && old.phase !== 'resolved')
        old = (await ledger.apply(
          sql,
          value,
          {
            signal: {
              sourceEventId: command.result_event_id,
              sourceRecordId: message.id,
              kind: pending.move === 'invite_once' ? 'nudge' : 'npc_progress',
            },
            quote: message.document.text.slice(0, 240),
          },
          worldVersion,
        )) as State;
      if (
        !message &&
        old.phase !== 'resolved' &&
        event.payload.type === 'scene.reaction_recorded'
      ) {
        const entry = (
          await sql.query(
            "SELECT id,document FROM parallel_life.scene_items WHERE world_id=$1 AND owner_id=$2 AND source_event_id=$3 AND kind='entry' AND document->>'kind'='dialogue' AND document->'speaker'->>'actorId'=$4 ORDER BY ordinal LIMIT 1",
            [
              value.definition.worldId,
              value.definition.ownerId,
              command.result_event_id,
              pending.actorId,
            ],
          )
        ).rows[0];
        if (!entry) throw new TaskError('INVALID_STATE');
        old = (await ledger.apply(
          sql,
          value,
          {
            signal: {
              sourceEventId: command.result_event_id,
              sourceRecordId: entry.id,
              kind: pending.move === 'invite_once' ? 'nudge' : 'npc_progress',
            },
            quote: entry.document.text.slice(0, 240),
          },
          worldVersion,
        )) as State;
      }
      await this.audit(sql, value, pending, 'message_presented', command.result_event_id);
      const { pendingBeat: _, ...done } = old;
      return this.save(sql, value, old, done as State, worldVersion);
    }
    const task = (
      await sql.query(
        "SELECT status FROM parallel_life.tasks WHERE owner_id=$1 AND scope_kind='world' AND scope_id=$2 AND (command_id::text=$3::text OR input->>'progressCommandId'=$3::text) ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END,created_at DESC LIMIT 1",
        [value.definition.ownerId, value.definition.worldId, pending.commandId],
      )
    ).rows[0];
    if (task && ['queued', 'running'].includes(task.status)) return old;
    const active = !(
      await sql.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS idle', [
        value.definition.worldId,
      ])
    ).rows[0]?.idle;
    if (active) return old;
    const status =
      command?.status === 'failed' || task?.status === 'failed' || task?.status === 'cancelled'
        ? 'failed'
        : 'unknown';
    if (pending.status !== status) {
      const next = { ...pending, status } as PendingPublicationBeat;
      await this.audit(sql, value, next, status === 'failed' ? 'failure' : 'unknown');
      return this.save(sql, value, old, { ...old, pendingBeat: next }, worldVersion);
    }
    return old;
  }
  async retry(
    sql: SqlClient,
    value: ProgressLedgerDefinition,
    claimId: string,
    worldVersion: number,
    allowSceneNavigation = false,
  ) {
    const before = (await new PublicationEventProgressRepository().load(
      sql,
      value,
    )) as State | null;
    if (!before?.pendingBeat || before.pendingBeat.claimId !== claimId)
      throw new TaskError('NOT_FOUND');
    const old = (await this.reconcile(sql, value, worldVersion)) as State | null;
    // A real successful receipt may have reconciled the pending delivery already.
    if (!old?.pendingBeat) return null;
    if (old.pendingBeat.claimId !== claimId) throw new TaskError('NOT_FOUND');
    const previous = old.pendingBeat;
    const phone = previous.channel !== 'scene';
    if (
      phone &&
      (old.phase === 'resolved' ||
        ['fulfilled', 'withdrawn'].includes(old.actorGoalStatus[previous.actorId] ?? ''))
    ) {
      await this.audit(sql, value, previous, 'failure', null, 'goal_closed');
      const { pendingBeat: _, ...done } = old;
      await this.save(sql, value, old, done as State, worldVersion);
      return null;
    }
    if (old.pendingBeat.expectedVersion !== worldVersion) {
      if (phone && old.pendingBeat.expectedVersion < worldVersion) {
        if (previous.status === 'claimed') throw new TaskError('BUSY');
        if (!value.definition.goals.some((goal) => goal.actorId === previous.actorId))
          throw new TaskError('INVALID_STATE');
        const clock = (
          await sql.query(
            `SELECT paused,managed,active_until,clock_timestamp() AS real_now,
          parallel_life.publication_story_clock(world_id) AS story_at FROM parallel_life.world_clock WHERE world_id=$1 AND owner_id=$2`,
            [value.definition.worldId, value.definition.ownerId],
          )
        ).rows[0];
        if (
          !clock ||
          clock.paused ||
          (clock.managed &&
            (!clock.active_until ||
              new Date(clock.active_until).getTime() <= new Date(clock.real_now).getTime()))
        )
          throw new TaskError('BUSY');
        await this.audit(sql, value, previous, 'failure', null, 'world_version_changed');
        const { pendingBeat: _, ...done } = old;
        await this.save(sql, value, old, done as State, worldVersion);
        const prepared = await this.prepare(sql, value, {
          worldVersion,
          storyAt: new Date(clock.story_at).toISOString(),
          autonomousActionAvailable: true,
          actorId: previous.actorId,
          trigger: 'idle',
        });
        return prepared.status === 'claimed' ? prepared.pending : null;
      }
      if (
        !allowSceneNavigation ||
        old.pendingBeat.channel !== 'scene' ||
        old.pendingBeat.expectedVersion > worldVersion
      )
        throw new TaskError('VERSION_CONFLICT');
      const changed = (
        await sql.query(
          "SELECT 1 FROM parallel_life.world_events WHERE world_id=$1 AND owner_id=$2 AND version>$3 AND version<=$4 AND payload->>'type'<>'scene.view_changed' AND NOT(payload->>'type'='scene.input_recorded' AND coalesce(payload->'data'->>'privateThought','false')='true') LIMIT 1",
          [
            value.definition.worldId,
            value.definition.ownerId,
            old.pendingBeat.expectedVersion,
            worldVersion,
          ],
        )
      ).rowCount;
      if (changed) throw new TaskError('VERSION_CONFLICT');
    }
    if (old.pendingBeat.status === 'claimed') throw new TaskError('BUSY');
    const pending = { ...old.pendingBeat, status: 'claimed' as const };
    await this.audit(sql, value, pending, 'retry');
    await this.save(sql, value, old, { ...old, pendingBeat: pending }, worldVersion);
    return pending;
  }
}
