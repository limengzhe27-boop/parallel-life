import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLoop } from '../src/modules/tasks/application/run-loop.ts';

/** A sleep stub that resolves immediately, so the loop never blocks the test. */
const noSleep = async () => {};

test('shutdown before any work stops the loop without cancelling anything', async () => {
  const shutdown = new AbortController();
  shutdown.abort();
  let calls = 0;
  const result = await runLoop({
    shutdown: shutdown.signal,
    runOnce: async () => {
      calls += 1;
      return false;
    },
    sleep: noSleep,
  });
  assert.deepEqual(result, { reason: 'shutdown', drained: true, tasksRun: 0 });
  assert.equal(calls, 0);
});

test('in-flight work is drained: its signal stays live so the task can commit', async () => {
  const shutdown = new AbortController();
  let signalWhenRunning: AbortSignal | undefined;
  const result = await runLoop({
    shutdown: shutdown.signal,
    drainMs: 5_000,
    sleep: noSleep,
    runOnce: async (signal) => {
      signalWhenRunning = signal;
      /* Shutdown arrives while this task is running. */
      shutdown.abort();
      await Promise.resolve();
      return true;
    },
  });
  assert.equal(result.drained, true);
  assert.equal(result.tasksRun, 1);
  assert.equal(
    signalWhenRunning?.aborted,
    false,
    'work signal must not be aborted during the grace window',
  );
});

test('work that outlasts the grace window is cancelled and reported as not drained', async () => {
  const shutdown = new AbortController();
  let abortedDuringRun = false;
  const result = await runLoop({
    shutdown: shutdown.signal,
    drainMs: 0,
    sleep: noSleep,
    runOnce: async (signal) => {
      shutdown.abort();
      /* The drain timer fires immediately with drainMs = 0. */
      await new Promise((resolve) => setTimeout(resolve, 5));
      abortedDuringRun = signal.aborted;
      return true;
    },
  });
  assert.equal(result.drained, false);
  assert.equal(
    abortedDuringRun,
    true,
    'the work signal must be aborted once the grace window passes',
  );
});

test('idle polling keeps working and a queue error does not stop the loop', async () => {
  const shutdown = new AbortController();
  let attempts = 0;
  const messages: string[] = [];
  const result = await runLoop({
    shutdown: shutdown.signal,
    sleep: noSleep,
    log: (message) => messages.push(message),
    runOnce: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('connection lost');
      if (attempts === 3) shutdown.abort();
      return attempts === 2;
    },
  });
  assert.equal(attempts, 3);
  assert.equal(result.tasksRun, 1);
  assert.equal(messages.length, 1);
});
