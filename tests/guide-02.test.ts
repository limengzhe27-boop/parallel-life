import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Profile, Interview } from '../src/contracts/api.ts';
import {
  InterviewPlanner,
  guideState,
  PersonProposalSchema,
} from '../src/modules/profile/infrastructure/interview-planner.ts';
import {
  explicitPhotoPeople,
  explicitPhotoReference,
  groundPersonProposal,
  resolvePhotoReference,
  isStoryPersonContext,
} from '../src/modules/profile/application/person-extraction.ts';
const now = new Date().toISOString();
const profile: Profile = {
  id: randomUUID(),
  version: 0,
  facts: [],
  events: [],
  people: [],
  portraitAssetId: null,
  referenceAssetIds: [],
  updatedAt: now,
};
const message = (text: string, photoAssetId: string | null = null) => ({
  id: randomUUID(),
  role: 'user' as const,
  text,
  photoAssetId,
  createdAt: now,
  taskId: null,
});

test('GUIDE-02 six-turn prompt simulation carries user identity, wish and prior questions without inventing a generated branch', async () => {
  const history: Interview['messages'] = [];
  let calls = 0;
  const planner = new InterviewPlanner({
    async complete(input) {
      calls++;
      const prompt = input[0]!.content;
      const context = JSON.parse(input[1]!.content);
      assert.match(prompt, /眼下可做的一件事/);
      assert.match(prompt, /没目标/);
      assert.match(prompt, /不重复问/);
      assert.match(prompt, /真实确认入口/);
      assert.match(prompt, /未成年性内容/);
      assert.match(prompt, /现实伤人、勒索/);
      assert.equal(context.guideState.mode, calls === 6 ? 'listen' : 'propose_opening');
      assert(context.guideState.userEvidence.includes('我想体验古惑仔的身份'));
      if (calls >= 3) assert(context.guideState.userEvidence.includes('人物有小芳和王大毛'));
      if (calls >= 4) assert(context.guideState.priorQuestions.length > 0);
      return JSON.stringify({
        reply: '可以先设想今晚的街边茶餐厅，先回一条小芳的消息；这是可修改的开场，创建时再确认。',
        people: [],
        facts: [],
        events: [],
      });
    },
  });
  for (const text of [
    '我想体验古惑仔的身份',
    '我想要自由',
    '人物有小芳和王大毛',
    '没有目标，你来安排',
    '想先看看开场',
    '先不创建',
  ]) {
    history.push(message(text));
    const output = await planner.propose(profile, history);
    history.push({ ...message(output.reply), role: 'assistant' });
    if (calls === 3) history.push({ ...message('哪些内容不希望遇到？'), role: 'assistant' });
  }
  assert.equal(calls, 6);
  assert.equal(guideState([message('我想成为古惑仔'), message('没目标')]).delegateOpening, true);
});

test('GUIDE-02 two literal photo labels ground exact roles without turning the teacher partner into the user partner', () => {
  const text = '第一张是教导主任，第二张是班主任女友';
  const proposals = explicitPhotoPeople(text, randomUUID());
  assert.equal(proposals.length, 2);
  assert.deepEqual(
    proposals.map((p) => p.subject),
    ['教导主任', '班主任女友'],
  );
  for (const p of proposals) assert.equal(groundPersonProposal(p, text, [])?.associatePhoto, true);
  assert.equal(explicitPhotoReference('第二张是班主任女友', '班主任'), null);
  assert.equal(explicitPhotoReference('第二张是班主任女友', '女朋友'), null);
  assert.equal(explicitPhotoPeople('第一张可能是教导主任', randomUUID()).length, 0);
  assert.equal(explicitPhotoPeople('第一张不是我表姐', randomUUID()).length, 0);
  assert.equal(explicitPhotoPeople('第一张是谁？', randomUUID()).length, 0);
  assert.equal(explicitPhotoPeople('第一张是小芳', randomUUID())[0]?.subject, '小芳');
});

test('GUIDE-02 delayed ordinal references require exactly one recent adjacent group, never a global first photo', () => {
  const first = message('照片', randomUUID()),
    second = message('照片', randomUUID()),
    source = message('第一张是教导主任，第二张是班主任女友');
  assert.equal(
    resolvePhotoReference(source, [first, second], '第一张是教导主任', '教导主任')?.id,
    first.id,
  );
  assert.equal(
    resolvePhotoReference(source, [first, second], '第二张是班主任女友', '班主任女友')?.id,
    second.id,
  );
  assert.equal(resolvePhotoReference(source, [first, second], '这是我表姐的照片', '表姐'), null);
  assert.equal(
    resolvePhotoReference(
      source,
      [first, message('旧照片已说明'), second],
      '第一张是教导主任',
      '教导主任',
    ),
    null,
  );
  assert.equal(
    resolvePhotoReference(
      source,
      [first, second, message('聊点别的')],
      '第一张是教导主任',
      '教导主任',
    ),
    null,
  );
  assert.equal(
    resolvePhotoReference(
      source,
      [{ ...first, createdAt: new Date(Date.now() - 90000000).toISOString() }],
      '第一张是教导主任',
      '教导主任',
    )?.id,
    first.id,
  );
  assert.equal(
    resolvePhotoReference(
      { ...source, text: '刚才第一张是教导主任' },
      [first, message('旧组说明'), second],
      '刚才第一张是教导主任',
      '教导主任',
    )?.id,
    second.id,
  );
  assert.equal(resolvePhotoReference(source, [first], '第二张是班主任女友', '班主任女友'), null);
  assert.equal(
    resolvePhotoReference(
      source,
      [first, { ...second, photoAssetId: first.photoAssetId }],
      '第一张是教导主任',
      '教导主任',
    ),
    null,
  );
});

test('GUIDE-02 hypothetical roles stay out of Profile even when description arrives later; no model asset IDs accepted', async () => {
  const text = '如果第一张是我的教导主任，第二张是我的班主任女友';
  assert.deepEqual(explicitPhotoPeople(text, randomUUID()), []);
  assert.equal(
    groundPersonProposal(
      { subject: '教导主任', quote: text, messageId: randomUUID(), associatePhoto: true },
      text,
      [],
    ),
    null,
  );
  assert.equal(isStoryPersonContext('第一张是教导主任', ['我想体验古惑仔的平行人生']), true);
  assert.equal(isStoryPersonContext('现实中第一张是教导主任', ['我想体验古惑仔的平行人生']), false);
  assert.equal(
    PersonProposalSchema.safeParse({
      subject: '朋友',
      quote: '这是我朋友的照片',
      messageId: randomUUID(),
      associatePhoto: true,
      assetId: randomUUID(),
    }).success,
    false,
  );
  const earlier = message('故事里我想当古惑仔'),
    last = message('第一张是教导主任');
  const planner = new InterviewPlanner({
    async complete() {
      return JSON.stringify({
        reply: '这个称呼暂留在故事构想里。',
        people: [
          { subject: '教导主任', messageId: last.id, quote: last.text, associatePhoto: true },
        ],
      });
    },
  });
  assert.equal((await planner.propose(profile, [earlier, last])).people?.length, 1);
  assert.equal(
    groundPersonProposal(
      { subject: '教导主任', messageId: last.id, quote: last.text, associatePhoto: true },
      last.text,
      [],
      true,
    )?.photoLabel,
    true,
  );
});

test('GUIDE-02 prompt sees upload markers and literal labels without receiving private assets or claiming visual analysis', async () => {
  const asset = randomUUID(),
    first = message('照片', asset),
    caption = message('第一张是我的班主任');
  let calls = 0;
  const planner = new InterviewPlanner({
    async complete(input) {
      calls++;
      assert(!JSON.stringify(input).includes(asset));
      assert.match(input[0]!.content, /没有看到图像内容/);
      return JSON.stringify({ reply: '收到你对照片的说明。', people: [] });
    },
  });
  await planner.propose(profile, [first, caption]);
  assert.equal(calls, 1);
});

test('GUIDE-02 final review counterexamples: negated recency, mixed reality/wish, explicit story photo labels', () => {
  const one = message('照片', randomUUID()),
    two = message('照片', randomUUID());
  const caption = message('不是刚才那组，第一张是教导主任');
  assert.equal(
    resolvePhotoReference(caption, [one, message('旧组说明'), two], '第一张是教导主任', '教导主任'),
    null,
  );
  assert.equal(isStoryPersonContext('第一张是我的女朋友', ['现实太累，想体验古惑仔']), true);
  const text = '故事里第一张是教导主任，第二张是班主任女友';
  const proposals = explicitPhotoPeople(text, caption.id);
  assert.equal(proposals.length, 2);
  for (const p of proposals)
    assert.equal(groundPersonProposal(p, text, [], true)?.photoLabel, true);
  const hypothetical = '如果第一张是我的女朋友';
  assert.deepEqual(explicitPhotoPeople(hypothetical, caption.id), []);
  assert.equal(
    groundPersonProposal(
      { subject: '女朋友', messageId: caption.id, quote: hypothetical, associatePhoto: true },
      hypothetical,
      [],
      true,
    ),
    null,
  );
});

test('GUIDE-02 named characters have literal photo labels, never model invented names or real romance', () => {
  const text = '第一张是小芳，第二张是王大毛',
    id = randomUUID();
  const items = explicitPhotoPeople(text, id);
  assert.deepEqual(
    items.map((p) => p.subject),
    ['小芳', '王大毛'],
  );
  for (const p of items) assert.equal(groundPersonProposal(p, text, [], true)?.photoLabel, true);
  assert.equal(groundPersonProposal({ ...items[0]!, subject: '小红' }, text, [], true), null);
  for (const invalid of [
    '第一张是小芳吗？',
    '第一张不是小芳',
    '第一张可能是小芳',
    '第一张是“王大毛”',
    '如果第一张是小芳',
    '第一张是不知道是谁',
    '第一张是' + '人'.repeat(41),
  ])
    assert.deepEqual(explicitPhotoPeople(invalid, id), [], invalid);
});

test('GUIDE-02 ordinal on the current upload must match its exact position in the adjacent group', () => {
  const first = message('照片', randomUUID()),
    second = message('第二张是小芳', randomUUID());
  assert.equal(resolvePhotoReference(second, [first], second.text, '小芳')?.id, second.id);
  assert.equal(resolvePhotoReference(second, [], second.text, '小芳'), null);
  assert.equal(
    resolvePhotoReference({ ...second, text: '第一张是小芳' }, [first], '第一张是小芳', '小芳'),
    null,
  );
});

test('delegating the opening and asking to rest do not repeat a generic question', async () => {
  const planner = new InterviewPlanner({
    async complete() {
      return JSON.stringify({
        reply: '可以先设想街边茶馆，先看一条小芳的消息。你会有什么感觉？',
        question: { text: '你会有什么感觉？', target: 'wish' },
        facts: [],
        events: [],
      });
    },
  });
  const output = await planner.propose(profile, [
    message('我想体验古惑仔'),
    message('没有目标，你来安排'),
  ]);
  assert.equal(output.reply, '可以先设想街边茶馆，先看一条小芳的消息。');
  assert.equal(output.question, undefined);
  const paused = guideState([message('我想体验古惑仔'), message('现实太累，想休息一会儿。')]);
  assert.equal(paused.mode, 'listen');
  assert.equal(paused.paused, true);
});

test('salvaged real reply and streaming display use the same delegated question policy', async () => {
  const messages = [message('我想体验古惑仔'), message('没有目标，你来安排')];
  const salvaged = new InterviewPlanner({
    async complete() {
      return JSON.stringify({
        reply: '可以先看一条小芳的消息。你有什么感受？',
        facts: [{ category: 'not-valid' }],
      });
    },
  });
  const proposal = await salvaged.propose(profile, messages);
  assert.equal(proposal.reply, '可以先看一条小芳的消息。');
  let visible = '';
  const streamed = new InterviewPlanner({
    async complete() {
      throw Error('No second call');
    },
    async *streamComplete() {
      yield '{"reply":"可以先看一条小芳的消息。';
      yield '你有什么感受？","facts":[],"events":[]}';
    },
  });
  const result = await streamed.proposeStream(profile, messages, (token) => {
    visible += token;
  });
  assert.equal(visible, result.reply);
  assert.equal(visible, '可以先看一条小芳的消息。');
});
