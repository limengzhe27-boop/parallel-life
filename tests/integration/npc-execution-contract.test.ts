import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import {
  PostgresAgentRuntimeRepository,
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { PostgresDirectorSnapshotRepository } from '../../src/modules/world/infrastructure/director-snapshot-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { npcAgentServices } from '../../src/server/npc-agent-services.ts';
import { npcAgentAdvanceServices } from '../../src/server/npc-agent-advance-services.ts';
import type { WorldState } from '../../src/modules/world/domain/types.ts';
import type { TextModel } from '../../src/modules/ai/application/ports.ts';

import { admitNewAgentNarrativeInTransaction } from '../../src/modules/world/infrastructure/agent-narrative-repository.ts';
test('real original NPC/kernel rejects empty execution contracts atomically and preserves known failure receipts', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.NPC_EXECUTION_CONTRACT_TEST_PORT ?? 55602));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  t.after(async () => {
    await db.close();
    await admin.end();
  });
  async function fixture() {
    const owner = randomUUID(),
      id = randomUUID(),
      actorId = randomUUID();
    await new IdentityRepository(db).ensureGuest(owner);
    const world: WorldState = {
      schemaVersion: 1,
      id,
      ownerId: owner,
      version: 0,
      title: 'Own plan test',
      time: new Date().toISOString(),
      actors: [{ id: actorId, name: 'A', persona: 'An independent fictional shopkeeper' }],
      facts: [
        {
          id: 'basis',
          text: 'An authorized agreed material list is available.',
          kind: 'canonical',
          visibility: { kind: 'world' },
          sourceEventId: 'genesis:' + id,
        },
      ],
      messages: [],
      appointments: [],
      mediaRequests: [],
    };
    const worlds = new PostgresWorldRepository(db);
    await worlds.initialize({ userId: owner }, world);
    await db.transaction(owner, async (sql) => {
      await initializeActorAgentStateInTransaction(
        sql,
        owner,
        emptyActorAgentState({ worldId: id, actorId }, agentDefinitionRef(world, actorId), 0),
      );
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId: id,
        expectedEpoch: 1,
        nextEpoch: 2,
        expectedWorldVersion: 0,
      });
    });
    await db.transaction(owner, (sql) =>
      admitNewAgentNarrativeInTransaction(sql, owner, { worldId: id, engineEpoch: 2 }),
    );
    return { owner, id, actorId, worlds };
  }
  const empty = () => ({
    statements: [],
    goals: [],
    plans: [],
    actions: [],
    responsibilities: [],
    decisions: [],
  });
  await t.test(
    'invalid active plan has no successful dialogue/state/event; replay never repays',
    async () => {
      const f = await fixture();
      let calls = 0;
      const service = npcAgentServices(db, () => ({
        async complete(messages) {
          calls++;
          const p = JSON.parse(messages[1]!.content);
          return JSON.stringify({
            ...empty(),
            statements: [{ text: 'I have arranged everything.', dependsOnActionIds: [] }],
            goals: [
              {
                id: 'g',
                summary: 'Own goal',
                status: 'active',
                sourceIds: [p.input.sourceId],
                resultIds: [],
              },
            ],
            plans: [
              {
                id: 'p',
                goalId: 'g',
                summary: 'Unsupported commitment',
                status: 'active',
                sourceIds: [p.input.sourceId],
                actionIds: [],
                nextActionId: null,
                triggers: [],
                missingConditions: [],
              },
            ],
          });
        },
      }));
      const command = {
        id: randomUUID(),
        worldId: f.id,
        actorId: f.actorId,
        expectedVersion: 0,
        text: 'Please arrange a real invitation.',
      };
      await assert.rejects(service.sendMessageIfEnabled(f.owner, command));
      const state = await new PostgresAgentRuntimeRepository(db).read(f.owner, {
        worldId: f.id,
        actorId: f.actorId,
      });
      assert.equal(state!.revision, 0);
      assert.deepEqual(state!.plans, []);
      assert.equal((await f.worlds.get({ userId: f.owner }, f.id)).version, 0);
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.world_messages WHERE world_id=$1',
            [f.id],
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM parallel_life.world_events WHERE world_id=$1',
            [f.id],
          )
        ).rows[0].n,
        0,
      );
      await assert.rejects(service.sendMessageIfEnabled(f.owner, command));
      assert.equal(calls, 1);
    },
  );
  await t.test(
    'honest capability block persists and does not pretend work has executed',
    async () => {
      const f = await fixture();
      let calls = 0;
      const service = npcAgentServices(db, () => ({
        async complete(messages) {
          calls++;
          const p = JSON.parse(messages[1]!.content);
          return JSON.stringify({
            ...empty(),
            statements: [
              {
                text: 'I cannot physically verify stock with the available abilities.',
                dependsOnActionIds: [],
              },
            ],
            goals: [
              {
                id: 'g',
                summary: 'Check stock',
                status: 'active',
                sourceIds: [p.input.sourceId],
                resultIds: [],
              },
            ],
            plans: [
              {
                id: 'p',
                goalId: 'g',
                summary: 'Await a supported way to check',
                status: 'blocked',
                sourceIds: [p.input.sourceId],
                actionIds: [],
                nextActionId: null,
                triggers: [],
                missingConditions: ['No registered physical stock-check capability'],
              },
            ],
          });
        },
      }));
      const command = {
        id: randomUUID(),
        worldId: f.id,
        actorId: f.actorId,
        expectedVersion: 0,
        text: 'Can you check physical stock?',
      };
      const result = await service.sendMessageIfEnabled(f.owner, command);
      assert.equal(result?.status, 'committed');
      await service.sendMessageIfEnabled(f.owner, command);
      assert.equal(calls, 1);
      const state = await new PostgresAgentRuntimeRepository(db).read(f.owner, {
        worldId: f.id,
        actorId: f.actorId,
      });
      assert.equal(state!.plans[0]!.status, 'blocked');
      assert.equal(state!.goals[0]!.status, 'active');
      assert.deepEqual(state!.actions, []);
      assert.deepEqual(state!.goals[0]!.resultIds, []);
    },
  );
  await t.test(
    'wire event choice reaches active episode and a real proposed appointment through original services',
    async () => {
      const f = await fixture();
      let calls = 0;
      const model: TextModel = {
        async complete(messages) {
          calls++;
          const p = JSON.parse(messages[1]!.content);
          if (p.promptVersion.startsWith('director-')) {
            const ref = p.wireCatalog.sources.find(
              (s: { sourceId: string }) => s.sourceId === 'fact:basis',
            ).ref;
            return JSON.stringify({
              protocol: 'director-wire-v1',
              mode: 'bounded_opportunity',
              candidates: [{ ref: p.wireCatalog.actors[0].ref, decision: 'select' }],
              opportunities: [
                {
                  id: 'wire-event',
                  title: 'Discuss preparations',
                  description: 'An optional discussion based on an existing fact',
                  playerImpact: 'Player may decline',
                  actors: [p.wireCatalog.actors[0].ref],
                  places: [],
                  activity: 'conversation',
                  origin: { kind: 'emergent', sourceRefs: [ref] },
                },
              ],
              audit: { reason: 'Existing available basis', sourceRefs: [ref] },
            });
          }
          const base = { protocol: 'npc-wire-v1', consideration: null, ...empty() };
          if (p.input.origin === 'coordination')
            return JSON.stringify({
              ...base,
              consideration: {
                choice: 'engage',
                reason: 'This fits my own preparation goal; player still chooses.',
                basisSourceIds: [],
              },
              statements: [
                {
                  text: 'Would you like to discuss the preparation with me?',
                  dependsOnActionIds: [],
                },
              ],
            });
          return JSON.stringify({
            ...base,
            statements: [
              {
                text: 'I have sent an invitation, awaiting your confirmation.',
                dependsOnActionIds: ['invite'],
              },
            ],
            goals: [
              {
                id: 'discuss',
                summary: 'Discuss preparation with the player',
                status: 'active',
                sourceIds: [p.input.sourceId],
                resultIds: [],
              },
            ],
            plans: [
              {
                id: 'invite-plan',
                goalId: 'discuss',
                summary: 'Propose a meeting then await a decision',
                sourceIds: [p.input.sourceId],
                nextStep: { kind: 'action', actionId: 'invite' },
              },
            ],
            actions: [
              {
                id: 'invite',
                goalId: 'discuss',
                capability: 'appointment.propose',
                targetIds: [],
                parameters: {
                  title: 'Preparation discussion',
                  at: new Date(Date.parse(p.storyAt) + 3600000).toISOString(),
                },
                preconditions: [],
                dependsOnActionIds: [],
                handlesResponsibilityIds: [],
                sourceIds: [p.input.sourceId],
                status: 'proposed',
              },
            ],
          });
        },
      };
      await npcAgentAdvanceServices(
        db,
        () => model,
        new PostgresDirectorSnapshotRepository(db),
      ).advanceIfEnabled(f.owner, f.id);
      const episode = (
        await admin.query('SELECT document FROM parallel_life.shared_episodes WHERE world_id=$1', [
          f.id,
        ])
      ).rows[0].document;
      assert.equal(episode.status, 'active');
      const directorDecision = (
        await admin.query(
          'SELECT document FROM parallel_life.director_decisions WHERE world_id=$1',
          [f.id],
        )
      ).rows[0].document;
      assert.deepEqual(directorDecision.selectedCandidateIds, []);
      assert.match(directorDecision.audit.reason, /未执行的候选选择/);
      assert.equal(
        (
          await admin.query(
            'SELECT choice FROM parallel_life.agent_episode_receipts WHERE world_id=$1',
            [f.id],
          )
        ).rows[0].choice,
        'engage',
      );
      const w = await f.worlds.get({ userId: f.owner }, f.id);
      const command = {
        id: randomUUID(),
        worldId: f.id,
        actorId: f.actorId,
        expectedVersion: w.version,
        text: 'Please invite me to discuss preparations one hour from now; I will confirm after receiving it.',
      };
      const service = npcAgentServices(db, () => model);
      const result = await service.sendMessageIfEnabled(f.owner, command);
      assert.equal(result?.status, 'committed');
      const after = await f.worlds.get({ userId: f.owner }, f.id);
      assert.equal(after.appointments.length, 1);
      assert.equal(after.appointments[0]!.status, 'proposed');
      const state = await new PostgresAgentRuntimeRepository(db).read(f.owner, {
        worldId: f.id,
        actorId: f.actorId,
      });
      assert.equal(state!.actions[0]!.status, 'succeeded');
      assert.equal(state!.plans[0]!.nextActionId, state!.actions[0]!.id);
      assert.equal(state!.goals[0]!.status, 'active');
      assert.deepEqual(state!.goals[0]!.resultIds, []);
      const beforeReplay = calls;
      await service.sendMessageIfEnabled(f.owner, command);
      assert.equal(calls, beforeReplay);
      assert.equal((await f.worlds.get({ userId: f.owner }, f.id)).appointments.length, 1);
    },
  );
  for (const mode of ['missing', 'quiet'] as const)
    await t.test(
      `coordination ${mode}: no implicit participation or repeated paid fallback`,
      async () => {
        const f = await fixture();
        let npcCalls = 0;
        const model: TextModel = {
          async complete(messages) {
            const p = JSON.parse(messages[1]!.content);
            if (p.promptVersion.startsWith('director-'))
              return JSON.stringify({
                mode: 'bounded_opportunity',
                selectedCandidateIds: [],
                deferred: [],
                nudges: [],
                opportunities: [
                  {
                    id: 'op',
                    title: 'Optional discussion',
                    description: 'A future optional conversation',
                    playerImpact: 'Player may decline',
                    participantActorIds: [f.actorId],
                    placeIds: [],
                    activity: 'conversation',
                    basisSourceIds: ['fact:basis'],
                  },
                ],
                audit: { reason: 'Existing authorized basis only', basisSourceIds: ['fact:basis'] },
              });
            npcCalls++;
            assert.equal(p.input.origin, 'coordination');
            const request = JSON.parse(p.input.text);
            return JSON.stringify({
              ...empty(),
              ...(mode === 'quiet'
                ? {
                    episodeDecision: {
                      requestId: request.requestId,
                      choice: 'quiet',
                      reason: 'I do not need to begin a discussion now',
                      sourceIds: [p.input.sourceId],
                    },
                  }
                : {}),
            });
          },
        };
        const advance = npcAgentAdvanceServices(
          db,
          () => model,
          new PostgresDirectorSnapshotRepository(db),
        );
        if (mode === 'missing') await assert.rejects(advance.advanceIfEnabled(f.owner, f.id));
        else await advance.advanceIfEnabled(f.owner, f.id);
        const rows = (
          await admin.query(
            'SELECT status FROM parallel_life.agent_episode_requests WHERE world_id=$1',
            [f.id],
          )
        ).rows;
        assert.equal(rows.length, 1);
        assert.equal(rows[0].status, mode === 'quiet' ? 'consumed' : 'pending');
        const receipts = (
          await admin.query(
            'SELECT choice FROM parallel_life.agent_episode_receipts WHERE world_id=$1',
            [f.id],
          )
        ).rows;
        assert.equal(receipts.length, mode === 'quiet' ? 1 : 0);
        if (mode === 'quiet') assert.equal(receipts[0].choice, 'quiet');
        const state = await new PostgresAgentRuntimeRepository(db).read(f.owner, {
          worldId: f.id,
          actorId: f.actorId,
        });
        assert.equal(state!.revision, mode === 'quiet' ? 1 : 0);
        assert.deepEqual(state!.actions, []);
        if (mode === 'missing') {
          try {
            await advance.advanceIfEnabled(f.owner, f.id);
          } catch {}
          assert.equal(npcCalls, 1);
          assert.equal((await f.worlds.get({ userId: f.owner }, f.id)).version, 0);
        }
        assert.equal(
          (
            await admin.query(
              'SELECT count(*)::int n FROM parallel_life.world_messages WHERE world_id=$1',
              [f.id],
            )
          ).rows[0].n,
          0,
        );
      },
    );
});
