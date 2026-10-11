import test from 'node:test';
import assert from 'node:assert/strict';
import type { SceneRead } from '../src/contracts/scenes.ts';
import { SceneWorldSync } from '../src/features/phone/scenes/world-sync.ts';

const read = (version: number, status?: string, worldId = 'world'): SceneRead =>
  ({
    worldVersion: version,
    experience: { worldId },
    task: status ? { status } : null,
  }) as SceneRead;

test('pending and foreign scene reads never refresh or execute the phone; committed newer state does', async () => {
  const sync = new SceneWorldSync('world');
  const versions: number[] = [];
  const refresh = async (v: number) => {
    versions.push(v);
  };
  await sync.sync(read(4, 'queued'), 2, refresh);
  await sync.sync(read(5, 'running'), 2, refresh);
  await sync.sync(read(7, 'succeeded', 'another-world'), 2, refresh);
  await sync.sync(read(2), 2, refresh);
  assert.deepEqual(versions, []);
  await sync.sync(read(6, 'succeeded'), 2, refresh);
  await sync.sync(read(6), 2, refresh);
  await sync.sync(read(5), 2, refresh);
  assert.deepEqual(versions, [6]);
});

test('simultaneous scene and phone observers coalesce reads while a later commit still refreshes', async () => {
  const sync = new SceneWorldSync('world');
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const versions: number[] = [];
  const refresh = async (v: number) => {
    versions.push(v);
    if (v === 6) await gate;
  };
  const first = sync.sync(read(6), 2, refresh);
  const duplicate = sync.sync(read(6), 2, refresh);
  const newer = sync.sync(read(8), 2, refresh);
  assert.deepEqual(versions, [6]);
  release();
  await Promise.all([first, duplicate, newer]);
  assert.deepEqual(versions, [6, 8]);
});

test('failed projection reads remain retryable without resubmitting the scene action', async () => {
  const sync = new SceneWorldSync('world');
  let reads = 0;
  const refresh = async () => {
    if (++reads === 1) throw new Error('offline');
  };
  await assert.rejects(sync.sync(read(6, 'succeeded'), 2, refresh), /offline/);
  await sync.sync(read(6, 'succeeded'), 2, refresh);
  assert.equal(reads, 2);
  await sync.sync(read(6, 'succeeded'), 6, refresh);
  assert.equal(reads, 2);
});

test('failed or unknown task can refresh saved inputs but cannot be advertised as a successful action', async () => {
  const sync = new SceneWorldSync('world');
  const versions: number[] = [];
  await sync.sync(read(3, 'unknown'), 2, async (v) => {
    versions.push(v);
  });
  await sync.sync(read(4, 'failed'), 3, async (v) => {
    versions.push(v);
  });
  assert.deepEqual(versions, [3, 4]);
});
