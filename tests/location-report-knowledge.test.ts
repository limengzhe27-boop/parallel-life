import test from 'node:test';
import assert from 'node:assert/strict';
import { projectLocationReportKnowledge } from '../src/modules/world/domain/project-location-report-knowledge.ts';
import type { AgentInputReceipt } from '../src/modules/world/domain/agent-runtime.ts';

const input: AgentInputReceipt = {
  id: 'input',
  worldId: 'world',
  commandId: 'command',
  inputHash: 'hash',
  channel: 'private',
  threadId: 'thread',
  recipientActorId: 'a',
  expectedWorldVersion: 2,
  receivedAt: '2026-10-16T01:05:00Z',
  storyAt: '2026-10-16T01:00:00Z',
  origin: 'player',
  text: '我说我在咖啡馆。',
};
const base = () => ({
  worldId: 'world',
  actorIds: ['a', 'b', 'c'],
  placeIds: ['cafe', 'home'],
  responderActorId: 'a',
  input: structuredClone(input),
  inputSourceId: 'source',
  eventId: 'commit',
  worldVersion: 3,
  reports: [
    {
      subject: { kind: 'player' as const },
      placeId: 'cafe',
      sourceId: 'source',
      quote: '我在咖啡馆',
      assertion: 'reported' as const,
    },
  ],
});
const shared = (channel: 'group' | 'scene' = 'group') => ({
  ...base(),
  input: { ...input, channel },
  audience: {
    channel,
    threadId: 'thread',
    inputReceiptId: 'input',
    sourceEventId: 'original',
    sourceWorldVersion: 2,
    actorIds: ['a', 'b', 'b'],
  },
});

test('private report belongs only to the recipient and remains a sourced claim', () => {
  const rows = projectLocationReportKnowledge(base());
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    worldId: 'world',
    observerActorId: 'a',
    subject: { kind: 'player' },
    kind: 'report',
    placeId: 'cafe',
    sourceKind: 'player_report',
    occurredAt: null,
    learnedAt: input.storyAt,
    sourceEventId: 'commit',
    worldVersion: 3,
    possiblyStale: true,
    evidence: { inputReceiptId: 'input', quote: '我在咖啡馆' },
  });
});
for (const channel of ['group', 'scene'] as const)
  test(`${channel} uses only authenticated message audience, deduplicated`, () => {
    const context = shared(channel);
    const before = structuredClone(context);
    const rows = projectLocationReportKnowledge(context);
    assert.deepEqual(
      rows.map((r) => r.observerActorId),
      ['a', 'b'],
    );
    assert.equal(
      rows.some((r) => r.observerActorId === 'c'),
      false,
    );
    assert.equal(
      rows.every((r) => r.kind === 'report' && r.occurredAt === null),
      true,
    );
    assert.deepEqual(context, before);
    rows[0]!.subject.kind = 'player';
    assert.notEqual(rows[0]!.subject, rows[1]!.subject);
  });
test('no channel audience proof never expands to cast or place contacts', () => {
  const context = shared();
  const { audience: _, ...withoutAudience } = context;
  assert.deepEqual(
    projectLocationReportKnowledge(withoutAudience).map((r) => r.observerActorId),
    ['a'],
  );
});
test('private input cannot borrow a group or scene audience', () => {
  const context = shared();
  assert.throws(() => projectLocationReportKnowledge({ ...context, input }), /AUDIENCE_MISMATCH/);
});
for (const patch of [
  { channel: 'scene' as const },
  { threadId: 'elsewhere' },
  { inputReceiptId: 'other' },
  { sourceWorldVersion: 1 },
  { sourceEventId: '' },
  { actorIds: ['b'] },
  { actorIds: ['a', 'stranger'] },
])
  test(`rejects mismatched audience ${JSON.stringify(patch)}`, () => {
    const context = shared();
    assert.throws(
      () =>
        projectLocationReportKnowledge({ ...context, audience: { ...context.audience, ...patch } }),
      /AUDIENCE_MISMATCH/,
    );
  });
test('uncertain and hypothetical reports never become stored positional knowledge', () => {
  for (const assertion of ['uncertain', 'hypothetical'] as const) {
    const context = shared();
    assert.deepEqual(
      projectLocationReportKnowledge({
        ...context,
        reports: [{ ...context.reports[0]!, assertion }],
      }),
      [],
    );
  }
});
test('quote and source must refer to this exact player input', () => {
  for (const patch of [{ quote: '未说过的话' }, { quote: ' ' }, { sourceId: 'other' }]) {
    const context = base();
    assert.throws(
      () =>
        projectLocationReportKnowledge({
          ...context,
          reports: [{ ...context.reports[0]!, ...patch }],
        }),
      /UNSOURCED/,
    );
  }
  assert.throws(
    () => projectLocationReportKnowledge({ ...base(), input: { ...input, origin: 'wake' } }),
    /UNSOURCED/,
  );
});
test('out of world actors or locations cannot be introduced by a report', () => {
  const context = base();
  assert.throws(
    () =>
      projectLocationReportKnowledge({
        ...context,
        reports: [{ ...context.reports[0]!, placeId: 'new_city' }],
      }),
    /OUT_OF_BOUNDARY/,
  );
  assert.throws(
    () =>
      projectLocationReportKnowledge({
        ...context,
        reports: [{ ...context.reports[0]!, subject: { kind: 'actor', actorId: 'stranger' } }],
      }),
    /OUT_OF_BOUNDARY/,
  );
});
test('a null reported location is preserved as unknown rather than replaced with truth', () => {
  const context = shared();
  const rows = projectLocationReportKnowledge({
    ...context,
    reports: [{ ...context.reports[0]!, placeId: null }],
  });
  assert.equal(
    rows.every((r) => r.placeId === null),
    true,
  );
});
test('conflicting reports of one subject cannot silently overwrite each other', () => {
  const context = base();
  assert.throws(
    () =>
      projectLocationReportKnowledge({
        ...context,
        reports: [context.reports[0]!, { ...context.reports[0]!, placeId: 'home' }],
      }),
    /AMBIGUOUS_SUBJECT/,
  );
});
test('input world, recipient, time and version boundaries are checked', () => {
  for (const patch of [
    { worldId: 'other' },
    { recipientActorId: 'b' },
    { storyAt: 'bad' },
    { expectedWorldVersion: 3 },
    { expectedWorldVersion: -1 },
  ])
    assert.throws(
      () => projectLocationReportKnowledge({ ...base(), input: { ...input, ...patch } }),
      /INPUT_MISMATCH/,
    );
});
