import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sceneInputDisabled,
  mergeScene,
  mergeSceneTask,
  canRetrySceneTask,
  readSceneTaskForRecovery,
  sceneStatus,
  type SceneTask,
} from '../src/features/phone/scenes/state.ts';
import type { SceneRead } from '../src/contracts/scenes.ts';

const worldId = '00000000-0000-4000-8000-000000000001';
function task(status: SceneTask['status'], updatedAt = '2026-10-27T01:00:00.000Z'): SceneTask {
  return {
    id: '00000000-0000-4000-8000-000000000002',
    scope: { kind: 'world', worldId },
    status,
    createdAt: '2026-10-27T00:00:00.000Z',
    updatedAt,
    errorCode: null,
    resultVersion: status === 'succeeded' ? 4 : null,
  };
}
function read(): SceneRead {
  return {
    worldVersion: 3,
    paused: false,
    scene: { id: 'scene', status: 'active', presence: [{ participant: { kind: 'player' } }] },
  } as SceneRead;
}

test('player-only scenes keep input available; actual task/scene state still prevents duplicate submission', () => {
  assert.equal(sceneInputDisabled(read(), null, false), false);
  assert.equal(sceneInputDisabled(read(), task('failed'), false), false);
  assert.equal(sceneInputDisabled(read(), task('unknown'), false), false);
  assert.equal(sceneInputDisabled(read(), task('queued'), false), true);
  assert.equal(sceneInputDisabled(read(), task('running'), false), true);
  assert.equal(sceneInputDisabled(read(), null, true), true);
  assert.equal(sceneInputDisabled({ ...read(), paused: true }, null, false), true);
  assert.equal(sceneInputDisabled({ ...read(), scene: null }, null, false), true);
  assert.equal(
    sceneInputDisabled({ ...read(), scene: { ...read().scene!, status: 'ended' } }, null, false),
    true,
  );
});

test('late reads cannot roll back the accepted scene or the latest status of its original task', () => {
  const latest = {
    ...read(),
    worldVersion: 4,
    task: task('succeeded', '2026-10-27T01:01:00.000Z'),
  };
  const old = { ...read(), task: task('running') };
  assert.equal(mergeScene(latest, old), latest);
  assert.equal(mergeSceneTask(latest.task, old.task), latest.task);
  assert.equal(mergeSceneTask(old.task, latest.task), latest.task);
  assert.equal(mergeSceneTask(undefined, null), null);
});

test('unknown recovery only reads original task; late success does not offer another paid response', async () => {
  const original = task('unknown');
  const completed = task('succeeded', '2026-10-27T01:01:00.000Z');
  const requests: string[] = [];
  const latest = await readSceneTaskForRecovery(original, async (id) => {
    requests.push(id);
    return completed;
  });
  assert.deepEqual(requests, [original.id]);
  assert.equal(latest, completed);
  assert.equal(canRetrySceneTask(latest), false);
  assert.match(sceneStatus(original), /先核对原回应/);
  assert.match(sceneStatus(task('conflict')), /现场有了变化.*重新读取/);
});

test('still unknown requires an explicit later decision; read failures and wrong task/world are not treated as permission to retry', async () => {
  const original = task('unknown');
  assert.equal(await readSceneTaskForRecovery(original, async () => original), original);
  await assert.rejects(
    readSceneTaskForRecovery(original, async () => {
      throw new Error('connection lost');
    }),
    /connection lost/,
  );
  await assert.rejects(
    readSceneTaskForRecovery(original, async () => ({ ...original, id: worldId })),
    /来源不一致/,
  );
  await assert.rejects(
    readSceneTaskForRecovery(original, async () => ({
      ...original,
      scope: { kind: 'world', worldId: 'another-world' },
    })),
    /来源不一致/,
  );
  assert.equal(canRetrySceneTask(task('queued')), false);
  assert.equal(canRetrySceneTask(task('running')), false);
  assert.equal(canRetrySceneTask(task('conflict')), false);
});
