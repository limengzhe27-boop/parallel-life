import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  sendFailureStatus,
  hasLocalSendFailure,
  storeSendMessages,
  restoreSendMessages,
  restoreSendCommands,
  retryLatestGroupTask,
} from '../src/features/phone/chat-send-state.ts';
import type { PhoneMessage } from '../src/features/phone/apps/types.ts';
import type { GroupTask } from '../src/features/phone/groups/client.ts';
const worldId = randomUUID(),
  actorId = randomUUID(),
  commandId = randomUUID();
const message: PhoneMessage = {
  id: commandId,
  actorId,
  role: 'user',
  text: '原始文字与相册分享文本',
  at: '2026-10-10T09:00:00.000Z',
  status: 'failed',
};
const op = { status: 'failed' as const, error: 'failed', commandId };
const task: GroupTask = {
  id: randomUUID(),
  scope: { kind: 'world', worldId },
  status: 'unknown',
  createdAt: message.at,
  updatedAt: message.at,
  errorCode: 'UNKNOWN',
  resultVersion: null,
};

test('lost response, timeout and ambiguous failures stay unknown, explicit rejections are failed', () => {
  for (const error of [
    new TypeError('fetch failed'),
    { code: 'UNAVAILABLE' },
    { code: 'UNKNOWN' },
    { code: 'INTERNAL' },
    new Error('private upstream'),
  ])
    assert.equal(sendFailureStatus(error), 'unknown');
  for (const code of ['INVALID_INPUT', 'VERSION_CONFLICT', 'FORBIDDEN', 'INVALID_COMMAND'])
    assert.equal(sendFailureStatus({ code }), 'failed');
});
test('only the same visible player command handles composer error; other commands and NPCs never mask it', () => {
  assert.equal(hasLocalSendFailure(op, [message]), true);
  assert.equal(hasLocalSendFailure(op, [{ ...message, status: 'unknown' }]), true);
  assert.equal(hasLocalSendFailure(op, [{ ...message, id: randomUUID() }]), false);
  assert.equal(hasLocalSendFailure(op, [{ ...message, role: 'assistant' }]), false);
  assert.equal(hasLocalSendFailure(op, []), false);
  assert.equal(hasLocalSendFailure({ ...op, error: undefined }, [message]), false);
});
test('explicit retry chain keeps the original error handled during another failure and after commit', () => {
  const next = randomUUID();
  assert.equal(
    hasLocalSendFailure(op, [{ ...message, id: next }], {
      [`retry:${commandId}`]: { ...op, commandId: next },
    }),
    true,
  );
  assert.equal(
    hasLocalSendFailure(op, [], {
      [`retry:${commandId}`]: { status: 'committed', commandId: next },
    }),
    true,
  );
  assert.equal(hasLocalSendFailure(op, [], { [`retry:${commandId}`]: { ...op } }), false);
});
test('refresh restores pending as unknown with the original command and text, never a new send', () => {
  const restored = restoreSendMessages(
    storeSendMessages(worldId, [{ ...message, status: 'pending' }]),
    worldId,
  );
  assert.deepEqual(restored, [{ ...message, status: 'unknown' }]);
  assert.deepEqual(restoreSendMessages(storeSendMessages(worldId, [message]), worldId), [message]);
});
test('recovery rejects other worlds, corrupt data and speculative assistant entries', () => {
  const raw = storeSendMessages(worldId, [message]);
  assert.deepEqual(restoreSendMessages(raw, randomUUID()), []);
  assert.deepEqual(restoreSendMessages('not JSON', worldId), []);
  assert.deepEqual(
    restoreSendMessages(
      JSON.stringify({ worldId, messages: [{ ...message, role: 'assistant' }] }),
      worldId,
    ),
    [],
  );
  assert.deepEqual(
    restoreSendMessages(storeSendMessages(worldId, [{ ...message, status: 'sent' }]), worldId),
    [],
  );
});
test('stale unknown already succeeded is read only; no retry command is even allocated', async () => {
  let reads = 0,
    retries = 0,
    ids = 0;
  const result = await retryLatestGroupTask(
    task.id,
    async (id) => {
      reads++;
      assert.equal(id, task.id);
      return { ...task, status: 'succeeded', errorCode: null };
    },
    async () => {
      retries++;
      return task;
    },
    () => {
      ids++;
      return randomUUID();
    },
  );
  assert.equal(result.retried, false);
  assert.equal(result.task.status, 'succeeded');
  assert.deepEqual([reads, retries, ids], [1, 0, 0]);
});
test('current running/queued/conflict task never creates a new attempt', async () => {
  for (const status of ['running', 'queued', 'conflict'] as const) {
    const result = await retryLatestGroupTask(
      task.id,
      async () => ({ ...task, status }),
      async () => {
        throw Error('unexpected retry');
      },
      () => {
        throw Error('unexpected id');
      },
    );
    assert.equal(result.retried, false);
  }
});
test('explicit retry reads latest failed/unknown before creating exactly one command', async () => {
  for (const status of ['failed', 'unknown'] as const) {
    const order: string[] = [],
      retryId = randomUUID();
    const result = await retryLatestGroupTask(
      task.id,
      async () => {
        order.push('read');
        return { ...task, status };
      },
      async (id, cmd) => {
        order.push('retry');
        assert.equal(id, task.id);
        assert.equal(cmd, retryId);
        return { ...task, id: randomUUID(), status: 'queued' };
      },
      () => {
        order.push('id');
        return retryId;
      },
    );
    assert.equal(result.retried, true);
    assert.deepEqual(order, ['read', 'id', 'retry']);
  }
});
test('failed or mismatched task lookup prevents retry and command allocation', async () => {
  const noRetry = async () => {
      throw Error('must not retry');
    },
    noId = () => {
      throw Error('must not allocate');
    };
  await assert.rejects(
    retryLatestGroupTask(
      task.id,
      async () => {
        throw Error('offline');
      },
      noRetry,
      noId,
    ),
    /offline/,
  );
  await assert.rejects(
    retryLatestGroupTask(task.id, async () => ({ ...task, id: randomUUID() }), noRetry, noId),
    /来源不一致/,
  );
});

test('restore preserves the exact last submitted version and rejects foreign/mismatched commands', () => {
  const command = { worldId, commandId, actorId, text: message.text, expectedVersion: 27 };
  const raw = storeSendMessages(worldId, [message], { [commandId]: command });
  assert.deepEqual(restoreSendCommands(raw, worldId), { [commandId]: command });
  assert.deepEqual(restoreSendCommands(raw, randomUUID()), {});
  assert.deepEqual(restoreSendCommands(storeSendMessages(worldId, [message]), worldId), {});
  assert.deepEqual(
    restoreSendCommands(
      storeSendMessages(worldId, [message], { [commandId]: { ...command, actorId: randomUUID() } }),
      worldId,
    ),
    {},
  );
});
