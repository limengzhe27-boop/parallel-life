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

test('actor capability chain: moment.interact end-to-end execution, parameter guards, duplicate like prevention, dynamic social feed projection with likes/comments', async (t) => {
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
    const likeGoalId = 'goal_like_post';
    const likeRespId = 'resp_like_post';
    const commentGoalId = 'goal_comment_post';
    const commentRespId = 'resp_comment_post';
    const event1Id = randomUUID();
    const existingMomentKey = 'moment_opening_aranya';

    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [owner]);

    const initialWorldState: any = {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 1,
      title: '朋友圈点赞与评论闭环测试世界',
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
      moments: [
        {
          id: randomUUID(),
          key: existingMomentKey,
          actorId: actorLinId,
          name: '林白语',
          text: '阿那亚秋日的海风与木工刨花，让每一天都变得专注。',
          at: '2026-10-18T09:30:00.000Z',
          images: ['https://example.com/aranya.jpg'],
          sourceEventId: event1Id,
        },
      ],
      momentInteractions: [],
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
      goals: [],
      plans: [],
      actions: [],
      responsibilities: [],
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
      goals: [
        {
          id: likeGoalId,
          summary: '给林白语的阿那亚木工动态点赞',
          status: 'active',
          sourceIds: ['source_init'],
          resultIds: [],
        },
        {
          id: commentGoalId,
          summary: '回复林白语的朋友圈动态并送上鼓励',
          status: 'active',
          sourceIds: ['source_init'],
          resultIds: [],
        },
      ],
      plans: [],
      actions: [],
      responsibilities: [
        {
          id: likeRespId,
          revision: 0,
          status: 'open',
          waitingOn: null,
          summary: '点赞白语的动态',
          sourceIds: ['source_init'],
          subject: { kind: 'matter', id: 'matter_post' },
          nextCheck: [],
        },
        {
          id: commentRespId,
          revision: 0,
          status: 'open',
          waitingOn: null,
          summary: '留言互动白语的动态',
          sourceIds: ['source_init'],
          subject: { kind: 'matter', id: 'matter_post' },
          nextCheck: [],
        },
      ],
      decisions: [],
      focus: null,
    };

    await app.transaction(owner, async (sql) => {
      await sql.query(
        'INSERT INTO parallel_life.worlds(id,owner_id,title,version,asset_revision,state) VALUES($1,$2,$3,1,0,$4)',
        [worldId, owner, '朋友圈点赞与评论闭环测试世界', JSON.stringify(initialWorldState)],
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
      existingMomentKey,
      likeGoalId,
      likeRespId,
      commentGoalId,
      commentRespId,
      storyNow,
      createdTime,
    };
  }

  await t.test('1. Rejects invalid parameters and non-existent moment', async () => {
    const f = await fixture();
    const kernel = new PostgresNpcAgentKernel(app, worlds);

    const inputReceipt: AgentInputReceipt = {
      id: randomUUID(),
      worldId: f.worldId,
      channel: 'private',
      threadId: f.actorQingqingId,
      recipientActorId: f.actorQingqingId,
      commandId: randomUUID(),
      origin: 'player',
      storyAt: f.storyNow,
      expectedWorldVersion: 1,
      inputHash: createHash('sha256').update('check-interact').digest('hex'),
      text: '看看朋友圈动态',
      receivedAt: new Date().toISOString(),
    };
    await store.accept(f.owner, inputReceipt);

    // 1.1 Invalid kind
    const badKindProposal: AgentProposal = {
      goals: [],
      plans: [],
      actions: [
        {
          id: 'action_bad_kind',
          goalId: f.likeGoalId,
          capability: 'moment.interact',
          targetIds: [f.actorLinId],
          parameters: {
            momentKey: f.existingMomentKey,
            kind: 'share', // invalid
          },
          sourceIds: ['source_init', inputReceipt.id],
          preconditions: [],
          dependsOnActionIds: [],
          handlesResponsibilityIds: [f.likeRespId],
          status: 'ready',
        },
      ],
      responsibilities: [],
      decisions: [],
      statements: [{ text: '点个赞', dependsOnActionIds: ['action_bad_kind'] }],
    };

    const qingqingState0 = (await store.read(f.owner, { worldId: f.worldId, actorId: f.actorQingqingId }))!;
    const snapshot: AgentSnapshot = {
      state: qingqingState0,
      viewState: structuredClone(qingqingState0),
      redactedStateIds: [],
      worldVersion: 1,
      channel: {
        kind: 'private',
        threadId: f.actorLinId,
        audienceActorIds: [f.actorLinId],
        allowedCapabilities: ['moment.interact'],
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
        name: '青青',
        persona: '多年闺蜜与设计搭档',
        boundaries: '不替用户做决定',
        definitionRef: 'author:actor:qingqing',
      },
    };

    const claim1 = {
      id: randomUUID(),
      commandId: inputReceipt.commandId!,
      inputReceiptId: inputReceipt.id,
      worldId: f.worldId,
      actorId: f.actorQingqingId,
      expectedWorldVersion: 1,
      expectedActorRevision: 0,
      inputHash: inputReceipt.inputHash,
      engineEpoch: 2,
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 120000).toISOString(),
    };

    let error1: any = null;
    try {
      await runNpcAgent(
        {
          attempts: store,
          model: {
            async decide() {
              return JSON.stringify(badKindProposal);
            },
          },
          kernel,
        },
        f.owner,
        claim1,
        snapshot,
      );
    } catch (err: any) {
      error1 = err;
    }
    assert.ok(error1);
    assert.match(error1.message, /MOMENT_INTERACTION_PARAMETERS/);

    // 1.2 Non-existent momentKey
    const inputReceipt2: AgentInputReceipt = {
      id: randomUUID(),
      worldId: f.worldId,
      channel: 'private',
      threadId: f.actorQingqingId,
      recipientActorId: f.actorQingqingId,
      commandId: randomUUID(),
      origin: 'player',
      storyAt: f.storyNow,
      expectedWorldVersion: 1,
      inputHash: createHash('sha256').update('check-interact-2').digest('hex'),
      text: '看看不存在的动态',
      receivedAt: new Date().toISOString(),
    };
    await store.accept(f.owner, inputReceipt2);

    const nonExistentProposal: AgentProposal = {
      goals: [],
      plans: [],
      actions: [
        {
          id: 'action_nonexistent',
          goalId: f.likeGoalId,
          capability: 'moment.interact',
          targetIds: [f.actorLinId],
          parameters: {
            momentKey: 'non_existent_key_xyz',
            kind: 'like',
          },
          sourceIds: ['source_init', inputReceipt2.id],
          preconditions: [],
          dependsOnActionIds: [],
          handlesResponsibilityIds: [f.likeRespId],
          status: 'ready',
        },
      ],
      responsibilities: [],
      decisions: [],
      statements: [{ text: '点赞不存在的动态', dependsOnActionIds: ['action_nonexistent'] }],
    };

    const claim2 = {
      id: randomUUID(),
      commandId: inputReceipt2.commandId!,
      inputReceiptId: inputReceipt2.id,
      worldId: f.worldId,
      actorId: f.actorQingqingId,
      expectedWorldVersion: 1,
      expectedActorRevision: 0,
      inputHash: inputReceipt2.inputHash,
      engineEpoch: 2,
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 120000).toISOString(),
    };

    const snapshot2: AgentSnapshot = {
      ...snapshot,
      input: {
        text: inputReceipt2.text,
        sourceId: inputReceipt2.id,
        origin: inputReceipt2.origin,
      },
      sources: [
        {
          id: inputReceipt2.id,
          kind: 'accepted_input',
          recordId: inputReceipt2.id,
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
    };

    let error2: any = null;
    try {
      await runNpcAgent(
        {
          attempts: store,
          model: {
            async decide() {
              return JSON.stringify(nonExistentProposal);
            },
          },
          kernel,
        },
        f.owner,
        claim2,
        snapshot2,
      );
    } catch (err: any) {
      error2 = err;
    }
    assert.ok(error2);
    assert.match(error2.message, /MOMENT_NOT_FOUND/);

    // 1.3 Empty comment for kind: comment
    const inputReceipt3: AgentInputReceipt = {
      id: randomUUID(),
      worldId: f.worldId,
      channel: 'private',
      threadId: f.actorQingqingId,
      recipientActorId: f.actorQingqingId,
      commandId: randomUUID(),
      origin: 'player',
      storyAt: f.storyNow,
      expectedWorldVersion: 1,
      inputHash: createHash('sha256').update('check-interact-3').digest('hex'),
      text: '留个空白言',
      receivedAt: new Date().toISOString(),
    };
    await store.accept(f.owner, inputReceipt3);

    const emptyCommentProposal: AgentProposal = {
      goals: [],
      plans: [],
      actions: [
        {
          id: 'action_empty_comment',
          goalId: f.commentGoalId,
          capability: 'moment.interact',
          targetIds: [f.actorLinId],
          parameters: {
            momentKey: f.existingMomentKey,
            kind: 'comment',
            comment: '   ',
          },
          sourceIds: ['source_init', inputReceipt3.id],
          preconditions: [],
          dependsOnActionIds: [],
          handlesResponsibilityIds: [f.commentRespId],
          status: 'ready',
        },
      ],
      responsibilities: [],
      decisions: [],
      statements: [{ text: '留言评论', dependsOnActionIds: ['action_empty_comment'] }],
    };

    const claim3 = {
      id: randomUUID(),
      commandId: inputReceipt3.commandId!,
      inputReceiptId: inputReceipt3.id,
      worldId: f.worldId,
      actorId: f.actorQingqingId,
      expectedWorldVersion: 1,
      expectedActorRevision: 0,
      inputHash: inputReceipt3.inputHash,
      engineEpoch: 2,
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 120000).toISOString(),
    };

    const snapshot3: AgentSnapshot = {
      ...snapshot,
      input: {
        text: inputReceipt3.text,
        sourceId: inputReceipt3.id,
        origin: inputReceipt3.origin,
      },
      sources: [
        {
          id: inputReceipt3.id,
          kind: 'accepted_input',
          recordId: inputReceipt3.id,
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
    };

    let error3: any = null;
    try {
      await runNpcAgent(
        {
          attempts: store,
          model: {
            async decide() {
              return JSON.stringify(emptyCommentProposal);
            },
          },
          kernel,
        },
        f.owner,
        claim3,
        snapshot3,
      );
    } catch (err: any) {
      error3 = err;
    }
    assert.ok(error3);
    assert.match(error3.message, /COMMENT_EMPTY/);
  });

  await t.test('2. Successfully likes a moment, persists to state, fulfills goal & responsibility, rejects duplicate like', async () => {
    const f = await fixture();
    const kernel = new PostgresNpcAgentKernel(app, worlds);

    const inputReceipt: AgentInputReceipt = {
      id: randomUUID(),
      worldId: f.worldId,
      channel: 'private',
      threadId: f.actorQingqingId,
      recipientActorId: f.actorQingqingId,
      commandId: randomUUID(),
      origin: 'player',
      storyAt: f.storyNow,
      expectedWorldVersion: 1,
      inputHash: createHash('sha256').update('valid-like').digest('hex'),
      text: '白语的木工动态发出来了',
      receivedAt: new Date().toISOString(),
    };
    await store.accept(f.owner, inputReceipt);

    const actionId = 'action_valid_like';
    const likeProposal: AgentProposal = {
      goals: [],
      plans: [],
      actions: [
        {
          id: actionId,
          goalId: f.likeGoalId,
          capability: 'moment.interact',
          targetIds: [f.actorLinId],
          parameters: {
            momentKey: f.existingMomentKey,
            kind: 'like',
            note: '支持白语的好作品',
          },
          sourceIds: ['source_init', inputReceipt.id],
          preconditions: [],
          dependsOnActionIds: [],
          handlesResponsibilityIds: [f.likeRespId],
          status: 'ready',
        },
      ],
      responsibilities: [],
      decisions: [],
      statements: [{ text: '给你点了个大大的赞！', dependsOnActionIds: [actionId] }],
    };

    const qingqingState0 = (await store.read(f.owner, { worldId: f.worldId, actorId: f.actorQingqingId }))!;
    const snapshot: AgentSnapshot = {
      state: qingqingState0,
      viewState: structuredClone(qingqingState0),
      redactedStateIds: [],
      worldVersion: 1,
      channel: {
        kind: 'private',
        threadId: f.actorLinId,
        audienceActorIds: [f.actorLinId],
        allowedCapabilities: ['moment.interact'],
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
        name: '青青',
        persona: '多年闺蜜与设计搭档',
        boundaries: '不替用户做决定',
        definitionRef: 'author:actor:qingqing',
      },
    };

    const claim = {
      id: randomUUID(),
      commandId: inputReceipt.commandId!,
      inputReceiptId: inputReceipt.id,
      worldId: f.worldId,
      actorId: f.actorQingqingId,
      expectedWorldVersion: 1,
      expectedActorRevision: 0,
      inputHash: inputReceipt.inputHash,
      engineEpoch: 2,
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 120000).toISOString(),
    };

    await runNpcAgent(
      {
        attempts: store,
        model: {
          async decide() {
            return JSON.stringify(likeProposal);
          },
        },
        kernel,
      },
      f.owner,
      claim,
      snapshot,
    );

    // Verify world persistence
    const world1 = await worlds.get({ userId: f.owner }, f.worldId);
    assert.equal(world1.version, 2);
    assert.equal(world1.momentInteractions?.length, 1);
    const interaction = world1.momentInteractions![0]!;
    assert.equal(interaction.momentKey, f.existingMomentKey);
    assert.equal(interaction.actorId, f.actorQingqingId);
    assert.equal(interaction.kind, 'like');
    assert.equal(interaction.note, '支持白语的好作品');

    // Verify actor state convergence
    const actorState1 = (await store.read(f.owner, { worldId: f.worldId, actorId: f.actorQingqingId }))!;
    assert.equal(actorState1.revision, 1);
    const goal = actorState1.goals.find((g) => g.id === f.likeGoalId);
    assert.equal(goal?.status, 'fulfilled');
    const resp = actorState1.responsibilities.find((r) => r.id === f.likeRespId);
    assert.equal(resp?.status, 'fulfilled');

    // Duplicate like attempt must be rejected
    const inputReceipt2: AgentInputReceipt = {
      id: randomUUID(),
      worldId: f.worldId,
      channel: 'private',
      threadId: f.actorQingqingId,
      recipientActorId: f.actorQingqingId,
      commandId: randomUUID(),
      origin: 'player',
      storyAt: f.storyNow,
      expectedWorldVersion: 2,
      inputHash: createHash('sha256').update('duplicate-like').digest('hex'),
      text: '再点一次赞',
      receivedAt: new Date().toISOString(),
    };
    await store.accept(f.owner, inputReceipt2);

    const claim2 = {
      id: randomUUID(),
      commandId: inputReceipt2.commandId!,
      inputReceiptId: inputReceipt2.id,
      worldId: f.worldId,
      actorId: f.actorQingqingId,
      expectedWorldVersion: 2,
      expectedActorRevision: 1,
      inputHash: inputReceipt2.inputHash,
      engineEpoch: 2,
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 120000).toISOString(),
    };

    const snapshot2: AgentSnapshot = {
      ...snapshot,
      state: actorState1,
      viewState: structuredClone(actorState1),
      worldVersion: 2,
      input: {
        text: inputReceipt2.text,
        sourceId: inputReceipt2.id,
        origin: inputReceipt2.origin,
      },
      sources: [
        {
          id: inputReceipt2.id,
          kind: 'accepted_input',
          recordId: inputReceipt2.id,
          worldVersion: 2,
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
    };

    const duplicateLikeProposal: AgentProposal = {
      goals: [],
      plans: [],
      actions: [
        {
          id: 'action_duplicate_like',
          goalId: f.commentGoalId,
          capability: 'moment.interact',
          targetIds: [f.actorLinId],
          parameters: {
            momentKey: f.existingMomentKey,
            kind: 'like',
            note: '再次点赞尝试',
          },
          sourceIds: ['source_init', inputReceipt2.id],
          preconditions: [],
          dependsOnActionIds: [],
          handlesResponsibilityIds: [],
          status: 'ready',
        },
      ],
      responsibilities: [],
      decisions: [],
      statements: [{ text: '再点一次赞', dependsOnActionIds: ['action_duplicate_like'] }],
    };

    let duplicateError: any = null;
    try {
      await runNpcAgent(
        {
          attempts: store,
          model: {
            async decide() {
              return JSON.stringify(duplicateLikeProposal);
            },
          },
          kernel,
        },
        f.owner,
        claim2,
        snapshot2,
      );
    } catch (err: any) {
      duplicateError = err;
    }
    assert.ok(duplicateError);
    assert.match(duplicateError.message, /MOMENT_ALREADY_LIKED/);
  });

  await t.test('3. Successfully comments on a moment, persists comment text, fulfills goal & responsibility', async () => {
    const f = await fixture();
    const kernel = new PostgresNpcAgentKernel(app, worlds);

    const inputReceipt: AgentInputReceipt = {
      id: randomUUID(),
      worldId: f.worldId,
      channel: 'private',
      threadId: f.actorQingqingId,
      recipientActorId: f.actorQingqingId,
      commandId: randomUUID(),
      origin: 'player',
      storyAt: f.storyNow,
      expectedWorldVersion: 1,
      inputHash: createHash('sha256').update('valid-comment').digest('hex'),
      text: '给白语留个言吧',
      receivedAt: new Date().toISOString(),
    };
    await store.accept(f.owner, inputReceipt);

    const actionId = 'action_valid_comment';
    const commentProposal: AgentProposal = {
      goals: [],
      plans: [],
      actions: [
        {
          id: actionId,
          goalId: f.commentGoalId,
          capability: 'moment.interact',
          targetIds: [f.actorLinId],
          parameters: {
            momentKey: f.existingMomentKey,
            kind: 'comment',
            comment: '手工作品太精致了，下周一定去你店里看看！',
            note: '闺蜜留言支持',
          },
          sourceIds: ['source_init', inputReceipt.id],
          preconditions: [],
          dependsOnActionIds: [],
          handlesResponsibilityIds: [f.commentRespId],
          status: 'ready',
        },
      ],
      responsibilities: [],
      decisions: [],
      statements: [{ text: '在你的动态下留言了，记得回复我呀~', dependsOnActionIds: [actionId] }],
    };

    const qingqingState0 = (await store.read(f.owner, { worldId: f.worldId, actorId: f.actorQingqingId }))!;
    const snapshot: AgentSnapshot = {
      state: qingqingState0,
      viewState: structuredClone(qingqingState0),
      redactedStateIds: [],
      worldVersion: 1,
      channel: {
        kind: 'private',
        threadId: f.actorLinId,
        audienceActorIds: [f.actorLinId],
        allowedCapabilities: ['moment.interact'],
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
        name: '青青',
        persona: '多年闺蜜与设计搭档',
        boundaries: '不替用户做决定',
        definitionRef: 'author:actor:qingqing',
      },
    };

    const claim = {
      id: randomUUID(),
      commandId: inputReceipt.commandId!,
      inputReceiptId: inputReceipt.id,
      worldId: f.worldId,
      actorId: f.actorQingqingId,
      expectedWorldVersion: 1,
      expectedActorRevision: 0,
      inputHash: inputReceipt.inputHash,
      engineEpoch: 2,
      token: randomUUID(),
      leaseUntil: new Date(Date.now() + 120000).toISOString(),
    };

    await runNpcAgent(
      {
        attempts: store,
        model: {
          async decide() {
            return JSON.stringify(commentProposal);
          },
        },
        kernel,
      },
      f.owner,
      claim,
      snapshot,
    );

    // Verify world persistence
    const world1 = await worlds.get({ userId: f.owner }, f.worldId);
    assert.equal(world1.version, 2);
    assert.equal(world1.momentInteractions?.length, 1);
    const interaction = world1.momentInteractions![0]!;
    assert.equal(interaction.momentKey, f.existingMomentKey);
    assert.equal(interaction.actorId, f.actorQingqingId);
    assert.equal(interaction.kind, 'comment');
    assert.equal(interaction.comment, '手工作品太精致了，下周一定去你店里看看！');
    assert.equal(interaction.note, '闺蜜留言支持');

    // Verify actor state convergence
    const actorState1 = (await store.read(f.owner, { worldId: f.worldId, actorId: f.actorQingqingId }))!;
    assert.equal(actorState1.revision, 1);
    const goal = actorState1.goals.find((g) => g.id === f.commentGoalId);
    assert.equal(goal?.status, 'fulfilled');
    const resp = actorState1.responsibilities.find((r) => r.id === f.commentRespId);
    assert.equal(resp?.status, 'fulfilled');
  });

  await t.test('4. Dynamic social feed projection cleanly integrates likes and comments', async () => {
    const f = await fixture();

    const authoredSocial = AuthoredSocialSchema.parse({
      moments: [
        {
          key: 'moment_opening_authored',
          actorId: f.actorLinId,
          name: '林白语',
          text: '旧动态：开店筹备中。',
          at: '2026-10-17T08:00:00.000Z',
        },
      ],
    });

    const worldMoments = [
      {
        key: f.existingMomentKey,
        actorId: f.actorLinId,
        name: '林白语',
        text: '阿那亚秋日的海风与木工刨花，让每一天都变得专注。',
        at: '2026-10-18T09:30:00.000Z',
        images: ['https://example.com/aranya.jpg'],
      },
    ];

    const interactions = [
      {
        id: randomUUID(),
        momentKey: f.existingMomentKey,
        actorId: f.actorQingqingId,
        kind: 'like' as const,
        at: '2026-10-18T09:35:00.000Z',
      },
      {
        id: randomUUID(),
        momentKey: f.existingMomentKey,
        actorId: f.actorQingqingId,
        kind: 'comment' as const,
        comment: '太棒了，加油白语！',
        at: '2026-10-18T09:36:00.000Z',
      },
    ];

    const actors = [
      { id: f.actorLinId, name: '林白语' },
      { id: f.actorQingqingId, name: '青青' },
    ];

    const merged = mergeSocialMoments(authoredSocial, worldMoments, interactions, actors);

    assert.equal(merged.moments.length, 2);
    // Dynamic moment is newest (09:30 vs 10-17)
    const targetMoment = merged.moments[0]!;
    assert.equal(targetMoment.key, f.existingMomentKey);
    assert.equal(targetMoment.likes?.length, 1);
    const like = targetMoment.likes![0]!;
    assert.equal(like.actorId, f.actorQingqingId);
    assert.equal(like.name, '青青');

    assert.equal(targetMoment.comments?.length, 1);
    const comment = targetMoment.comments![0]!;
    assert.equal(comment.actorId, f.actorQingqingId);
    assert.equal(comment.name, '青青');
    assert.equal(comment.text, '太棒了，加油白语！');
  });
});
