import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import type { SqlClient } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import {
  PostgresAgentRuntimeRepository,
  initializeActorAgentStateInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import {
  agentDefinitionRef,
  readPrivateAgentSnapshot,
} from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { readChatContextWorld } from '../../src/modules/world/infrastructure/chat-context-read-repository.ts';
import { ChatContextFallbackError } from '../../src/modules/world/application/chat-context-read.ts';
import { actorContext } from '../../src/modules/world/application/actor-context.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';

const START = '2026-10-20T08:00:00.000Z';
const END = '2026-10-20T18:00:00.000Z';

function counted(db: PostgresDatabase) {
  const stats = { queries: 0 };
  const wrapped = {
    pool: db.pool,
    close: () => db.close(),
    async transaction<T>(owner: string, run: (sql: SqlClient) => Promise<T>): Promise<T> {
      return db.transaction(owner, async (sql) => {
        const proxy = new Proxy(sql, {
          get(target, prop, receiver) {
            if (prop === 'query') {
              return (...args: Parameters<SqlClient['query']>) => {
                stats.queries += 1;
                return target.query(...args);
              };
            }
            const value = Reflect.get(target, prop, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        return run(proxy);
      });
    },
  } as PostgresDatabase;
  return { db: wrapped, stats };
}

test('44-169 bounded chat context: recent window, complete active obligations, exact old references and author/runtime merge', async (t) => {
  const config = await localConfig();
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const base = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  const owner = randomUUID();
  const worldId = randomUUID();
  const actorId = randomUUID();
  const otherActorId = randomUUID();
  const oldMessageId = randomUUID();
  const oldFactId = randomUUID();
  const linkedFactId = randomUUID();
  const oldAppointmentId = randomUUID();
  const initialAppointmentId = randomUUID();
  const staleAppointmentId = randomUUID();
  const messageIdsByVersion = new Map<number, string>();
  const secretFactId = randomUUID();
  const secretMessageId = randomUUID();
  const openingIds = [randomUUID(), randomUUID()];
  const latestMessageId = randomUUID();
  let unreferencedOldMessageId = '';
  const matterId = randomUUID();
  const commandIds: string[] = [];
  let fixtureOpen = false;
  t.after(async () => {
    try {
      if (fixtureOpen) await admin.query('ROLLBACK').catch(() => {});
      for (const id of commandIds)
        await admin.query('DELETE FROM parallel_life.commands WHERE world_id=$1 AND id=$2', [
          worldId,
          id,
        ]);
      await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [owner]);
    } finally {
      await base.close();
      await admin.end();
    }
  });

  await new IdentityRepository(base).ensureGuest(owner);
  const actors = [
    { id: actorId, name: '林岸', persona: '说话简短，守旧约。' },
    { id: otherActorId, name: '周遥', persona: '独立生活，不替别人做决定。' },
  ];
  const earlyAt = '2026-10-20T08:01:00.000Z';
  const world: WorldState = {
    schemaVersion: 1,
    id: worldId,
    ownerId: owner,
    version: 0,
    title: '44-169 bounded context fixture',
    time: START,
    actors,
    facts: [
      {
        id: 'genesis-fact',
        text: '世界开场背景：河岸旧桥。',
        visibility: { kind: 'world' },
        sourceEventId: `genesis:${worldId}`,
        kind: 'canonical',
      },
    ],
    messages: [],
    appointments: [],
    mediaRequests: [],
    matters: [
      {
        id: matterId,
        worldId,
        span: 'near_term',
        title: '完成很早之前的约定',
        description: '很早之前的明确约定，仍然有效。',
        status: 'in_progress',
        assertion: 'player_statement',
        visibility: 'player_visible',
        relatedActorIds: [actorId],
        source: {
          kind: 'actor_proposal',
          actorId,
          eventId: 'pending',
          eventVersion: 1,
          at: earlyAt,
        },
        version: 1,
        createdAt: earlyAt,
        updatedAt: earlyAt,
      },
    ],
    choices: [
      {
        id: 'old-choice',
        actorId,
        quote: '我会还记得。',
        intent: '记住旧约定',
        sourceEventId: 'pending',
        sourceVersion: 1,
        status: 'pending',
      },
    ],
  };
  await new PostgresWorldRepository(base).initialize({ userId: owner }, world);
  await base.transaction(owner, async (sql) => {
    for (const actor of actors)
      await initializeActorAgentStateInTransaction(
        sql,
        owner,
        emptyActorAgentState(
          { worldId, actorId: actor.id },
          agentDefinitionRef(world, actor.id),
          0,
        ),
      );
  });

  const initialWorld: WorldState = {
    ...world,
    messages: openingIds.map((id, index) => ({
      id,
      actorId,
      role: 'assistant' as const,
      text: `作者预设开场 ${index + 1}：旧桥见。`,
      at: START,
      sourceEventId: `genesis:${worldId}`,
    })),
    appointments: [
      {
        id: initialAppointmentId,
        title: '作者初始约定',
        at: earlyAt,
        participantIds: [actorId],
        sourceEventId: `genesis:${worldId}`,
        status: 'proposed',
      },
    ],
  };
  await admin.query(
    'DELETE FROM parallel_life.world_initial_snapshots WHERE world_id=$1 AND owner_id=$2',
    [worldId, owner],
  );
  await admin.query(
    'INSERT INTO parallel_life.world_initial_snapshots(world_id,owner_id,version,state,approved_seed) VALUES($1,$2,0,$3,$4)',
    [worldId, owner, JSON.stringify(initialWorld), '{}'],
  );

  const shortFullCounter = counted(base);
  const shortFullStart = performance.now();
  const shortFull = await new PostgresWorldRepository(shortFullCounter.db).get(
    { userId: owner },
    worldId,
  );
  const shortFullMs = performance.now() - shortFullStart;
  const shortFullBytes = Buffer.byteLength(JSON.stringify(shortFull));
  const shortFullRows =
    shortFull.messages.length + shortFull.facts.length + shortFull.appointments.length;
  const shortCounter = counted(base);
  const shortStart = performance.now();
  const short = await readChatContextWorld(shortCounter.db, owner, {
    worldId,
    actorId,
  });
  const shortMs = performance.now() - shortStart;
  const shortBytes = Buffer.byteLength(JSON.stringify(short.world));
  const shortRows =
    short.world.messages.length + short.world.facts.length + short.world.appointments.length;
  assert.equal(short.completeness.messages.runtimeCount, 0);
  assert.equal(short.completeness.messages.runtimeWindowHasMore, false);
  assert.equal(short.completeness.messages.openingCount, openingIds.length);
  assert.deepEqual(
    short.world.messages.map((message) => message.id),
    openingIds,
  );
  assert.equal(short.world.appointments.length, 1);
  assert.equal(short.world.appointments[0]?.id, initialAppointmentId);
  assert.equal(short.world.appointments[0]?.status, 'proposed');

  const state = await new PostgresAgentRuntimeRepository(base).read(owner, { worldId, actorId });
  assert.ok(state);
  await admin.query('BEGIN');
  fixtureOpen = true;
  let factOrdinal = 0;
  const insertVersion = async (
    version: number,
    actor: string,
    text: string,
    options: {
      messageId?: string;
      role?: 'user' | 'assistant';
      factId?: string;
      factText?: string;
      appointmentId?: string;
      appointmentStatus?: 'proposed' | 'confirmed' | 'cancelled';
    } = {},
  ) => {
    const commandId = randomUUID();
    const eventId = randomUUID();
    const messageId = options.messageId ?? randomUUID();
    commandIds.push(commandId);
    const at = new Date(Date.parse(START) + version * 60_000).toISOString();
    await admin.query(
      `INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status,result_event_id,result_state)
       VALUES($1,$2,$3,$4,$5,$6,'succeeded',$7,$8)`,
      [
        commandId,
        worldId,
        owner,
        version - 1,
        createHash('sha256').update(`${worldId}:${version}`).digest('hex'),
        '{}',
        eventId,
        '{}',
      ],
    );
    await admin.query(
      'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        eventId,
        worldId,
        owner,
        version,
        commandId,
        JSON.stringify({
          type: 'turn.resolved',
          storyTime: at,
          data: { actorId: actor, origin: 'player', userText: text },
        }),
        at,
      ],
    );
    if (actor === actorId) messageIdsByVersion.set(version, messageId);
    await admin.query(
      'INSERT INTO parallel_life.world_messages(id,world_id,owner_id,actor_id,document) VALUES($1,$2,$3,$4,$5)',
      [
        messageId,
        worldId,
        owner,
        actor,
        JSON.stringify({
          id: messageId,
          actorId: actor,
          role: options.role ?? 'assistant',
          text,
          at,
          sourceEventId: eventId,
          sourceVersion: version,
        }),
      ],
    );
    if (options.factId) {
      await admin.query(
        'INSERT INTO parallel_life.world_facts(id,world_id,owner_id,ordinal,document) VALUES($1,$2,$3,$4,$5)',
        [
          options.factId,
          worldId,
          owner,
          factOrdinal++,
          JSON.stringify({
            id: options.factId,
            text: options.factText ?? text,
            visibility: { kind: 'world' },
            sourceEventId: eventId,
            kind: 'canonical',
          }),
        ],
      );
    }
    if (options.appointmentId) {
      const status = options.appointmentStatus ?? 'confirmed';
      await admin.query(
        'INSERT INTO parallel_life.world_appointments(id,world_id,owner_id,document,status) VALUES($1,$2,$3,$4,$5)',
        [
          options.appointmentId,
          worldId,
          owner,
          JSON.stringify({
            id: options.appointmentId,
            title: `约定 ${version}`,
            at,
            participantIds: [actorId],
            sourceEventId: eventId,
            status,
          }),
          status,
        ],
      );
    }
    return { eventId, messageId };
  };

  const early = await insertVersion(1, actorId, '很早之前：我答应你，旧桥的事我不会忘。', {
    messageId: oldMessageId,
    factId: oldFactId,
    factText: '很早之前的明确约定仍然有效。',
    appointmentId: oldAppointmentId,
    appointmentStatus: 'confirmed',
  });
  await admin.query(
    'INSERT INTO parallel_life.world_facts(id,world_id,owner_id,ordinal,document) VALUES($1,$2,$3,$4,$5)',
    [
      linkedFactId,
      worldId,
      owner,
      factOrdinal++,
      JSON.stringify({
        id: linkedFactId,
        text: '很早之前的事项见证事实。',
        visibility: { kind: 'world' },
        sourceEventId: early.eventId,
        kind: 'canonical',
      }),
    ],
  );
  await admin.query(
    'INSERT INTO parallel_life.world_appointments(id,world_id,owner_id,document,status) VALUES($1,$2,$3,$4,$5)',
    [
      staleAppointmentId,
      worldId,
      owner,
      JSON.stringify({
        id: staleAppointmentId,
        title: '投影仍旧的约定',
        at: earlyAt,
        participantIds: [actorId],
        sourceEventId: early.eventId,
        status: 'proposed',
      }),
      'proposed',
    ],
  );
  for (let version = 2; version <= 600; version++) {
    const isOther = version === 599;
    await insertVersion(
      version,
      isOther ? otherActorId : actorId,
      isOther ? 'OTHER_ACTOR_PRIVATE_SECRET' : `第 ${version} 轮普通聊天。`,
      {
        messageId: isOther
          ? secretMessageId
          : version === 600
            ? latestMessageId
            : version === 100
              ? (unreferencedOldMessageId = randomUUID())
              : undefined,
        role: version % 2 === 0 ? 'user' : 'assistant',
        ...(version % 6 === 0
          ? { factId: `fact-${version}`, factText: `近期事实 ${version}。` }
          : {}),
        ...(version % 12 === 0
          ? {
              appointmentId: `appt-${version}`,
              appointmentStatus: version % 24 === 0 ? 'confirmed' : 'cancelled',
            }
          : {}),
      },
    );
  }
  await admin.query(
    "UPDATE parallel_life.worlds SET version=600,state=jsonb_set(state,'{time}',to_jsonb($3::text)) WHERE id=$1 AND owner_id=$2",
    [worldId, owner, END],
  );
  // The matter/choice source event must be the actual early event, not a placeholder.
  await admin.query(
    "UPDATE parallel_life.worlds SET state=jsonb_set(jsonb_set(state,'{matters,0,source}', $3::jsonb),'{choices,0,sourceEventId}',to_jsonb($4::text)) WHERE id=$1 AND owner_id=$2",
    [
      worldId,
      owner,
      JSON.stringify({
        kind: 'actor_proposal',
        actorId,
        eventId: early.eventId,
        eventVersion: 1,
        at: earlyAt,
      }),
      early.eventId,
    ],
  );

  const source = `message:${oldMessageId}`;
  await admin.query(
    `UPDATE parallel_life.actor_agent_states
     SET document=$3::jsonb,projected_world_version=600
     WHERE world_id=$1 AND owner_id=$2 AND actor_id=$4`,
    [
      worldId,
      owner,
      JSON.stringify({
        ...state,
        projectedWorldVersion: 600,
        knowledgeSourceIds: [source],
        goals: [
          {
            id: 'old-goal',
            summary: '完成很早之前的约定',
            status: 'active',
            sourceIds: [source, `appointment:${oldAppointmentId}`],
            resultIds: [],
          },
        ],
        plans: [
          {
            id: 'old-plan',
            goalId: 'old-goal',
            summary: '仍有效的旧计划',
            status: 'active',
            sourceIds: [source],
            actionIds: [],
            nextActionId: null,
            triggers: [],
            missingConditions: [],
          },
        ],
        responsibilities: [
          {
            id: 'old-responsibility',
            revision: 0,
            subject: { kind: 'appointment', id: oldAppointmentId },
            summary: '仍有效的旧约定责任',
            status: 'waiting',
            waitingOn: 'player',
            sourceIds: [source, `appointment:${oldAppointmentId}`],
            nextCheck: [],
          },
        ],
        decisions: [
          {
            id: 'old-decision',
            responsibilityId: 'old-responsibility',
            kind: 'declined',
            sourceId: source,
            quote: '我明确拒绝过这件事。',
          },
        ],
        questions: [
          {
            id: 'old-question',
            channel: 'private',
            threadId: actorId,
            sourceId: source,
            text: '旧问题仍然有效吗？',
            askedAt: earlyAt,
            status: 'open',
          },
        ],
      }),
      actorId,
    ],
  );

  // A visible verdict fact from another actor must never enter this actor's bounded reader.
  await admin.query(
    'INSERT INTO parallel_life.world_facts(id,world_id,owner_id,ordinal,document) VALUES($1,$2,$3,$4,$5)',
    [
      secretFactId,
      worldId,
      owner,
      factOrdinal++,
      JSON.stringify({
        id: secretFactId,
        text: 'OTHER_ACTOR_PRIVATE_FACT',
        visibility: { kind: 'actors', actorIds: [otherActorId] },
        sourceEventId: early.eventId,
        kind: 'belief',
      }),
    ],
  );

  await admin.query('COMMIT');
  fixtureOpen = false;
  const { db: fullDb, stats: fullStats } = counted(base);
  const fullStart = performance.now();
  const full = await new PostgresWorldRepository(fullDb).get({ userId: owner }, worldId);
  const fullMs = performance.now() - fullStart;
  const fullBytes = Buffer.byteLength(JSON.stringify(full));
  const fullRows = full.messages.length + full.facts.length + full.appointments.length;

  const { db: boundedDb, stats: boundedStats } = counted(base);
  const boundedStart = performance.now();
  const bounded = await readChatContextWorld(boundedDb, owner, {
    worldId,
    actorId,
  });
  const boundedMs = performance.now() - boundedStart;
  const boundedBytes = Buffer.byteLength(JSON.stringify(bounded.world));
  const boundedRows =
    bounded.world.messages.length + bounded.world.facts.length + bounded.world.appointments.length;

  assert.equal(bounded.world.version, 600);
  assert.equal(bounded.world.messages.at(-1)?.id, latestMessageId);
  assert.ok(bounded.world.messages.some((message) => message.id === oldMessageId));
  assert.equal(
    bounded.world.messages.some((message) => message.id === unreferencedOldMessageId),
    false,
  );
  assert.equal(
    bounded.world.messages.some((message) => message.text.includes('OTHER_ACTOR_PRIVATE_SECRET')),
    false,
  );
  assert.equal(bounded.completeness.messages.runtimeWindowHasMore, true);
  assert.equal(bounded.completeness.messages.runtimeCount, 200);
  assert.deepEqual(
    bounded.world.messages.slice(0, 2).map((message) => message.id),
    openingIds,
  );
  assert.ok(bounded.world.matters?.some((matter) => matter.id === matterId));
  assert.ok(bounded.world.choices?.some((choice) => choice.id === 'old-choice'));
  assert.ok(bounded.actorState?.goals.some((goal) => goal.id === 'old-goal'));
  assert.ok(
    bounded.actorState?.responsibilities.some(
      (responsibility) => responsibility.id === 'old-responsibility',
    ),
  );
  assert.ok(bounded.actorState?.questions?.some((question) => question.id === 'old-question'));
  assert.ok(bounded.actorState?.decisions.some((decision) => decision.id === 'old-decision'));
  assert.ok(bounded.world.facts.some((fact) => fact.id === linkedFactId));
  assert.ok(bounded.world.appointments.some((appointment) => appointment.id === oldAppointmentId));
  assert.ok(boundedRows < fullRows, `bounded rows ${boundedRows} should be less than ${fullRows}`);
  assert.ok(
    boundedBytes < fullBytes,
    `bounded bytes ${boundedBytes} should be less than ${fullBytes}`,
  );

  const referenced = await readChatContextWorld(base, owner, {
    worldId,
    actorId,
    referencedSourceIds: [
      `message:${oldMessageId}`,
      `fact:${oldFactId}`,
      `appointment:${oldAppointmentId}`,
      'media-result:missing-media',
      'action-result:missing-action',
      `message:${randomUUID()}`,
      `fact:${secretFactId}`,
    ],
  });
  assert.ok(referenced.world.messages.some((message) => message.id === oldMessageId));
  assert.ok(referenced.world.facts.some((fact) => fact.id === oldFactId));
  assert.ok(
    referenced.world.appointments.some((appointment) => appointment.id === oldAppointmentId),
  );
  assert.deepEqual(referenced.completeness.referenced.deferredToExistingResolver, [
    'media-result:missing-media',
    'action-result:missing-action',
  ]);
  assert.equal(referenced.completeness.referenced.explicitUnresolved.length, 2);
  assert.ok(
    referenced.completeness.referenced.stateRequired.some((id) => id === `message:${oldMessageId}`),
  );
  assert.ok(
    referenced.completeness.referenced.stateResolved.some((id) => id === `message:${oldMessageId}`),
  );
  assert.equal(
    referenced.world.facts.some((fact) => fact.id === secretFactId),
    false,
  );
  assert.equal(
    referenced.completeness.mediaResults,
    'not_loaded_existing_media_result_resolver_remains_required',
  );

  // Existing snapshot reader accepts the bounded world without pretending it is complete.
  const attempts = new PostgresAgentRuntimeRepository(base);
  const input = (
    await attempts.accept(owner, {
      id: randomUUID(),
      worldId,
      commandId: randomUUID(),
      inputHash: createHash('sha256').update(`${worldId}:input`).digest('hex'),
      channel: 'private',
      threadId: actorId,
      recipientActorId: actorId,
      expectedWorldVersion: 600,
      receivedAt: END,
      storyAt: END,
      origin: 'player',
      text: '你还记得很早之前的约定吗？',
    })
  ).receipt;
  const currentState = (await attempts.read(owner, { worldId, actorId }))!;
  const fullSnapshot = (
    await readPrivateAgentSnapshot(base, owner, full, actorId, input, END, currentState)
  ).snapshot;
  const boundedSnapshot = (
    await readPrivateAgentSnapshot(base, owner, bounded.world, actorId, input, END, currentState, {
      referencedSourceIds: bounded.completeness.referenced.deferredToExistingResolver,
    })
  ).snapshot;
  for (const snapshot of [fullSnapshot, boundedSnapshot]) {
    assert.equal(snapshot.input.text, input.text);
    assert.ok(snapshot.state.goals.some((goal) => goal.id === 'old-goal'));
    assert.ok(snapshot.state.responsibilities.some((item) => item.id === 'old-responsibility'));
    assert.ok(snapshot.sources.some((item) => item.id === source));
    assert.ok(
      snapshot.observations.every(
        (observation) => !observation.text.includes('OTHER_ACTOR_PRIVATE_FACT'),
      ),
    );
  }

  // Task B evidence: the existing actor-context budget builder is cheap at this size.
  const contextStart = performance.now();
  const contextRuns = 20;
  for (let i = 0; i < contextRuns; i++)
    actorContext(bounded.world, actorId, '你还记得很早之前的约定吗？');
  const contextMs = (performance.now() - contextStart) / contextRuns;
  const originalStringify = JSON.stringify;
  let stringifyCalls = 0;
  const json = JSON as unknown as { stringify: (...args: any[]) => any };
  json.stringify = (...args: any[]) => {
    stringifyCalls += 1;
    return (originalStringify as (...values: any[]) => any)(...args);
  };
  try {
    actorContext(bounded.world, actorId, '你还记得很早之前的约定吗？');
  } finally {
    json.stringify = originalStringify;
  }
  t.diagnostic(
    JSON.stringify({
      full: {
        queries: fullStats.queries,
        rows: fullRows,
        bytes: fullBytes,
        ms: Math.round(fullMs * 100) / 100,
        messages: full.messages.length,
        facts: full.facts.length,
        appointments: full.appointments.length,
      },
      short: {
        full: {
          queries: shortFullCounter.stats.queries,
          rows: shortFullRows,
          bytes: shortFullBytes,
          ms: Math.round(shortFullMs * 100) / 100,
          messages: shortFull.messages.length,
        },
        bounded: {
          queries: shortCounter.stats.queries,
          rows: shortRows,
          bytes: shortBytes,
          ms: Math.round(shortMs * 100) / 100,
          messages: short.world.messages.length,
        },
      },
      bounded: {
        queries: boundedStats.queries,
        rows: boundedRows,
        bytes: boundedBytes,
        ms: Math.round(boundedMs * 100) / 100,
        messages: bounded.world.messages.length,
        facts: bounded.world.facts.length,
        appointments: bounded.world.appointments.length,
        runtimeWindowHasMore: bounded.completeness.messages.runtimeWindowHasMore,
        jsonStringifyCallsPerContext: stringifyCalls,
        actorContextMsPerCall: Math.round(contextMs * 100) / 100,
      },
    }),
  );

  // Invitation responses exist only in history while the appointment projection is stale.
  // The bounded reader must apply the original domain rule, not trust the projection.
  await admin.query('BEGIN');
  try {
    const insertResponse = async (version: number, appointmentId: string) => {
      const commandId = randomUUID();
      const eventId = randomUUID();
      commandIds.push(commandId);
      await admin.query(
        `INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status,result_event_id,result_state)
         VALUES($1,$2,$3,$4,$5,$6,'succeeded',$7,$8)`,
        [
          commandId,
          worldId,
          owner,
          version - 1,
          createHash('sha256').update(`${worldId}:response:${version}`).digest('hex'),
          '{}',
          eventId,
          '{}',
        ],
      );
      await admin.query(
        'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          eventId,
          worldId,
          owner,
          version,
          commandId,
          JSON.stringify({
            schemaVersion: 1,
            type: 'invitation.responded',
            id: eventId,
            worldId,
            version,
            commandId,
            occurredAt: END,
            storyTime: END,
            data: {
              commandId,
              worldId,
              id: appointmentId,
              expectedVersion: version - 1,
              operation: 'cancel',
            },
          }),
          END,
        ],
      );
    };
    await insertResponse(601, initialAppointmentId);
    await insertResponse(602, staleAppointmentId);
    await admin.query('UPDATE parallel_life.worlds SET version=602 WHERE id=$1 AND owner_id=$2', [
      worldId,
      owner,
    ]);
    await admin.query('COMMIT');
  } catch (error) {
    await admin.query('ROLLBACK');
    throw error;
  }
  const fullAfterResponses = await new PostgresWorldRepository(base).get(
    { userId: owner },
    worldId,
  );
  const boundedAfterResponses = await readChatContextWorld(base, owner, {
    worldId,
    actorId,
  });
  const appointmentStatus = (
    world: { appointments: { id: string; status?: string }[] },
    id: string,
  ) => world.appointments.find((appointment) => appointment.id === id)?.status;
  assert.equal(appointmentStatus(fullAfterResponses, initialAppointmentId), 'cancelled');
  assert.equal(appointmentStatus(boundedAfterResponses.world, initialAppointmentId), 'cancelled');
  assert.equal(appointmentStatus(fullAfterResponses, staleAppointmentId), 'cancelled');
  assert.equal(appointmentStatus(boundedAfterResponses.world, staleAppointmentId), 'cancelled');

  // Caller-supplied refs are optional and explicitly capped; over the cap we fall back.
  await assert.rejects(
    readChatContextWorld(base, owner, {
      worldId,
      actorId,
      referencedSourceIds: Array.from({ length: 257 }, (_, index) => `message:missing-${index}`),
    }),
    (error: any) =>
      error instanceof ChatContextFallbackError && error.reason === 'explicit-reference-limit',
  );

  // Persistent state references above the old 256 cap are read exactly, not sliced.
  const manyHandles = Array.from({ length: 300 }, (_, index) => {
    const messageId = messageIdsByVersion.get(index + 1);
    return messageId ? `message:${messageId}` : null;
  }).filter((id): id is string => Boolean(id));
  assert.equal(manyHandles.length, 300);
  await admin.query(
    "UPDATE parallel_life.actor_agent_states SET document=jsonb_set(document,'{knowledgeSourceIds}',$3::jsonb) WHERE world_id=$1 AND owner_id=$2 AND actor_id=$4",
    [worldId, owner, JSON.stringify(manyHandles), actorId],
  );
  const manyReferences = await readChatContextWorld(base, owner, {
    worldId,
    actorId,
  });
  assert.ok(manyReferences.completeness.referenced.stateRequired.length >= 300);
  assert.ok(manyReferences.completeness.referenced.stateResolved.length >= 300);
  assert.ok(
    manyReferences.world.messages.some((message) => message.id === messageIdsByVersion.get(1)),
  );
  assert.ok(
    manyReferences.world.messages.some((message) => message.id === messageIdsByVersion.get(300)),
  );

  // Matter-linked evidence beyond the deterministic 200 row cap is a fallback, not silent loss.
  await admin.query('BEGIN');
  try {
    for (let index = 0; index < 201; index++) {
      const factId = randomUUID();
      await admin.query(
        'INSERT INTO parallel_life.world_facts(id,world_id,owner_id,ordinal,document) VALUES($1,$2,$3,$4,$5)',
        [
          factId,
          worldId,
          owner,
          factOrdinal++,
          JSON.stringify({
            id: factId,
            text: `事项证据溢出 ${index}`,
            visibility: { kind: 'world' },
            sourceEventId: early.eventId,
            kind: 'canonical',
          }),
        ],
      );
    }
    await admin.query('COMMIT');
  } catch (error) {
    await admin.query('ROLLBACK');
    throw error;
  }
  await assert.rejects(
    readChatContextWorld(base, owner, {
      worldId,
      actorId,
    }),
    (error: any) =>
      error instanceof ChatContextFallbackError && error.reason === 'linked-evidence-limit',
  );

  // Legacy attendance worlds keep the existing full-hydrate path instead of a stale projection.
  await admin.query('BEGIN');
  try {
    const commandId = randomUUID();
    const eventId = randomUUID();
    await admin.query(
      `INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status,result_event_id,result_state)
       VALUES($1,$2,$3,$4,$5,$6,'succeeded',$7,$8)`,
      [
        commandId,
        worldId,
        owner,
        602,
        createHash('sha256').update(`${worldId}:attendance`).digest('hex'),
        '{}',
        eventId,
        '{}',
      ],
    );
    await admin.query(
      'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        eventId,
        worldId,
        owner,
        603,
        commandId,
        JSON.stringify({
          type: 'turn.resolved',
          storyTime: END,
          data: { actorId, worldResults: { attendance: { legacyFixture: true } } },
        }),
        END,
      ],
    );
    await admin.query('UPDATE parallel_life.worlds SET version=603 WHERE id=$1 AND owner_id=$2', [
      worldId,
      owner,
    ]);
    await admin.query('COMMIT');
  } catch (error) {
    await admin.query('ROLLBACK');
    throw error;
  }
  await assert.rejects(
    readChatContextWorld(base, owner, {
      worldId,
      actorId,
    }),
    (error: any) => error instanceof ChatContextFallbackError && error.reason === 'attendance',
  );
});
