import { npcAgentServices } from '../../src/server/npc-agent-services.ts';
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
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { emptyActorAgentState } from '../../src/modules/world/domain/agent-runtime.ts';
import { agentDefinitionRef } from '../../src/modules/world/infrastructure/agent-snapshot-repository.ts';
import { PostgresDirectorSnapshotRepository } from '../../src/modules/world/infrastructure/director-snapshot-repository.ts';
import {
  PostgresDirectorRuntimeRepository,
  directorSnapshotInputHash,
} from '../../src/modules/world/infrastructure/director-runtime-repository.ts';
import { WorldDirectorAgentModel } from '../../src/modules/world/infrastructure/director-agent-model.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { admitNewAgentNarrativeInTransaction } from '../../src/modules/world/infrastructure/agent-narrative-repository.ts';

import type { ModelMessage } from '../../src/modules/ai/application/ports.ts';
import { PostgresAgentRuntimeRepository } from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';

import { runDirectorAgent } from '../../src/modules/world/application/run-director-agent.ts';
import { parseDirectorDecision } from '../../src/modules/world/infrastructure/director-agent-model.ts';

import { PostgresNpcAgentKernel } from '../../src/modules/world/infrastructure/npc-agent-kernel.ts';
import { createEpisodeRequestsInTransaction } from '../../src/modules/world/infrastructure/agent-narrative-repository.ts';

import type { AgentInputReceipt } from '../../src/modules/world/domain/agent-runtime.ts';
import type { AgentAttemptStore } from '../../src/modules/world/application/agent-runtime-ports.ts';
test('41-B final followup question projection and next-turn player decisions', async (t) => {
  const cfg = await localConfig();
  if (process.env.PLAYER_EPISODE_MANIFEST_TEST_PORT)
    assert.equal(cfg.port, Number(process.env.PLAYER_EPISODE_MANIFEST_TEST_PORT));
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
    [staff, 'Only local authored eligibility SQL fixtures'],
  );
  // Reviewer evidence must be stable across check/publish. No provider, no production review claim.
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
  const published = new PublicationWorldRepository(app, compiler),
    worlds = new PostgresWorldRepository(app);
  const raw = await readFile(
    new URL('../../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
    'utf8',
  );
  const base = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(raw)![1]!);
  const time = (h: number, m = 0, s = 0) =>
    `2026-10-12T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.000Z`;
  base.world.startAt = time(9);
  const secret = 'ACTOR_A_ONLY_TYPED_SUGGESTION_74';
  const prohibited = [
    'GLOBAL_SCRIPT_SECRET_74',
    'GLOBAL_EDITORIAL_SECRET_74',
    'GLOBAL_SCENE_SECRET_74',
    'GLOBAL_DESCRIPTION_SECRET_74',
    'GLOBAL_AUDIT_SECRET_74',
  ];
  const clocks = new PostgresClockStore(app),
    snapshots = new PostgresDirectorSnapshotRepository(app),
    directors = new PostgresDirectorRuntimeRepository(app),
    actors = new PostgresAgentRuntimeRepository(app),
    kernel = new PostgresNpcAgentKernel(app, worlds);
  async function fixture(
    kind:
      | 'message'
      | 'invitation'
      | 'hidden_invitation'
      | 'multi_invitation'
      | 'editorial'
      | 'improvised'
      | 'known' = 'message',
    legacyAuthored = false,
  ) {
    const content = structuredClone(base);
    content.history = [];
    content.initialKnowledge = [];
    const intent = ['invitation', 'hidden_invitation', 'multi_invitation'].includes(kind)
      ? {
          kind: 'offer_invitation',
          actorKeys:
            kind === 'multi_invitation'
              ? content.actors.map((a: { key: string }) => a.key)
              : [content.actors[0].key],
          placeKey: kind === 'hidden_invitation' ? 'hidden' : 'shop',
          title: 'LOCAL_INVITATION_74',
          earliestAt: '2026-10-13T09:00:00.000Z',
        }
      : kind === 'message'
        ? { kind: 'offer_message', actorKey: content.actors[0].key, text: secret }
        : { kind: 'editorial_only' };
    content.candidates = [
      {
        key: 'typed_offer',
        kind: 'candidate',
        title: 'Local typed author offer',
        editorialIntent: prohibited[1],
        script: prohibited[0],
        sceneText: prohibited[2],
        actorKeys: content.actors.map((a: { key: string }) => a.key),
        prerequisites: [],
        mutuallyExclusiveNodeKeys: [],
        intent,
      },
    ];
    if (kind === 'invitation' || kind === 'hidden_invitation')
      content.candidates[0].actorKeys = [content.actors[0].key];
    // Optional-event fixture: no separate opening protocol.
    delete content.openingEventKey;
    if (kind === 'hidden_invitation') {
      content.places.push({
        key: 'hidden',
        name: 'HIDDEN_PLACE_SENTINEL_74',
        description: 'Unrevealed',
        knownAtStart: false,
      });
      content.candidates[0].placeKey = 'hidden';
    }
    const parsed = PublishedWorldContentSchema.parse(content);
    const work = await stableWorks.create(staff, {
      commandId: randomUUID(),
      title: 'Explicit local actor intent fixture',
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
        if (kind === 'known')
          initial.goals.push({
            id: 'existing_goal',
            summary: 'MY_EXISTING_GOAL_' + a.id,
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
    await clocks.write(owner, id, {
      storyNow: world.time,
      paused: false,
      speed: 0,
      lastTickAt: new Date().toISOString(),
      missedBeats: 0,
      summary: null,
    });
    const snapshot = await snapshots.read(owner, {
      worldId: id,
      engineEpoch: 2,
      worldVersion: 0,
      candidates: [],
      blockers: [],
    });
    if (legacyAuthored) delete snapshot.deliberationWindow; // Historical v1 snapshot predates assessment partition.
    let calls = 0;
    const decision = await runDirectorAgent(
      {
        attempts: directors,
        parse: parseDirectorDecision,
        model: new WorldDirectorAgentModel({
          async complete(messages) {
            calls++;
            const p = JSON.parse(messages[1]!.content);
            const m = p.authoredMaterials.materials.find(
              (m: { ref: { nodeKey: string } }) => m.ref.nodeKey === 'typed_offer',
            );
            const e = p.wireCatalog.events.find((e: any) => e.authoredEventKey === 'typed_offer');
            assert.ok(e);
            const selectedActors = p.wireCatalog.actors.filter((a: any) =>
              kind === 'invitation' || kind === 'hidden_invitation'
                ? a.actorId === world.actors[0]!.id
                : true,
            );
            if (legacyAuthored)
              return JSON.stringify({
                protocol: 'director-wire-v1',
                mode: 'bounded_opportunity',
                candidates: [],
                opportunities: [
                  {
                    id: 'legacy-author-brief',
                    title: '原作者邀约',
                    description: '保留原作者材料',
                    playerImpact: '玩家自行决定',
                    actors: selectedActors.map((a: any) => a.ref),
                    places: [],
                    activity: 'conversation',
                    origin: { kind: 'authored', eventRef: e.ref },
                  },
                ],
                audit: { reason: '保留旧协议的作者原稿路径', sourceRefs: [e.ref] },
              });
            const wire = {
              protocol: 'director-wire-v14',
              openingContext: null,
              candidates: p.wireCatalog.candidates.map((c: any) => ({
                ref: c.ref,
                decision: 'defer',
                reason: 'Consider existing opportunity',
              })),
              authoredChoices: Object.fromEntries(
                p.wireCatalog.events.map((x: any) => [
                  x.ref,
                  x.ref === e.ref
                    ? {
                        kind: 'consider',
                        opportunity: {
                          title: 'Local opportunity',
                          description: prohibited[3],
                          playerImpact: 'Optional',
                          places: [],
                          activity: 'conversation',
                          actorTasks: Object.fromEntries(
                            p.wireCatalog.actors.map((a: any) => [
                              a.ref,
                              selectedActors.some((selected: any) => selected.ref === a.ref)
                                ? {
                                    topic: 'Optional meeting',
                                    personalObjective: 'Consider whether to meet',
                                    proposedInteraction: 'Ask about a suitable arrangement',
                                  }
                                : null,
                            ]),
                          ),
                        },
                      }
                    : { kind: 'defer', reason: 'Not selected' },
                ]),
              ),
              opportunities: [],
              audit: { reason: prohibited[4], sourceRefs: [e.ref] },
            };
            return JSON.stringify(wire);
          },
        }),
      },
      owner,
      {
        id: randomUUID(),
        worldId: id,
        commandId: randomUUID(),
        engineEpoch: 2,
        expectedWorldVersion: 0,
        inputHash: directorSnapshotInputHash(snapshot),
        token: randomUUID(),
        leaseUntil: new Date(Date.now() + 120000).toISOString(),
      },
      snapshot,
    );
    assert.equal(calls, 1);
    const requests = await app.transaction(owner, (sql) =>
      createEpisodeRequestsInTransaction(sql, owner, { worldId: id, engineEpoch: 2, decision }),
    );
    assert.equal(requests.length, kind === 'invitation' || kind === 'hidden_invitation' ? 1 : 2);
    return { owner, id, world, requests };
  }

  for (const streaming of [false, true]) {
    for (const [decision, text, relation] of [
      ['accepted', '好，我愿意参加。', 'answer'],
      ['declined', '我不参加。', 'answer'],
      ['deferred', '这件事明天再决定。', 'defer_answer'],
      ['undecided', '活动具体是什么？我先了解，还没有确定参加。', 'defer_answer'],
    ] as const)
      await t.test(`${streaming ? 'stream' : 'complete'} / ${decision}`, async () => {
        const f = await fixture('message');
        const actorId = f.world.actors[0]!.id;
        let calls = 0;
        function response(messages: readonly ModelMessage[]) {
          calls++;
          const payload = JSON.parse(messages[1]!.content);
          const sourceId = payload.wireCatalog.inputSourceRef;
          const quote = payload.input.text;
          return JSON.stringify({
            protocol: 'npc-wire-v19',
            executions: [],
            statements: [
              {
                text: calls === 1 ? '你愿意参加这次活动吗？' : '知道了，我按你的意思安排。',
                dependsOnActionIds: [],
                requestsPlayerReply: calls === 1,
              },
            ],
            changes:
              calls === 1
                ? {
                    consideration: {
                      choice: 'engage',
                      reason: '先询问玩家意愿',
                      basisSourceIds: [],
                      followUp: { waitingOn: 'player', missing: ['玩家是否参加'] },
                    },
                  }
                : {
                    inputInterpretation: {
                      kind: 'related_reply',
                      sourceId,
                      quote,
                      replies: [{ targetRef: 'reply:1', relation, decision }],
                    },
                  },
          });
        }
        const service = npcAgentServices(app, () =>
          streaming
            ? {
                async complete(messages) {
                  return response(messages);
                },
                async *streamComplete(messages) {
                  const raw = response(messages);
                  const end = raw.indexOf('],"changes"') + 1;
                  yield raw.slice(0, end);
                  yield raw.slice(end);
                },
              }
            : {
                async complete(messages) {
                  return response(messages);
                },
              },
        );
        const first = {
          id: randomUUID(),
          worldId: f.id,
          actorId,
          expectedVersion: 0,
          text: '你好。',
        };
        const seen: any[] = [];
        let prefixBeforeFinal: unknown[] = [];
        let prefixQuestion: unknown;
        const reply = await service.sendMessageIfEnabled(
          f.owner,
          first,
          streaming
            ? {
                onSegment: async (segment) => {
                  seen.push(segment);
                  prefixBeforeFinal = (
                    await admin.query(
                      `SELECT e.id,e.version,e.payload FROM parallel_life.world_events e WHERE e.world_id=$1 AND e.payload#>>'{data,stream,unit}'='statement:0'`,
                      [f.id],
                    )
                  ).rows;
                  const prefixState = (await actors.read(f.owner, { worldId: f.id, actorId }))!;
                  prefixQuestion = prefixState.questions;
                },
              }
            : undefined,
        );
        assert.equal(reply?.status, 'committed');
        let state = (await actors.read(f.owner, { worldId: f.id, actorId }))!;
        assert.equal(state.questions?.length, 1);
        const question = state.questions![0]!;
        const responsibility = state.responsibilities.find((r) => r.id.endsWith(':followup'))!;
        assert.ok(responsibility);
        assert.equal(question.responsibilityId, responsibility.id);
        assert.equal(state.decisions.length, 0);
        if (streaming) {
          assert.equal(seen.length, 1);
          const rows = (
            await admin.query(
              `SELECT completion_status FROM parallel_life.agent_attempt_stream_segments WHERE world_id=$1 AND command_id=$2`,
              [f.id, first.id],
            )
          ).rows;
          assert.equal(rows.length, 1);
          assert.equal(rows[0].completion_status, 'completed');
        }
        const prefix = streaming
          ? (
              await admin.query(
                `SELECT e.id,e.version,e.payload FROM parallel_life.world_events e
        WHERE e.world_id=$1 AND e.payload#>>'{data,stream,unit}'='statement:0'`,
                [f.id],
              )
            ).rows
          : [];
        if (streaming) {
          assert.equal(prefix.length, 1);
          assert.ok(
            (prefixQuestion as any[] | undefined)?.every((q) => q.responsibilityId === undefined) ??
              true,
          );
          assert.deepEqual(
            prefix,
            prefixBeforeFinal,
            'final keeps original prefix event immutable',
          );
        }
        const beforeVersion = (await worlds.get({ userId: f.owner }, f.id)).version;
        await service.sendMessageIfEnabled(f.owner, first);
        assert.equal(calls, 1);
        assert.equal(
          (await actors.read(f.owner, { worldId: f.id, actorId }))!.questions?.length,
          1,
        );
        const next = {
          id: randomUUID(),
          worldId: f.id,
          actorId,
          expectedVersion: beforeVersion,
          text,
        };
        const nextResult = await service.sendMessageIfEnabled(
          f.owner,
          next,
          streaming ? { onSegment: () => {} } : undefined,
        );
        assert.equal(nextResult?.status, 'committed');
        state = (await actors.read(f.owner, { worldId: f.id, actorId }))!;
        assert.equal(
          state.decisions.filter((d) => d.responsibilityId === responsibility.id).at(-1)?.kind,
          decision,
        );
        assert.equal(state.questions?.length, 1);
        await service.sendMessageIfEnabled(f.owner, next);
        assert.equal(calls, 2);
        if (streaming)
          assert.deepEqual(
            (
              await admin.query(
                `SELECT e.id,e.version,e.payload FROM parallel_life.world_events e
        WHERE e.world_id=$1 AND e.payload#>>'{data,stream,unit}'='statement:0' AND id=ANY($2::text[])`,
                [f.id, prefix.map((e) => e.id)],
              )
            ).rows,
            prefix,
          );
      });
  }
});
