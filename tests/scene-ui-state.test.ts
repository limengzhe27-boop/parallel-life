import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sceneBusy,
  sceneStatus,
  restoreSceneCommand,
  mergeScene,
} from '../src/features/phone/scenes/state.ts';
import type { SceneTask } from '../src/features/phone/scenes/state.ts';
import type { SceneRead } from '../src/contracts/scenes.ts';
test('scene recovery distinguishes queued execution from unknown and never presents unresolved as success', () => {
  for (const status of ['queued', 'running', 'unknown', 'failed', 'succeeded'] as const) {
    const task = { status } as SceneTask;
    assert.equal(sceneBusy(task), status === 'queued' || status === 'running');
    if (status === 'unknown') assert.match(sceneStatus(task), /不能确认/);
  }
  const input = {
    id: '00000000-0000-4000-8000-000000000001',
    version: 2,
    text: '  我试着转动把手。  ',
  };
  assert.deepEqual(restoreSceneCommand(JSON.stringify(input)), input);
  assert.equal(restoreSceneCommand(JSON.stringify({ ...input, outcome: 'succeeded' })), undefined);
  assert.equal(restoreSceneCommand('{'), undefined);
});
test('late scene queries cannot roll back the same saved scene but different scene IDs can be opened', () => {
  const a = { worldVersion: 9, scene: { id: 'a' } } as SceneRead;
  const b = { worldVersion: 8, scene: { id: 'a' } } as SceneRead;
  assert.equal(mergeScene(a, b), a);
  const c = { worldVersion: 8, scene: { id: 'b' } } as SceneRead;
  assert.equal(mergeScene(a, c), c);
});
