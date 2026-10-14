import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicationManuscriptPlanner } from '../src/modules/settings/infrastructure/publication-manuscript-planner.ts';
import { protectCharacterTrialProposal } from '../src/modules/settings/domain/publication-character-trial-policy.ts';
import { PublishedWorldContentSchema } from '../src/contracts/published-world-content.ts';
import { compilePublicationGenesis } from '../src/modules/settings/infrastructure/publication-genesis.ts';
import type { ModelMessage } from '../src/modules/ai/application/ports.ts';
const referenceAt = '2031-03-06T08:00:00Z';
function person() {
  return {
    key: 'solo',
    name: '林夏',
    knownAtStart: true,
    lifeModules: {
      lifeContext: '负责小店的花艺工作。',
      traits: '细心，偶尔开轻松玩笑。',
      drives: '做好喜欢的手艺。',
      behavior: '答复简短，先确认细节。',
      relationships: '与主角是认识多年的同事。',
    },
    publicCard: { traits: [], introduction: '林夏是你认识多年的花艺师朋友。' },
    privatePersona: { background: '', motivation: '', voice: '', boundaries: '' },
  };
}
function baseline() {
  return { work: { title: '人物演示' }, actors: [person()], media: [], extensions: [] };
}
const sources = [
  {
    filename: '人物_林夏.md',
    content:
      '# 人物：林夏\n## 关系模型\n与主角是认识多年的同事。\n公开介绍：林夏是你认识多年的花艺师朋友。',
  },
];
function completeDraft() {
  return {
    schemaVersion: 1,
    work: {
      key: 'role_demo',
      title: '人物演示',
      hook: '日常消息',
      description: '一个普通工作日的私有角色演示。',
      experienceNote: '私有角色演示，未发布。',
    },
    world: {
      publicSetting: '普通花艺工作室',
      tone: '日常',
      startAt: '',
      startPlaceKey: 'studio',
      hiddenContext: '没有预定结果，尊重人物和用户选择。',
    },
    protagonist: {
      identity: '工作室同事',
      situation: '正在整理今天的工作材料。',
      knownFactKeys: [],
    },
    actors: [
      {
        ...person(),
        privatePersona: {
          background: '花艺师，和主角认识多年。',
          motivation: '做好手艺。',
          voice: '简短，先确认细节。',
          boundaries: '尊重主角选择。',
        },
      },
    ],
    places: [
      { key: 'studio', name: '工作室', description: '普通的工作空间。', knownAtStart: true },
    ],
    routes: [],
    relationships: [],
    history: [],
    initialKnowledge: [],
    phone: {
      messages: [
        {
          key: 'past_a',
          actorKey: 'solo',
          origin: 'history',
          speaker: 'actor',
          text: '你上次说的花瓶我收好了。',
          at: '2031-03-05T08:00:00Z',
        },
        {
          key: 'past_p',
          actorKey: 'solo',
          origin: 'history',
          speaker: 'player',
          text: '好，谢谢。',
          at: '2031-03-05T08:01:00Z',
        },
      ],
      moments: [
        {
          key: 'daily',
          actorKey: 'solo',
          text: '把花器整理好了，架子终于清爽了。',
          at: '2031-03-05T07:00:00Z',
        },
      ],
      notes: [],
      invitations: [],
      album: [],
    },
    media: [],
    candidates: [],
    extensions: [],
  };
}
function harness(replies: Record<string, unknown>[], trusted = true) {
  const calls: ModelMessage[][] = [];
  return {
    calls,
    planner: new PublicationManuscriptPlanner(
      {
        async complete(messages) {
          calls.push(messages);
          const draft = replies[calls.length - 1] ?? replies.at(-1)!;
          return JSON.stringify({
            updatedContent: draft,
            summary: '待核对的私有演示稿',
            notes: [{ kind: 'supplemented', text: '补充普通日常演示环境。' }],
          });
        },
      },
      trusted ? { characterTrial: true } : undefined,
    ),
  };
}
test('trusted character trial completes an empty world for one authored person through the actual planner and compiler without altering author modules or introduction', async () => {
  const before = baseline(),
    snapshot = structuredClone(before),
    h = harness([completeDraft()]);
  const result = await h.planner.propose(
    { scope: 'world', currentContent: before, sources },
    undefined,
    { referenceAt },
  );
  assert.equal(h.calls.length, 1);
  assert.deepEqual(result.issues, []);
  const content = PublishedWorldContentSchema.parse(result.updatedContent);
  assert.equal(content.actors.length, 1);
  assert.equal(content.world.startAt, new Date(referenceAt).toISOString());
  assert.deepEqual(content.actors[0]!.lifeModules, before.actors[0]!.lifeModules);
  assert.deepEqual(content.actors[0]!.publicCard, before.actors[0]!.publicCard);
  assert.deepEqual(before, snapshot);
  assert.deepEqual(content.candidates, []);
  assert.ok(result.notes.some((n) => n.text.includes('私有未发布草稿')));
  assert.ok(h.calls[0]![0]!.content.includes('允许仅一个角色'));
  let seq = 10;
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const compiled = compilePublicationGenesis({
    content,
    originKind: 'trial',
    origin: { workId: id(4), publicationVersion: 0, draftVersion: 0, contentHash: '0'.repeat(64) },
    worldId: id(1),
    ownerId: id(2),
    seedId: id(3),
    newId: () => id(seq++),
  });
  assert.equal(compiled.status, 'compiled');
});
test('new cast and plot cannot pass as a character demo and receive only the existing one corrective call', async () => {
  const wrong = completeDraft();
  wrong.actors.push({ ...wrong.actors[0]!, key: 'fake_second', name: '凭空的第二人' });
  const proposal = {
    ...wrong,
    candidates: [
      {
        key: 'new_event',
        kind: 'candidate',
        title: '凭空新事件',
        editorialIntent: '不能新增',
        actorKeys: ['solo'],
        prerequisites: [],
        mutuallyExclusiveNodeKeys: [],
        intent: { kind: 'director_event', actorKey: 'solo' },
      },
    ],
  };
  const h = harness([proposal, completeDraft()]);
  const result = await h.planner.propose(
    { scope: 'world', currentContent: baseline(), sources },
    undefined,
    { referenceAt },
  );
  assert.equal(h.calls.length, 2);
  assert.deepEqual(result.issues, []);
  const correction = JSON.parse(h.calls[1]![1]!.content);
  assert.ok(
    correction.validationIssues.some(
      (i: { code: string }) => i.code === 'character_trial_actor_set_changed',
    ),
  );
  assert.ok(
    correction.validationIssues.some(
      (i: { code: string }) => i.code === 'character_trial_event_set_changed',
    ),
  );
  assert.equal((result.updatedContent.actors as unknown[]).length, 1);
  assert.deepEqual(result.updatedContent.candidates, []);
  const refused = harness([proposal]);
  const invalid = await refused.planner.propose(
    { scope: 'world', currentContent: baseline(), sources },
    undefined,
    { referenceAt },
  );
  assert.equal(refused.calls.length, 2);
  assert.ok(invalid.issues.some((i) => i.code === 'character_trial_actor_set_changed'));
});
test('author cast, modules, public introduction, avatar and existing events survive deletion or rewrite proposals', () => {
  const old = baseline();
  const actor = {
    ...person(),
    publicCard: { ...person().publicCard, avatarMediaKey: 'authored_avatar' },
  };
  const event = {
    key: 'authored',
    title: '作者事件',
    editorialIntent: '保持作者原文。',
    intent: { kind: 'editorial_only' },
  };
  const before = { ...old, actors: [actor], candidates: [event] };
  const edited = {
    ...actor,
    name: '另一个名字',
    lifeModules: { traits: '模型重写' },
    publicCard: { traits: [], introduction: '秘密伪装的介绍', avatarMediaKey: 'new_picture' },
  };
  const rejected = protectCharacterTrialProposal(before, { actors: [edited], candidates: [] });
  assert.ok(rejected.issues.some((i) => i.code === 'character_trial_actor_set_changed'));
  assert.ok(rejected.issues.some((i) => i.code === 'character_trial_event_set_changed'));
  assert.deepEqual(rejected.proposal.actors, before.actors);
  assert.deepEqual(rejected.proposal.candidates, before.candidates);
  const deletion = protectCharacterTrialProposal(before, { actors: [] });
  assert.ok(deletion.issues.some((i) => i.code === 'character_trial_actor_set_changed'));
  assert.deepEqual(deletion.proposal.actors, before.actors);
});
test('missing relationship does not authorize manufactured prehistory or major invitations', () => {
  const actor = { ...person(), lifeModules: { lifeContext: '花艺师。' } };
  const before = {
    actors: [actor],
    phone: {
      messages: [{ key: 'old', actorKey: 'solo', origin: 'history', text: '作者旧记录' }],
      notes: [],
      invitations: [],
    },
  };
  const trial = protectCharacterTrialProposal(before, {
    phone: {
      messages: [{ key: 'new', actorKey: 'solo', origin: 'history', text: '模型编的旧承诺' }],
      invitations: [{ title: '模型新的约会' }],
    },
  });
  assert.ok(trial.issues.some((i) => i.code === 'character_trial_relationship_required'));
  assert.ok(trial.issues.some((i) => i.code === 'character_trial_event_set_changed'));
  assert.deepEqual((trial.proposal.phone as { messages: unknown[] }).messages, []);
});
test('an input flag never enables trusted character-trial policy, and a conflicting characters-only scope is rejected before a model call', async () => {
  const h = harness([completeDraft()], false);
  await h.planner.propose(
    { scope: 'world', currentContent: { ...baseline(), characterTrial: true }, sources },
    undefined,
    { referenceAt },
  );
  assert.ok(!h.calls[0]![0]!.content.includes('受信服务端已选择私有角色演示准备'));
  const trusted = harness([completeDraft()]);
  await assert.rejects(
    trusted.planner.propose({ scope: 'characters', currentContent: baseline(), sources }),
    { code: 'INVALID_INPUT' },
  );
  assert.equal(trusted.calls.length, 0);
});
