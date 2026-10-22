import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isGenericProactiveLine,
  withProactiveQuality,
} from '../src/modules/world/domain/proactive-quality.ts';
import type { AgentProposal } from '../src/modules/world/domain/agent-runtime.ts';

const proposal = (text: string) =>
  ({ statements: [{ text, dependsOnActionIds: [] }] }) as unknown as AgentProposal;

test('content-free waiting lines are not proactive contact', () => {
  for (const text of [
    '我这儿暂时没什么新事儿，就先这样。',
    '我先不急着说什么，就等这边情况明朗了，再看看下一步怎么走。',
    '没什么新意要说了，先这样吧。',
    '我暂时没什么新打算，也没别的想法，先这样吧。',
    '我这边条件稳定，准备继续关注修车细节，确保没遗漏什么重要信息。',
    '我这边已经整理好了今晚见面前的心情，没什么要补充的了。',
    '暂时没有新的想法，还是先观察观察吧。',
  ])
    assert.equal(isGenericProactiveLine(text), true, text);
});

test('concrete observations, plans and stickers survive the gate', () => {
  for (const text of [
    '刚查了查资料，天气这两天不错，出门修车和吃饭都合适。',
    '锅里依旧有饭，你回家的时候告诉我一声，我给你留着。',
    '明天下午三点我在河边咖啡馆等你。',
    '我暂时没什么新打算，不过明天还是去店里把车交了。',
  ])
    assert.equal(isGenericProactiveLine(text), false, text);
  const result = withProactiveQuality(proposal('我这儿暂时没什么新事儿，就先这样。'), {
    channelKind: 'private',
    origin: 'wake',
  });
  assert.equal(result.statements.length, 0);
});

test('an exact duplicate of a recent proactive line is hard-blocked', () => {
  const result = withProactiveQuality(proposal('今晚先把活儿收拾好。'), {
    channelKind: 'private',
    origin: 'wake',
    recentSelfTexts: ['今晚先把活儿收拾好。'],
  });
  assert.equal(result.statements.length, 0);
});

test('the gate never touches a player reply or drops a real sticker', () => {
  const player = withProactiveQuality(proposal('我这儿暂时没什么新事儿，就先这样。'), {
    channelKind: 'private',
    origin: 'player',
  });
  assert.equal(player.statements.length, 1);
  const sticker = {
    statements: [{ text: '', stickerId: 'kun', dependsOnActionIds: [] }],
  } as unknown as AgentProposal;
  assert.equal(
    withProactiveQuality(sticker, { channelKind: 'private', origin: 'wake' }).statements.length,
    1,
  );
});
