import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { sendFailureStatus, storeSendMessages } from '../src/features/phone/chat-send-state.ts';
import { ApiFailure } from '../src/features/api/client.ts';

// Execute the actual component-owned functions without mounting an unrelated phone tree.
function extract(file: string, name: string, callback = false) {
  const source = ts.createSourceFile(
    file,
    readFileSync(new URL(file, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let node: ts.Node | undefined;
  const visit = (candidate: ts.Node) => {
    if (ts.isFunctionDeclaration(candidate) && candidate.name?.text === name) node = candidate;
    if (
      callback &&
      ts.isVariableDeclaration(candidate) &&
      candidate.name.getText(source) === name &&
      candidate.initializer &&
      ts.isCallExpression(candidate.initializer)
    )
      node = candidate.initializer.arguments[0];
    ts.forEachChild(candidate, visit);
  };
  visit(source);
  assert.ok(node, `actual ${name} exists`);
  const subjectText = node.getText(source);
  return (bindings: Record<string, unknown>) => {
    const code = ts.transpileModule(`const subject = ${subjectText};`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText;
    return new Function(...Object.keys(bindings), `${code};return subject;`)(
      ...Object.values(bindings),
    );
  };
}
const conversation = extract('../src/features/phone/use-world-time.ts', 'startConversation', true);
const delivery = extract('../src/features/phone/world-phone-app.tsx', 'deliverMessage');

function fixture(localGuard?: () => void) {
  const ownerWorld = '11111111-1111-4111-8111-111111111111';
  const actorId = '22222222-2222-4222-8222-222222222222';
  const commandId = '33333333-3333-4333-8333-333333333333';
  let messages: Array<{ id: string; text: string; status: string }> = [];
  const saved = new Map<string, string>();
  const commands = { current: {} as Record<string, unknown> };
  const session = { current: { active: true, returning: false, resumeRequired: false } };
  let clockReject!: (reason: Error) => void;
  const clockPending = new Promise((_resolve, reject) => {
    clockReject = reject;
  });
  const notices: string[] = [];
  let clockCalls = 0;
  const startConversation = conversation({
    waiting: { current: false },
    pendingWaitRef: { current: null },
    session,
    view: { worldId: ownerWorld, clock: { paused: false, speed: 3 } },
    worldId: ownerWorld,
    sync: () => {
      clockCalls++;
      return clockPending;
    },
    setNotice: (text: string) => notices.push(text),
  });
  let worldReads = 0;
  const posted: unknown[] = [];
  const send = delivery({
    automatic: true,
    liveTimeRef: { current: { startConversation: localGuard ?? startConversation } },
    data: { version: 7, time: '2026-10-23T08:00:00Z', messages: [] },
    worldId: ownerWorld,
    localMessages: [],
    sendCommands: commands,
    partialCommands: { current: {} },
    confirmedSendVersion: { current: { worldId: ownerWorld, version: 9 } },
    sessionStorage: { setItem: (key: string, value: string) => saved.set(key, value) },
    setLocalMessages: (update: (current: typeof messages) => typeof messages) => {
      messages = update(messages);
    },
    storeSendMessages,
    sendFailureStatus,
    ApiFailure,
    client: {
      world: () => {
        worldReads++;
        throw Error('must not read before sending');
      },
      sendWorldMessage: async (_id: string, input: unknown) => {
        posted.push(input);
        throw new ApiFailure('INVALID_INPUT', 'controlled server rejection');
      },
    },
  });
  return {
    send: () => send(actorId, '这条原文不能丢', commandId),
    messages: () => messages,
    posted,
    worldReads: () => worldReads,
    saved,
    commands,
    commandId,
    ownerWorld,
    clockReject,
    notices,
    clockCalls: () => clockCalls,
  };
}

test('actual send reaches messages while clock sync is pending, using existing confirmed anchor without world GET', async () => {
  const f = fixture();
  await assert.rejects(f.send(), /controlled server rejection/);
  assert.equal(f.clockCalls(), 1);
  assert.equal(f.worldReads(), 0);
  assert.deepEqual(f.posted, [
    {
      commandId: f.commandId,
      actorId: '22222222-2222-4222-8222-222222222222',
      text: '这条原文不能丢',
      expectedVersion: 9,
    },
  ]);
  assert.equal(f.messages()[0]!.text, '这条原文不能丢');
  assert.equal(f.messages()[0]!.status, 'failed');
  assert.ok(f.saved.get(`pl-send:${f.ownerWorld}`)?.includes('这条原文不能丢'));
  assert.ok(f.commands.current[f.commandId]);
  f.clockReject(Error('clock timeout'));
  await Promise.resolve();
  assert.equal(f.notices.length, 1, 'clock error is handled independently of the send result');
});

test('local wait guard rejects before HTTP but preserves visible text and original command instead of dropping composer text', async () => {
  const f = fixture(() => {
    throw Error('请先核对这次等待');
  });
  await assert.rejects(f.send(), /请先核对这次等待/);
  assert.equal(f.posted.length, 0);
  assert.equal(f.worldReads(), 0);
  assert.equal(f.messages()[0]!.status, 'failed');
  assert.equal(f.messages()[0]!.text, '这条原文不能丢');
  assert.ok(f.commands.current[f.commandId]);
});

test('conversation entry still rejects paused, returning and pending-wait sessions without a clock request', () => {
  for (const condition of ['paused', 'returning', 'waiting']) {
    const start = conversation({
      waiting: { current: condition === 'waiting' },
      pendingWaitRef: { current: null },
      session: {
        current: { active: true, returning: condition === 'returning', resumeRequired: false },
      },
      view: { worldId: 'world', clock: { paused: condition === 'paused', speed: 3 } },
      worldId: 'world',
      sync: () => {
        throw Error('must not sync');
      },
      setNotice: () => {},
    });
    assert.throws(start, /核对|恢复/);
  }
});
