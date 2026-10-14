import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicationManuscriptPlanner } from '../src/modules/settings/infrastructure/publication-manuscript-planner.ts';
import type { ModelMessage } from '../src/modules/ai/application/ports.ts';

const start = '2037-01-12T08:00:00Z';
const sources = [
  {
    filename: '人物_舟川.md',
    content:
      '# 人物：舟川\n## 人生背景\n气象观测员。\n## 关系模型\n与主角是合作多年的队员。\n## 人格特质\n说话简洁。',
  },
];
function actor(key: string, name: string) {
  return {
    key,
    name,
    knownAtStart: true,
    lifeModules: { relationships: '与主角是合作多年的队员。', traits: '说话简洁。' },
    publicCard: { identity: '气象观测员', introduction: '作者的公开介绍', traits: [] },
    privatePersona: {
      background: '作者写的人生背景',
      motivation: 'PRIVATE_MOTIVE',
      voice: '作者写的口吻',
      boundaries: 'PRIVATE_BOUNDARY',
    },
  };
}
function history(key: string, speaker: 'actor' | 'player', actorKey = 'guide') {
  return {
    key,
    actorKey,
    origin: 'history',
    speaker,
    text: speaker === 'actor' ? '路况我先查好，再告诉你。' : '好，等你确认。',
    at: '2037-01-11T08:00:00Z',
  };
}
function post(key: string, actorKey = 'guide') {
  return { key, actorKey, text: '今天观测站天气不错。', at: '2037-01-10T08:00:00Z' };
}
function content() {
  return {
    world: { startAt: start, hiddenContext: 'PRIVATE_WORLD' },
    protagonist: { identity: '记录员', situation: 'PRIVATE_PLAYER' },
    actors: [actor('guide', '舟川'), actor('other', '另一位')],
    phone: {
      messages: [history('authored', 'actor'), history('other_message', 'actor', 'other')],
      moments: [post('authored_post'), post('other_post', 'other')],
      notes: [{ title: '作者笔记' }],
    },
    candidates: [{ title: 'PRIVATE_FUTURE' }],
  };
}
function harness(outputs: unknown[]) {
  const calls: ModelMessage[][] = [];
  const planner = new PublicationManuscriptPlanner({
    async complete(messages) {
      calls.push(messages);
      return JSON.stringify({
        updatedContent: outputs[calls.length - 1] ?? outputs.at(-1),
        summary: '模型说两个都生成了',
        notes: [{ kind: 'supplemented', text: '朋友圈和聊天全部生成' }],
      });
    },
  });
  return { planner, calls };
}
const focused = (
  currentContent: ReturnType<typeof content>,
  socialFocus: 'history' | 'moments' | 'both',
) => ({
  scope: 'characters' as const,
  socialFocus,
  socialActorKey: 'guide',
  currentContent,
  sources,
});

test('history-only proposal accepts only this actor’s new dialogue and preserves all authored fields and posts', async () => {
  const original = content();
  const h = harness([
    {
      actors: [{ ...actor('guide', '舟川'), publicCard: { identity: '模型改写', traits: [] } }],
      world: { startAt: '2050-01-01T00:00:00Z' },
      phone: {
        messages: [
          { ...history('authored', 'player'), text: '模型篡改作者消息' },
          history('new_actor', 'actor'),
          history('new_player', 'player'),
        ],
        moments: [post('new_post')],
      },
    },
  ]);
  const result = await h.planner.propose(focused(original, 'history'));
  assert.deepEqual(result.issues, []);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(result.updatedContent.actors, original.actors);
  assert.deepEqual(result.updatedContent.world, original.world);
  assert.deepEqual(result.updatedContent.candidates, original.candidates);
  assert.deepEqual(
    (result.updatedContent.phone as typeof original.phone).moments,
    original.phone.moments,
  );
  assert.deepEqual((result.updatedContent.phone as typeof original.phone).messages, [
    ...original.phone.messages,
    history('new_actor', 'actor'),
    history('new_player', 'player'),
  ]);
  const request = JSON.parse(h.calls[0]![1]!.content);
  assert.equal(request.socialFocus, 'history');
  assert.equal(request.socialActorKey, 'guide');
  assert.deepEqual(
    request.currentContent.actors.map((a: { key: string }) => a.key),
    ['guide'],
  );
  assert.equal(JSON.stringify(request).includes('PRIVATE_WORLD'), false);
  assert.equal(JSON.stringify(request).includes('PRIVATE_PLAYER'), false);
  assert.equal(JSON.stringify(request).includes('PRIVATE_FUTURE'), false);
  assert.equal(JSON.stringify(request).includes('PRIVATE_MOTIVE'), true);
  assert.match(h.calls[0]![0]!.content, /只提出 phone.messages/);
  assert.ok(!result.notes.some((n) => n.text === '朋友圈和聊天全部生成'));
});

test('moments-only proposal leaves histories and five dimensions intact; no history completeness requirement', async () => {
  const original = content();
  original.phone.messages = [];
  const h = harness([
    {
      actors: [{ ...actor('guide', '舟川'), lifeModules: { relationships: '模型改写' } }],
      phone: {
        messages: [history('forbidden_actor', 'actor'), history('forbidden_player', 'player')],
        moments: [post('new_post')],
      },
    },
  ]);
  const result = await h.planner.propose(focused(original, 'moments'));
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.updatedContent.actors, original.actors);
  assert.deepEqual((result.updatedContent.phone as typeof original.phone).messages, []);
  assert.deepEqual((result.updatedContent.phone as typeof original.phone).moments, [
    ...original.phone.moments,
    post('new_post'),
  ]);
  assert.match(h.calls[0]![0]!.content, /只提出 phone.moments/);
});

test('both permits both proposal collections while still retaining pre-existing prose and actor cards', async () => {
  const original = content();
  original.phone.moments = [post('other_post', 'other')];
  const h = harness([
    {
      actors: [{ ...actor('guide', '舟川'), name: '模型改名' }],
      phone: {
        messages: [history('new_player', 'player')],
        moments: [post('new_post')],
      },
    },
  ]);
  const result = await h.planner.propose(focused(original, 'both'));
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.updatedContent.actors, original.actors);
  assert.deepEqual((result.updatedContent.phone as typeof original.phone).messages, [
    ...original.phone.messages,
    history('new_player', 'player'),
  ]);
  assert.deepEqual((result.updatedContent.phone as typeof original.phone).moments, [
    ...original.phone.moments,
    post('new_post'),
  ]);
});

test('focused request refuses a missing, mismatched or same-name ambiguous actor before calling a model', async () => {
  for (const mutate of [
    (x: ReturnType<typeof content>) => x,
    (x: ReturnType<typeof content>) => ({ ...x, actors: [x.actors[0]!, actor('other', '舟川')] }),
  ]) {
    const current = mutate(content());
    const h = harness([{ phone: { messages: [history('new_actor', 'actor')] } }]);
    await assert.rejects(
      h.planner.propose({
        ...focused(current, 'history'),
        socialActorKey:
          current.actors.length === 2 && current.actors[1]?.name === '舟川' ? 'guide' : 'absent',
      }),
      (error: unknown) => (error as { code?: string }).code === 'INVALID_INPUT',
    );
    assert.equal(h.calls.length, 0);
  }
  const h = harness([{ phone: { moments: [post('new_post')] } }]);
  await assert.rejects(
    h.planner.propose({
      ...focused(content(), 'moments'),
      sources: [{ filename: '另一人.md', content: '# 人物：另一人' }],
    }),
    (error: unknown) => (error as { code?: string }).code === 'INVALID_INPUT',
  );
  assert.equal(h.calls.length, 0);
});

test('one focused correction keeps the selected scope and never adopts an unselected post', async () => {
  const original = content();
  original.phone.messages = [history('authored', 'actor')];
  const h = harness([
    {
      phone: {
        messages: [{ ...history('new_player', 'player'), at: '2038-01-01T08:00:00Z' }],
        moments: [post('rogue_post')],
      },
    },
    {
      phone: {
        messages: [history('new_player', 'player')],
        moments: [post('rogue_post')],
      },
    },
  ]);
  const result = await h.planner.propose(focused(original, 'history'));
  assert.equal(h.calls.length, 2);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(
    (result.updatedContent.phone as typeof original.phone).moments,
    original.phone.moments,
  );
  assert.deepEqual((result.updatedContent.phone as typeof original.phone).messages, [
    history('authored', 'actor'),
    history('new_player', 'player'),
  ]);
  const correction = JSON.parse(h.calls[1]![1]!.content);
  assert.equal(correction.socialFocus, 'history');
  assert.equal(correction.socialActorKey, 'guide');
  assert.deepEqual(
    correction.originalCurrentContent.actors.map((a: { key: string }) => a.key),
    ['guide'],
  );
  assert.ok(
    !correction.firstProposal.phone.moments.some((p: { key: string }) => p.key === 'rogue_post'),
  );
  assert.ok(
    correction.validationIssues.some(
      (issue: { code: string }) => issue.code === 'character_preview_not_history',
    ),
  );
});

test('a focused proposal cannot append social content to another known actor', async () => {
  const original = content();
  const h = harness([
    {
      phone: {
        moments: [post('injected', 'other')],
      },
    },
  ]);
  const result = await h.planner.propose(focused(original, 'moments'));
  assert.deepEqual(result.updatedContent, original);
  assert.ok(result.issues.some((issue) => issue.code === 'character_preview_subject_unconfirmed'));
  assert.equal(h.calls.length, 2, 'only the existing bounded correction may retry');
});
