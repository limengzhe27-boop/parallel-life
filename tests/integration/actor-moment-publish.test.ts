import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import {
  PostgresAgentRuntimeRepository,
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import { PostgresNpcAgentKernel } from '../../src/modules/world/infrastructure/npc-agent-kernel.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { runNpcAgent } from '../../src/modules/world/application/run-agent.ts';
import {
  mergeSocialMoments,
} from '../../src/modules/settings/infrastructure/publication-social-repository.ts';
import { AuthoredSocialSchema } from '../../src/contracts/authored-social.ts';
import type { AgentSnapshot } from '../../src/modules/world/application/agent-runtime-ports.ts';
import type {
  ActorAgentState,
  AgentInputReceipt,
  AgentProposal,
} from '../../src/modules/world/domain/agent-runtime.ts';

test('actor capability chain: moment.publish end-to-end execution, parameter guards, dynamic social feed projection, and responsibility fulfillment', async (t) => {
  const cfg = await localConfig();
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const app = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );

  const worlds = new PostgresWorldRepository(app);
  const store = new PostgresAgentRuntimeRepository(app);

  t.after(async () => {
    await app.close();
    await admin.end();
  });

  async function fixture() {
    const owner = randomUUID();
    const worldId = randomUUID();
    const actorLinId = randomUUID();
    const actorQingqingId = randomUUID();
    const storyNow = '2026-10-18T10:00:00.000Z';
    const createdTime = '2026-10-18T09:00:00.000Z';
    const publishGoalId = 'goal_publish_workshop';
    const publishRespId = 'resp_publish_workshop';
    const event1Id = randomUUID();

    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [owner]);

    const initialWorldState: any = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 1,
      title: '朋友圈动态发布闭环测试世界',
      time: storyNow,
      actors: [
        { id: actorLinId, name: '林白语', persona: '知性严谨的手作人' },
        { id: actorQingqingId, name: '青青', persona: '多年闺蜜与设计搭档' },
      ],
      messages: [],
      appointments: [],
      facts: [],
      mediaRequests: [],
      items: [],
      activities: [],
      moments: [],
    };

    const linInitialState: ActorAgentState = {
      schemaVersion: 1,
      worldId,
      actorId: actorLinId,
      revision: 0,
      projectedWorldVersion: 1,
      definitionRef: 'author:actor:lin',
      knowledgeSourceIds: ['source_init'],
      memoryIds: [],
      relationshipIds: [],
      goals: [
        {
          id: publishGoalId,
          summary: '向朋友圈分享今日工坊新出的手作琉璃胸针',
          status: 'active',
          sourceIds: ['source_init'],
          resultIds: [],
        },
      ],
      plans: [],
      actions: [],
      responsibilities: [
        {
          id: publishRespId,
          revision: 0,
          status: 'open',
          waitingOn: null,
          summary: '发布琉璃手作动态',
          sourceIds: ['source_init'],
          subject: { kind: 'matter', id: 'matter_workshop' },
          nextCheck: [],
        },
      ],
      decisions: [],
      focus: null,
    };

    const qingqingInitialState: ActorAgentState = {
      schemaVersion: 1,
      worldId,
      actorId: actorQingqingId,
      revision: 0,
      projectedWorldVersion: 1,
      definitionRef: 'author:actor:qingqing',
      knowledgeSourceIds: ['source_init'],
      memoryIds: [],
      relationshipIds: [],
      goals: [],
      plans: [],
      actions: [],
      responsibilities: [],
      decisions: [],
      focus: null,
    };

    await app.transaction(owner, async (sql) => {
      await sql.query(
        'INSERT INTO parallel_life.worlds(id,owner_id,title,version,asset_revision,state) VALUES($1,$2,$3,1,0,$4)',
        [worldId, owner, '朋友圈动态发布闭环测试世界', JSON.stringify(initialWorldState)],
      );
      await sql.query(
        'INSERT INTO parallel_life.world_initial_snapshots(world_id,owner_id,state,approved_seed) VALUES($1,$2,$3,$4)',
        [worldId, owner, JSON.stringify({ ...initialWorldState, version: 0 }), {}],
      );
      const event1CommandId = randomUUID();
      await sql.query(
        "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status,result_event_id,result_state) VALUES($1,$2,$3,0,'0000000000000000000000000000000000000000000000000000000000000000','{}','succeeded',$4,$5)",
        [event1CommandId, worldId, owner, event1Id, JSON.stringify(initialWorldState)],
      );
      await sql.query(
        'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,1,$4,$5,$6)',
        [
          event1Id,
          worldId,
          owner,
          event1CommandId,
          {
            id: event1Id,
            worldId,
            type: 'turn.resolved',
            version: 1,
            occurredAt: createdTime,
            storyAt: createdTime,
            data: { effects: [] },
          },
          createdTime,
        ],
      );
      await sql.query(
        'INSERT INTO parallel_life.world_clock(world_id,owner_id,story_now,paused,speed,managed,active_until) VALUES($1,$2,$3,false,1,false,null)',
        [worldId, owner, storyNow],
      );
      await initializeActorAgentStateInTransaction(sql, owner, linInitialState);
      await initializeActorAgentStateInTransaction(sql, owner, qingqingInitialState);
      await switchAgentEngineEpochInTransaction(sql, owner, {
        worldId,
        expectedEpoch: 1,
        nextEpoch: 2,
        expectedWorldVersion: 1,
      });
    });

    return {
      owner,
      worldId,
      actorLinId,
      actorQingqingId,
      storyNow,
      createdTime,
      publishGoalId,
      publishRespId,
    };
  }

  await t.test('1. rejection: empty text or unrecognized parameters throw MOMENT_PUBLISH_PARAMETERS', async () => {
    const f = await fixture();
    const kernel = new PostgresNpcAgentKernel(app, worlds);

    const inputReceipt: AgentInputReceipt = {
      id: randomUUID(),
      worldId: f.worldId,
      channel: 'private',
      threadId: f.actorLinId,
      recipientActorId: f.actorLinId,
      commandId: randomUUID(),
      origin: 'player',
      storyAt: f.storyNow,
      expectedWorldVersion: 1,
      inputHash: createHash('sha256').update('empty-moment-check').digest('hex'),
      text: '今天工坊有什么新鲜事吗？',
      receivedAt: new Date().toISOString(),
    };
    await store.accept(f.owner, inputReceipt);

    const actionId = 'action_empty_moment';
    const proposal: AgentProposal = {
      goals: [],
      plans: [],
      actions: [
        {
          id: actionId,
          goalId: f.publishGoalId,
          capability: 'moment.publish',
          targetIds: [f.actorLinId],
          parameters: {
            text: '   ', // empty trimmed text
          },
          sourceIds: ['source_init'],
          preconditions: [],
          dependsOnActionIds: [],
          handlesResponsibilityIds: [],
          status: 'ready',
        },
      ],
      responsibilities: [],
      decisions: [],
      statements: [{ text: '发个空白朋友圈', dependsOnActionIds: [] }],
    };

    const linState0 = (await store.read(f.owner, { worldId: f.worldId, actorId: f.actorLinId }))!;
    const snapshot: AgentSnapshot = {
      state: linState0,
      viewState: structuredClone(linState0),
      redactedStateIds: [],
      worldVersion: 1,
      channel: {
        kind: 'private',
        threadId: f.actorLinId,
        audienceActorIds: [f.actorLinId],
        allowedCapabilities: ['moment.publish'],
      },
      input: {
        text: inputReceipt.text,
        sourceId: inputReceipt.id,
        origin: inputReceipt.origin,
      },
      storyAt: f.storyNow,
      sources: [
        {
          id: inputReceipt.id,
          kind: 'accepted_input',
          recordId: inputReceipt.id,
          worldVersion: 1,
          at: f.storyNow,
        },
        {
          id: 'source_init',
          kind: 'authored',
          recordId: 'source_init',
          worldVersion: 1,
          at: f.createdTime,
        },
      ],
      observations: [],
      actor: {
        name: '林白语',
        persona: '知性严谨的手作人',
        boundaries: '不替用户做决定',
        definitionRef: 'author:actor:lin',
      },
    };

    const claim = {
      id: randomUUID(),
      commandId: inputReceipt.commandId!,
      inputReceiptId: inputReceipt.id,
      worldId: f.worldId,
      actorId: f.actorLinId,
      expectedWorldVersion: 1,
      expectedActorRevision: 0,
      inputHash: inputReceipt.inputHash,
      engineEpoch: 2,
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 120000).toISOString(),
    };

    let thrownError: any = null;
    try {
      await runNpcAgent(
        {
          attempts: store,
          model: {
            async decide() {
              return JSON.stringify(proposal);
            },
          },
          kernel,
        },
        f.owner,
        claim,
        snapshot,
      );
    } catch (err: any) {
      thrownError = err;
    }

    assert.ok(thrownError, 'Should throw error on empty moment text');
    assert.match(thrownError.message, /MOMENT_PUBLISH_PARAMETERS/);
  });

  await t.test('2. success: moment.publish end-to-end execution, world.moments persistence, and goal fulfillment', async () => {
    const f = await fixture();
    const kernel = new PostgresNpcAgentKernel(app, worlds);

    const inputReceipt: AgentInputReceipt = {
      id: randomUUID(),
      worldId: f.worldId,
      channel: 'private',
      threadId: f.actorLinId,
      recipientActorId: f.actorLinId,
      commandId: randomUUID(),
      origin: 'player',
      storyAt: f.storyNow,
      expectedWorldVersion: 1,
      inputHash: createHash('sha256').update('valid-moment-publish').digest('hex'),
      text: '今天工坊有什么值得分享的作品吗？',
      receivedAt: new Date().toISOString(),
    };
    await store.accept(f.owner, inputReceipt);

    const actionId = 'action_publish_moment';
    const momentKey = 'm_glass_brooch_01';
    const momentText = '窑炉开温780度，新烧制的琉璃羽毛胸针终于退火完成，泛着淡淡的青蓝光泽。✨';
    const momentImages = ['https://assets.example.com/craft/glass_brooch.jpg'];
    const momentPlaceId = 'place_craft_studio';

    const proposal: AgentProposal = {
      goals: [],
      plans: [],
      actions: [
        {
          id: actionId,
          goalId: f.publishGoalId,
          capability: 'moment.publish',
          targetIds: [f.actorLinId],
          parameters: {
            key: momentKey,
            text: momentText,
            images: momentImages,
            placeId: momentPlaceId,
            note: '工坊最新手作成品实拍展示',
          },
          sourceIds: ['source_init', inputReceipt.id],
          preconditions: [],
          dependsOnActionIds: [],
          handlesResponsibilityIds: [f.publishRespId],
          status: 'ready',
        },
      ],
      responsibilities: [],
      decisions: [],
      statements: [
        {
          text: '刚刚把新烧的琉璃胸针拍了照片发朋友圈了，你可以看一眼~',
          dependsOnActionIds: [actionId],
        },
      ],
    };

    const linState0 = (await store.read(f.owner, { worldId: f.worldId, actorId: f.actorLinId }))!;
    const snapshot: AgentSnapshot = {
      state: linState0,
      viewState: structuredClone(linState0),
      redactedStateIds: [],
      worldVersion: 1,
      channel: {
        kind: 'private',
        threadId: f.actorLinId,
        audienceActorIds: [f.actorLinId],
        allowedCapabilities: ['moment.publish'],
      },
      input: {
        text: inputReceipt.text,
        sourceId: inputReceipt.id,
        origin: inputReceipt.origin,
      },
      storyAt: f.storyNow,
      sources: [
        {
          id: inputReceipt.id,
          kind: 'accepted_input',
          recordId: inputReceipt.id,
          worldVersion: 1,
          at: f.storyNow,
        },
        {
          id: 'source_init',
          kind: 'authored',
          recordId: 'source_init',
          worldVersion: 1,
          at: f.createdTime,
        },
      ],
      observations: [],
      actor: {
        name: '林白语',
        persona: '知性严谨的手作人',
        boundaries: '不替用户做决定',
        definitionRef: 'author:actor:lin',
      },
    };

    const claim = {
      id: randomUUID(),
      commandId: inputReceipt.commandId!,
      inputReceiptId: inputReceipt.id,
      worldId: f.worldId,
      actorId: f.actorLinId,
      expectedWorldVersion: 1,
      expectedActorRevision: 0,
      inputHash: inputReceipt.inputHash,
      engineEpoch: 2,
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 120000).toISOString(),
    };

    const runResult = await runNpcAgent(
      {
        attempts: store,
        model: {
          async decide() {
            return JSON.stringify(proposal);
          },
        },
        kernel,
      },
      f.owner,
      claim,
      snapshot,
    );

    assert.ok(runResult.eventId);

    // 1. Verify world.moments in database
    const worldAfter = await worlds.get({ userId: f.owner }, f.worldId);
    assert.ok(worldAfter.moments, 'worldAfter.moments must be defined');
    assert.equal(worldAfter.moments.length, 1);
    const savedMoment = worldAfter.moments[0];
    assert.ok(savedMoment, 'savedMoment must exist');
    assert.equal(savedMoment.key, momentKey);
    assert.equal(savedMoment.actorId, f.actorLinId);
    assert.equal(savedMoment.name, '林白语');
    assert.equal(savedMoment.text, momentText);
    assert.equal(savedMoment.placeId, momentPlaceId);
    assert.deepEqual(savedMoment.images, momentImages);
    assert.ok(savedMoment.at.startsWith('2026-10-18T10:00:00'));

    // 2. Verify actor state in database
    const linState1 = (await store.read(f.owner, { worldId: f.worldId, actorId: f.actorLinId }))!;
    const goal1 = linState1.goals.find((g) => g.id === f.publishGoalId);
    assert.equal(goal1?.status, 'fulfilled', 'Goal must be fulfilled');

    const resp1 = linState1.responsibilities.find((r) => r.id === f.publishRespId);
    assert.equal(resp1?.status, 'fulfilled', 'Responsibility must be fulfilled');

    // 3. Verify agent_action_results in database
    const actionResults = await app.transaction(f.owner, async (sql) => {
      return (
        await sql.query(
          'SELECT document FROM parallel_life.agent_action_results WHERE world_id=$1 AND actor_id=$2',
          [f.worldId, f.actorLinId],
        )
      ).rows.map((r) => r.document);
    });
    const publishResult = actionResults.find((r: any) => r.actionId === actionId);
    assert.ok(publishResult, 'Action result must be recorded');
    assert.equal(publishResult.outcome, 'succeeded');
    assert.deepEqual(publishResult.outputRefs, [{ kind: 'moment', id: momentKey }]);
    assert.deepEqual(publishResult.handledResponsibilityIds, [f.publishRespId]);
    assert.deepEqual(publishResult.completedGoalIds, [f.publishGoalId]);
  });

  await t.test('3. default key generation: moment.publish generates unique key if key is omitted', async () => {
    const f = await fixture();
    const kernel = new PostgresNpcAgentKernel(app, worlds);

    const inputReceipt: AgentInputReceipt = {
      id: randomUUID(),
      worldId: f.worldId,
      channel: 'private',
      threadId: f.actorLinId,
      recipientActorId: f.actorLinId,
      commandId: randomUUID(),
      origin: 'player',
      storyAt: f.storyNow,
      expectedWorldVersion: 1,
      inputHash: createHash('sha256').update('default-key-moment-publish').digest('hex'),
      text: '随手发一句随感吧',
      receivedAt: new Date().toISOString(),
    };
    await store.accept(f.owner, inputReceipt);

    const actionId = 'action_default_key_moment';
    const momentText = '午后的阳光穿过窗棂，落在工坊的木桌上，静谧又安心。';

    const proposal: AgentProposal = {
      goals: [],
      plans: [],
      actions: [
        {
          id: actionId,
          goalId: f.publishGoalId,
          capability: 'moment.publish',
          targetIds: [f.actorLinId],
          parameters: {
            text: momentText, // no key provided
          },
          sourceIds: ['source_init'],
          preconditions: [],
          dependsOnActionIds: [],
          handlesResponsibilityIds: [f.publishRespId],
          status: 'ready',
        },
      ],
      responsibilities: [],
      decisions: [],
      statements: [{ text: '发了一条朋友圈生活随感。', dependsOnActionIds: [] }],
    };

    const linState0 = (await store.read(f.owner, { worldId: f.worldId, actorId: f.actorLinId }))!;
    const snapshot: AgentSnapshot = {
      state: linState0,
      viewState: structuredClone(linState0),
      redactedStateIds: [],
      worldVersion: 1,
      channel: {
        kind: 'private',
        threadId: f.actorLinId,
        audienceActorIds: [f.actorLinId],
        allowedCapabilities: ['moment.publish'],
      },
      input: {
        text: inputReceipt.text,
        sourceId: inputReceipt.id,
        origin: inputReceipt.origin,
      },
      storyAt: f.storyNow,
      sources: [
        {
          id: inputReceipt.id,
          kind: 'accepted_input',
          recordId: inputReceipt.id,
          worldVersion: 1,
          at: f.storyNow,
        },
        {
          id: 'source_init',
          kind: 'authored',
          recordId: 'source_init',
          worldVersion: 1,
          at: f.createdTime,
        },
      ],
      observations: [],
      actor: {
        name: '林白语',
        persona: '知性严谨的手作人',
        boundaries: '不替用户做决定',
        definitionRef: 'author:actor:lin',
      },
    };

    const claim = {
      id: randomUUID(),
      commandId: inputReceipt.commandId!,
      inputReceiptId: inputReceipt.id,
      worldId: f.worldId,
      actorId: f.actorLinId,
      expectedWorldVersion: 1,
      expectedActorRevision: 0,
      inputHash: inputReceipt.inputHash,
      engineEpoch: 2,
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 120000).toISOString(),
    };

    const runResult = await runNpcAgent(
      {
        attempts: store,
        model: {
          async decide() {
            return JSON.stringify(proposal);
          },
        },
        kernel,
      },
      f.owner,
      claim,
      snapshot,
    );

    assert.ok(runResult.eventId);

    const worldAfter = await worlds.get({ userId: f.owner }, f.worldId);
    assert.equal(worldAfter.moments?.length, 1);
    const m = worldAfter.moments?.[0];
    assert.ok(m, 'm must exist');
    assert.ok(m.key.startsWith('m_'), 'Auto-generated moment key should start with m_');
    assert.equal(m.text, momentText);
  });

  await t.test('4. social feed projection: mergeSocialMoments aggregates dynamic and authored moments sorted descending', async () => {
    const f = await fixture();

    const authoredSocialBase = {
      profiles: [],
      moments: [
        {
          key: 'm_authored_01',
          actorId: f.actorLinId,
          name: '林白语',
          text: '工坊清晨的第一缕晨光。',
          at: '2026-10-18T08:00:00.000Z',
        },
      ],
    };

    const earlierMoment = {
      id: randomUUID(),
      key: 'm_earlier',
      actorId: f.actorQingqingId,
      name: '青青',
      text: '上午的设计草稿完成了第一版，很期待与林工汇合！',
      at: '2026-10-18T09:30:00.000Z',
      sourceEventId: randomUUID(),
    };
    const laterMoment = {
      id: randomUUID(),
      key: 'm_later',
      actorId: f.actorLinId,
      name: '林白语',
      text: '刚把工坊整理好，琉璃胸针已经全部陈列完毕。',
      at: '2026-10-18T10:15:00.000Z',
      image: 'https://assets.example.com/craft/studio_display.jpg',
      sourceEventId: randomUUID(),
    };

    const dynamicMoments = [earlierMoment, laterMoment];
    const merged = mergeSocialMoments(authoredSocialBase, dynamicMoments);
    const parsed = AuthoredSocialSchema.parse(merged);

    assert.equal(parsed.moments.length, 3, 'Feed must contain 2 dynamic moments + 1 authored moment');
    const laterIdx = parsed.moments.findIndex((m) => m.key === 'm_later');
    const earlierIdx = parsed.moments.findIndex((m) => m.key === 'm_earlier');
    const authoredIdx = parsed.moments.findIndex((m) => m.key === 'm_authored_01');

    assert.ok(laterIdx >= 0, 'm_later must exist in feed');
    assert.ok(earlierIdx >= 0, 'm_earlier must exist in feed');
    assert.ok(authoredIdx >= 0, 'm_authored_01 must exist in feed');

    assert.ok(laterIdx < earlierIdx, 'Later moment (10:15) must appear before earlier moment (09:30)');
    assert.ok(earlierIdx < authoredIdx, 'Earlier moment (09:30) must appear before authored moment (08:00)');
  });
});
