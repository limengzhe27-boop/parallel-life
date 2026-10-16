import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { PostgresWorldSpace } from '../../src/modules/world/infrastructure/space-repository.ts';
import {
  SceneRepository,
  commitSceneProposal,
} from '../../src/modules/world/infrastructure/scene-repository.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { officialLifeCatalog } from '../../src/modules/settings/infrastructure/official-presets/index.ts';
import {
  PostgresAgentRuntimeRepository,
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { PostgresDirectorSnapshotRepository } from '../../src/modules/world/infrastructure/director-snapshot-repository.ts';
import {
  PostgresDirectorRuntimeRepository,
  directorSnapshotInputHash,
} from '../../src/modules/world/infrastructure/director-runtime-repository.ts';
import { PostgresWorldAwarenessRepository } from '../../src/modules/world/infrastructure/world-awareness-repository.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { projectStoryTime } from '../../src/modules/world/domain/clock.ts';
import { worldBoundary } from '../../src/modules/world/domain/world-awareness.ts';
import {
  npcAgentAdvanceServices,
  type DirectorSnapshotReader,
} from '../../src/server/npc-agent-advance-services.ts';
import { npcAgentServices } from '../../src/server/npc-agent-services.ts';
import type { DirectorSnapshot } from '../../src/modules/world/domain/director-runtime.ts';
import type {
  ActorAgentState,
  AgentProposal,
} from '../../src/modules/world/domain/agent-runtime.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
import type { TextModel, ModelMessage } from '../../src/modules/ai/application/ports.ts';
import type { AgentSnapshot } from '../../src/modules/world/application/agent-runtime-ports.ts';

const empty = (): AgentProposal => ({
  statements: [],
  goals: [],
  plans: [],
  actions: [],
  responsibilities: [],
  decisions: [],
});
type NpcPayload = {
  promptVersion: string;
  state: ActorAgentState;
  actor: { persona: string };
  input: { sourceId: string; origin: string; text: string };
  worldContext?: AgentSnapshot['worldContext'];
};
test('actual epoch2 advance: real PG sources/receipts/kernel/director with explicit mock model outputs only', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.NPC_ADVANCE_TEST_PORT ?? 55566));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const worlds = new PostgresWorldRepository(db),
    clocks = new PostgresClockStore(db),
    store = new PostgresAgentRuntimeRepository(db),
    directors = new PostgresDirectorRuntimeRepository(db);
  const owned: { id: string; owner: string }[] = [];
  t.after(async () => {
    try {
      for (const f of owned) {
        await admin.query(
          'UPDATE parallel_life.world_clock SET paused=true,active_until=NULL WHERE world_id=$1 AND owner_id=$2',
          [f.id, f.owner],
        );
      }
    } finally {
      await db.close();
      await admin.end();
    }
  });
  const at = '2026-10-15T07:00:00.000Z';
  async function fixture(
    options: {
      epoch1?: boolean;
      plansA?: number;
      plansB?: number;
      refusal?: boolean;
      homeContact?: boolean;
    } = {},
  ) {
    const owner = randomUUID(),
      id = randomUUID(),
      a = randomUUID(),
      b = randomUUID();
    await new IdentityRepository(db).ensureGuest(owner);
    owned.push({ id, owner });
    const source = {
      kind: 'seed_genesis' as const,
      seedId: randomUUID(),
      snapshotVersion: 0 as const,
    };
    const world: WorldState = {
      schemaVersion: 1,
      id,
      ownerId: owner,
      version: 0,
      title: 'Explicit advance SQL fixture',
      time: at,
      actors: [
        { id: a, name: '甲', persona: '虚构人物，温和克制，尊重拒绝，有自己的日程。' },
        { id: b, name: '乙', persona: '虚构人物，独立安排工作。' },
      ],
      facts: [
        {
          id: 'basis',
          text: '这是用于验证自主计划的虚构共同事实。',
          kind: 'canonical',
          visibility: { kind: 'world' },
          sourceEventId: 'genesis:' + id,
        },
        {
          id: 'b-private',
          text: 'B_PRIVATE_SENTINEL',
          kind: 'canonical',
          visibility: { kind: 'actors', actorIds: [b] },
          sourceEventId: 'genesis:' + id,
        },
      ],
      messages: [],
      appointments: [],
      mediaRequests: [],
      space: {
        currentPlaceId: 'home',
        positionSource: source,
        places: ['home', 'shop'].map((p) => ({
          id: p,
          name: p,
          description: '明确合成地点',
          source,
          contactActorIds: options.homeContact && p === 'home' ? [a] : [],
          appointmentIds: [],
        })),
        routes: [],
      },
    };
    await worlds.initialize({ userId: owner }, world);
    const states = [a, b].map((actorId) =>
      emptyActorAgentState({ worldId: id, actorId }, agentDefinitionRef(world, actorId), 0),
    );
    for (const [index, count] of [options.plansA ?? 0, options.plansB ?? 0].entries())
      for (let i = 0; i < count; i++) {
        const s = states[index]!,
          goalId = `goal-${index}-${i}`,
          planId = `plan-${index}-${i}`,
          actionId = `action-${index}-${i}`;
        s.goals.push({
          id: goalId,
          summary: '本人继续安排自己的事情',
          status: 'active',
          sourceIds: ['fact:basis'],
          resultIds: [],
        });
        s.plans.push({
          id: planId,
          goalId,
          summary: '我仍打算去shop处理自己的事，计划不是实际到达',
          status: 'active',
          sourceIds: ['fact:basis'],
          actionIds: [actionId],
          nextActionId: actionId,
          triggers: [],
          missingConditions: [],
        });
        s.actions.push({
          id: actionId,
          goalId,
          capability: 'plan.record',
          status: 'ready',
          sourceIds: ['fact:basis'],
          targetIds: [],
          parameters: { planId },
          preconditions: [],
          dependsOnActionIds: [],
          handlesResponsibilityIds: [],
        });
      }
    if (options.refusal) {
      states[0]!.responsibilities.push({
        id: 'invitation-r',
        revision: 0,
        subject: { kind: 'request', id: 'fictional-request' },
        summary: '邀请玩家一起，但本人仍有自己的去向',
        status: 'waiting',
        waitingOn: 'player',
        sourceIds: ['fact:basis'],
        nextCheck: [],
      });
      for (const plan of states[0]!.plans)
        plan.triggers = [
          { kind: 'player_decision', responsibilityId: 'invitation-r', decision: 'declined' },
        ];
    }
    if (!options.epoch1)
      await db.transaction(owner, async (sql) => {
        for (const s of states) await initializeActorAgentStateInTransaction(sql, owner, s);
        await switchAgentEngineEpochInTransaction(sql, owner, {
          worldId: id,
          expectedWorldVersion: 0,
          expectedEpoch: 1,
          nextEpoch: 2,
        });
      });
    await clocks.setClock(owner, id, { paused: false, speed: 0 });
    return { owner, id, a, b, world, states };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  await t.test(
    'actual travel does not invent a departure witness from a coarse-place scene roster; global evaluation never wakes an uninformed NPC',
    async () => {
      const f = await fixture({ epoch1: true, homeContact: true });
      const scenes = new SceneRepository(db),
        space = new PostgresWorldSpace(db, officialLifeCatalog);
      const queue = new PostgresTaskQueue(
        `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
      );
      try {
        const entered = await scenes.enterPlace(f.owner, f.id, {
          commandId: randomUUID(),
          expectedVersion: 0,
          placeId: 'home',
        });
        const lease = (await queue.claimForOwner(entered.task!.id, f.owner, ['world']))!;
        const version = await db.transaction(f.owner, (sql) =>
          commitSceneProposal(
            sql,
            f.owner,
            f.id,
            lease.input as Parameters<typeof commitSceneProposal>[3],
            {
              location: 'home',
              narration: '合成历史：甲在家，乙不在场。',
              presentActorIds: [f.a],
              outcome: null,
              observation: null,
              matterTitle: null,
              initialMatters: [],
              matterUpdates: [],
              dialogues: [],
              stepProposals: [],
              npcActions: [],
            },
            randomUUID(),
          ),
        );
        await queue.finish(lease, { status: 'succeeded', resultVersion: version });
        await db.transaction(f.owner, async (sql) => {
          for (const actorId of [f.a, f.b])
            await initializeActorAgentStateInTransaction(
              sql,
              f.owner,
              emptyActorAgentState(
                { worldId: f.id, actorId },
                agentDefinitionRef(f.world, actorId),
                version,
              ),
            );
          await switchAgentEngineEpochInTransaction(sql, f.owner, {
            worldId: f.id,
            expectedEpoch: 1,
            nextEpoch: 2,
            expectedWorldVersion: version,
          });
        });
        const route = (await space.read(f.owner, f.id)).routes.find((r) => r.toPlaceId === 'shop')!;
        assert.ok(route, 'existing configured map offers a real reachable route');
        const moved = await space.travel(f.owner, f.id, {
          commandId: randomUUID(),
          expectedVersion: version,
          routeId: route.id,
        });
        const awareness = new PostgresWorldAwarenessRepository(db);
        const mother = await awareness.readActorAwareness(f.owner, f.id, f.a),
          absent = await awareness.readActorAwareness(f.owner, f.id, f.b);
        assert.deepEqual(
          mother.knowledge,
          [],
          'scene membership is not proof of witnessing departure',
        );
        assert.deepEqual(absent.knowledge, []);
        const h = harness(f, {
          realReader: true,
          director: (p) => ({
            mode: 'quiet',
            selectedCandidateIds: [],
            deferred: p.candidates.map((c) => ({ candidateId: c.id, reason: '没有新的可见依据' })),
            nudges: [],
            opportunities: [],
            audit: { reason: '实际位置不自动下发给旁人', basisSourceIds: [] },
          }),
          npc: () => {
            throw Error('uninformed actors must not be woken as witnesses');
          },
        });
        const result = await h.service.advanceIfEnabled(f.owner, f.id);
        assert.equal(result?.played, 0);
        assert.equal(h.npcCalls().length, 0);
        assert.equal((await store.read(f.owner, { worldId: f.id, actorId: f.a }))!.revision, 0);
        assert.equal((await store.read(f.owner, { worldId: f.id, actorId: f.b }))!.revision, 0);
        assert.equal((await worlds.get({ userId: f.owner }, f.id)).version, moved.version);
        const before = h.calls.length;
        await h.service.advanceIfEnabled(f.owner, f.id);
        assert.equal(
          h.calls.length,
          before,
          'quiet evaluated observation is not an invitation to poll models',
        );
      } finally {
        await queue.close();
      }
    },
  );
  async function count(table: string, f: Fixture) {
    assert.ok(
      [
        'world_events',
        'world_messages',
        'commands',
        'agent_attempts',
        'agent_action_results',
        'agent_input_receipts',
        'director_decisions',
      ].includes(table),
    );
    return Number(
      (
        await admin.query(`SELECT count(*)::int n FROM parallel_life.${table} WHERE world_id=$1`, [
          f.id,
        ])
      ).rows[0].n,
    );
  }
  function harness(
    f: Fixture,
    options: {
      npc?: (payload: NpcPayload) => Promise<unknown> | unknown;
      director?: (payload: DirectorSnapshot) => unknown;
      assertEligibleOnly?: boolean;
      realReader?: boolean;
    } = {},
  ) {
    let factories = 0;
    const calls: { kind: 'npc' | 'director'; payload: any }[] = [],
      reads: Parameters<DirectorSnapshotReader['read']>[1][] = [];
    const reader: DirectorSnapshotReader = {
      async read(owner, input) {
        assert.equal(owner, f.owner);
        reads.push(structuredClone(input));
        if (options.realReader)
          return new PostgresDirectorSnapshotRepository(db).read(owner, input);
        if (options.assertEligibleOnly)
          for (const c of input.candidates)
            assert.ok(
              !input.blockers.some(
                (b) => b.scope.kind === 'actor' && b.scope.actorId === c.actorId,
              ),
            );
        const world = await worlds.get({ userId: owner }, input.worldId),
          now = new Date().toISOString(),
          clock = await clocks.read(owner, input.worldId, now);
        const storyAt = new Date(
          Math.max(Date.parse(world.time), Date.parse(projectStoryTime(clock, now))),
        ).toISOString();
        const read = await db.transaction(owner, async (sql) => {
          const cursor = (
            await sql.query(
              'SELECT * FROM parallel_life.director_observed_states WHERE world_id=$1 AND owner_id=$2',
              [world.id, owner],
            )
          ).rows[0];
          const states = (
            await sql.query(
              'SELECT document FROM parallel_life.actor_agent_states WHERE world_id=$1 AND owner_id=$2 ORDER BY actor_id',
              [world.id, owner],
            )
          ).rows.map((r) => r.document);
          const boundary =
            (
              await sql.query(
                'SELECT document FROM parallel_life.world_awareness_boundaries WHERE world_id=$1 AND owner_id=$2',
                [world.id, owner],
              )
            ).rows[0]?.document ?? worldBoundary(world, null);
          const changes = (
            await sql.query(
              'SELECT document FROM parallel_life.director_pending_reasons WHERE world_id=$1 AND owner_id=$2 AND source_version>$3 AND source_version<=$4 ORDER BY source_version,id',
              [
                world.id,
                owner,
                cursor?.evaluated_through_version ?? 0,
                cursor?.observed_through_version ?? 0,
              ],
            )
          ).rows.map((r) => r.document);
          return { cursor, states, boundary, changes };
        });
        return {
          schemaVersion: 1,
          worldId: world.id,
          engineEpoch: input.engineEpoch,
          worldVersion: world.version,
          storyAt,
          boundary: read.boundary,
          observedThroughVersion: read.cursor?.observed_through_version ?? 0,
          evaluatedThroughVersion: read.cursor?.evaluated_through_version ?? 0,
          worldSetting: '明确的本地虚构测试设定',
          cast: world.actors.map((a) => ({ id: a.id, name: a.name, persona: a.persona })),
          actorStates: read.states,
          episodes: await directors.readEpisodes(owner, world.id),
          candidates: input.candidates,
          blockers: input.blockers,
          changes: read.changes,
          observations: world.facts.map((fact) => ({
            sourceId: 'fact:' + fact.id,
            text: fact.text,
            kind: 'fact' as const,
            knownByActorIds:
              fact.visibility.kind === 'world'
                ? world.actors.map((a) => a.id)
                : fact.visibility.kind === 'actors'
                  ? fact.visibility.actorIds
                  : [],
          })),
          focus: [],
        } as DirectorSnapshot;
      },
    };
    const model: TextModel = {
      async complete(messages: ModelMessage[]) {
        const payload = JSON.parse(messages.find((m) => m.role === 'user')!.content),
          kind = payload.promptVersion.startsWith('director-') ? 'director' : 'npc';
        calls.push({ kind, payload });
        // Both a held world row and a legacy advisory-lock transaction would be visible here.
        assert.equal(
          (
            await admin.query(
              "SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND usename='pl_app' AND state='idle in transaction'",
            )
          ).rows[0].n,
          0,
        );
        await admin.query('SELECT id FROM parallel_life.worlds WHERE id=$1 FOR UPDATE NOWAIT', [
          f.id,
        ]);
        if (kind === 'director') {
          const raw = options.director?.(payload) ?? {
            mode: 'quiet',
            selectedCandidateIds: [],
            deferred: payload.candidates.map((c: { id: string }) => ({
              candidateId: c.id,
              reason: '没有新增执行依据',
            })),
            nudges: [],
            opportunities: [],
            audit: { reason: 'DIRECTOR_GLOBAL_AUDIT_SENTINEL', basisSourceIds: ['fact:b-private'] },
          };
          return JSON.stringify(raw);
        }
        assert.match(payload.promptVersion, /^npc-agent-/);
        if (payload.state.actorId === f.a)
          assert.doesNotMatch(
            JSON.stringify(payload),
            /B_PRIVATE_SENTINEL|DIRECTOR_GLOBAL_AUDIT_SENTINEL/,
          );
        const raw = await (options.npc?.(payload) ?? empty());
        return typeof raw === 'string' ? raw : JSON.stringify(raw);
      },
    };
    return {
      calls,
      reads,
      reader,
      model,
      service: npcAgentAdvanceServices(
        db,
        () => {
          factories++;
          return model;
        },
        reader,
      ),
      factoryCalls: () => factories,
      npcCalls: () => calls.filter((c) => c.kind === 'npc'),
      directorCalls: () => calls.filter((c) => c.kind === 'director'),
    };
  }
  async function materialChange(f: Fixture) {
    const current = await worlds.get({ userId: f.owner }, f.id);
    await npcAgentServices(db, () => ({
      async complete(messages) {
        const p = JSON.parse(messages.find((m) => m.role === 'user')!.content);
        return JSON.stringify({
          ...empty(),
          goals: [
            {
              id: 'b-material-goal',
              summary: '本人明确的后续工作',
              status: 'active',
              sourceIds: [p.input.sourceId],
              resultIds: [],
            },
          ],
          plans: [
            {
              id: 'b-material-plan',
              goalId: 'b-material-goal',
              summary: '等待自己进一步安排',
              status: 'waiting',
              sourceIds: [p.input.sourceId],
              actionIds: [],
              nextActionId: null,
              triggers: [],
              missingConditions: ['等待自己的工作条件'],
            },
          ],
          statements: [{ text: '我记下自己的工作，等条件明确再安排。', dependsOnActionIds: [] }],
        });
      },
    })).sendMessageIfEnabled(f.owner, {
      id: randomUUID(),
      worldId: f.id,
      actorId: f.b,
      expectedVersion: current.version,
      text: '请记下你自己的后续工作，暂时等待条件。',
    });
  }
  function chooseOwn(payload: DirectorSnapshot) {
    const c = payload.candidates.find((c) => c.source === 'actor_plan') ?? payload.candidates[0];
    return c
      ? {
          mode: 'coordinate',
          selectedCandidateIds: [c.id],
          deferred: payload.candidates
            .filter((v) => v.id !== c.id)
            .map((v) => ({ candidateId: v.id, reason: '本人其他工作稍后评估' })),
          nudges: [
            {
              actorId: c.actorId,
              candidateId: c.id,
              kind: c.source === 'actor_plan' ? 'continue_own_plan' : 'reassess_own_responsibility',
              basisSourceIds: c.sourceIds,
            },
          ],
          opportunities: [],
          audit: { reason: 'DIRECTOR_GLOBAL_AUDIT_SENTINEL', basisSourceIds: ['fact:b-private'] },
        }
      : {
          mode: 'quiet',
          selectedCandidateIds: [],
          deferred: [],
          nudges: [],
          opportunities: [],
          audit: { reason: '安静', basisSourceIds: [] },
        };
  }
  function executeOwn(payload: NpcPayload) {
    const action = payload.state.actions.find((a) => a.status === 'ready')!;
    assert.ok(action);
    const plan = payload.state.plans.find((p) => p.id === action.parameters.planId)!;
    assert.ok(plan);
    return {
      ...empty(),
      plans: [plan],
      actions: [action],
      statements: [{ text: '我先按自己的安排继续。', dependsOnActionIds: [action.id] }],
    };
  }
  await t.test(
    'an unknown director proposal blocks new coordination but cannot consume or freeze an independent actor plan',
    async () => {
      const f = await fixture({ plansA: 1 });
      await materialChange(f);
      const current = await worlds.get({ userId: f.owner }, f.id);
      const snapshot = await new PostgresDirectorSnapshotRepository(db).read(f.owner, {
        worldId: f.id,
        engineEpoch: 2,
        worldVersion: current.version,
        candidates: [],
        blockers: [],
      });
      const original = (
        await directors.claim(
          f.owner,
          {
            id: randomUUID(),
            commandId: randomUUID(),
            worldId: f.id,
            engineEpoch: 2,
            expectedWorldVersion: current.version,
            inputHash: directorSnapshotInputHash(snapshot),
            token: randomUUID(),
            leaseUntil: new Date(Date.now() + 60000).toISOString(),
          },
          snapshot,
        )
      ).attempt;
      await directors.mark(f.owner, original, 'request_sent');
      await directors.mark(f.owner, { ...original, status: 'request_sent' }, 'unknown_after_send');
      const h = harness(f, { realReader: true, npc: executeOwn });
      const result = await h.service.advanceIfEnabled(f.owner, f.id);
      assert.equal(result?.played, 1);
      assert.equal(h.directorCalls().length, 0);
      assert.equal(h.npcCalls().length, 1);
      assert.equal(
        (await directors.lookup(f.owner, f.id, original.commandId))!.status,
        'unknown_after_send',
      );
      assert.equal(
        (await store.read(f.owner, { worldId: f.id, actorId: f.a }))!.actions[0]!.status,
        'succeeded',
      );
    },
  );
  await t.test(
    'epoch1 returns null before any new model/reader/state execution; another owner stays isolated',
    async () => {
      const f = await fixture({ epoch1: true }),
        h = harness(f);
      assert.equal(await h.service.advanceIfEnabled(f.owner, f.id), null);
      assert.equal(h.calls.length, 0);
      assert.equal(h.factoryCalls(), 0);
      assert.equal(h.reads.length, 0);
      const other = await fixture();
      await assert.rejects(h.service.advanceIfEnabled(other.owner, f.id), { code: 'NOT_FOUND' });
      assert.equal(await count('world_events', f), 0);
    },
  );
  await t.test(
    'epoch2 no candidate is honest quiet with zero model, fake message, task or event',
    async () => {
      const f = await fixture(),
        h = harness(f),
        result = await h.service.advanceIfEnabled(f.owner, f.id);
      assert.ok(result);
      assert.equal(result.played, 0);
      assert.equal(result.folded, 0);
      assert.deepEqual(result.actors, []);
      assert.equal(h.calls.length, 0);
      assert.equal(h.factoryCalls(), 0);
      assert.equal(h.reads.length, 0);
      assert.equal(await count('world_events', f), 0);
      assert.equal(await count('world_messages', f), 0);
      assert.equal(await count('agent_attempts', f), 0);
    },
  );
  await t.test(
    'paused epoch2 does not call models or accept wake input even with ready plan',
    async () => {
      const f = await fixture({ plansA: 1 }),
        h = harness(f);
      await clocks.setClock(f.owner, f.id, { paused: true });
      assert.equal((await h.service.advanceIfEnabled(f.owner, f.id))!.played, 0);
      assert.equal(h.calls.length, 0);
      assert.equal(h.factoryCalls(), 0);
      assert.equal(h.reads.length, 0);
      assert.equal(await count('agent_input_receipts', f), 0);
    },
  );
  await t.test(
    'ready actor uses actual new kernel; quiet result is committed without inventing a message',
    async () => {
      const f = await fixture({ plansA: 1 }),
        h = harness(f),
        result = await h.service.advanceIfEnabled(f.owner, f.id);
      assert.equal(result!.played, 0);
      assert.deepEqual(result!.actors, []);
      assert.equal(h.npcCalls().length, 1);
      assert.equal(await count('world_messages', f), 0);
      const rows = (
        await admin.query(
          'SELECT a.status,e.payload,c.status command_status,s.revision FROM parallel_life.agent_attempts a JOIN parallel_life.world_events e ON e.id=a.event_id JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.id=e.command_id JOIN parallel_life.actor_agent_states s ON s.world_id=a.world_id AND s.actor_id=a.actor_id WHERE a.world_id=$1',
          [f.id],
        )
      ).rows;
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.status, 'committed');
      assert.equal(rows[0]!.command_status, 'succeeded');
      assert.equal(rows[0]!.revision, 1);
      assert.equal(rows[0]!.payload.type, 'agent.state_committed');
      assert.equal(
        (await new PostgresWorldAwarenessRepository(db).readDirectorObservedState(f.owner, f.id))
          .observedThroughVersion,
        1,
      );
    },
  );
  await t.test(
    'stable same-plan wake is not bought again after unrelated native message and world version change',
    async () => {
      const f = await fixture({ plansA: 1 }),
        h = harness(f);
      await h.service.advanceIfEnabled(f.owner, f.id);
      assert.equal(h.npcCalls().length, 1);
      const command = {
        id: randomUUID(),
        worldId: f.id,
        actorId: f.b,
        expectedVersion: 1,
        text: '无关的天气闲聊',
      };
      await npcAgentServices(db, () => ({
        async complete() {
          return JSON.stringify({
            ...empty(),
            statements: [{ text: '收到，今天很晴。', dependsOnActionIds: [] }],
          });
        },
      })).sendMessageIfEnabled(f.owner, command);
      const current = await worlds.get({ userId: f.owner }, f.id);
      assert.equal(current.version, 2);
      await h.service.advanceIfEnabled(f.owner, f.id);
      assert.equal(h.npcCalls().length, 1);
      assert.equal(
        (
          await admin.query(
            "SELECT count(*)::int n FROM parallel_life.agent_attempts WHERE world_id=$1 AND actor_id=$2 AND status='committed'",
            [f.id, f.a],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await t.test(
    'an actual unknown wake blocks only that actor; the other actor continues without retrying unknown',
    async () => {
      const f = await fixture({ plansA: 1, plansB: 1 });
      let first = true;
      const h = harness(f, {
        npc() {
          if (first) {
            first = false;
            throw Error('EXPLICIT_MOCK_TRANSPORT_UNCERTAINTY');
          }
          return empty();
        },
        assertEligibleOnly: true,
      });
      await assert.rejects(
        h.service.advanceIfEnabled(f.owner, f.id),
        /EXPLICIT_MOCK_TRANSPORT_UNCERTAINTY/,
      );
      const unknown = h.npcCalls()[0]!.payload.state.actorId;
      await h.service.advanceIfEnabled(f.owner, f.id);
      assert.equal(h.npcCalls().length, 2);
      assert.notEqual(h.npcCalls()[1]!.payload.state.actorId, unknown);
      assert.equal(
        (
          await admin.query(
            "SELECT count(*)::int n FROM parallel_life.agent_attempts WHERE world_id=$1 AND actor_id=$2 AND status='unknown_after_send'",
            [f.id, unknown],
          )
        ).rows[0].n,
        1,
      );
      await h.service.advanceIfEnabled(f.owner, f.id);
      assert.equal(h.npcCalls().filter((c) => c.payload.state.actorId === unknown).length, 1);
    },
  );
  await t.test(
    'known failed semantic candidate is resource-blocked while another matter of the same actor can run',
    async () => {
      const f = await fixture({ plansA: 2 });
      let first = true;
      const h = harness(f, {
        npc() {
          if (first) {
            first = false;
            return { unexpected: 'known invalid mock result' };
          }
          return empty();
        },
      });
      await assert.rejects(h.service.advanceIfEnabled(f.owner, f.id));
      await h.service.advanceIfEnabled(f.owner, f.id);
      assert.equal(h.npcCalls().length, 2);
      const rows = (
        await admin.query(
          'SELECT status FROM parallel_life.agent_attempts WHERE world_id=$1 ORDER BY status',
          [f.id],
        )
      ).rows.map((r) => r.status);
      assert.deepEqual(rows, ['committed', 'invalid_output']);
    },
  );
  await t.test(
    'explicit refusal keeps the NPC own plan and intended destination, without inventing physical arrival or anger',
    async () => {
      const f = await fixture({ plansA: 1, refusal: true });
      await npcAgentServices(db, () => ({
        async complete(messages) {
          const p = JSON.parse(messages.find((m) => m.role === 'user')!.content);
          return JSON.stringify({
            ...empty(),
            statements: [{ text: '明白，我自己安排，你不用勉强。', dependsOnActionIds: [] }],
            decisions: [
              {
                id: 'explicit-decline',
                responsibilityId: 'invitation-r',
                kind: 'declined',
                sourceId: p.input.sourceId,
                quote: p.input.text,
              },
            ],
          });
        },
      })).sendMessageIfEnabled(f.owner, {
        id: randomUUID(),
        worldId: f.id,
        actorId: f.a,
        expectedVersion: 0,
        text: '这次我不去，你自己安排，不用生气。',
      });
      const h = harness(f, {
        director: chooseOwn,
        npc(payload) {
          assert.equal(payload.state.decisions.at(-1)!.kind, 'declined');
          assert.match(payload.state.plans[0]!.summary, /shop/);
          assert.match(payload.actor.persona, /温和克制/);
          assert.equal(payload.worldContext!.selfPosition.status, 'unknown');
          return empty();
        },
      });
      await h.service.advanceIfEnabled(f.owner, f.id);
      assert.equal(h.npcCalls().length, 1);
      const s = await store.read(f.owner, { worldId: f.id, actorId: f.a });
      assert.equal(s!.decisions.at(-1)!.kind, 'declined');
      assert.match(s!.plans[0]!.summary, /shop/);
      assert.equal(
        (
          await admin.query(
            'SELECT 1 FROM parallel_life.world_authoritative_positions WHERE world_id=$1 AND subject_key=$2',
            [f.id, 'actor:' + f.a],
          )
        ).rowCount,
        0,
      );
    },
  );
  await t.test(
    'director quiet accounts for eligible candidates but adds no world event or NPC call',
    async () => {
      const f = await fixture({ plansA: 1 });
      await materialChange(f);
      const h = harness(f),
        before = await count('world_events', f);
      await h.service.advanceIfEnabled(f.owner, f.id);
      assert.equal(h.directorCalls().length, 1);
      assert.equal(h.npcCalls().length, 0);
      assert.equal(await count('world_events', f), before);
      assert.equal(await count('director_decisions', f), 1);
      const d = (
        await admin.query(
          'SELECT document FROM parallel_life.director_decisions WHERE world_id=$1',
          [f.id],
        )
      ).rows[0].document;
      assert.equal(d.mode, 'quiet');
      assert.equal(d.deferred.length, h.reads[0]!.candidates.length);
    },
  );
  await t.test(
    'actual SQL director snapshot flows through advance, coordinator, model parser and durable decision store',
    async () => {
      const f = await fixture({ plansA: 1 });
      await materialChange(f);
      const h = harness(f, { realReader: true, director: chooseOwn });
      const result = await h.service.advanceIfEnabled(f.owner, f.id);
      assert.equal(result!.played, 0);
      assert.equal(h.directorCalls().length, 1);
      assert.equal(h.npcCalls().length, 1);
      assert.equal(await count('director_decisions', f), 1);
      assert.equal(await count('world_events', f), 2);
      const decision = (
        await admin.query(
          'SELECT document FROM parallel_life.director_decisions WHERE world_id=$1',
          [f.id],
        )
      ).rows[0].document;
      assert.equal(decision.mode, 'coordinate');
      assert.equal(decision.selectedCandidateIds.length, 1);
      assert.equal(
        (await new PostgresWorldAwarenessRepository(db).readDirectorObservedState(f.owner, f.id))
          .evaluatedThroughVersion,
        1,
      );
    },
  );
  await t.test(
    'blocked candidate is excluded before director evaluation and a malicious selection cannot advance evaluated cursor',
    async () => {
      const f = await fixture({ plansA: 1 });
      const failed = harness(f, {
        npc() {
          throw Error('EXPLICIT_MOCK_UNKNOWN');
        },
      });
      await assert.rejects(failed.service.advanceIfEnabled(f.owner, f.id), /EXPLICIT_MOCK_UNKNOWN/);
      const blockedId = JSON.parse(failed.npcCalls()[0]!.payload.input.text).candidateId;
      assert.equal(typeof blockedId, 'string');
      await materialChange(f);
      const h = harness(f, {
        assertEligibleOnly: true,
        director(payload) {
          assert.deepEqual(payload.candidates, []);
          return {
            mode: 'coordinate',
            selectedCandidateIds: [blockedId],
            deferred: [],
            nudges: [],
            opportunities: [],
            audit: { reason: 'invalid selection mock', basisSourceIds: [] },
          };
        },
      });
      await assert.rejects(h.service.advanceIfEnabled(f.owner, f.id), {
        code: 'INVALID_DIRECTOR_PROPOSAL',
      });
      assert.equal(h.directorCalls().length, 1);
      assert.equal(h.npcCalls().length, 0);
      assert.equal(await count('director_decisions', f), 0);
      const cursor = await new PostgresWorldAwarenessRepository(db).readDirectorObservedState(
        f.owner,
        f.id,
      );
      assert.equal(cursor.observedThroughVersion, 1);
      assert.equal(cursor.evaluatedThroughVersion, 0);
    },
  );
  await t.test(
    'late kernel SQL failure rolls back native state/result/event/awareness, then advance recovers protected raw without model repayment',
    async () => {
      const f = await fixture({ plansA: 1 }),
        h = harness(f, { npc: executeOwn }),
        guard = 'advance_fail_' + randomUUID().replaceAll('-', '');
      await admin.query(
        `CREATE FUNCTION parallel_life.${guard}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.world_id='${f.id}' THEN RAISE EXCEPTION 'ADVANCE_INJECTED_SQL_FAILURE'; END IF; RETURN NEW; END $$`,
      );
      await admin.query(
        `CREATE TRIGGER ${guard} BEFORE INSERT ON parallel_life.agent_action_results FOR EACH ROW EXECUTE FUNCTION parallel_life.${guard}()`,
      );
      try {
        await assert.rejects(
          h.service.advanceIfEnabled(f.owner, f.id),
          /ADVANCE_INJECTED_SQL_FAILURE/,
        );
      } finally {
        await admin.query(`DROP TRIGGER ${guard} ON parallel_life.agent_action_results`);
        await admin.query(`DROP FUNCTION parallel_life.${guard}()`);
      }
      assert.equal(h.npcCalls().length, 1);
      assert.equal(await count('world_events', f), 0);
      assert.equal(await count('commands', f), 0);
      assert.equal(await count('agent_action_results', f), 0);
      assert.equal((await store.read(f.owner, { worldId: f.id, actorId: f.a }))!.revision, 0);
      assert.equal(
        (
          await admin.query('SELECT status FROM parallel_life.agent_attempts WHERE world_id=$1', [
            f.id,
          ])
        ).rows[0].status,
        'response_received',
      );
      const recovered = await h.service.advanceIfEnabled(f.owner, f.id);
      assert.equal(
        h.npcCalls().length,
        1,
        'durable known response must not buy a second model call',
      );
      assert.equal(h.factoryCalls(), 1, 'known raw recovery constructs no new model');
      assert.equal(recovered!.played, 1);
      assert.deepEqual(recovered!.actors, [f.a]);
      assert.equal(await count('agent_action_results', f), 1);
      assert.equal(await count('world_events', f), 1);
      assert.equal(await count('world_messages', f), 1);
      assert.equal((await store.read(f.owner, { worldId: f.id, actorId: f.a }))!.revision, 1);
      assert.equal(
        (await new PostgresWorldAwarenessRepository(db).readDirectorObservedState(f.owner, f.id))
          .observedThroughVersion,
        1,
      );
    },
  );
});
