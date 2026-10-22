import assert from 'node:assert/strict';
import test from 'node:test';
import { isExplicitRecallRequest, withRecallRequest } from '../src/modules/world/domain/recall-request.ts';
import type { AgentProposal } from '../src/modules/world/domain/agent-runtime.ts';

const proposal = {
  statements: [{ text: '好吧。', dependsOnActionIds: [] }],
} as unknown as AgentProposal;

test('explicit private recall request becomes a formal decision', () => {
  for (const text of ['刚才那句撤回一下', '把上一条消息收回去', '你刚发的那条撤销吧']) {
    assert.equal(isExplicitRecallRequest(text), true, text);
    assert.equal(
      withRecallRequest(proposal, { channelKind: 'private', origin: 'player', text }).recallLast,
      true,
    );
  }
});

test('ordinary talk about recall is not a command', () => {
  for (const text of ['我昨天撤回了一条消息', '为什么有人会撤回啊', '撤回是什么意思']) {
    assert.equal(isExplicitRecallRequest(text), false, text);
    assert.equal(
      withRecallRequest(proposal, { channelKind: 'private', origin: 'player', text }).recallLast,
      undefined,
    );
  }
  assert.equal(
    withRecallRequest(proposal, { channelKind: 'group', origin: 'player', text: '刚才那句撤回' })
      .recallLast,
    undefined,
  );
});
