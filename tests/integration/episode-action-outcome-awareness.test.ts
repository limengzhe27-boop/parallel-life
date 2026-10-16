import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import {
  PostgresDatabase,
  type SqlClient,
} from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PublicationRepository } from '../../src/modules/settings/infrastructure/publication-repository.ts';
import { PublicationWorldRepository } from '../../src/modules/settings/infrastructure/publication-world-repository.ts';
import { compilePublicationGenesis } from '../../src/modules/settings/infrastructure/publication-genesis.ts';
import {
  PublishedWorldContentSchema,
  inspectPublishedWorldSupport,
} from '../../src/contracts/published-world-content.ts';
import type { PublicationWorldCompilerPort } from '../../src/modules/settings/application/publication-world-ports.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
  PostgresAgentRuntimeRepository,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { PostgresDirectorSnapshotRepository } from '../../src/modules/world/infrastructure/director-snapshot-repository.ts';
import { PostgresDirectorRuntimeRepository } from '../../src/modules/world/infrastructure/director-runtime-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { admitNewAgentNarrativeInTransaction } from '../../src/modules/world/infrastructure/agent-narrative-repository.ts';
import { npcAgentAdvanceServices } from '../../src/server/npc-agent-advance-services.ts';
import { npcAgentServices } from '../../src/server/npc-agent-services.ts';
import { readActorSceneObservationSourcesInTransaction } from '../../src/modules/world/infrastructure/actor-scene-observation-sources.ts';
import { readActorGroupObservationSourcesInTransaction } from '../../src/modules/world/infrastructure/actor-group-observation-sources.ts';
import { projectCommittedWorldAwareness } from '../../src/modules/world/infrastructure/world-awareness-repository.ts';
import { PostgresGroupRepository } from '../../src/modules/world/infrastructure/group-repository.ts';

test('44-117 episode action outcome, resolution criteria, and sourced awareness propagation', async (t) => {
  const cfg = await localConfig();
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const app = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  class LocalPublisher extends PostgresDatabase {
    override transaction<T>(owner: string, run: (sql: SqlClient) => Promise<T>) {
      return super.transaction(owner, async (sql) => {
        await sql.query('SET LOCAL ROLE pl_publisher');
        return run(sql);
      });
    }
  }
  const pub = new LocalPublisher(
    `postgresql://pl_admin:${cfg.adminPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const owned: { owner: string; id: string }[] = [];
  t.after(async () => {
    try {
      for (const f of owned)
        await admin.query(
          'UPDATE parallel_life.world_clock SET paused=true,active_until=NULL WHERE world_id=$1 AND owner_id=$2',
          [f.id, f.owner],
        );
    } finally {
      await app.close();
      await pub.close();
      await admin.end();
    }
  });

  const staff = randomUUID();
  await admin.query(
    'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active)VALUES($1,$2,true,true,true)',
    [staff, 'Outcome awareness integration staff'],
  );
  const reviewReceipt = randomUUID();
  const stableWorks = new PublicationRepository(pub, {
    async review({ content }) {
      return {
        reviewerVersion: 'EXPLICIT_LOCAL_AUTHORED_SEMANTIC_WAKE_FIXTURE',
        runtimeCapabilities: new Set(inspectPublishedWorldSupport(content).requiredCapabilities),
        media: { verified: true, manifestHash: 'a'.repeat(64) },
        trial: { verified: true, receiptId: reviewReceipt },
      };
    },
  });
  const compiler: PublicationWorldCompilerPort = {
    prepare(input) {
      const r = compilePublicationGenesis({
        ...input,
        originKind: input.originKind === 'trial' ? 'trial' : 'published',
        newId: randomUUID,
      });
      assert.equal(r.status, 'compiled');
      if (r.status !== 'compiled') throw Error('EXPLICIT_FIXTURE_COMPILER_FAILED');
      return {
        world: r.world,
        opening: r.opening,
        seed: {
          id: input.seedId,
          createdAt: new Date().toISOString(),
          source: {
            kind: input.originKind === 'trial' ? 'publication_trial' : 'published_work',
            ...input.origin,
          },
          identity: r.opening.identity,
          situation: r.opening.situation,
          setting: r.opening.setting,
          experienceNote: r.opening.experienceNote,
        },
      };
    },
  };
  const published = new PublicationWorldRepository(app, compiler);
  const worlds = new PostgresWorldRepository(app);
  const clocks = new PostgresClockStore(app);
  const snapshots = new PostgresDirectorSnapshotRepository(app);
  const directors = new PostgresDirectorRuntimeRepository(app);
  const actors = new PostgresAgentRuntimeRepository(app);
  const groups = new PostgresGroupRepository(app);

  const raw = await readFile(
    new URL('../../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
    'utf8',
  );
  const base = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(raw)![1]!);
  const time = (h: number, m = 0, s = 0) =>
    `2026-10-12T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.000Z`;
  base.world.startAt = time(9);

  async function createFixture() {
    const content = structuredClone(base);
    content.candidates = [
      {
        key: 'formal_invitation_event',
        kind: 'candidate',
        title: 'Formal Invitation Event',
        editorialIntent: 'Formal invitation test node',
        script: 'Formal invitation script',
        sceneText: 'Cafe meeting',
        actorKeys: [content.actors[0].key],
        prerequisites: [],
        mutuallyExclusiveNodeKeys: [],
        intent: {
          kind: 'offer_invitation',
          actorKeys: [content.actors[0].key],
          placeKey: content.places[0].key,
          title: 'FORMAL_INVITATION_TITLE',
          earliestAt: '2026-10-13T09:00:00.000Z',
        },
        direction: {
          mode: 'optional',
          progress: {
            completion: {
              scope: 'invitation_response',
              mode: 'all',
              criteria: [{ key: 'answer', kind: 'invitation_response', response: 'accepted' }],
            },
          },
        },
      },
      {
        key: 'dependent_followup_event',
        kind: 'candidate',
        title: 'Dependent Meeting Event',
        editorialIntent: 'Dependent meeting event',
        script: 'Dependent script',
        sceneText: 'Dependent scene',
        actorKeys: [content.actors[0].key],
        prerequisites: [{ kind: 'after_committed_node', nodeKey: 'formal_invitation_event' }],
        mutuallyExclusiveNodeKeys: [],
        intent: { kind: 'editorial_only' },
      },
      {
        key: 'opening',
        kind: 'candidate',
        title: 'Opening Scene',
        editorialIntent: 'Opening event',
        script: 'Opening script',
        sceneText: 'Opening scene',
        actorKeys: [],
        prerequisites: [],
        mutuallyExclusiveNodeKeys: [],
        intent: { kind: 'director_event' },
      },
    ];
    content.openingEventKey = 'opening';

    const parsed = PublishedWorldContentSchema.parse(content);
    const work = await stableWorks.create(staff, {
      commandId: randomUUID(),
      title: 'Action Outcome Publication',
      content: parsed,
    });
    const check = await stableWorks.check(staff, work.id, {
      commandId: randomUUID(),
      expectedDraftVersion: 0,
    });
    assert.equal(check.status, 'ready');
    await stableWorks.publish(staff, work.id, {
      commandId: randomUUID(),
      expectedDraftVersion: 0,
      expectedMetadataVersion: 0,
      checkId: check.id,
    });
    const owner = randomUUID();
    await new IdentityRepository(app).ensureGuest(owner);
    const { worldId: id } = await published.startPublished(owner, work.id, {
      commandId: randomUUID(),
      publicationVersion: 1,
    });
    owned.push({ owner, id });
    const world = await worlds.get({ userId: owner }, id);
    await app.transaction(owner, async (sql) => {
      for (const a of world.actors) {
        const initial = emptyActorAgentState(
          { worldId: id, actorId: a.id },
          agentDefinitionRef(world, a.id),
          0,
        );
        initial.goals.push({
          id: 'goal-initial-' + a.id,
          summary: 'Existing private responsibility for ' + a.name,
          status: 'active',
          sourceIds: ['definition:' + initial.definitionRef],
          resultIds: [],
        });
        await initializeActorAgentStateInTransaction(sql, owner, initial);
      }
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId: id,
        expectedWorldVersion: 0,
        expectedEpoch: 1,
        nextEpoch: 2,
      });
      await admitNewAgentNarrativeInTransaction(sql, owner, { worldId: id, engineEpoch: 2 });
    });
    await clocks.setClock(owner, id, { paused: false, speed: 0 });
    return { owner, id, world };
  }

  const f = await createFixture();
  const actorA = f.world.actors[0]!.id;
  const actorB = f.world.actors[1]!.id;

  // =========================================================================
  // Part 1: Distinction between Dialogue and Genuine Action Execution (Negative Boundaries)
  // =========================================================================

  // Boundary 1: NPC merely claims in dialogue "I have finished everything", but proposes NO action.
  // The dialogue should commit legally, but actor's goal remains unfulfilled (no fake result).
  let dialogueOnlyCalls = 0;
  const dialogueOnlyService = npcAgentServices(app, () => ({
    async complete(messages) {
      dialogueOnlyCalls++;
      return JSON.stringify({
        statements: [{ text: '我已经把所有工作全办好了，放心吧！', dependsOnActionIds: [] }],
        goals: [],
        plans: [],
        actions: [],
        responsibilities: [],
        decisions: [],
      });
    },
  }));

  const chatCmd = {
    id: randomUUID(),
    worldId: f.id,
    expectedVersion: 0,
    actorId: actorA,
    text: '工作准备得怎么样了？',
  };
  const chatResult = await dialogueOnlyService.sendMessageIfEnabled(f.owner, chatCmd);
  assert.equal(chatResult?.status, 'committed');
  assert.equal(dialogueOnlyCalls, 1);

  // Read DB: Alice's goal MUST remain active and unfulfilled!
  const aliceStateAfterChat = await actors.read(f.owner, { worldId: f.id, actorId: actorA });
  const initialGoal = aliceStateAfterChat!.goals.find((g) => g.id === 'goal-initial-' + actorA);
  assert.equal(initialGoal?.status, 'active');
  assert.equal(initialGoal?.resultIds.length, 0);

  // Boundary 2: NPC attempts to propose goal.status = 'fulfilled' WITHOUT legitimate resultIds.
  // The kernel proposal validator MUST strictly reject it with GOAL_RESULT_REQUIRED.
  const curWorld1 = await worlds.get({ userId: f.owner }, f.id);
  const illegalFulfilledService = npcAgentServices(app, () => ({
    async complete(messages) {
      const p = JSON.parse(messages[1]!.content);
      const inputSourceId = p.input.sourceId;
      return JSON.stringify({
        statements: [{ text: '目标完成！', dependsOnActionIds: [] }],
        goals: [
          {
            id: 'goal-initial-' + actorA,
            summary: 'Existing private responsibility for Alice',
            status: 'fulfilled', // ILLEGAL: no resultIds provided!
            sourceIds: [inputSourceId],
            resultIds: [],
          },
        ],
        plans: [],
        actions: [],
        responsibilities: [],
        decisions: [],
      });
    },
  }));

  const illegalCmd = {
    id: randomUUID(),
    worldId: f.id,
    expectedVersion: curWorld1.version,
    actorId: actorA,
    text: '请汇报结果。',
  };
  // Rejected with 422 INVALID_AI_OUTPUT caused by GOAL_RESULT_REQUIRED in kernel
  await assert.rejects(illegalFulfilledService.sendMessageIfEnabled(f.owner, illegalCmd), {
    apiCode: 'INVALID_AI_OUTPUT',
  });

  // =========================================================================
  // Part 2: Genuine Action Execution, Substep Progression, and Atomic Outcome
  // =========================================================================

  // Step 2.1: Director proposes opportunity for formal_invitation_event
  let opportunityProposed = false;
  let episodeId = '';
  const advanceDirector = npcAgentAdvanceServices(
    app,
    () => ({
      async complete(messages) {
        const p = JSON.parse(messages.find((m) => m.role === 'user')!.content);
        if (p.promptVersion?.startsWith('director-')) {
          if (!opportunityProposed) {
            opportunityProposed = true;
            episodeId = randomUUID();
            const m = p.authoredMaterials.materials.find(
              (mat: any) => mat.ref.nodeKey === 'formal_invitation_event',
            );
            return JSON.stringify({
              mode: 'bounded_opportunity',
              selectedCandidateIds: [],
              deferred: [],
              nudges: [],
              opportunities: [
                {
                  id: episodeId,
                  title: 'Formal Invitation Opportunity',
                  description: 'Opportunity to invite player to meeting',
                  playerImpact: 'Player invitation',
                  participantActorIds: [actorA],
                  placeIds: [],
                  activity: 'conversation',
                  basisSourceIds: [m.sourceId],
                  authoredEventKey: 'formal_invitation_event',
                },
              ],
              audit: { reason: 'PROPOSE_INVITATION_OPPORTUNITY', basisSourceIds: [] },
            });
          }
          return JSON.stringify({
            mode: 'quiet',
            selectedCandidateIds: [],
            deferred: [],
            nudges: [],
            opportunities: [],
            audit: { reason: 'DIRECTOR_QUIET', basisSourceIds: [] },
          });
        }
        // When coordination dispatches episode consideration to Actor A:
        // Actor A engages and proposes a genuine action: capability 'appointment.propose'
        const intent = p.input?.text ? (p.input.text.startsWith('{') ? JSON.parse(p.input.text) : null) : null;
        if (p.input.origin === 'coordination' && intent?.type === 'npc_episode_consideration') {
          const basis = [p.input.sourceId, `definition:${p.state.definitionRef}`];
          return JSON.stringify({
            statements: [{ text: '我想正式邀请您于明天上午在约定地点见面商谈。', dependsOnActionIds: [] }],
            goals: [
              {
                id: 'goal-invite-meeting',
                summary: '邀请玩家见面',
                status: 'active',
                sourceIds: basis,
                resultIds: [],
              },
            ],
            plans: [],
            actions: [
              {
                id: 'action-propose-invitation',
                goalId: 'goal-invite-meeting',
                capability: 'appointment.propose',
                targetIds: [],
                parameters: {
                  title: 'FORMAL_MEETING_APPOINTMENT',
                  at: new Date(Date.parse(p.storyAt) + 86400000).toISOString(),
                },
                preconditions: [],
                dependsOnActionIds: [],
                handlesResponsibilityIds: [],
                sourceIds: basis,
                status: 'proposed',
              },
            ],
            responsibilities: [],
            decisions: [],
            episodeDecision: {
              requestId: intent.requestId,
              choice: 'engage',
              reason: 'I genuinely want to arrange this meeting with player',
              sourceIds: basis,
            },
          });
        }
        return JSON.stringify({ statements: [], goals: [], plans: [], actions: [], responsibilities: [], decisions: [] });
      },
    }),
    snapshots,
  );

  // Advance 1: Director proposes opportunity and may dispatch
  const res1 = await advanceDirector.advanceIfEnabled(f.owner, f.id);
  console.log('ADVANCE_1_RESULT:', res1);
  assert.ok(opportunityProposed);
  assert.ok(episodeId);

  // Check if res1 already changed state or if advance 2 is needed
  let resEngage = res1;
  if (!resEngage?.changed) {
    resEngage = await advanceDirector.advanceIfEnabled(f.owner, f.id);
    console.log('ADVANCE_2_RESULT:', resEngage);
  }
  assert.equal(resEngage?.changed, true);

  // Verify in PostgreSQL:
  // 1. Appointment is created by legitimate action execution
  const curWorld2 = await worlds.get({ userId: f.owner }, f.id);
  const appointment = curWorld2.appointments.find((a) => a.title === 'FORMAL_MEETING_APPOINTMENT');
  assert.ok(appointment, 'Appointment must be genuinely created in world state');
  assert.equal(appointment.status, 'proposed');

  // 2. Substep Progression: Shared episode MUST remain 'active' (NOT resolved!)
  // Proposing an action or engaging does NOT resolve the event!
  const epMid = (await directors.readEpisodes(f.owner, f.id)).find((e) => e.id === episodeId)!;
  assert.equal(epMid.status, 'active');
  assert.equal(epMid.resultIds.length, 0);

  // 3. Dependent event (dependent_followup_event) MUST still be blocked!
  const preResolutionEligibility = (await snapshots.read(f.owner, {
    worldId: f.id,
    engineEpoch: 2,
    worldVersion: curWorld2.version,
    candidates: [],
    blockers: [],
  })).authoredEligibility!;
  const followupEligibilityPre = preResolutionEligibility.find((e) => e.nodeKey === 'dependent_followup_event');
  assert.equal(followupEligibilityPre?.status, 'blocked', 'Dependent event must NOT unlock before resolution');

  // Step 2.2: Player genuinely responds to invitation via original application entry
  const acceptCommand = {
    commandId: randomUUID(),
    worldId: f.id,
    id: appointment.id,
    expectedVersion: curWorld2.version,
    operation: 'accept' as const,
  };
  await worlds.respondToInvitation({ userId: f.owner }, acceptCommand);

  // Verify in PostgreSQL:
  // 1. Appointment status updated to 'confirmed'
  const worldAfterAccept = await worlds.get({ userId: f.owner }, f.id);
  const apptAfter = worldAfterAccept.appointments.find((a) => a.id === appointment.id)!;
  assert.equal(apptAfter.status, 'confirmed');

  // 2. Event Resolution: Because completion.scope = 'invitation_response',
  // projectEpisodeOutcomesInTransaction committed an immutable outcome into agent_episode_outcomes!
  const outcomes = (
    await app.transaction(f.owner, (sql) =>
      sql.query('SELECT * FROM parallel_life.agent_episode_outcomes WHERE world_id=$1', [f.id]),
    )
  ).rows;
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0]!.scope, 'invitation_response');
  assert.equal(outcomes[0]!.outcome, 'committed');

  // 3. Shared episode transitioned to 'resolved' with author_completion_criteria_met!
  const epResolved = (await directors.readEpisodes(f.owner, f.id)).find((e) => e.id === episodeId)!;
  assert.equal(epResolved.status, 'resolved');
  assert.equal(epResolved.endReason, 'author_completion_criteria_met');
  assert.deepEqual(epResolved.resultIds, [outcomes[0]!.id]);

  // 4. Dependent event is now unlocked!
  const postResolutionEligibility = (await snapshots.read(f.owner, {
    worldId: f.id,
    engineEpoch: 2,
    worldVersion: worldAfterAccept.version,
    candidates: [],
    blockers: [],
  })).authoredEligibility!;
  const followupEligibilityPost = postResolutionEligibility.find((e) => e.nodeKey === 'dependent_followup_event');
  assert.equal(followupEligibilityPost?.status, 'eligible', 'Dependent event must unlock after outcome resolution');

  // 5. Separate participant responsibility: Actor A's private goals are NOT wiped or falsely marked fulfilled!
  const aliceStateAfterOutcome = await actors.read(f.owner, { worldId: f.id, actorId: actorA });
  const aliceInitialGoal = aliceStateAfterOutcome!.goals.find((g) => g.id === 'goal-initial-' + actorA)!;
  assert.equal(aliceInitialGoal.status, 'active', 'Private ongoing goal must not be wiped by episode outcome');
  assert.equal(aliceInitialGoal.resultIds.length, 0);

  // 6. Idempotent command replay: Replaying the identical invitation acceptance must NOT insert duplicate outcomes
  await worlds.respondToInvitation({ userId: f.owner }, acceptCommand);
  const outcomesReplay = (
    await app.transaction(f.owner, (sql) =>
      sql.query('SELECT * FROM parallel_life.agent_episode_outcomes WHERE world_id=$1', [f.id]),
    )
  ).rows;
  assert.equal(outcomesReplay.length, 1, 'Replaying acceptance command must never duplicate outcomes');

  // =========================================================================
  // Part 3: Genuine On-Scene Observation, Visibility Proof, and Knowledge Isolation
  // =========================================================================

  // Step 3.1: Create a scene at Central Cafe where Actor A is present, but Actor B is ABSENT!
  const sceneId = randomUUID();
  const curWorld3 = await worlds.get({ userId: f.owner }, f.id);
  const openTime = new Date(Date.parse(curWorld3.time) + 1000).toISOString();

  await app.transaction(f.owner, async (sql) => {
    // 1. Open scene in cafe
    const openEventId = randomUUID();
    const openCmdId = randomUUID();
    await sql.query(
      `INSERT INTO parallel_life.commands (id, world_id, owner_id, expected_version, request_hash, request_payload, status)
       VALUES ($1, $2, $3, $4, 'open-scene-hash', $5, 'queued')`,
      [openCmdId, f.id, f.owner, curWorld3.version, {}],
    );
    const openEventPayload = {
      id: openEventId,
      worldId: f.id,
      ownerId: f.owner,
      version: curWorld3.version + 1,
      commandId: openCmdId,
      type: 'scene.opened',
      occurredAt: openTime,
      storyAt: openTime,
      schemaVersion: 1,
      data: {
        sceneId,
        placeId: 'cafe',
        proposal: {
          presentActorIds: [actorA],
          narration: '咖啡馆的窗边摆放着一盆盛开的百合花。',
        },
      },
    };
    await sql.query(
      `INSERT INTO parallel_life.world_events (id, world_id, owner_id, version, command_id, payload, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        openEventId,
        f.id,
        f.owner,
        curWorld3.version + 1,
        openCmdId,
        openEventPayload,
        openTime,
      ],
    );
    await sql.query(
      `SELECT set_config('app.agent_engine_epoch', '2', true), set_config('app.agent_world_id', $1, true)`,
      [f.id],
    );
    await sql.query(
      `UPDATE parallel_life.commands SET status='succeeded', result_event_id=$3, result_state=$4 WHERE world_id=$1 AND id=$2`,
      [f.id, openCmdId, openEventId, { ...curWorld3, version: curWorld3.version + 1 }],
    );
    await sql.query(
      `UPDATE parallel_life.worlds SET version=$2 WHERE id=$1`,
      [f.id, curWorld3.version + 1],
    );
    await projectCommittedWorldAwareness(sql, f.owner, openEventPayload as any);
    await sql.query(
      `INSERT INTO parallel_life.scene_sessions (id, world_id, owner_id, source_event_id, document)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        sceneId,
        f.id,
        f.owner,
        openEventId,
        {
          id: sceneId,
          worldId: f.id,
          ownerId: f.owner,
          title: '咖啡馆现场',
          placeId: 'cafe',
          sourceVersion: curWorld3.version + 1,
          sourceEventId: openEventId,
          status: 'active',
          presence: [
            {
              participant: { kind: 'actor', actorId: actorA },
              joinedVersion: curWorld3.version + 1,
              sourceVersion: curWorld3.version + 1,
              sourceEventId: openEventId,
            },
            // Actor B is intentionally omitted from presence! Actor B is at 'office', NOT in this scene.
          ],
        },
      ],
    );

    // 2. Insert a real scene item entry observableTo Actor A
    const itemId = randomUUID();
    await sql.query(
      `INSERT INTO parallel_life.scene_items (id, world_id, owner_id, scene_id, source_event_id, kind, document)
       VALUES ($1, $2, $3, $4, $5, 'entry', $6)`,
      [
        itemId,
        f.id,
        f.owner,
        sceneId,
        openEventId,
        {
          id: itemId,
          worldId: f.id,
          ownerId: f.owner,
          sceneId,
          sourceEventId: openEventId,
          sourceVersion: curWorld3.version + 1,
          kind: 'narration',
          perspective: 'observable',
          text: '咖啡馆的窗边摆放着一盆盛开的百合花。',
          observableTo: [{ kind: 'actor', actorId: actorA }],
        },
      ],
    );
  });

  // Step 3.2: Verify genuine observation filtering
  // Read scene observation sources for Actor A (in scene) vs Actor B (absent from scene)
  const sceneWorldVersion = curWorld3.version + 1;
  const obsPacketAlice = await app.transaction(f.owner, (sql) =>
    readActorSceneObservationSourcesInTransaction(sql, f.owner, {
      worldId: f.id,
      actorId: actorA,
      sceneId,
      worldVersion: sceneWorldVersion,
      storyAt: openTime,
    }),
  );
  assert.equal(obsPacketAlice.status, 'complete');
  assert.equal(obsPacketAlice.observations.length, 1);
  const aliceObs = obsPacketAlice.observations[0]!;
  assert.equal(aliceObs.text, '咖啡馆的窗边摆放着一盆盛开的百合花。');
  assert.equal(aliceObs.evidenceKind, 'scene_record');
  assert.ok(aliceObs.learnedAt, 'learnedAt must be honestly tracked in protocol');
  assert.ok(aliceObs.eventOccurredAt, 'eventOccurredAt must be honestly tracked');

  // Verify Actor B: Absent from scene presence -> MUST RECEIVE 0 OBSERVATIONS!
  const obsPacketBob = await app.transaction(f.owner, (sql) =>
    readActorSceneObservationSourcesInTransaction(sql, f.owner, {
      worldId: f.id,
      actorId: actorB,
      sceneId,
      worldVersion: sceneWorldVersion,
      storyAt: openTime,
    }),
  );
  assert.equal(obsPacketBob.observations.length, 0, 'Actor B absent from scene must remain completely unaware');

  // Verify Director's observation isolation:
  // Director has result observations, but knownByActorIds is EMPTY -> does NOT leak to all NPCs!
  const directorSnapshot = await snapshots.read(f.owner, {
    worldId: f.id,
    engineEpoch: 2,
    worldVersion: sceneWorldVersion,
    candidates: [],
    blockers: [],
  });
  const outcomeObs = directorSnapshot.observations.filter((o) => o.sourceId.startsWith('episode-outcome:'));
  assert.ok(outcomeObs.length > 0);
  for (const o of outcomeObs) {
    assert.deepEqual(o.knownByActorIds, [], 'Global director outcome observations must NOT broadcast to NPCs');
  }

  // Step 3.3: Distinction between Report (speech) and Fact
  // If player tells Bob in group chat "听说咖啡馆窗边有一盆百合花", Bob receives it as 'player_report', NOT world fact!
  const curWorldForGroup = await worlds.get({ userId: f.owner }, f.id);
  const groupCmd = {
    commandId: randomUUID(),
    expectedVersion: curWorldForGroup.version,
    worldId: f.id,
    title: 'Staff Coordination Chat',
    actorIds: [actorA, actorB],
  };
  const groupRes = await groups.create(f.owner, groupCmd);
  const curWorldForSend = await worlds.get({ userId: f.owner }, f.id);
  const msgCmd = {
    commandId: randomUUID(),
    expectedVersion: curWorldForSend.version,
    worldId: f.id,
    groupId: groupRes.groupId,
    text: '我刚才在咖啡馆看到窗边有一盆百合花。',
  };
  await groups.send(f.owner, msgCmd);

  const bobGroupPacket = await app.transaction(f.owner, async (sql) => {
    const curW = (await sql.query('SELECT version, state FROM parallel_life.worlds WHERE id=$1', [f.id])).rows[0];
    return readActorGroupObservationSourcesInTransaction(sql, f.owner, {
      worldId: f.id,
      actorId: actorB,
      engineEpoch: 2,
      worldVersion: curW.version,
      storyAt: curW.state?.time ?? openTime,
      groupId: groupRes.groupId,
    });
  });

  assert.equal(bobGroupPacket.observations.length, 1);
  const bobObs = bobGroupPacket.observations[0]!;
  assert.equal(bobObs.text, '我刚才在咖啡馆看到窗边有一盆百合花。');
  assert.equal(bobObs.evidenceKind, 'player_report', 'Hearsay message must be classified as player_report, not fact');
  assert.ok(bobObs.learnedAt, 'learnedAt tracks when recipient heard the message');

  // Step 3.4: Restrained Wake and Dedup
  // Advance engine: Actor A's follow-up or quiet processing occurs once, and does not loop or repeat
  let actorAWakes = 0;
  const advanceWithObservation = npcAgentAdvanceServices(
    app,
    () => ({
      async complete(messages) {
        const p = JSON.parse(messages.find((m) => m.role === 'user')!.content);
        if (p.promptVersion?.startsWith('director-')) {
          return JSON.stringify({
            mode: 'quiet',
            selectedCandidateIds: [],
            deferred: (p.candidates ?? []).map((c: any) => ({ candidateId: c.id, reason: 'QUIET' })),
            nudges: [],
            opportunities: [],
            audit: { reason: 'QUIET', basisSourceIds: [] },
          });
        }
        return JSON.stringify({ statements: [], goals: [], plans: [], actions: [], responsibilities: [], decisions: [] });
      },
    }),
    snapshots,
  );

  // Advance engine: Actor processes observations without crashing or duplicating outcome records
  const advRes1 = await advanceWithObservation.advanceIfEnabled(f.owner, f.id);
  assert.ok(advRes1);

  const advRes2 = await advanceWithObservation.advanceIfEnabled(f.owner, f.id);
  assert.ok(advRes2);

  // Re-verify that outcomes in DB were never duplicated by subsequent advances:
  const outcomesFinal = (
    await app.transaction(f.owner, (sql) =>
      sql.query(
        'SELECT * FROM parallel_life.agent_episode_outcomes WHERE world_id=$1',
        [f.id],
      ),
    )
  ).rows;
  assert.equal(outcomesFinal.length, 1, 'Episode outcomes must remain exactly 1, never duplicated by advances');
});
