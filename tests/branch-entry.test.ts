import { test } from 'node:test';
import assert from 'node:assert/strict';
import { branchEntryState, branchMaterialBrief } from '../src/features/interview/branch-entry.ts';

const base = {
  ready: true,
  hasReadyWorld: false,
  confirmedCount: 0,
  pendingCandidates: 0,
  directionCount: 0,
};

test('the branch entry never appears before the assistant has replied', () => {
  assert.deepEqual(branchEntryState({ ...base, ready: false, pendingCandidates: 3 }), {
    kind: 'hidden',
  });
});

test('an existing world can be reopened even without freshly confirmed records', () => {
  assert.deepEqual(branchEntryState({ ...base, hasReadyWorld: true }), { kind: 'open-ready' });
});

test('no confirmed material never calls the model: pending records are confirmed first', () => {
  assert.deepEqual(branchEntryState({ ...base, pendingCandidates: 5 }), {
    kind: 'confirm-records',
    pending: 5,
  });
  assert.deepEqual(branchEntryState({ ...base, pendingCandidates: 0 }), { kind: 'needs-material' });
});

test('confirmed material offers generation, and reports how many directions already exist', () => {
  assert.deepEqual(branchEntryState({ ...base, confirmedCount: 1 }), {
    kind: 'create',
    directionCount: 0,
  });
  assert.deepEqual(branchEntryState({ ...base, confirmedCount: 3, directionCount: 3 }), {
    kind: 'create',
    directionCount: 3,
  });
});

test('the entry is offered before confirmation is possible only through a ready world', () => {
  const states = [
    branchEntryState({ ...base, pendingCandidates: 2 }),
    branchEntryState(base),
    branchEntryState({ ...base, confirmedCount: 2 }),
    branchEntryState({ ...base, hasReadyWorld: true }),
  ];
  assert.deepEqual(
    states.map((state) => state.kind),
    ['confirm-records', 'needs-material', 'create', 'open-ready'],
  );
});

test('a user with confirmed material can still create new branches even if an existing world exists', () => {
  assert.deepEqual(branchEntryState({ ...base, confirmedCount: 2, hasReadyWorld: true }), {
    kind: 'create',
    directionCount: 0,
  });
});

test('a concrete wish in user words opens review despite pending profile records', () => {
  const messages = [
    { role: 'assistant', text: '我为你安排一家海边书店。' },
    { role: 'user', text: '我想在老街开一家二手书店，每周末和朋友办读书小聚。' },
  ];
  const brief = branchMaterialBrief(messages);
  assert.equal(brief, messages[1]!.text);
  assert.deepEqual(
    branchEntryState({ ...base, pendingCandidates: 4, hasUserMaterial: Boolean(brief) }),
    { kind: 'create', directionCount: 0 },
  );
});

test('assistant invention, a bare photo, fatigue and explicit negation do not become branch material', () => {
  assert.equal(branchMaterialBrief([{ role: 'assistant', text: '我想让你去开咖啡馆。' }]), '');
  assert.equal(
    branchMaterialBrief([
      { role: 'user', text: '我分享了一张照片。', photoAssetId: crypto.randomUUID() },
    ]),
    '',
  );
  assert.equal(branchMaterialBrief([{ role: 'user', text: '我想休息，今天太累了。' }]), '');
  assert.equal(branchMaterialBrief([{ role: 'user', text: '我不想去开店，先不要创建分支。' }]), '');
  assert.deepEqual(branchEntryState({ ...base, pendingCandidates: 1 }), {
    kind: 'confirm-records',
    pending: 1,
  });
});

test('a hypothetical concrete life remains user material but never authorizes automatic creation', () => {
  assert.equal(
    branchMaterialBrief([{ role: 'user', text: '如果我搬去杭州经营一家花店，会过怎样的生活？' }]),
    '如果我搬去杭州经营一家花店，会过怎样的生活？',
  );
});

test('the actual alternate-schooling phrasing survives as user-authored material', () => {
  const original = '我总是在想，如果当时我没有去上学，而是…当古惑仔…';
  assert.equal(branchMaterialBrief([{ role: 'user', text: original }]), original);
});

test('negating the current job can still introduce a positive future', () => {
  const original = '我不想再上班，想成为摄影师';
  assert.equal(branchMaterialBrief([{ role: 'user', text: original }]), original);
});

test('a caption can carry a concrete wish without inferring anything from photo pixels', () => {
  const original = '这是阿越的照片，我想和她办影展。';
  assert.equal(
    branchMaterialBrief([{ role: 'user', text: original, photoAssetId: crypto.randomUUID() }]),
    original,
  );
});

test('full original story and later photo names survive unrelated fatigue', () => {
  const story =
    '我总是在想，如果当时我没有去上学，而是当古惑仔。' +
    '我希望慢慢体验街坊的人际变化。'.repeat(9) +
    '人物是小芳和王大毛。';
  const brief = branchMaterialBrief([
    { role: 'user', text: story },
    { role: 'user', text: '我分享了一张照片。' },
    { role: 'user', text: '第一张是小芳，第二张是王大毛' },
    { role: 'user', text: '现实太累，想休息一会儿。' },
  ]);
  assert(brief.includes(story));
  assert(brief.includes('第一张是小芳，第二张是王大毛'));
  assert(!brief.includes('想休息'));
});

test('cancelling creation clears the earlier branch material', () => {
  assert.equal(
    branchMaterialBrief([
      { role: 'user', text: '我想在杭州开一家花店' },
      { role: 'user', text: '先不要创建分支' },
    ]),
    '',
  );
});
