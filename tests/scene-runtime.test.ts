import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifySceneInput,
  sceneAttemptBoundary,
  assertsDeferredExecution,
  sceneContextEntries,
  assertSceneAvailable,
} from '../src/modules/world/domain/scene-runtime.ts';
import { SceneRuntimeSessionSchema, SceneInputSchema } from '../src/contracts/scenes.ts';
import { randomUUID } from 'node:crypto';
test('scene input preserves distinction between hypothesis, intention and attempted operation', () => {
  assert.equal(classifySceneInput('如果我把灯调暗，会怎样？').intent, 'hypothesis');
  assert.equal(classifySceneInput('我想先把灯调暗').intent, 'plan');
  assert.deepEqual(classifySceneInput('我把灯调暗一级，观察阴影'), {
    intent: 'attempt',
    kind: 'inspect',
  });
  assert.equal(classifySceneInput('我问小林愿不愿意试一下').kind, 'speak');
  assert.equal(
    SceneInputSchema.parse({ commandId: randomUUID(), expectedVersion: 0, text: '  我看看灯  ' })
      .text,
    '  我看看灯  ',
  );
});
test('scene runtime accepts owned event-derived appointment references while rejecting forged input fields', () => {
  const id = randomUUID(),
    scene = {
      id,
      ownerId: randomUUID(),
      worldId: randomUUID(),
      sourceEventId: randomUUID(),
      sourceVersion: 1,
      title: '测试',
      appointmentId: `${id}_effect_0`,
      status: 'active',
      presence: [],
    };
  assert.ok(SceneRuntimeSessionSchema.safeParse(scene).success);
  assert.equal(
    SceneInputSchema.safeParse({
      commandId: id,
      expectedVersion: 1,
      text: '测试',
      ownerId: id,
      outcome: 'succeeded',
    }).success,
    false,
  );
});
test('paused or departed scene is read-only, absent actors receive no observable entries', () => {
  const scene = {
    id: 's',
    worldId: 'w',
    ownerId: 'o',
    title: 't',
    sourceEventId: 'e',
    sourceVersion: 1,
    status: 'active' as const,
    presence: [
      {
        participant: { kind: 'player' as const },
        joinedVersion: 1,
        sourceVersion: 1,
        sourceEventId: 'e',
      },
    ],
  };
  assert.throws(() => assertSceneAvailable(scene, 's', true, true));
  assert.throws(() => assertSceneAvailable(scene, undefined, false, true));
  assert.throws(() => assertSceneAvailable(scene, 's', false, false));
  assert.doesNotThrow(() => assertSceneAvailable(scene, 's', false, true));
  const entries = [
    {
      id: 'x',
      ownerId: 'o',
      worldId: 'w',
      sceneId: 's',
      sourceEventId: 'e',
      sourceVersion: 1,
      observableTo: [{ kind: 'player' as const }],
      kind: 'narration' as const,
      text: '玩家看到',
      perspective: 'observable' as const,
    },
  ];
  assert.equal(sceneContextEntries(entries, { kind: 'actor', actorId: 'a' }).length, 0);
});

test('a deferred action stops at the unanswered decision rather than executing the conditional clause', () => {
  const input = '我问小林哪一侧更自然，等他回答后，再把灯抬高一点';
  const boundary = sceneAttemptBoundary(input);
  assert.equal(boundary.now, '我问小林哪一侧更自然');
  assert.ok(boundary.deferred);
  assert.equal(assertsDeferredExecution(boundary.deferred!, '并且我调整了灯的位置'), true);
  assert.equal(assertsDeferredExecution(boundary.deferred!, '对方还没有回答'), false);
});
test('the saved player action cannot silently change its performer to an NPC', async () => {
  const { attributesPlayerStepToActor } =
    await import('../src/modules/world/domain/scene-runtime.ts');
  assert.equal(
    attributesPlayerStepToActor('我把花盆放到中间', '小林直接将花盆放到花架上', ['小林']),
    true,
  );
  assert.equal(
    attributesPlayerStepToActor('我问小林哪个角度', '小林询问哪一侧更自然', ['小林']),
    true,
  );
  assert.equal(
    attributesPlayerStepToActor('我问小林哪个角度', '你向小林提出问题，正在等待他的回答', ['小林']),
    false,
  );
});

test('duplicate matter references are rejected before saving an otherwise unreadable action', () => {
  const id = randomUUID();
  assert.equal(
    SceneInputSchema.safeParse({
      commandId: randomUUID(),
      expectedVersion: 1,
      text: 'test',
      relatedMatterIds: [id, id],
    }).success,
    false,
  );
});
