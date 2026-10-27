import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneEnvironmentScope } from '../src/modules/world/domain/scene-environment-scope.ts';
import { emptySceneModelInput, emptySceneProposal } from '../src/server/empty-scene-environment.ts';
import type { ScenePlanningContext } from '../src/modules/world/application/scene-ports.ts';

const scope = (name: string, description = '', history: string[] = []) =>
  sceneEnvironmentScope({ name, description }, history);

test('a public service setting permits optional anonymous functional exchange, not proof of presence', () => {
  for (const name of ['酒店', '西餐厅', '便利店', '医院门诊大厅']) {
    const s = scope(name);
    assert.equal(s.area, 'public_service');
    assert.equal(s.interaction, 'optional_anonymous_service');
    assert.equal(s.restriction, null);
    assert.equal(
      s.suggestedRoles.length,
      1,
      'role is an alternative category, not an assembled cast',
    );
    assert.equal('presentActorIds' in s, false);
  }
  assert.deepEqual(scope('酒店').suggestedRoles, ['前台工作人员']);
  assert.equal(scope('公园').interaction, 'established_history_only');
});

test('a private room never inherits a public service desk from its building', () => {
  for (const name of ['酒店客房', '医院母亲病房', '刘胜男办公室', '出租屋', '餐厅包间']) {
    const s = scope(name, '楼下酒店大厅有前台，正常营业。');
    assert.equal(s.area, 'private');
    assert.equal(s.interaction, 'established_history_only');
    assert.deepEqual(s.suggestedRoles, []);
    assert.equal(s.restriction, 'private_area');
  }
});

test('closed, abandoned, explicitly empty and unmanned settings do not invent a service person', () => {
  for (const description of [
    '酒店已经打烊。',
    '这是一栋废弃酒店。',
    '无人值守的自助酒店。',
    '尚未营业。',
  ]) {
    const s = scope('酒店', description);
    assert.equal(s.interaction, 'established_history_only');
    assert.deepEqual(s.suggestedRoles, []);
  }
  assert.equal(scope('酒店', '', ['大厅此时没有人。']).restriction, 'explicitly_empty');
  assert.equal(
    scope('酒店', '', ['没有听到回应。']).restriction,
    null,
    'no answer is not proof that the entire public place is empty',
  );
  assert.equal(scope('酒店', '酒店还没打烊。').restriction, null);
});

test('saved public-scene observations can supersede a previous closure without changing private scope', () => {
  assert.equal(scope('酒店', '已打烊', ['前台重新营业。']).restriction, null);
  assert.equal(scope('酒店', '', ['前台正在营业。', '酒店已经打烊。']).restriction, 'not_open');
  assert.equal(scope('酒店客房', '', ['前台重新营业。']).restriction, 'private_area');
});

function context(): ScenePlanningContext {
  return {
    storyAt: '2026-10-27T10:00:00Z',
    world: { space: { places: [{ id: 'hotel', name: '酒店', description: '一层为接待大厅。' }] } },
    scene: { placeId: 'hotel', title: '酒店' },
    action: { text: '我说这里早打烊了，我已经在朋友家', intent: 'attempt', kind: 'speak' },
    entries: [
      {
        kind: 'narration',
        text: '前台工作人员抬起头，示意你说话。',
        observableTo: [{ kind: 'player' }],
      },
      { kind: 'player_action', text: '酒店已经打烊', observableTo: [{ kind: 'player' }] },
      {
        kind: 'narration',
        text: 'PRIVATE_OTHER_ACTOR',
        observableTo: [{ kind: 'actor', actorId: 'other' }],
      },
    ],
  } as unknown as ScenePlanningContext;
}

test('environment input binds actual place, authorized history and scope without private actor data or user-claimed relocation', () => {
  const c = context(),
    before = structuredClone(c),
    input = emptySceneModelInput(c);
  assert.equal(input.place.name, '酒店');
  assert.equal(input.environmentScope.interaction, 'optional_anonymous_service');
  assert.equal(input.visibleHistory.length, 2);
  assert.ok(input.visibleHistory[0]!.text!.includes('前台工作人员'));
  assert.ok(!JSON.stringify(input).includes('PRIVATE_OTHER_ACTOR'));
  assert.deepEqual(c, before);
  const proposal = emptySceneProposal(
    c,
    JSON.stringify({ feedback: '前台问：“您是想咨询入住，还是找人？”' }),
  );
  assert.deepEqual(proposal.presentActorIds, []);
  assert.deepEqual(proposal.dialogues, []);
  assert.deepEqual(proposal.npcActions, []);
  assert.deepEqual(proposal.matterUpdates, []);
  assert.equal(proposal.outcome, 'partial');
  assert.throws(() =>
    emptySceneProposal(c, JSON.stringify({ feedback: '已办理', newActor: '前台' })),
  );
});
