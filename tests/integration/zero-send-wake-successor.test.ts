import { createAgentScheduleSources } from '../../src/modules/world/application/agent-schedule-collectors.ts';
import { agentWakeCommandId } from '../../src/server/npc-agent-advance-services.ts';
import type { TextModel } from '../../src/modules/ai/application/ports.ts';
import { npcAgentAdvanceServices } from '../../src/server/npc-agent-advance-services.ts';
import { PostgresDirectorSnapshotRepository } from '../../src/modules/world/infrastructure/director-snapshot-repository.ts';
import {
  DEFAULT_OWN_AGENDA_RUNTIME_CONFIG,
  type OwnAgendaRuntimeConfig,
} from '../../src/modules/world/infrastructure/own-agenda-review-authority.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import {
  PostgresAgentRuntimeRepository,
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { admitNewAgentNarrativeInTransaction } from '../../src/modules/world/infrastructure/agent-narrative-repository.ts';
import {
  readPrivateAgentSnapshot,
  agentDefinitionRef,
} from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
const ACTOR_A = '11111111-1111-4111-8111-111111111111',
  ACTOR_B = '22222222-2222-4222-8222-222222222222';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
test('original advance replaces only an obsolete zero-send responsibility wake', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, 55587);
  const admin = await adminClient('parallel_life_test');
  assert.equal((await admin.query('SELECT inet_server_port() port')).rows[0].port, 55587);
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const fast: OwnAgendaRuntimeConfig = structuredClone(DEFAULT_OWN_AGENDA_RUNTIME_CONFIG);
  Object.assign(fast.policy, {
    storyGapMs: 1,
    realGapMs: 1,
    maxRealGapMs: 1,
    quietBackoffMultiplier: 1,
  });
  const worlds = new PostgresWorldRepository(db),
    clocks = new PostgresClockStore(db),
    store = new PostgresAgentRuntimeRepository(db, fast);
  const fixtures: { owner: string; worldId: string }[] = [];
  t.after(async () => {
    for (const f of fixtures) await clocks.setClock(f.owner, f.worldId, { paused: true });
    await db.close();
    await admin.end();
  });
  async function fixture() {
    const owner = randomUUID(),
      worldId = randomUUID();
    await new IdentityRepository(db).ensureGuest(owner);
    const world: WorldState = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: 'Synthetic evidence fixture',
      time: '2026-10-19T00:00:00.000Z',
      actors: [
        { id: ACTOR_A, name: 'A', persona: 'Independent quiet planner' },
        { id: ACTOR_B, name: 'B', persona: 'Reserved shopkeeper', relationship: 'Acquaintance' },
      ],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    };
    await worlds.initialize({ userId: owner }, world);
    await db.transaction(owner, async (sql) => {
      for (const a of world.actors)
        await initializeActorAgentStateInTransaction(sql, owner, {
          ...emptyActorAgentState({ worldId, actorId: a.id }, agentDefinitionRef(world, a.id), 0),
          responsibilities:
            a.id === ACTOR_A
              ? [
                  {
                    id: 'own-duty',
                    subject: { kind: 'matter', id: 'own-duty' },
                    summary: 'Consider own arrangement',
                    status: 'open',
                    waitingOn: 'self',
                    sourceIds: [`definition:${agentDefinitionRef(world, a.id)}`],
                    nextCheck: [
                      {
                        kind: 'observation',
                        sourceId: `definition:${agentDefinitionRef(world, a.id)}`,
                      },
                    ],
                  },
                ]
              : [],
        });
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId,
        expectedWorldVersion: 0,
        expectedEpoch: 1,
        nextEpoch: 2,
      });
      await admitNewAgentNarrativeInTransaction(sql, owner, { worldId, engineEpoch: 2 });
    });
    await clocks.write(owner, worldId, {
      storyNow: world.time,
      speed: 12,
      paused: false,
      lastTickAt: new Date().toISOString(),
      missedBeats: 0,
      summary: null,
    });
    const identity = {
      worldId,
      engineEpoch: 2,
      actorId: ACTOR_A,
      definitionRef: agentDefinitionRef(world, ACTOR_A),
    };
    fixtures.push({ owner, worldId });
    return { owner, worldId, world, identity };
  }
  const f = await fixture();
  const state = await store.read(f.owner, { worldId: f.worldId, actorId: ACTOR_A });
  const snapshot = (
    await readPrivateAgentSnapshot(db, f.owner, f.world, ACTOR_A, null, f.world.time, state)
  ).snapshot;
  const registrations = createAgentScheduleSources({
    worldId: f.worldId,
    engineEpoch: 2,
    worldVersion: 0,
    storyAt: f.world.time,
    actors: [{ snapshot, trustedResults: [], appointments: [] }],
    activeAttempts: [],
    consumedCandidateIds: [],
  });
  const candidate = (
    await registrations
      .find((r) => r.id === `responsibility:${ACTOR_A}`)!
      .source.collect(f.owner, f.worldId)
  ).candidates[0];
  assert.ok(candidate);
  const commandId = agentWakeCommandId(f.worldId, candidate.id);
  const text = JSON.stringify({
    type: 'npc_own_condition_ready',
    candidateId: candidate.id,
    source: candidate.source,
    actionId: candidate.actionId,
    basisSourceIds: candidate.sourceIds,
    nudges: [],
  });
  const { receipt } = await store.accept(f.owner, {
    id: randomUUID(),
    worldId: f.worldId,
    commandId,
    inputHash: hash(JSON.stringify([f.worldId, ACTOR_A, candidate.id, text])),
    channel: 'private',
    threadId: ACTOR_A,
    recipientActorId: ACTOR_A,
    expectedWorldVersion: 0,
    receivedAt: new Date().toISOString(),
    storyAt: f.world.time,
    origin: 'wake',
    text,
  });
  const claimed = await store.claim(f.owner, {
    id: randomUUID(),
    worldId: f.worldId,
    actorId: ACTOR_A,
    commandId,
    inputReceiptId: receipt.id,
    inputHash: receipt.inputHash,
    engineEpoch: 2,
    expectedWorldVersion: 0,
    expectedActorRevision: state!.revision,
    token: randomUUID(),
    leaseUntil: new Date(Date.now() + 240000).toISOString(),
  });
  const cancelled = await store.mark(f.owner, claimed.attempt, 'cancelled_before_send');
  const before = (
    await admin.query('SELECT * FROM parallel_life.agent_attempts WHERE id=$1', [cancelled.id])
  ).rows[0];
  const receiptBefore = (
    await admin.query('SELECT * FROM parallel_life.agent_input_receipts WHERE id=$1', [receipt.id])
  ).rows[0];
  await worlds.saveNote(
    { userId: f.owner },
    {
      commandId: randomUUID(),
      worldId: f.worldId,
      title: 'Actual independent change',
      text: 'Synthetic player note',
      expectedVersion: 0,
    },
  );
  assert.equal((await worlds.get({ userId: f.owner }, f.worldId)).version, 1);
  let ownCalls = 0;
  const model: TextModel = {
    async complete(messages) {
      const p = JSON.parse(messages.find((m) => m.role === 'user')!.content);
      if (p.promptVersion.startsWith('director-'))
        return JSON.stringify({
          protocol: 'director-wire-v4',
          mode: 'quiet',
          candidates: p.wireCatalog.candidates.map((c: any) => ({
            ref: c.ref,
            decision: 'defer',
            reason: 'No new arrangement',
          })),
          events: p.wireCatalog.events.map((e: any) => ({
            eventRef: e.ref,
            decision: 'defer',
            reason: 'No new arrangement',
          })),
          opportunities: [],
          audit: { reason: 'Independent personal work', sourceRefs: [] },
        });
      const input = JSON.parse(p.input.text);
      if (input.type === 'npc_own_condition_ready') {
        ownCalls++;
        assert.equal(input.zeroSendRecoveryOfAttemptId, cancelled.id);
      }
      return JSON.stringify({
        protocol: 'npc-wire-v9',
        consideration: null,
        statements: [],
        executions: [],
        goals: [],
        planIntents: [],
        responsibilities: [],
        inputInterpretation: null,
        focusChange: { kind: 'keep' },
        questionWithdrawals: null,
        locationReports: null,
        agendaReview: null,
      });
    },
  };
  const services = npcAgentAdvanceServices(
    db,
    () => model,
    new PostgresDirectorSnapshotRepository(db),
    { maxActors: 2, maxSteps: 6, maxModelCalls: 6 },
  );
  await services.advanceIfEnabled(f.owner, f.worldId);
  assert.equal(ownCalls, 1);
  const successors = (
    await admin.query(
      'SELECT a.*,r.document AS receipt FROM parallel_life.agent_attempts a JOIN parallel_life.agent_input_receipts r ON r.id=a.input_receipt_id WHERE a.world_id=$1 AND a.command_id<>$2 AND a.actor_id=$3',
      [f.worldId, commandId, ACTOR_A],
    )
  ).rows;
  assert.ok(
    successors.some(
      (a) =>
        a.status === 'committed' &&
        JSON.parse(a.receipt.text).zeroSendRecoveryOfAttemptId === cancelled.id,
    ),
  );
  assert.deepEqual(
    (await admin.query('SELECT * FROM parallel_life.agent_attempts WHERE id=$1', [cancelled.id]))
      .rows[0],
    before,
  );
  assert.deepEqual(
    (
      await admin.query('SELECT * FROM parallel_life.agent_input_receipts WHERE id=$1', [
        receipt.id,
      ])
    ).rows[0],
    receiptBefore,
  );
  await services.advanceIfEnabled(f.owner, f.worldId);
  assert.equal(ownCalls, 1, 'committed semantic work is not purchased again');
});
