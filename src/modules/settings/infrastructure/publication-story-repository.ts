import { ownGoalBrief } from '../domain/story-event-progress.ts';
import {
  PublicationProgressBeatStore,
  type PendingPublicationBeat,
} from './publication-progress-beat-store.ts';
import {
  publicationGoalContexts,
  publicationOwnGoalFrame,
  publicationProgressTrigger,
  type PublicationGoalContext,
} from './publication-event-goal-context.ts';
import { createHash, randomUUID } from 'node:crypto';
import { Id } from '../../../contracts/api.ts';
import { PostgresDatabase, type SqlClient } from '../../storage/infrastructure/postgres.ts';
import { TaskError } from '../../tasks/infrastructure/task-repository.ts';
import { validateCharacterEffects } from '../../world/domain/character-policy.ts';
import {
  buildStoryPlan,
  evaluateStory,
  openingEventPending,
  legalPresentation,
  nodeActor,
  eligibleStoryActors,
  PublicationStoryError,
  type StoryPlan,
  type StoryState,
  type StorySource,
  type StoryNode,
  storyStateOutcome,
} from '../domain/publication-story.ts';
import type {
  PublicationStoryPort,
  PublicationStoryPrepare,
  PublicationStoryProgress,
  PublicationStoryClaim,
  PublicationSceneBrief,
  PublicationStoryOpportunities,
  PublicationEventProgressContext,
} from '../application/publication-story-ports.ts';
import { discoveredRouteIds } from '../domain/publication-route-ids.ts';
import {
  applySpaceEvent,
  reachableSpacePlaces,
  type SpacePlaceRevealedEvent,
} from '../../world/domain/space.ts';
import type { WorldState } from '../../world/domain/types.ts';

type Context = {
  plan: StoryPlan;
  states: StoryState[];
  storyNow: string;
  currentPlaceId: string | null;
  placeDescriptions: Map<string, string>;
  authoredPlaces: StorySource['places'];
  authoredRoutes: NonNullable<StorySource['routes']>;
  world: WorldState;
  availableFactIds: string[];
  version: number;
  followupNodeKeys: Set<string>;
  goalContexts?: PublicationGoalContext[];
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
      return await this.db.transaction(ownerId, (sql) =>
        this.withContext(sql, ownerId, worldId, run),
      );
    } catch (e) {
      return fail(e);
    }
  }
  private async withContext<T>(
    sql: SqlClient,
    ownerId: string,
    worldId: string,
    run: (sql: SqlClient, c: Context | null) => Promise<T>,
  ): Promise<T> {
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
        await sql.query('SELECT parallel_life.publication_story_source($1) AS source', [worldId])
      ).rows[0].source as StorySource | null;
      if (!source || (!source.timeline && !source.nodes.length)) return run(sql, null);
      plan = buildStoryPlan(source);
      await sql.query('SELECT parallel_life.publication_story_store_plan($1,$2)', [worldId, plan]);
    }
    const initial = (
      await sql.query(
        'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1 AND owner_id=$2',
        [worldId, ownerId],
      )
    ).rows[0].state;
    const source = (
      await sql.query('SELECT parallel_life.publication_story_source($1) AS source', [worldId])
    ).rows[0].source as StorySource | null;
    if (!source || JSON.stringify(source.origin) !== JSON.stringify(plan.origin))
      throw new TaskError('INVALID_STATE');
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
      await sql.query('SELECT parallel_life.publication_story_clock($1) AS story_now', [worldId])
    ).rows[0].story_now;
    if (!clockValue) throw new TaskError('INVALID_STATE');
    const storyNow = iso(clockValue);
    const c: Context = {
      plan,
      states: rows.map(state),
      version: w.version,
      world: { ...w.state, version: w.version } as WorldState,
      storyNow,
      currentPlaceId: w.state.space?.currentPlaceId ?? null,
      placeDescriptions: new Map(
        source.places.map((place) => [place.key, place.description ?? '']),
      ),
      authoredPlaces: source.places,
      authoredRoutes: source.routes ?? [],
      availableFactIds: [...initial.facts.map((f: { id: string }) => f.id), ...facts],
      followupNodeKeys: new Set(),
    };
    return run(sql, c);
  }
  /** Existing successful world commit calls this on its own connection, never nested transactions. */
  async reconcileInTransaction(sql: SqlClient, ownerId: string, worldId: string) {
    return this.withContext(sql, ownerId, worldId, async (sql, c) => {
      if (c) await this.reconcile(sql, ownerId, worldId, c);
    });
  }
  private async progressContexts(sql: SqlClient, ownerId: string, worldId: string, c: Context) {
    const rows = await publicationGoalContexts(sql, ownerId, worldId, c.version);
    const store = new PublicationProgressBeatStore();
    for (const row of rows) {
      row.progress = (await store.reconcile(sql, row.value, c.version)) ?? row.progress;
      const s = c.states.find((s) => s.nodeKey === row.record.node.key);
      const sourceEventId = row.progress.lastSourceEventId;
      if (s && row.progress.phase === 'resolved' && row.progress.resolution && sourceEventId)
        s.progressResolution = { resolution: row.progress.resolution, sourceEventId };
    }
    c.goalContexts = rows;
    return rows;
  }
  private async progressBrief(
    sql: SqlClient,
    row: PublicationGoalContext,
    c: Context,
    actorId = row.record.state.actorId,
  ): Promise<PublicationEventProgressContext | null> {
    const frame = await publicationOwnGoalFrame(sql, row, actorId, c.storyNow);
    if (!frame) return null;
    const ownGoal = ownGoalBrief(row.value.definition, row.progress, actorId);
    if (!ownGoal) return null;
    return {
      nodeKey: row.record.node.key,
      actorId: frame.actorId,
      phase: frame.phase,
      resolution: frame.phase === 'resolved' ? row.progress.resolution : null,
      ownGoal,
      productiveBeats: frame.productiveBeats,
      segmentIndex: frame.segmentIndex,
      nextMove:
        frame.nextMove === 'wait' && (await publicationProgressTrigger(sql, row)) === 'world_change'
          ? 'continue_in_current_turn'
          : frame.nextMove,
    };
  }
  private async progressSpeaker(sql: SqlClient, row: PublicationGoalContext, c: Context) {
    const ids = Object.keys(row.record.openingActors ?? {});
    const candidates = await Promise.all(
      (ids.length ? ids : [row.record.state.actorId]).map((id) =>
        this.progressBrief(sql, row, c, id),
      ),
    );
    const allowed = await Promise.all(
      candidates.map(async (brief) =>
        brief &&
        (await new PublicationProgressBeatStore().mayFollowUp(
          sql,
          row.value,
          c.version,
          brief.actorId,
        ))
          ? brief
          : null,
      ),
    );
    return (
      allowed
        .filter(
          (brief): brief is PublicationEventProgressContext =>
            brief !== null && !['wait', 'finished'].includes(brief.nextMove),
        )
        .sort(
          (a, b) => a.productiveBeats - b.productiveBeats || a.actorId.localeCompare(b.actorId),
        )[0] ?? null
    );
  }
  eventProgressContext(ownerId: string, worldId: string, actorId: string) {
    return this.tx(ownerId, worldId, async (sql, c) => {
      if (!c) return [];
      await this.reconcile(sql, ownerId, worldId, c);
      const rows = await this.progressContexts(sql, ownerId, worldId, c);
      const briefs = await Promise.all(
        rows
          .filter((r) => r.record.state.actorId === actorId || r.record.openingActors?.[actorId])
          .map((r) => this.progressBrief(sql, r, c, actorId)),
      );
      return briefs.filter((b): b is PublicationEventProgressContext => b !== null);
    });
  }
  prepareProgressBeat(
    ownerId: string,
    worldId: string,
    nodeKey: string,
    options: { expectedVersion: number; automatic: boolean },
  ): Promise<PublicationStoryPrepare> {
    return this.tx(ownerId, worldId, async (sql, c) => {
      if (!c) return { status: 'none', managed: false };
      await this.reconcile(sql, ownerId, worldId, c);
      await this.progressContexts(sql, ownerId, worldId, c);
      if (c.version !== options.expectedVersion) throw new TaskError('VERSION_CONFLICT');
      const rows = await this.progressContexts(sql, ownerId, worldId, c);
      const row = rows.find((r) => r.record.node.key === nodeKey);
      if (!row) return { status: 'none', managed: true };
      const brief = await this.progressSpeaker(sql, row, c);
      if (!brief) return { status: 'none', managed: true };
      const result = await new PublicationProgressBeatStore().prepare(sql, row.value, {
        worldVersion: c.version,
        storyAt: c.storyNow,
        autonomousActionAvailable: true,
        trigger: 'idle',
        actorId: brief.actorId,
      });
      if (result.status !== 'claimed')
        return {
          status: result.status,
          managed: true,
          ...('pending' in result && result.pending
            ? { pendingClaimId: result.pending.claimId }
            : {}),
        };
      const original = c.states.find((s) => s.nodeKey === nodeKey)!;
      return {
        status: 'claimed',
        claim: {
          ...this.claim(c, original),
          ...result.pending,
          actorKey: c.plan.actors.find((a) => a.id === result.pending.actorId)!.key,
          eventProgress: { ...brief, nextMove: result.pending.move },
        },
      };
    });
  }
  finishProgressBeat(ownerId: string, worldId: string, claimId: string) {
    return this.tx(ownerId, worldId, async (sql, c) => {
      if (!c) throw new TaskError('NOT_FOUND');
      await this.reconcile(sql, ownerId, worldId, c);
      await this.progressContexts(sql, ownerId, worldId, c);
      await this.progressContexts(sql, ownerId, worldId, c);
      return this.read(c);
    });
  }
  private claim(c: Context, s: StoryState): PublicationStoryClaim {
    const node = c.plan.nodes.find((n) => n.key === s.nodeKey)!,
      actor = c.plan.actors.find((actor) => actor.id === s.actorId);
    if (!actor || node.intent.kind === 'editorial_only') throw new TaskError('INVALID_STATE');
    const placeKey =
      node.intent.kind === 'offer_invitation'
        ? node.intent.placeKey
        : (node.settingPlaceKey ?? node.placeKey);
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
      placeDescription: place ? (c.placeDescriptions.get(place.key) ?? null) : null,
      placeNeedsReveal: !!place && !c.world.space?.places.some((known) => known.id === place.key),
      editorialIntent: node.script ?? node.editorialIntent,
      ...(node.script ? { script: node.script } : {}),
      ...(node.sceneText ? { sceneText: node.sceneText } : {}),
      ...(node.scenePlaceKeys?.length
        ? {
            places: c.authoredPlaces
              .filter((p) => node.scenePlaceKeys!.includes(p.key))
              .map((p) => ({
                key: p.key,
                name: p.name,
                ...(p.description ? { description: p.description } : {}),
              })),
          }
        : {}),
      intent: structuredClone(node.intent),
      origin: { ...c.plan.origin },
    };
  }
  private read(c: Context | null): PublicationStoryProgress {
    if (!c) return empty();
    const e = evaluateStory(c.plan, c.states, { ...c, automatic: false });
    const pending = c.states.find((s) => s.status === 'claimed' || s.status === 'unknown');
    const beat = c.goalContexts
      ?.map(
        (r) =>
          (r.progress as typeof r.progress & { pendingBeat?: PendingPublicationBeat }).pendingBeat,
      )
      .find((p) => p !== undefined && p.channel !== 'scene');
    return {
      currentStageKeys: e.currentStages,
      totalNodes: c.plan.nodes.length,
      presented: c.states
        .filter((s) => s.sourceEventId !== null)
        .map((s) => ({
          nodeKey: s.nodeKey,
          status: s.status,
          outcome: storyStateOutcome(s),
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
        : beat
          ? {
              claimId: beat.claimId,
              commandId: beat.commandId,
              status: beat.status === 'claimed' ? 'claimed' : 'unknown',
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
    chosenActorId?: string,
  ): StoryState {
    return {
      nodeKey: n.key,
      claimId: randomUUID(),
      commandId: randomUUID(),
      actorId: chosenActorId ?? nodeActor(c.plan, n)?.id ?? null,
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
  private canIntroducePlace(c: Context, node: StoryNode): boolean {
    const key = node.settingPlaceKey;
    if (!key || c.world.space?.places.some((p) => p.id === key)) return true;
    if (!c.world.space) return false;
    const reachable = reachableSpacePlaces(c.world.space);
    return c.authoredRoutes.some(
      (route) =>
        route.toPlaceKey === key && route.minutes <= 120 && reachable.has(route.fromPlaceKey),
    );
  }
  private async revealAuthoredPlace(
    sql: SqlClient,
    ownerId: string,
    worldId: string,
    c: Context,
    node: StoryNode,
    proof: { id: string },
    messageId: string,
    presentedAt: string,
  ) {
    const placeKey = node.settingPlaceKey;
    if (!placeKey || !c.world.space || c.world.space.places.some((p) => p.id === placeKey)) return;
    const authored = c.authoredPlaces.find((p) => p.key === placeKey);
    if (!authored?.description || !c.plan.places.some((p) => p.key === placeKey))
      throw new TaskError('INVALID_STATE');
    if (!this.canIntroducePlace(c, node)) throw new TaskError('INVALID_STATE');
    const known = new Set(c.world.space.places.map((p) => p.id));
    const routes = discoveredRouteIds(c.authoredRoutes)
      .filter(
        (r) =>
          (r.fromPlaceKey === placeKey && known.has(r.toPlaceKey)) ||
          (r.toPlaceKey === placeKey && known.has(r.fromPlaceKey)),
      )
      .map((r) => ({
        id: r.id,
        fromPlaceId: r.fromPlaceKey,
        toPlaceId: r.toPlaceKey,
        durationMinutes: r.minutes,
        modeLabel: '移动',
      }));
    if (!routes.some((r) => r.toPlaceId === placeKey && known.has(r.fromPlaceId)))
      throw new TaskError('INVALID_STATE');
    const eventId = randomUUID(),
      commandId = randomUUID(),
      version = c.version + 1,
      eventSource = {
        kind: 'world_event' as const,
        snapshotVersion: 0 as const,
        eventId,
        eventVersion: version,
      };
    const event: SpacePlaceRevealedEvent = {
      schemaVersion: 1,
      id: eventId,
      worldId,
      commandId,
      version,
      occurredAt: new Date().toISOString(),
      storyAt: new Date(Math.max(Date.parse(c.world.time), Date.parse(presentedAt))).toISOString(),
      type: 'space.place_revealed',
      data: {
        nodeKey: node.key,
        sourceEventId: proof.id,
        sourceMessageId: messageId,
        place: {
          id: placeKey,
          name: authored.name,
          description: authored.description,
          source: eventSource,
          contactActorIds: [],
          appointmentIds: [],
        },
        routes: routes.map((route) => ({ ...route, source: eventSource })),
      },
    };
    const next = applySpaceEvent(c.world, event);
    const snapshot = {
      ...next,
      messages: [],
      appointments: [],
      mediaRequests: [],
      notes: [],
      facts: [],
    };
    if (JSON.stringify(event).length >= 65536 || JSON.stringify(snapshot).length >= 262144)
      throw new TaskError('INVALID_STATE');
    const request = {
      kind: 'publication_story_place_reveal',
      nodeKey: node.key,
      sourceEventId: proof.id,
      sourceMessageId: messageId,
      placeKey,
    };
    const hash = createHash('sha256').update(JSON.stringify(request)).digest('hex');
    await sql.query(
      "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES($1,$2,$3,$4,$5,$6,'queued')",
      [commandId, worldId, ownerId, c.version, hash, request],
    );
    await sql.query(
      'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [eventId, worldId, ownerId, version, commandId, event, event.occurredAt],
    );
    await sql.query(
      'UPDATE parallel_life.worlds SET version=$2,state=$3,updated_at=now() WHERE id=$1 AND owner_id=$4',
      [worldId, version, snapshot, ownerId],
    );
    await sql.query(
      "UPDATE parallel_life.commands SET status='succeeded',result_event_id=$3,result_state=$4,updated_at=now() WHERE world_id=$1 AND id=$2",
      [worldId, commandId, eventId, snapshot],
    );
    c.world = next;
    c.version = version;
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
          if (node.intent.kind === 'offer_message' || node.intent.kind === 'director_event') {
            await this.save(
              sql,
              ownerId,
              worldId,
              c,
              {
                ...old,
                status: 'presented',
                outcome: node.intent.kind === 'director_event' ? null : 'committed',
                sourceEventId: proof.id,
                sourceMessageId: message.id,
              },
              'message_presented',
              proof.id,
              {},
              at,
            );
          } else if (node.intent.kind === 'offer_invitation') {
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
            if (invitation) {
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
            } else
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
    // A story receipt proves that the actor spoke, but does not prove that the player
    // learned an address. Only a successful, committed assistant message that actually
    // names the authored place (or its authored address) can disclose it. This scan also
    // catches a later NPC clarification after the original presentation omitted it.
    for (const s of c.states) {
      if (
        !['presented', 'offered', 'committed'].includes(s.status) ||
        !s.sourceEventId ||
        !s.sourceMessageId ||
        !s.actorId
      )
        continue;
      const node = c.plan.nodes.find((n) => n.key === s.nodeKey);
      const placeKey = node?.settingPlaceKey;
      if (!node || !placeKey || c.world.space?.places.some((p) => p.id === placeKey)) continue;
      const place = c.authoredPlaces.find((p) => p.key === placeKey);
      if (!place?.description || !this.canIntroducePlace(c, node)) continue;
      const message = (
        await sql.query(
          "SELECT e.id AS event_id,e.payload,m.id AS message_id FROM parallel_life.world_events source JOIN parallel_life.world_events e ON e.world_id=source.world_id AND e.owner_id=source.owner_id AND e.version>=source.version JOIN parallel_life.commands cmd ON cmd.id=e.command_id AND cmd.world_id=e.world_id AND cmd.owner_id=e.owner_id AND cmd.status='succeeded' AND cmd.result_event_id=e.id JOIN parallel_life.world_messages m ON m.world_id=e.world_id AND m.owner_id=e.owner_id AND m.actor_id=$4 AND m.document->>'actorId'=$4 AND m.document->>'role'='assistant' AND m.document->>'sourceEventId'=e.id WHERE source.world_id=$1 AND source.owner_id=$2 AND source.id=$3 AND e.payload->>'type'='turn.resolved' AND e.payload->'data'->>'actorId'=$4 AND ((char_length($5)>1 AND position($5 in m.document->>'text')>0) OR position($6 in m.document->>'text')>0) ORDER BY e.version,m.ordinal LIMIT 1",
          [worldId, ownerId, s.sourceEventId, s.actorId, place.name, place.description],
        )
      ).rows[0];
      if (message)
        await this.revealAuthoredPlace(
          sql,
          ownerId,
          worldId,
          c,
          node,
          { id: message.event_id },
          message.message_id,
          message.payload.storyAt ?? c.storyNow,
        );
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
  opportunities(
    ownerId: string,
    worldId: string,
    automatic: boolean,
  ): Promise<PublicationStoryOpportunities> {
    return this.tx(ownerId, worldId, async (sql, c) => {
      if (!c)
        return { managed: false, directorPool: false, version: 0, storyNow: '', candidates: [] };
      await this.reconcile(sql, ownerId, worldId, c);
      await this.progressContexts(sql, ownerId, worldId, c);
      const directorPool =
        c.plan.nodes.some((node) => node.intent.kind === 'director_event') ||
        (c.goalContexts ?? []).some((r) => r.progress.phase !== 'resolved');
      const pending = c.states.some((s) => ['claimed', 'unknown'].includes(s.status));
      const evaluation = evaluateStory(c.plan, c.states, { ...c, automatic });
      const setting = directorPool
        ? (
            await sql.query('SELECT parallel_life.publication_director_setting($1) AS setting', [
              worldId,
            ])
          ).rows[0].setting
        : null;
      const continuing: PublicationStoryOpportunities['candidates'] = [];
      for (const row of c.goalContexts ?? []) {
        if (row.progress.phase === 'resolved') continue;
        const brief = await this.progressSpeaker(sql, row, c);
        if (!brief || ['wait', 'finished'].includes(brief.nextMove)) continue;
        const node = row.record.node;
        const placeKey = node.settingPlaceKey ?? node.placeKey;
        continuing.push({
          nodeKey: node.key,
          title: node.title,
          editorialIntent: node.script ?? node.editorialIntent,
          actorId: brief.actorId,
          placeName: c.plan.places.find((p) => p.key === placeKey)?.name ?? null,
          placeDescription: placeKey ? (c.placeDescriptions.get(placeKey) ?? null) : null,
          eventProgress: brief,
        });
      }
      return {
        managed: true,
        directorPool,
        ...(setting ? { worldSetting: JSON.stringify(setting) } : {}),
        version: c.version,
        storyNow: c.storyNow,
        candidates:
          !directorPool || pending
            ? []
            : [
                ...continuing,
                ...[...evaluation.eligible]
                  .filter((node) => this.canIntroducePlace(c, node))
                  .sort(
                    (a, b) =>
                      Number((b.direction?.mode ?? 'optional') === 'required') -
                      Number((a.direction?.mode ?? 'optional') === 'required'),
                  )
                  .slice(0, 24)
                  .map((node) => {
                    const fixedActor = nodeActor(c.plan, node);
                    const actorOptions = eligibleStoryActors(c.plan, node, c.states, {
                      ...c,
                      automatic,
                    }).map((a) => ({
                      id: a.id,
                      key: a.key,
                      name: c.world.actors.find((person) => person.id === a.id)?.name ?? a.key,
                    }));
                    const placeKey =
                      node.intent.kind === 'offer_invitation'
                        ? node.intent.placeKey
                        : (node.settingPlaceKey ?? node.placeKey);
                    return {
                      nodeKey: node.key,
                      title: node.title,
                      editorialIntent: node.script ?? node.editorialIntent,
                      actorOptions,
                      ...(node.scenePlaceKeys?.length
                        ? {
                            places: c.authoredPlaces
                              .filter((p) => node.scenePlaceKeys!.includes(p.key))
                              .map((p) => ({
                                key: p.key,
                                name: p.name,
                                ...(p.description ? { description: p.description } : {}),
                              })),
                          }
                        : {}),
                      direction: {
                        ...node.direction,
                        mode:
                          (openingEventPending(c.plan, c.states) &&
                          node.key === c.plan.openingEventKey
                            ? 'required'
                            : node.direction?.mode) ?? 'optional',
                      },
                      ...(fixedActor ? { actorId: fixedActor.id } : {}),
                      placeName: c.plan.places.find((p) => p.key === placeKey)?.name ?? null,
                      placeDescription: placeKey
                        ? (c.placeDescriptions.get(placeKey) ?? null)
                        : null,
                    };
                  }),
              ],
      };
    });
  }
  beginSelection(
    ownerId: string,
    worldId: string,
    version: number,
    attemptId: string,
    candidateKeys: string[],
  ): Promise<boolean> {
    id(attemptId);
    return this.tx(ownerId, worldId, async (sql, c) => {
      if (!c || c.version !== version || !candidateKeys.length) return false;
      await this.reconcile(sql, ownerId, worldId, c);
      await this.progressContexts(sql, ownerId, worldId, c);
      if (c.version !== version) return false;
      if (c.states.some((s) => ['claimed', 'unknown'].includes(s.status))) return false;
      const legal = evaluateStory(c.plan, c.states, { ...c, automatic: false }).eligible.filter(
        (node) => this.canIntroducePlace(c, node),
      );
      if (
        candidateKeys.some(
          (key) =>
            !legal.some((n) => n.key === key) &&
            !c.goalContexts?.some(
              (r) => r.record.node.key === key && r.progress.phase !== 'resolved',
            ),
        )
      )
        return false;
      return (
        (
          await sql.query(
            'SELECT parallel_life.publication_story_selection_begin($1,$2,$3,$4,$5) AS allowed',
            [worldId, ownerId, version, attemptId, JSON.stringify(candidateKeys)],
          )
        ).rows[0].allowed === true
      );
    });
  }
  async finishSelection(
    ownerId: string,
    worldId: string,
    attemptId: string,
    status: 'selected' | 'deferred' | 'unknown',
    nodeKey: string | null,
  ): Promise<void> {
    id(attemptId);
    await this.tx(ownerId, worldId, async (sql) => {
      await sql.query('SELECT parallel_life.publication_story_selection_finish($1,$2,$3,$4,$5)', [
        worldId,
        ownerId,
        attemptId,
        status,
        nodeKey,
      ]);
    });
  }
  prepare(
    ownerId: string,
    worldId: string,
    {
      automatic = true,
      nodeKey,
      expectedVersion,
      actorId,
    }: { automatic?: boolean; nodeKey?: string; expectedVersion?: number; actorId?: string } = {},
  ): Promise<PublicationStoryPrepare> {
    return this.tx(ownerId, worldId, async (sql, c) => {
      if (!c) return { status: 'none', managed: false };
      await this.reconcile(sql, ownerId, worldId, c);
      await this.progressContexts(sql, ownerId, worldId, c);
      const pending = c.states.find((s) => s.status === 'claimed' || s.status === 'unknown');
      if (pending)
        return {
          status: pending.status === 'unknown' ? 'unknown' : 'busy',
          pendingClaimId: pending.claimId,
        };
      const e = evaluateStory(c.plan, c.states, { ...c, automatic });
      if (e.rateLimited) return { status: 'rate_limited' };
      if (expectedVersion !== undefined && expectedVersion !== c.version)
        throw new TaskError('VERSION_CONFLICT');
      // A director pool requires an explicit validated choice; never silently pick the first event.
      if (c.plan.nodes.some((n) => n.intent.kind === 'director_event') && !nodeKey)
        return { status: 'none', managed: true };
      const eligible = e.eligible.filter((n) => this.canIntroducePlace(c, n));
      const node = nodeKey ? eligible.find((n) => n.key === nodeKey) : eligible[0];
      if (!node) return { status: 'none', managed: true };
      const actors = eligibleStoryActors(c.plan, node, c.states, { ...c, automatic });
      const fixed = nodeActor(c.plan, node);
      const chosenActorId = actorId ?? fixed?.id;
      if (!chosenActorId || !actors.some((actor) => actor.id === chosenActorId))
        throw new TaskError('INVALID_INPUT');
      const s = this.fresh(c, node, 'claimed', automatic, chosenActorId);
      await this.save(sql, ownerId, worldId, c, s, 'claim', null, { automatic });
      return { status: 'claimed', claim: this.claim(c, s) };
    });
  }
  finish(ownerId: string, worldId: string, claimId: string) {
    id(claimId);
    return this.tx(ownerId, worldId, async (sql, c) => {
      if (!c || !c.states.some((s) => s.claimId === claimId)) throw new TaskError('NOT_FOUND');
      await this.reconcile(sql, ownerId, worldId, c);
      await this.progressContexts(sql, ownerId, worldId, c);
      return this.read(c);
    });
  }
  progress(ownerId: string, worldId: string) {
    return this.tx(ownerId, worldId, async (sql, c) => {
      if (c) {
        await this.reconcile(sql, ownerId, worldId, c);
        await this.progressContexts(sql, ownerId, worldId, c);
      }
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
      await this.progressContexts(sql, ownerId, worldId, c);
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
      await this.progressContexts(sql, ownerId, worldId, c);
      const s = c.states.find((s) => s.claimId === claimId);
      if (!s) {
        const row = c.goalContexts?.find(
          (r) =>
            (r.progress as typeof r.progress & { pendingBeat?: PendingPublicationBeat }).pendingBeat
              ?.claimId === claimId,
        );
        if (
          !row ||
          (row.progress as typeof row.progress & { pendingBeat?: PendingPublicationBeat })
            .pendingBeat?.channel === 'scene'
        )
          throw new TaskError('NOT_FOUND');
        const pending = await new PublicationProgressBeatStore().retry(
          sql,
          row.value,
          claimId,
          c.version,
        );
        const brief = await this.progressBrief(sql, row, c, pending.actorId);
        if (!brief) throw new TaskError('INVALID_STATE');
        const original = c.states.find((s) => s.nodeKey === row.record.node.key)!;
        return {
          status: 'claimed',
          claim: {
            ...this.claim(c, original),
            ...pending,
            actorKey: c.plan.actors.find((a) => a.id === pending.actorId)!.key,
            eventProgress: { ...brief, nextMove: pending.move },
          },
        };
      }
      if (s.sourceEventId || s.outcome) return { status: 'none', managed: true };
      if (!['unknown', 'failed'].includes(s.status)) throw new TaskError('BUSY');
      if (s.expectedVersion !== c.version) throw new TaskError('VERSION_CONFLICT');
      const node = c.plan.nodes.find((n) => n.key === s.nodeKey)!;
      if (!legalPresentation(c.plan, node, c.storyNow)) throw new TaskError('INVALID_STATE');
      if (
        node.intent.kind === 'director_event' &&
        !eligibleStoryActors(
          c.plan,
          node,
          c.states.filter((state) => state.nodeKey !== node.key),
          { ...c, automatic: false },
        ).some((actor) => actor.id === s.actorId)
      )
        throw new TaskError('INVALID_STATE');
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
      await this.progressContexts(sql, ownerId, worldId, c);
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
      await this.progressContexts(sql, ownerId, worldId, c);
      return readPublicationSceneBrief(sql, ownerId, worldId, invitationId);
    });
  }
}
