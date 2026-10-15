import { createHash, randomUUID } from 'node:crypto';
import { Id } from '../../../contracts/api.ts';
import type { PostgresDatabase, SqlClient } from '../../storage/infrastructure/postgres.ts';
import { TaskError } from '../../tasks/infrastructure/task-repository.ts';
import type { WorldState } from '../../world/domain/types.ts';
import {
  eligibleStoryActors,
  legalPresentation,
  type StoryPlan,
  type StorySource,
  type StoryState,
} from '../domain/publication-story.ts';
import type {
  OpeningBrief,
  OpeningDelivery,
  OpeningSnapshot,
  OpeningSource,
  PublicationOpeningPort,
} from '../application/publication-opening-ports.ts';
import { PublicationStoryRepository } from './publication-story-repository.ts';

type Attempt = { commandId: string; expectedVersion: number | null };
type DeliveryRow = {
  actor_id: string;
  brief: string;
  ordinal: number;
  command_id: string;
  expected_version: number | null;
  command_history: Attempt[];
  status: OpeningDelivery['status'];
  source_event_id: string | null;
  source_message_id: string | null;
};
type Batch = {
  source_hash: string;
  node_key: string;
  status: 'planning' | 'ready' | 'unknown' | 'complete';
  plan_command_id: string;
  expected_version: number;
};
type Context = {
  world: WorldState;
  source: OpeningSource | null;
  batch: Batch | undefined;
  rows: DeliveryRow[];
};
type Evidence = {
  id: string;
  command_id: string;
  expected_version: number;
  version: number;
  message_id: string;
  payload: { storyAt?: string; occurredAt: string };
};
const delivery = (r: DeliveryRow): OpeningDelivery => ({
  actorId: r.actor_id,
  brief: r.brief,
  commandId: r.command_id,
  expectedVersion: r.expected_version,
  status: r.status,
  sourceEventId: r.source_event_id,
});
function id(v: string) {
  if (!Id.safeParse(v).success) throw new TaskError('INVALID_INPUT');
}
function attempts(r: DeliveryRow): Attempt[] {
  return [{ commandId: r.command_id, expectedVersion: r.expected_version }, ...r.command_history];
}
function states(rows: Record<string, any>[]): StoryState[] {
  return rows.map((r) => ({
    nodeKey: r.node_key,
    claimId: r.claim_id,
    commandId: r.command_id,
    actorId: r.actor_id,
    expectedVersion: r.expected_version,
    status: r.status,
    outcome: r.outcome,
    storyAt: new Date(r.story_at).toISOString(),
    automatic: r.automatic,
    sourceEventId: r.source_event_id,
    sourceMessageId: r.source_message_id,
    invitationId: r.invitation_id,
    responseEventId: r.response_event_id,
  }));
}

/** Only a player's bound manuscript and durable successful receipts can advance this batch. */
export class PublicationOpeningRepository implements PublicationOpeningPort {
  private readonly db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }
  private async initialize(ownerId: string, worldId: string) {
    id(ownerId);
    id(worldId);
    const initialized = await this.db.transaction(ownerId, async (sql) => {
      if (
        !(
          await sql.query('SELECT 1 FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2', [
            worldId,
            ownerId,
          ])
        ).rowCount
      )
        throw new TaskError('NOT_FOUND');
      return !!(
        await sql.query(
          'SELECT 1 FROM parallel_life.publication_story_plans WHERE world_id=$1 AND owner_id=$2',
          [worldId, ownerId],
        )
      ).rowCount;
    });
    if (!initialized) await new PublicationStoryRepository(this.db).progress(ownerId, worldId);
  }
  private async tx<T>(
    ownerId: string,
    worldId: string,
    run: (sql: SqlClient, c: Context) => Promise<T>,
  ) {
    await this.initialize(ownerId, worldId);
    return this.db.transaction(ownerId, async (sql) => {
      const row = (
        await sql.query(
          'SELECT version,state FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2 FOR UPDATE',
          [worldId, ownerId],
        )
      ).rows[0];
      if (!row) throw new TaskError('NOT_FOUND');
      const world = { ...row.state, version: row.version } as WorldState;
      const plan = (
        await sql.query(
          'SELECT document FROM parallel_life.publication_story_plans WHERE world_id=$1 AND owner_id=$2',
          [worldId, ownerId],
        )
      ).rows[0]?.document as StoryPlan | undefined;
      const batch = (
        await sql.query(
          'SELECT * FROM parallel_life.publication_opening_batches WHERE world_id=$1 AND owner_id=$2 FOR UPDATE',
          [worldId, ownerId],
        )
      ).rows[0] as Batch | undefined;
      const rows = (
        await sql.query(
          'SELECT * FROM parallel_life.publication_opening_deliveries WHERE world_id=$1 AND owner_id=$2 ORDER BY ordinal FOR UPDATE',
          [worldId, ownerId],
        )
      ).rows as DeliveryRow[];
      let source: OpeningSource | null = null;
      if (plan?.openingEventKey) {
        const raw = (
          await sql.query('SELECT parallel_life.publication_story_source($1) AS source', [worldId])
        ).rows[0].source as StorySource | null;
        if (!raw || JSON.stringify(raw.origin) !== JSON.stringify(plan.origin))
          throw new TaskError('INVALID_STATE');
        const node = plan.nodes.find((n) => n.key === plan.openingEventKey);
        const ss = states(
          (
            await sql.query(
              'SELECT * FROM parallel_life.publication_story_nodes WHERE world_id=$1 AND owner_id=$2',
              [worldId, ownerId],
            )
          ).rows,
        );
        const terminal = ss.find(
          (s) =>
            s.nodeKey === plan.openingEventKey &&
            ['skipped', 'expired', 'declined', 'committed'].includes(s.status),
        );
        const storyAt = (
          await sql.query('SELECT parallel_life.publication_story_clock($1) AS at', [worldId])
        ).rows[0].at;
        if (
          node?.intent.kind === 'director_event' &&
          storyAt &&
          ((!terminal && legalPresentation(plan, node, new Date(storyAt).toISOString())) ||
            batch?.status === 'complete')
        ) {
          const initial = (
            await sql.query(
              'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1 AND owner_id=$2',
              [worldId, ownerId],
            )
          ).rows[0]?.state;
          const facts = (
            await sql.query(
              'SELECT id FROM parallel_life.world_facts WHERE world_id=$1 AND owner_id=$2',
              [worldId, ownerId],
            )
          ).rows.map((r) => r.id);
          const options =
            batch?.status === 'complete'
              ? plan.actors.filter((a) => rows.some((r) => r.actor_id === a.id))
              : eligibleStoryActors(
                  plan,
                  node,
                  ss.filter((s) => s.nodeKey !== node.key),
                  {
                    storyNow: new Date(storyAt).toISOString(),
                    currentPlaceId: world.space?.currentPlaceId ?? null,
                    availableFactIds: [
                      ...(initial?.facts ?? []).map((f: { id: string }) => f.id),
                      ...facts,
                    ],
                    automatic: false,
                  },
                );
          const known = new Set(
            raw.contacts
              .filter(
                (a) =>
                  raw.initialActorIds.includes(a.actorId) &&
                  world.actors.some((w) => w.id === a.actorId),
              )
              .map((a) => a.actorId),
          );
          const ordered = node.actorKeys.length
            ? node.actorKeys.flatMap((key) => options.filter((a) => a.key === key))
            : options;
          const actors = ordered
            .filter((a) => known.has(a.id))
            .map((a) => ({
              id: a.id,
              key: a.key,
              name: world.actors.find((w) => w.id === a.id)!.name,
            }));
          if (actors.length > 24) throw new TaskError('INVALID_STATE');
          if (actors.length) {
            const setting = (
              await sql.query('SELECT parallel_life.publication_director_setting($1) AS value', [
                worldId,
              ])
            ).rows[0].value;
            source = {
              worldId,
              ownerId,
              sourceHash: createHash('sha256')
                .update(JSON.stringify([raw.origin, node.key, actors.map((a) => a.id)]))
                .digest('hex'),
              nodeKey: node.key,
              title: node.title,
              script: node.script ?? node.editorialIntent,
              worldSetting: JSON.stringify(setting ?? {}),
              actors,
            };
          }
        }
      }
      if (
        batch &&
        (!source || batch.source_hash !== source.sourceHash || batch.node_key !== source.nodeKey)
      )
        throw new TaskError('INVALID_STATE');
      return run(sql, { world, source, batch, rows });
    });
  }
  private async evidence(
    sql: SqlClient,
    c: Context,
    actorId: string,
    items: Attempt[],
  ): Promise<Evidence | null> {
    for (const a of items) {
      if (a.expectedVersion === null) continue;
      const e = (
        await sql.query(
          `SELECT e.id,e.command_id,c.expected_version,e.version,e.payload,m.id message_id
        FROM parallel_life.commands c JOIN parallel_life.world_events e ON e.world_id=c.world_id AND e.owner_id=c.owner_id AND e.id=c.result_event_id AND e.command_id=c.id
        JOIN parallel_life.world_messages m ON m.world_id=e.world_id AND m.owner_id=e.owner_id AND m.actor_id=$4 AND m.document->>'sourceEventId'=e.id
        WHERE c.world_id=$1 AND c.owner_id=$2 AND c.id=$3 AND c.status='succeeded' AND c.expected_version=$5 AND e.version=$5+1 AND e.version<=$6
        AND e.payload->>'type'='turn.resolved' AND e.payload->'data'->>'origin'='director' AND e.payload->'data'->>'actorId'=$4
        AND (m.document->>'sourceVersion')::bigint=e.version AND m.document->>'role'='assistant' AND m.document->>'actorId'=$4 AND length(trim(m.document->>'text'))>0 AND NOT (m.document ? 'history')
        AND EXISTS(SELECT 1 FROM jsonb_array_elements(e.payload->'data'->'effects') x WHERE x->>'type'='message.received' AND x->>'id'=m.id AND x->>'actorId'=$4 AND x->>'text'=m.document->>'text')
        ORDER BY m.ordinal LIMIT 1`,
          [c.world.id, c.world.ownerId, a.commandId, actorId, a.expectedVersion, c.world.version],
        )
      ).rows[0];
      if (e) return e as Evidence;
    }
    return null;
  }
  private async legacy(sql: SqlClient, c: Context, actorId: string) {
    const n = (
      await sql.query(
        "SELECT * FROM parallel_life.publication_story_nodes WHERE world_id=$1 AND owner_id=$2 AND node_key=$3 AND actor_id=$4 AND status='presented' AND outcome IS NULL",
        [c.world.id, c.world.ownerId, c.source!.nodeKey, actorId],
      )
    ).rows[0];
    if (!n?.source_event_id || !n.source_message_id) return null;
    const e = await this.evidence(sql, c, actorId, [
      { commandId: n.command_id, expectedVersion: n.expected_version },
    ]);
    return e && e.id === n.source_event_id && e.message_id === n.source_message_id ? e : null;
  }
  private async recordNode(sql: SqlClient, c: Context, actorId: string, e: Evidence) {
    if (
      (
        await sql.query(
          'SELECT 1 FROM parallel_life.publication_story_nodes WHERE world_id=$1 AND node_key=$2',
          [c.world.id, c.source!.nodeKey],
        )
      ).rowCount
    )
      return;
    const receipt = randomUUID(),
      at = e.payload.storyAt ?? e.payload.occurredAt;
    await sql.query(
      "INSERT INTO parallel_life.publication_story_receipts(id,world_id,owner_id,node_key,command_id,kind,story_at,source_event_id,data) VALUES($1,$2,$3,$4,$5,'message_presented',$6,$7,$8)",
      [
        receipt,
        c.world.id,
        c.world.ownerId,
        c.source!.nodeKey,
        e.command_id,
        at,
        e.id,
        { openingBatch: true },
      ],
    );
    await sql.query(
      "INSERT INTO parallel_life.publication_story_nodes(world_id,owner_id,node_key,claim_id,command_id,actor_id,expected_version,status,outcome,story_at,automatic,source_event_id,source_message_id,latest_receipt_id) VALUES($1,$2,$3,$4,$4,$5,$6,'presented',NULL,$7,true,$8,$9,$10)",
      [
        c.world.id,
        c.world.ownerId,
        c.source!.nodeKey,
        e.command_id,
        actorId,
        e.expected_version,
        at,
        e.id,
        e.message_id,
        receipt,
      ],
    );
  }
  private async reconcile(sql: SqlClient, c: Context) {
    if (!c.batch) return;
    for (const r of c.rows) {
      if (r.status === 'delivered') continue;
      const e =
        (await this.evidence(sql, c, r.actor_id, attempts(r))) ??
        (await this.legacy(sql, c, r.actor_id));
      if (!e) continue;
      await this.recordNode(sql, c, r.actor_id, e);
      const history = attempts(r).filter((a) => a.commandId !== e.command_id);
      if (history.length > 16) throw new TaskError('INVALID_STATE');
      await sql.query(
        "UPDATE parallel_life.publication_opening_deliveries SET status='delivered',source_event_id=$3,source_message_id=$4,command_id=$5,expected_version=$6,command_history=$7,updated_at=now() WHERE world_id=$1 AND actor_id=$2",
        [
          c.world.id,
          r.actor_id,
          e.id,
          e.message_id,
          e.command_id,
          e.expected_version,
          JSON.stringify(history),
        ],
      );
      r.command_id = e.command_id;
      r.expected_version = e.expected_version;
      r.command_history = history;
      r.status = 'delivered';
      r.source_event_id = e.id;
      r.source_message_id = e.message_id;
    }
    if (c.rows.length && c.rows.every((r) => r.status === 'delivered')) c.batch.status = 'complete';
    else if (c.rows.some((r) => r.status === 'unknown')) c.batch.status = 'unknown';
    await sql.query(
      'UPDATE parallel_life.publication_opening_batches SET status=$2,updated_at=now() WHERE world_id=$1',
      [c.world.id, c.batch.status],
    );
  }
  read(ownerId: string, worldId: string) {
    return this.tx(ownerId, worldId, async (sql, c) => {
      await this.reconcile(sql, c);
      return {
        source: c.source,
        phase: c.batch?.status ?? (c.source ? 'unplanned' : 'none'),
        planCommandId: c.batch?.plan_command_id ?? null,
        deliveries: c.rows.map(delivery),
      } as OpeningSnapshot;
    });
  }
  beginPlan(ownerId: string, worldId: string, commandId: string) {
    id(commandId);
    return this.tx(ownerId, worldId, async (sql, c) => {
      if (!c.source || c.batch) return false;
      await sql.query(
        "INSERT INTO parallel_life.publication_opening_batches(world_id,owner_id,source_hash,node_key,status,plan_command_id,expected_version) VALUES($1,$2,$3,$4,'planning',$5,$6)",
        [worldId, ownerId, c.source.sourceHash, c.source.nodeKey, commandId, c.world.version],
      );
      return true;
    });
  }
  savePlan(ownerId: string, worldId: string, commandId: string, briefs: OpeningBrief[]) {
    id(commandId);
    return this.tx(ownerId, worldId, async (sql, c) => {
      if (!c.source || !c.batch || c.batch.plan_command_id !== commandId)
        throw new TaskError('VERSION_CONFLICT');
      const ids = c.source.actors.map((a) => a.id);
      if (!Array.isArray(briefs) || briefs.some((b) => !b || typeof b !== 'object'))
        throw new TaskError('INVALID_AI_OUTPUT');
      if (
        !Array.isArray(briefs) ||
        briefs.length !== ids.length ||
        new Set(briefs.map((b) => b.actorId)).size !== ids.length ||
        briefs.some(
          (b) =>
            !b ||
            Object.keys(b).some((k) => !['actorId', 'brief'].includes(k)) ||
            !ids.includes(b.actorId) ||
            typeof b.brief !== 'string' ||
            !b.brief.trim() ||
            b.brief.length > 2400,
        )
      )
        throw new TaskError('INVALID_AI_OUTPUT');
      if (c.batch.status === 'ready' || c.batch.status === 'complete') {
        if (
          c.rows.length === ids.length &&
          c.rows.every((r) =>
            briefs.some((b) => b.actorId === r.actor_id && b.brief.trim() === r.brief),
          )
        )
          return;
        throw new TaskError('IDEMPOTENCY_CONFLICT');
      }
      if (c.batch.status !== 'planning') throw new TaskError('VERSION_CONFLICT');
      for (const [ordinal, actorId] of ids.entries()) {
        const brief = briefs.find((b) => b.actorId === actorId)!.brief.trim(),
          e = await this.legacy(sql, c, actorId);
        await sql.query(
          'INSERT INTO parallel_life.publication_opening_deliveries(world_id,owner_id,actor_id,brief,ordinal,command_id,expected_version,status,source_event_id,source_message_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
          [
            worldId,
            ownerId,
            actorId,
            brief,
            ordinal,
            e?.command_id ?? randomUUID(),
            e?.expected_version ?? null,
            e ? 'delivered' : 'queued',
            e?.id ?? null,
            e?.message_id ?? null,
          ],
        );
      }
      await sql.query(
        "UPDATE parallel_life.publication_opening_batches SET status='ready',updated_at=now() WHERE world_id=$1",
        [worldId],
      );
    });
  }
  failPlan(ownerId: string, worldId: string, commandId: string) {
    return this.tx(ownerId, worldId, async (sql, c) => {
      if (c.batch?.plan_command_id === commandId && c.batch.status === 'planning')
        await sql.query(
          "UPDATE parallel_life.publication_opening_batches SET status='unknown',updated_at=now() WHERE world_id=$1",
          [worldId],
        );
    });
  }
  claimNext(ownerId: string, worldId: string) {
    return this.tx(ownerId, worldId, async (sql, c) => {
      await this.reconcile(sql, c);
      if (
        c.batch?.status !== 'ready' ||
        c.rows.some((r) => ['sending', 'unknown'].includes(r.status))
      )
        return null;
      const r = c.rows.find((r) => r.status === 'queued');
      if (!r) return null;
      await sql.query(
        "UPDATE parallel_life.publication_opening_deliveries SET status='sending',expected_version=$3,updated_at=now() WHERE world_id=$1 AND actor_id=$2 AND status='queued'",
        [worldId, r.actor_id, c.world.version],
      );
      return delivery({ ...r, status: 'sending', expected_version: c.world.version });
    });
  }
  finishDelivery(ownerId: string, worldId: string, actorId: string, commandId: string) {
    return this.tx(ownerId, worldId, async (sql, c) => {
      const r = c.rows.find((r) => r.actor_id === actorId);
      if (!r || !attempts(r).some((a) => a.commandId === commandId)) return false;
      await this.reconcile(sql, c);
      return r.status === 'delivered';
    });
  }
  failDelivery(ownerId: string, worldId: string, actorId: string, commandId: string) {
    return this.tx(ownerId, worldId, async (sql, c) => {
      await this.reconcile(sql, c);
      const r = c.rows.find((r) => r.actor_id === actorId);
      if (!r || r.command_id !== commandId || r.status === 'delivered') return;
      if (r.status === 'sending') {
        await sql.query(
          "UPDATE parallel_life.publication_opening_deliveries SET status='unknown',updated_at=now() WHERE world_id=$1 AND actor_id=$2 AND command_id=$3",
          [worldId, actorId, commandId],
        );
        await sql.query(
          "UPDATE parallel_life.publication_opening_batches SET status='unknown',updated_at=now() WHERE world_id=$1",
          [worldId],
        );
      }
    });
  }
  /** Caller must hold the world advance lock; no timestamp can prove a model request has ended. */
  retry(ownerId: string, worldId: string) {
    return this.tx(ownerId, worldId, async (sql, c) => {
      await this.reconcile(sql, c);
      if (!c.batch || c.batch.status === 'complete') return;
      if (!c.rows.length) {
        await sql.query(
          "UPDATE parallel_life.publication_opening_batches SET status='planning',plan_command_id=$2,expected_version=$3,updated_at=now() WHERE world_id=$1",
          [worldId, randomUUID(), c.world.version],
        );
        return;
      }
      for (const r of c.rows.filter((r) => r.status === 'unknown' || r.status === 'sending')) {
        if (r.command_history.length >= 16) throw new TaskError('INVALID_STATE');
        await sql.query(
          "UPDATE parallel_life.publication_opening_deliveries SET status='queued',command_id=$3,expected_version=NULL,command_history=$4,updated_at=now() WHERE world_id=$1 AND actor_id=$2",
          [
            worldId,
            r.actor_id,
            randomUUID(),
            JSON.stringify([
              ...r.command_history,
              { commandId: r.command_id, expectedVersion: r.expected_version },
            ]),
          ],
        );
      }
      await sql.query(
        "UPDATE parallel_life.publication_opening_batches SET status='ready',updated_at=now() WHERE world_id=$1",
        [worldId],
      );
    });
  }
}
