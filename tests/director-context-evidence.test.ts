import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isRequiredDirectorEvidence,
  retainDirectorEvidence,
} from '../src/modules/world/domain/director-context-evidence.ts';
const evidence = (sourceId: string, kind = 'fact', text = '{}') => ({
  sourceId,
  kind,
  text,
  contentHash: 'original-hash',
});

test('budget preserves every actual position including unknown genesis, beyond a six-record tail', () => {
  const positions = Array.from({ length: 7 }, (_, i) =>
    evidence(
      `actual-position:${i}`,
      'fact',
      JSON.stringify({ status: i ? 'unknown' : 'at', worldVersion: 0, sourceEventId: null }),
    ),
  );
  const all = [
    ...positions,
    ...Array.from({ length: 9 }, (_, i) => evidence('noise:' + i, 'belief')),
  ];
  const result = retainDirectorEvidence(all, 2);
  assert.deepEqual(result, [...positions, ...all.slice(-2)]);
  assert.equal(result[0], positions[0]);
});
test('actual results, explicit decisions, appointment state and selected speech retain their distinct kinds', () => {
  const records = [
    evidence('action-result:a', 'result'),
    evidence('episode-outcome:a', 'result'),
    evidence('calendar-response:a'),
    evidence('decision:a'),
    evidence('appointment:a', 'plan'),
    evidence('message:a', 'speech', '我已经到了'),
    evidence('input:a', 'speech', '我拒绝'),
    evidence('position-knowledge:a', 'belief', JSON.stringify({ sourceKind: 'player_report' })),
  ];
  const result = retainDirectorEvidence(records, 0);
  assert.deepEqual(result, records);
  assert.equal(result[5]!.kind, 'speech');
  assert.equal(result[7]!.kind, 'belief');
});
test('opening report metadata is retained without treating free text or author plot as executed fact', () => {
  assert.equal(
    isRequiredDirectorEvidence(
      evidence(
        'fact:opening',
        'fact',
        JSON.stringify({
          type: 'received_opening_information',
          assertion: 'report',
          executionEvidence: false,
        }),
      ),
    ),
    true,
  );
  assert.equal(
    isRequiredDirectorEvidence(evidence('setting:world', 'fact', '作者写着玩家已到达')),
    false,
  );
  assert.equal(
    isRequiredDirectorEvidence(
      evidence(
        'fact:opening',
        'fact',
        JSON.stringify({
          type: 'received_opening_information',
          assertion: 'canonical',
          executionEvidence: true,
        }),
      ),
    ),
    false,
  );
  assert.equal(
    isRequiredDirectorEvidence(evidence('other', 'belief', 'received_opening_information')),
    false,
  );
});
test('execution receipts survive while quiet bookkeeping can leave the budget', () => {
  for (const type of [
    'travel.completed',
    'agent.arrival_committed',
    'scene.entered',
    'scene.action_resolved',
    'invitation.responded',
  ])
    assert.equal(
      isRequiredDirectorEvidence(
        evidence(
          'event:' + type,
          'fact',
          JSON.stringify({ kind: 'committed_event_receipt', type }),
        ),
      ),
      true,
    );
  assert.equal(
    isRequiredDirectorEvidence(
      evidence(
        'event:quiet',
        'fact',
        JSON.stringify({ kind: 'committed_event_receipt', type: 'agent.state_committed' }),
      ),
    ),
    false,
  );
  assert.equal(
    isRequiredDirectorEvidence(
      evidence(
        'calendar-response:a',
        'fact',
        JSON.stringify({ kind: 'explicit_calendar_button', operation: 'decline' }),
      ),
    ),
    true,
  );
});
test('deduplication preserves source order, exact text/hash and original object identity', () => {
  const first = evidence('message:a', 'speech', '原话'),
    other = evidence('actual-position:b'),
    duplicate = { ...first, text: '另一个显示摘录' },
    noise = evidence('setting:w', 'fact', '庞大重复设定');
  const input = [first, noise, other, duplicate],
    before = structuredClone(input);
  const result = retainDirectorEvidence(input, 0);
  assert.deepEqual(result, [first, other]);
  assert.equal(result[0], first);
  assert.equal(result[1], other);
  assert.deepEqual(input, before);
  assert.equal(result[0]!.text, '原话');
  assert.equal(result[0]!.contentHash, 'original-hash');
});
test('optional tail selection remains bounded and cannot turn omitted material into evidence of absence', () => {
  const records = [
    evidence('noise:1', 'belief'),
    evidence('noise:2', 'belief'),
    evidence('noise:3', 'belief'),
  ];
  assert.deepEqual(retainDirectorEvidence(records, 1), [records[2]]);
  assert.deepEqual(retainDirectorEvidence(records, 0), []);
  assert.deepEqual(retainDirectorEvidence(records, 100), records);
  for (const n of [-1, NaN, Infinity, 1.5])
    assert.throws(() => retainDirectorEvidence(records, n), {
      message: 'INVALID_DIRECTOR_EVIDENCE_TAIL',
    });
});

test('only source-bound fictional genesis receipt is essential; genesis-prefixed author script remains optional', () => {
  const receipt = evidence(
    'genesis:world',
    'fact',
    JSON.stringify({
      kind: 'fictional_genesis',
      title: '原世界',
      time: '2026-10-27T08:00:00.000Z',
      sourceId: 'genesis:world',
    }),
  );
  const author = evidence(
    'genesis:author-fact',
    'fact',
    JSON.stringify({
      tone: '生活',
      setting: '原稿'.repeat(13000),
      identity: '主角',
      situation: '作者待演绎内容',
      hiddenContext: '人物秘密',
    }),
  );
  const report = evidence(
    'fact:opening',
    'fact',
    JSON.stringify({
      type: 'received_opening_information',
      assertion: 'report',
      executionEvidence: false,
    }),
  );
  const position = evidence(
    'actual-position:actor',
    'fact',
    JSON.stringify({ status: 'unknown', sourceEventId: null, worldVersion: 0 }),
  );
  const all = [receipt, author, report, position],
    before = structuredClone(all);
  assert.equal(isRequiredDirectorEvidence(receipt), true);
  assert.equal(isRequiredDirectorEvidence(author), false);
  assert.deepEqual(retainDirectorEvidence(all, 0), [receipt, report, position]);
  assert.equal(retainDirectorEvidence(all, 0)[0], receipt);
  assert.deepEqual(all, before);
  assert.equal(receipt.contentHash, 'original-hash');
  assert.equal(author.text, before[1]!.text);
  assert.deepEqual(retainDirectorEvidence([receipt, author], 1), [receipt, author]);
  for (const invalid of [
    evidence('genesis:wrong', 'fact', receipt.text),
    evidence('genesis:world', 'belief', receipt.text),
    evidence('genesis:world', 'fact', '作者原稿并不因这个前缀成为执行证据'),
    evidence(
      'genesis:world',
      'fact',
      JSON.stringify({
        kind: 'fictional_genesis',
        sourceId: 'genesis:world',
        time: 'invalid',
        title: '世界',
      }),
    ),
  ])
    assert.equal(isRequiredDirectorEvidence(invalid), false);
});
