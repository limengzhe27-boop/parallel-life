import test from 'node:test';
import assert from 'node:assert/strict';
import type { SceneRead } from '../src/contracts/scenes.ts';
import {
  sceneTaskActionId,
  sceneStatus,
  shouldResumeSceneTask,
  canRetrySceneTask,
  restoreSceneCommand,
  readSceneTaskForRecovery,
  type SceneTask,
} from '../src/features/phone/scenes/state.ts';

const task = (status: SceneTask['status'], id = 'task-a') =>
  ({
    id,
    status,
    scope: { kind: 'world', worldId: 'world-a' },
    updatedAt: '2026-10-27T10:00:00Z',
  }) as SceneTask;
function read(t: SceneTask | null = task('running')): SceneRead {
  return {
    experience: { worldId: 'world-a' },
    scene: { id: 'scene-a' },
    task: t,
    actions: [
      { id: 'latest-input', sceneId: 'scene-a', sourceVersion: 9, text: '我向前台问路。' },
      { id: 'earlier-input', sceneId: 'scene-a', sourceVersion: 3, text: '我看看四周。' },
      { id: 'other-scene-input', sceneId: 'scene-b', sourceVersion: 12, text: '我打招呼。' },
      {
        id: 'latest-private-thought',
        sceneId: 'scene-a',
        sourceVersion: 11,
        text: '我心里想，这里还挺安静。',
      },
    ],
  } as unknown as SceneRead;
}

test('a confirmed newest task anchors only to its actual scene latest input, including private input projections', () => {
  const t = task('running'),
    r = read(t);
  assert.equal(sceneTaskActionId(r, t), 'latest-input');
  assert.equal(
    sceneTaskActionId(r, task('running', 'new-receipt-not-read-yet')),
    null,
    'a new receipt cannot place progress on an older input before its original read arrives',
  );
  assert.equal(sceneTaskActionId({ ...r, task: null }, t), null);
  assert.equal(
    sceneTaskActionId({ ...r, actions: [] }, t),
    null,
    'initial scene opening has no fabricated player action',
  );
  assert.equal(sceneTaskActionId(r, { ...t, scope: { kind: 'world', worldId: 'other' } }), null);
  assert.equal(sceneTaskActionId({ ...r, scene: null }, t), null);
});

test('success is silent, work is lightweight, and each failure remains an honest local status', () => {
  for (const status of ['queued', 'running'] as const) {
    assert.equal(sceneStatus(task(status)), '正在回应…');
    assert.equal(sceneTaskActionId(read(task(status)), task(status)), 'latest-input');
  }
  assert.equal(sceneStatus(task('succeeded')), '');
  assert.equal(sceneTaskActionId(read(task('succeeded')), task('succeeded')), null);
  for (const status of ['failed', 'unknown', 'cancelled', 'conflict'] as const) {
    assert.ok(sceneStatus(task(status)).length > 0);
    assert.doesNotMatch(sceneStatus(task(status)), /已保存|保存成功/);
    assert.equal(shouldResumeSceneTask(task(status), false), false);
  }
  assert.equal(
    canRetrySceneTask(task('conflict')),
    false,
    'conflict offers a read, not paid retry',
  );
  assert.equal(shouldResumeSceneTask(task('queued'), false), true);
});

test('failed sends retain the original text and command; read-only recovery never grants a new paid response on late success', async () => {
  const command = {
    id: '00000000-0000-4000-8000-000000000011',
    version: 9,
    text: '我想问一下前台。',
    relatedMatterIds: [],
  };
  const stored = JSON.stringify(command);
  assert.deepEqual(restoreSceneCommand(stored), command);
  const original = task('unknown'),
    requests: string[] = [];
  const completed = {
    ...original,
    status: 'succeeded' as const,
    updatedAt: '2026-10-27T10:01:00Z',
  };
  const result = await readSceneTaskForRecovery(original, async (id) => {
    requests.push(id);
    return completed;
  });
  assert.deepEqual(requests, ['task-a']);
  assert.equal(result, completed);
  assert.equal(canRetrySceneTask(result), false);
  assert.equal(sceneStatus(result), '');
  assert.deepEqual(restoreSceneCommand(stored), command);
});
