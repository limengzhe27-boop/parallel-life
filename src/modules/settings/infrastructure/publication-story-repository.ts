import { randomUUID } from 'node:crypto';
import { Id } from '../../../contracts/api.ts';
import { PostgresDatabase, type SqlClient } from '../../storage/infrastructure/postgres.ts';
import { TaskError } from '../../tasks/infrastructure/task-repository.ts';
import { validateCharacterEffects } from '../../world/domain/character-policy.ts';
import {
  buildStoryPlan,
  evaluateStory,
  legalPresentation,
  nodeActor,
  PublicationStoryError,
  type StoryPlan,
  type StoryState,
  type StorySource,
  type StoryNode,
} from '../domain/publication-story.ts';
import type {
  PublicationStoryPort,
  PublicationStoryPrepare,
  PublicationStoryProgress,
  PublicationStoryClaim,
  PublicationSceneBrief,
} from '../application/publication-story-ports.ts';

type Context = {
  plan: StoryPlan;
  states: StoryState[];
  storyNow: string;
  currentPlaceId: string | null;
  availableFactIds: string[];
  version: number;
  followupNodeKeys: Set<string>;
};
const iso = (v: unknown) => new Date(v as string).toISOString();
function state(row: Record<string, any>): StoryState {
  return {
    nodeKey: row.node_key,
    claimId: row.claim_id,
    commandId: row.command_id,
    actorId: row.actor_id,
    expectedVersion: row.expected_version,
    status: row.status,
    outcome: row.outcome,
    storyAt: iso(row.story_at),
    automatic: row.automatic,
    sourceEventId: row.source_event_id,
    sourceMessageId: row.source_message_id,
    invitationId: row.invitation_id,
    responseEventId: row.response_event_id,
  };
}
function id(value: string) {
  if (!Id.safeParse(value).success) throw new TaskError('INVALID_INPUT');
}
function fail(e: unknown): never {
  if (e instanceof TaskError) throw e;
  if (e instanceof PublicationStoryError) throw new TaskError('INVALID_STATE');
  const code = (e as { code?: string }).code;
  if (code === '42501') throw new TaskError('FORBIDDEN');
  if (code === '23514' || code === '23503') throw new TaskError('INVALID_STATE');
  if (code === '23505') throw new TaskError('IDEMPOTENCY_CONFLICT');
  throw new TaskError('UNAVAILABLE');
}
const empty = (): PublicationStoryProgress => ({
  currentStageKeys: [],
  totalNodes: 0,
  presented: [],
  pending: null,
});
/** No lazy initialization, reconciliation, new connection or role change. Used by existing world/scene transactions. */
export async function readPublicationSceneBrief(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
  invitationId: string,
): Promise<PublicationSceneBrief | null> {
  id(ownerId);
  id(worldId);
  const rows = (
    await sql.query('SELECT parallel_life.publication_story_offer_context($1,$2) AS offers', [
      worldId,
      ownerId,
    ])
  ).rows[0].offers as (PublicationSceneBrief & { sceneEligible?: boolean })[];
  const row = rows.find(
    (r) =>
      r.invitationId === invitationId &&
      r.sceneEligible !== false &&
      typeof r.editorialIntent === 'string',
  );
  if (!row) return null;
  const { sceneEligible: _gate, ...brief } = row;
  return brief;
}
export async function readPublicationInvitationLinks(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
) {
  id(ownerId);
  id(worldId);
  const rows = (
    await sql.query('SELECT parallel_life.publication_story_offer_context($1,$2) AS offers', [
      worldId,
      ownerId,
    ])
  ).rows[0].offers as (PublicationSceneBrief & { sceneEligible?: boolean })[];
  return rows.map(({ invitationId, placeId, placeName, sourceEventId }) => ({
    invitationId,
    placeId,
    placeName,
    sourceEventId,
  }));
}
/** Only app-owned fictional world context. Staff calls after a separately authorized private trialSession. */
export class PublicationStoryRepository implements PublicationStoryPort {
  private readonly db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }
  private async tx<T>(
    ownerId: string,
    worldId: string,
    run: (sql: SqlClient, c: Context | null) => Promise<T>,
  ): Promise<T> {
    id(ownerId);
    id(worldId);
    try {
      return await this.db.transaction(ownerId, async (sql) => {
        const w = (
          await sql.query(
            'SELECT version,state FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2 FOR UPDATE',
            [worldId, ownerId],
          )
        ).rows[0];
        if (!w) throw new TaskError('NOT_FOUND');
        let plan = (
          await sql.query(
            'SELECT document FROM parallel_life.publication_story_plans WHERE world_id=$1 AND owner_id=$2',
            [worldId, ownerId],
          )
        ).rows[0]?.document as StoryPlan | undefined;
        if (!plan) {
          const source = (
            await sql.query('SELECT parallel_life.publication_story_source($1) AS source', [
              worldId,
            ])
          ).rows[0].source as StorySource | null;
          if (!source || (!source.timeline && !source.nodes.length)) return run(sql, null);
          plan = buildStoryPlan(source);
          await sql.query('SELECT parallel_life.publication_story_store_plan($1,$2)', [
            worldId,
            plan,
          ]);
        }
        const initial = (
          await sql.query(
            'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1 AND owner_id=$2',
            [worldId, ownerId],
          )
        ).rows[0].state;
        const facts = (
          await sql.query(
            "SELECT f.id FROM parallel_life.world_facts f JOIN parallel_life.world_events e ON e.world_id=f.world_id AND e.owner_id=f.owner_id AND e.id=f.document->>'sourceEventId' WHERE f.world_id=$1 AND f.owner_id=$2 AND e.version<=$3",
            [worldId, ownerId, w.version],
          )
        ).rows.map((r) => r.id);
        const rows = (
          await sql.query(
            'SELECT * FROM parallel_life.publication_story_nodes WHERE world_id=$1 AND owner_id=$2 ORDER BY node_key',
            [worldId, ownerId],
          )
        ).rows;
        const clockValue = (
          await sql.query('SELECT parallel_life.publication_story_clock($1) AS story_now', [
            worldId,
          ])
        ).rows[0].story_now;
        if (!clockValue) throw new TaskError('INVALID_STATE');
        const storyNow = iso(clockValue);
        const c: Context = {
          plan,
          states: rows.map(state),
          version: w.version,
          storyNow,
          currentPlaceId: w.state.space?.currentPlaceId ?? null,
          availableFactIds: [...initial.facts.map((f: { id: string }) => f.id), ...facts],
          followupNodeKeys: new Set(),
        };
        return run(sql, c);
      });
    } catch (e) {
      return fail(e);
    }
  }
  private claim(c: Context, s: StoryState): PublicationStoryClaim {
    const node = c.plan.nodes.find((n) => n.key === s.nodeKey)!,
      actor = nodeActor(c.plan, node);
    if (!actor || node.intent.kind === 'editorial_only') throw new TaskError('INVALID_STATE');
    const placeKey = node.intent.kind === 'offer_invitation' ? node.intent.placeKey : node.placeKey;
    const place = c.plan.places.find((p) => p.key === placeKey);
    return {
      claimId: s.claimId,
      nodeKey: s.nodeKey,
      commandId: s.commandId,
      expectedVersion: s.expectedVersion,
      actorId: actor.id,
      actorKey: actor.key,
      placeId: place?.key ?? null,
      placeName: place?.name ?? null,
      editorialIntent: node.editorialIntent,
      intent: structuredClone(node.intent),
      origin: { ...c.plan.origin },
    };
  }
  private read(c: Context | null): PublicationStoryProgress {
    if (!c) return empty();
    const e = evaluateStory(c.plan, c.states, { ...c, automatic: false });
    const pending = c.states.find((s) => s.status === 'claimed' || s.status === 'unknown');
    return {
      currentStageKeys: e.currentStages,
      totalNodes: c.plan.nodes.length,
      presented: c.states
        .filter((s) => s.sourceEventId !== null)
        .map((s) => ({
          nodeKey: s.nodeKey,
          status: s.status,
          outcome: s.outcome,
          sourceEventId: s.sourceEventId!,
          sourceMessageId: s.sourceMessageId,
          invitationId: s.invitationId,
          playerCompleted: false,
        })),
      pending: pending
        ? {
            claimId: pending.claimId,
            commandId: pending.commandId,
            status: pending.status as 'claimed' | 'unknown',
          }
        : null,
    };
  }
  private async save(
    sql: SqlClient,
    ownerId: string,
    worldId: string,
    c: Context,
    s: StoryState,
    kind: string,
    sourceEventId: string | null,
    data: Record<string, unknown>,
    terminalAt: string | null = null,
    receiptCommandId = s.commandId,
  ) {
    const receiptId = randomUUID(),
      existing = c.states.find((x) => x.nodeKey === s.nodeKey);
    await sql.query(
      'INSERT INTO parallel_life.publication_story_receipts(id,world_id,owner_id,node_key,command_id,kind,story_at,source_event_id,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        receiptId,
        worldId,
        ownerId,
        s.nodeKey,
        receiptCommandId,
        kind,
        terminalAt ?? c.storyNow,
        sourceEventId,
        data,
      ],
    );
    if (existing)
      await sql.query(
        'UPDATE parallel_life.publication_story_nodes SET status=$3,outcome=$4,source_event_id=$5,source_message_id=$6,invitation_id=$7,response_event_id=$8,terminal_at=$9,latest_receipt_id=$10 WHERE world_id=$1 AND node_key=$2',
        [
          worldId,
          s.nodeKey,
          s.status,
          s.outcome,
          s.sourceEventId,
          s.sourceMessageId,
          s.invitationId,
          s.responseEventId,
          terminalAt,
          receiptId,
        ],
      );
    else
      await sql.query(
        'INSERT INTO parallel_life.publication_story_nodes(world_id,owner_id,node_key,claim_id,command_id,actor_id,expected_version,status,outcome,story_at,automatic,source_event_id,source_message_id,invitation_id,response_event_id,terminal_at,latest_receipt_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)',
        [
          worldId,
          ownerId,
          s.nodeKey,
          s.claimId,
          s.commandId,
          s.actorId,
          s.expectedVersion,
          s.status,
          s.outcome,
          s.storyAt,
          s.automatic,
          s.sourceEventId,
          s.sourceMessageId,
          s.invitationId,
          s.responseEventId,
          terminalAt,
          receiptId,
        ],
      );
    if (existing) c.states[c.states.indexOf(existing)] = s;
    else c.states.push(s);
  }
  private fresh(
    c: Context,
    n: StoryNode,
    status: StoryState['status'],
    automatic = false,
  ): StoryState {
    return {
      nodeKey: n.key,
      claimId: randomUUID(),
      commandId: randomUUID(),
      actorId: nodeActor(c.plan, n)?.id ?? null,
      expectedVersion: c.version,
      status,
      outcome: null,
      storyAt: c.storyNow,
      automatic,
      sourceEventId: null,
      sourceMessageId: null,
      invitationId: null,
      responseEventId: null,
    };
  }
  private async reconcile(sql: SqlClient, ownerId: string, worldId: string, c: Context) {
    await this.reconcileFollowups(sql, ownerId, worldId, c);
    for (const old of [...c.states]) {
      if (c.followupNodeKeys.has(old.nodeKey)) continue;
      const node = c.plan.nodes.find((n) => n.key === old.nodeKey)!;
      if (['claimed', 'unknown', 'failed'].includes(old.status) && !old.sourceEventId) {
        const proof = (
          await sql.query(
            "SELECT e.*,cmd.result_state FROM parallel_life.commands cmd JOIN parallel_life.world_events e ON e.id=cmd.result_event_id AND e.command_id=cmd.id AND e.owner_id=cmd.owner_id AND e.world_id=cmd.world_id WHERE cmd.world_id=$1 AND cmd.owner_id=$2 AND cmd.id=$3 AND cmd.status='succeeded'",
            [worldId, ownerId, old.commandId],
          )
        ).rows[0];
        if (proof) {
          const at = proof.payload.storyAt ?? proof.result_state?.time;
          if (
            proof.version !== old.expectedVersion + 1 ||
            proof.payload.type !== 'turn.resolved' ||
            proof.payload.data?.actorId !== old.actorId ||
            !at
          )
            throw new TaskError('INVALID_STATE');
          validateCharacterEffects(
            old.actorId!,
            proof.payload.data.effects,
            false,
            proof.payload.data.origin,
          );
          const message = (
            await sql.query(
              "SELECT id FROM parallel_life.world_messages WHERE world_id=$1 AND owner_id=$2 AND actor_id=$3 AND document->>'actorId'=$3 AND document->>'role'='assistant' AND document->>'sourceEventId'=$4 AND length(trim(document->>'text'))>0 ORDER BY ordinal LIMIT 1",
              [worldId, ownerId, old.actorId, proof.id],
            )
          ).rows[0];
          if (!message) throw new TaskError('INVALID_STATE');
          if (!legalPresentation(c.plan, node, at)) {
            await this.save(
              sql,
              ownerId,
              worldId,
              c,
              { ...old, status: 'failed' },
              'failure',
              null,
              { reason: 'outside_story_window' },
              c.storyNow,
            );
            continue;
          }
          if (node.intent.kind === 'offer_message')
            await this.save(
              sql,
              ownerId,
              worldId,
              c,
              {
                ...old,
                status: 'presented',
                outcome: 'committed',
                sourceEventId: proof.id,
                sourceMessageId: message.id,
              },
              'message_presented',
              proof.id,
              {},
              at,
            );
          else if (node.intent.kind === 'offer_invitation') {
            const invitation = (
              await sql.query(
                "SELECT id FROM parallel_life.world_appointments WHERE world_id=$1 AND owner_id=$2 AND document->>'sourceEventId'=$3 AND document->'participantIds'=$4::jsonb AND document->>'title'=$5 AND (document->>'at')::timestamptz>=$6::timestamptz ORDER BY id LIMIT 1",
                [
                  worldId,
                  ownerId,
                  proof.id,
                  JSON.stringify([old.actorId]),
                  node.intent.title,
                  node.intent.earliestAt,
                ],
              )
            ).rows[0];
            if (invitation)
              await this.save(
                sql,
                ownerId,
                worldId,
                c,
                {
                  ...old,
                  status: 'offered',
                  sourceEventId: proof.id,
                  sourceMessageId: message.id,
                  invitationId: invitation.id,
                },
                'invitation_offered',
                proof.id,
                {},
                at,
              );
            else
              await this.save(
                sql,
                ownerId,
                worldId,
                c,
                { ...old, status: 'failed', sourceEventId: proof.id, sourceMessageId: message.id },
                'failure',
                proof.id,
                { reason: 'no_matching_actual_invitation' },
                at,
              );
          }
        } else {
          const task = (
            await sql.query(
              "SELECT status FROM parallel_life.tasks WHERE owner_id=$1 AND scope_kind='world' AND scope_id=$2 AND command_id=$3 ORDER BY created_at DESC LIMIT 1",
              [ownerId, worldId, old.commandId],
            )
          ).rows[0];
          const failed = task && ['failed', 'conflict', 'cancelled'].includes(task.status);
          const status = failed ? 'failed' : 'unknown';
          if (old.status !== status)
            await this.save(
              sql,
              ownerId,
              worldId,
              c,
              { ...old, status },
              failed ? 'failure' : 'unknown',
              null,
              { reason: failed ? 'persisted_task_failure' : 'receipt_not_confirmed' },
            );
        }
      }
      const s = c.states.find((n) => n.nodeKey === old.nodeKey)!;
      if (s.invitationId && s.status !== 'skipped') {
        const response = (
          await sql.query(
            "SELECT e.* FROM parallel_life.world_events e JOIN parallel_life.commands cmd ON cmd.id=e.command_id AND cmd.world_id=e.world_id AND cmd.owner_id=e.owner_id AND cmd.status='succeeded' AND cmd.result_event_id=e.id WHERE e.world_id=$1 AND e.owner_id=$2 AND e.payload->>'type'='invitation.responded' AND e.payload->'data'->>'id'=$3 ORDER BY e.version DESC LIMIT 1",
            [worldId, ownerId, s.invitationId],
          )
        ).rows[0];
        if (response && response.id !== s.responseEventId) {
          const operation = response.payload.data.operation,
            at = response.payload.storyTime;
          const targets = {
            accept: 'committed',
            attend: 'committed',
            cancel: 'declined',
            miss: 'expired',
            reschedule: 'offered',
          } as const;
          const target = targets[operation as keyof typeof targets];
          if (!target || !at) throw new TaskError('INVALID_STATE');
          if (
            legalPresentation(c.plan, node, at) ||
            (s.outcome === 'committed' && ['cancel', 'miss', 'reschedule'].includes(operation))
          )
            await this.save(
              sql,
              ownerId,
              worldId,
              c,
              {
                ...s,
                status: target,
                outcome: target === 'offered' ? null : target,
                responseEventId: response.id,
              },
              'response',
              response.id,
              { operation },
              at,
            );
        }
      }
    }
    const e = evaluateStory(c.plan, c.states, { ...c, automatic: false });
    for (const key of e.expired) {
      if (c.followupNodeKeys.has(key)) continue;
      const node = c.plan.nodes.find((n) => n.key === key)!,
        existing = c.states.find((s) => s.nodeKey === key),
        s = existing ?? this.fresh(c, node, 'expired');
      await this.save(
        sql,
        ownerId,
        worldId,
        c,
        { ...s, status: 'expired', outcome: 'expired' },
        'clock_expiry',
        null,
        { storyNow: c.storyNow },
        c.storyNow,
      );
    }
    for (const x of e.excluded) {
      if (c.followupNodeKeys.has(x.nodeKey)) continue;
      const node = c.plan.nodes.find((n) => n.key === x.nodeKey)!,
        existing = c.states.find((s) => s.nodeKey === x.nodeKey),
        s = existing ?? this.fresh(c, node, 'skipped');
      await this.save(
        sql,
        ownerId,
        worldId,
        c,
        { ...s, status: 'skipped', outcome: 'skipped' },
        'exclusion',
        null,
        { sourceNodeKey: x.sourceNodeKey },
        c.storyNow,
      );
    }
  }
  private async reconcileFollowups(sql: SqlClient, ownerId: string, worldId: string, c: Context) {
    await this.overlayFollowups(sql, ownerId, worldId, c);
    if (!c.states.some((s) => ['claimed', 'unknown'].includes(s.status))) {
      for (const s of c.states) {
        const node = c.plan.nodes.find((n) => n.key === s.nodeKey);
        if (
          !node ||
          node.intent.kind !== 'offer_invitation' ||
          s.status !== 'failed' ||
          s.outcome ||
          !s.sourceEventId ||
          !s.sourceMessageId ||
          s.invitationId ||
          !legalPresentation(c.plan, node, c.storyNow)
        )
          continue;
        const evaluation = evaluateStory(c.plan, c.states, { ...c, automatic: false });
        if (
          (node.timeline && !evaluation.currentStages.includes(node.timeline.stageKey)) ||
          evaluation.excluded.some((x) => x.nodeKey === s.nodeKey)
        )
          continue;
        const invitationTitle = node.intent.title;
        // Two presented opportunities with the same actor/title cannot safely claim one invitation.
        if (
          c.states.filter((other) => {
            const n = c.plan.nodes.find((n) => n.key === other.nodeKey);
            return (
              other.status === 'failed' &&
              !other.outcome &&
              !!other.sourceEventId &&
              other.actorId === s.actorId &&
              n?.intent.kind === 'offer_invitation' &&
              n.intent.title === invitationTitle &&
              legalPresentation(c.plan, n, c.storyNow)
            );
          }).length !== 1
        )
          continue;
        const existing = (
          await sql.query(
            'SELECT 1 FROM parallel_life.publication_story_followups WHERE world_id=$1 AND owner_id=$2 AND node_key=$3',
            [worldId, ownerId, s.nodeKey],
          )
        ).rowCount;
        if (existing) continue;
        const candidates = (
          await sql.query(
            "SELECT DISTINCT ON(a.id) a.id invitation_id,e.id source_event_id,m.id source_message_id FROM parallel_life.world_appointments a JOIN parallel_life.world_events e ON e.id=a.document->>'sourceEventId' AND e.world_id=a.world_id AND e.owner_id=a.owner_id JOIN parallel_life.world_messages m ON m.world_id=e.world_id AND m.owner_id=e.owner_id AND m.document->>'sourceEventId'=e.id AND m.document->>'role'='assistant' AND m.actor_id=$4 WHERE a.world_id=$1 AND a.owner_id=$2 AND a.document->>'title'=$5 AND parallel_life.publication_story_followup_valid($1,$2,$3,e.id,m.id,a.id) AND NOT EXISTS(SELECT 1 FROM parallel_life.publication_story_followups f WHERE f.world_id=a.world_id AND f.invitation_id=a.id) ORDER BY a.id,m.ordinal LIMIT 2",
            [worldId, ownerId, s.nodeKey, s.actorId, node.intent.title],
          )
        ).rows;
        if (candidates.length !== 1) continue;
        const proof = candidates[0];
        await sql.query(
          'INSERT INTO parallel_life.publication_story_followups(world_id,owner_id,node_key,source_event_id,source_message_id,invitation_id) VALUES($1,$2,$3,$4,$5,$6)',
          [
            worldId,
            ownerId,
            s.nodeKey,
            proof.source_event_id,
            proof.source_message_id,
            proof.invitation_id,
          ],
        );
      }
    }
    await this.overlayFollowups(sql, ownerId, worldId, c);
  }
  private async overlayFollowups(sql: SqlClient, ownerId: string, worldId: string, c: Context) {
    const rows = (
      await sql.query(
        "SELECT f.*,s.status original_status,r.id response_id,r.payload response_payload FROM parallel_life.publication_story_followups f JOIN parallel_life.publication_story_nodes s ON s.world_id=f.world_id AND s.owner_id=f.owner_id AND s.node_key=f.node_key LEFT JOIN LATERAL(SELECT e.id,e.payload FROM parallel_life.world_events e JOIN parallel_life.commands cmd ON cmd.id=e.command_id AND cmd.world_id=e.world_id AND cmd.owner_id=e.owner_id AND cmd.status='succeeded' AND cmd.result_event_id=e.id WHERE e.world_id=f.world_id AND e.owner_id=f.owner_id AND e.payload->>'type'='invitation.responded' AND e.payload->'data'->>'id'=f.invitation_id ORDER BY e.version DESC LIMIT 1) r ON true WHERE f.world_id=$1 AND f.owner_id=$2",
        [worldId, ownerId],
      )
    ).rows;
    for (const f of rows) {
      const original = c.states.find((s) => s.nodeKey === f.node_key);
      const node = c.plan.nodes.find((n) => n.key === f.node_key);
      if (!original || !node) throw new TaskError('INVALID_STATE');
      c.followupNodeKeys.add(f.node_key);
      const op = f.response_payload?.data?.operation;
      const accepted =
        ['accept', 'attend'].includes(op) &&
        legalPresentation(c.plan, node, f.response_payload.storyTime);
      const status: StoryState['status'] =
        f.original_status !== 'failed'
          ? f.original_status
          : op === 'cancel'
            ? 'declined'
            : op === 'miss'
              ? 'expired'
              : accepted
                ? 'committed'
                : legalPresentation(c.plan, node, c.storyNow)
                  ? 'offered'
                  : 'expired';
      c.states[c.states.indexOf(original)] = {
        ...original,
        status,
        outcome: ['committed', 'declined', 'expired', 'skipped'].includes(status)
          ? (status as StoryState['outcome'])
          : null,
        sourceEventId: f.source_event_id,
        sourceMessageId: f.source_message_id,
        invitationId: f.invitation_id,
        responseEventId: f.response_id ?? null,
      };
    }
  }
  prepare(
    ownerId: string,
    worldId: string,
    { automatic = true }: { automatic?: boolean } = {},
  ): Promise<PublicationStoryPrepare> {
    return this.tx(ownerId, worldId, async (sql, c) => {
      if (!c) return { status: 'none', managed: false };
      await this.reconcile(sql, ownerId, worldId, c);
      const pending = c.states.find((s) => s.status === 'claimed' || s.status === 'unknown');
      if (pending)
        return {
          status: pending.status === 'unknown' ? 'unknown' : 'busy',
          pendingClaimId: pending.claimId,
        };
      const e = evaluateStory(c.plan, c.states, { ...c, automatic });
      if (e.rateLimited) return { status: 'rate_limited' };
      const node = e.eligible[0];
      if (!node) return { status: 'none', managed: true };
      const s = this.fresh(c, node, 'claimed', automatic);
      await this.save(sql, ownerId, worldId, c, s, 'claim', null, { automatic });
      return { status: 'claimed', claim: this.claim(c, s) };
    });
  }
  finish(ownerId: string, worldId: string, claimId: string) {
    id(claimId);
    return this.tx(ownerId, worldId, async (sql, c) => {
      if (!c || !c.states.some((s) => s.claimId === claimId)) throw new TaskError('NOT_FOUND');
      await this.reconcile(sql, ownerId, worldId, c);
      return this.read(c);
    });
  }
  progress(ownerId: string, worldId: string) {
    return this.tx(ownerId, worldId, async (sql, c) => {
      if (c) await this.reconcile(sql, ownerId, worldId, c);
      return this.read(c);
    });
  }
  skip(ownerId: string, worldId: string, nodeKey: string, commandId: string) {
    id(commandId);
    return this.tx(ownerId, worldId, async (sql, c) => {
      if (!c) throw new TaskError('NOT_FOUND');
      const old = (
        await sql.query(
          "SELECT node_key FROM parallel_life.publication_story_receipts WHERE world_id=$1 AND owner_id=$2 AND command_id=$3 AND kind='owner_skip'",
          [worldId, ownerId, commandId],
        )
      ).rows[0];
      if (old) {
        if (old.node_key !== nodeKey) throw new TaskError('IDEMPOTENCY_CONFLICT');
        return this.read(c);
      }
      await this.reconcile(sql, ownerId, worldId, c);
      const node = c.plan.nodes.find((n) => n.key === nodeKey);
      if (!node) throw new TaskError('NOT_FOUND');
      const existing = c.states.find((s) => s.nodeKey === nodeKey);
      if (c.followupNodeKeys.has(nodeKey)) throw new TaskError('INVALID_STATE');
      if (existing?.outcome) throw new TaskError('INVALID_STATE');
      if (existing && ['claimed', 'unknown'].includes(existing.status)) throw new TaskError('BUSY');
      const e = evaluateStory(c.plan, c.states, { ...c, automatic: false });
      if (
        !legalPresentation(c.plan, node, c.storyNow) ||
        (node.timeline && !e.currentStages.includes(node.timeline.stageKey)) ||
        (!existing &&
          node.intent.kind !== 'editorial_only' &&
          !e.eligible.some((n) => n.key === nodeKey))
      )
        throw new TaskError('INVALID_STATE');
      const s = existing ?? this.fresh(c, node, 'skipped');
      await this.save(
        sql,
        ownerId,
        worldId,
        c,
        { ...s, status: 'skipped', outcome: 'skipped' },
        'owner_skip',
        null,
        { operation: 'owner_skip' },
        c.storyNow,
        commandId,
      );
      return this.read(c);
    });
  }
  retry(ownerId: string, worldId: string, claimId: string): Promise<PublicationStoryPrepare> {
    id(claimId);
    return this.tx(ownerId, worldId, async (sql, c) => {
      if (!c) throw new TaskError('NOT_FOUND');
      await this.reconcile(sql, ownerId, worldId, c);
      const s = c.states.find((s) => s.claimId === claimId);
      if (!s) throw new TaskError('NOT_FOUND');
      if (s.sourceEventId || s.outcome) return { status: 'none', managed: true };
      if (!['unknown', 'failed'].includes(s.status)) throw new TaskError('BUSY');
      if (s.expectedVersion !== c.version) throw new TaskError('VERSION_CONFLICT');
      const node = c.plan.nodes.find((n) => n.key === s.nodeKey)!;
      if (!legalPresentation(c.plan, node, c.storyNow)) throw new TaskError('INVALID_STATE');
      await this.save(sql, ownerId, worldId, c, { ...s, status: 'claimed' }, 'retry', null, {
        explicit: true,
      });
      return { status: 'claimed', claim: this.claim(c, s) };
    });
  }
  invitationLinks(ownerId: string, worldId: string) {
    return this.tx(ownerId, worldId, async (sql, c) => {
      if (!c) return [];
      await this.reconcile(sql, ownerId, worldId, c);
      return readPublicationInvitationLinks(sql, ownerId, worldId);
    });
  }
  /** A clipped, already presented opportunity; never a calendar entry or knowledge grant. */
  invitationContext(
    ownerId: string,
    worldId: string,
    actorId: string,
  ): Promise<{ title: string; placeName: string | null; earliestAt: string } | null> {
    id(actorId);
    return this.tx(ownerId, worldId, async (sql, c) => {
      if (!c) return null;
      await this.overlayFollowups(sql, ownerId, worldId, c);
      if (c.states.some((s) => ['claimed', 'unknown'].includes(s.status))) return null;
      const evaluation = evaluateStory(c.plan, c.states, { ...c, automatic: false });
      const contexts: { title: string; placeName: string | null; earliestAt: string }[] = [];
      const followed = new Set(
        (
          await sql.query(
            'SELECT node_key FROM parallel_life.publication_story_followups WHERE world_id=$1 AND owner_id=$2',
            [worldId, ownerId],
          )
        ).rows.map((r) => r.node_key),
      );
      for (const s of c.states) {
        const node = c.plan.nodes.find((n) => n.key === s.nodeKey);
        if (
          !node ||
          followed.has(s.nodeKey) ||
          node.intent.kind !== 'offer_invitation' ||
          s.actorId !== actorId ||
          s.status !== 'failed' ||
          s.outcome ||
          s.invitationId ||
          !s.sourceEventId ||
          !s.sourceMessageId ||
          !legalPresentation(c.plan, node, c.storyNow) ||
          (node.timeline && !evaluation.currentStages.includes(node.timeline.stageKey)) ||
          evaluation.excluded.some((x) => x.nodeKey === s.nodeKey)
        )
          continue;
        const proof = (
          await sql.query(
            "SELECT e.payload,cmd.result_state FROM parallel_life.world_events e JOIN parallel_life.commands cmd ON cmd.id=e.command_id AND cmd.world_id=e.world_id AND cmd.owner_id=e.owner_id AND cmd.status='succeeded' AND cmd.result_event_id=e.id JOIN parallel_life.world_messages m ON m.id=$4 AND m.world_id=e.world_id AND m.owner_id=e.owner_id AND m.actor_id=$5 AND m.document->>'actorId'=$5 AND m.document->>'role'='assistant' AND m.document->>'sourceEventId'=e.id AND length(trim(m.document->>'text'))>0 WHERE e.world_id=$1 AND e.owner_id=$2 AND e.id=$3 AND e.command_id=$6 AND e.version=$7 AND e.version<=$8 AND e.payload->>'type'='turn.resolved' AND e.payload->'data'->>'actorId'=$5 AND EXISTS(SELECT 1 FROM parallel_life.publication_story_receipts r WHERE r.world_id=e.world_id AND r.owner_id=e.owner_id AND r.node_key=$9 AND r.command_id=$6::uuid AND r.source_event_id=e.id AND r.kind='failure' AND r.data->>'reason'='no_matching_actual_invitation')",
            [
              worldId,
              ownerId,
              s.sourceEventId,
              s.sourceMessageId,
              actorId,
              s.commandId,
              s.expectedVersion + 1,
              c.version,
              s.nodeKey,
            ],
          )
        ).rows[0];
        const at = proof?.payload.storyAt ?? proof?.result_state?.time;
        if (!at || !legalPresentation(c.plan, node, at) || Date.parse(at) > Date.parse(c.storyNow))
          continue;
        const placeKey = node.intent.placeKey;
        contexts.push({
          title: node.intent.title,
          placeName: c.plan.places.find((p) => p.key === placeKey)?.name ?? null,
          earliestAt: node.intent.earliestAt,
        });
      }
      return contexts.length === 1 ? contexts[0]! : null;
    });
  }
  sceneBrief(
    ownerId: string,
    worldId: string,
    invitationId: string,
  ): Promise<PublicationSceneBrief | null> {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(invitationId)) throw new TaskError('INVALID_INPUT');
    return this.tx(ownerId, worldId, async (sql, c) => {
      if (!c) return null;
      await this.reconcile(sql, ownerId, worldId, c);
      return readPublicationSceneBrief(sql, ownerId, worldId, invitationId);
    });
  }
}
