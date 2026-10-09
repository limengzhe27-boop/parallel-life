import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  explicitPhotoPeople,
  groundPersonProposal,
  resolvePhotoReference,
} from '../src/modules/profile/application/person-extraction.ts';
import {
  capturePhotoComposition,
  capturePhotoSubmission,
  savedPhotoPersonLabel,
} from '../src/features/interview/photo-share.ts';
let tick = 0;
const message = (text: string, photoAssetId: string | null = null) => ({
  id: randomUUID(),
  text,
  photoAssetId,
  createdAt: new Date(Date.UTC(2026, 9, 9, 0, 0, tick++)).toISOString(),
});

test('two consecutive photos keep their group through separate complete name captions', () => {
  const a = message('我分享了一张照片。', randomUUID()),
    b = message('我分享了一张照片。', randomUUID()),
    first = message('第一张是小芳'),
    second = message('第二张是王大毛');
  assert.equal(resolvePhotoReference(first, [a, b], first.text, '小芳')?.id, a.id);
  assert.equal(resolvePhotoReference(second, [a, b, first], second.text, '王大毛')?.id, b.id);
  const p = explicitPhotoPeople(second.text, second.id)[0]!;
  assert.equal(groundPersonProposal(p, second.text, [], true)?.photoLabel, true);
});

test('direct this/this photo identifies the immediately preceding single upload despite old groups', () => {
  const old = message('旧图', randomUUID()),
    other = message('现在聊工作'),
    latest = message('照片', randomUUID());
  for (const text of ['这是小芳的照片', '这张是小芳', '这张照片是小芳']) {
    const source = message(text),
      p = explicitPhotoPeople(text, source.id)[0]!;
    assert.equal(
      resolvePhotoReference(source, [old, other, latest], p.quote, p.subject)?.id,
      latest.id,
    );
  }
  const afterTopic = message('还是先聊工作');
  const after = message('这是小芳的照片');
  assert.equal(
    resolvePhotoReference(after, [old, other, latest, afterTopic], after.text, '小芳'),
    null,
  );
  const source = message('第一张是小芳');
  assert.equal(resolvePhotoReference(source, [old, other, latest], source.text, '小芳'), null);
});

test('an explicit latest-group caption can continue its group across another older group', () => {
  const old = message('旧图', randomUUID()),
    other = message('聊别的'),
    a = message('照片', randomUUID()),
    b = message('照片', randomUUID()),
    first = message('刚才第一张是小芳'),
    second = message('第二张是王大毛');
  assert.equal(
    resolvePhotoReference(second, [old, other, a, b, first], second.text, '王大毛')?.id,
    b.id,
  );
  const ambiguous = message('第一张是小芳');
  assert.equal(
    resolvePhotoReference(second, [old, other, a, b, ambiguous], second.text, '王大毛'),
    null,
  );
});

test('ordinary conversation, mixed captions and uncertain or conflicting labels break continuation', () => {
  const a = message('照片', randomUUID()),
    b = message('照片', randomUUID()),
    source = message('第二张是王大毛');
  for (const text of [
    '先聊工作',
    '昨天他们说第一张是小芳',
    '第一张是小芳，先聊工作',
    '第一张可能是小芳',
    '不是刚才那组，第一张是小芳',
    '他说“第一张是小芳”',
    '第一张是小芳，两个人同名',
  ]) {
    assert.equal(
      resolvePhotoReference(
        { ...source, createdAt: '2026-10-10T00:00:00.000Z' },
        [a, b, message(text)],
        source.text,
        '王大毛',
      ),
      null,
      text,
    );
  }
  assert.equal(
    resolvePhotoReference(
      { ...source, createdAt: '2026-10-10T00:00:00.000Z' },
      [a, b, message('第一张是小芳'), message('第一张是小红')],
      source.text,
      '王大毛',
    ),
    null,
  );
});

test('a recent multi-photo group needs an ordinal; attached caption binds only its own upload', () => {
  const a = message('照片', randomUUID()),
    b = message('照片', randomUUID()),
    source = message('这是小芳的照片');
  assert.equal(resolvePhotoReference(source, [a, b], source.text, '小芳'), null);
  const attached = message('这是小芳的照片', randomUUID());
  assert.equal(resolvePhotoReference(attached, [a, b], attached.text, '小芳')?.id, attached.id);
  const moved = message('这是小芳的照片');
  assert.equal(
    resolvePhotoReference(moved, [a, b, message('我们聊工作')], moved.text, '小芳'),
    null,
  );
});

test('negative current caption, out of range ordinal and duplicate assets cannot be repaired by continuation', () => {
  const a = message('照片', randomUUID()),
    b = message('照片', randomUUID()),
    first = message('第一张是小芳');
  for (const text of ['不是刚才那组，第二张是王大毛', '之前那组第二张是王大毛', '第六张是王大毛'])
    assert.equal(resolvePhotoReference(message(text), [a, b, first], text, '王大毛'), null);
  const source = message('第二张是王大毛');
  assert.equal(
    resolvePhotoReference(
      source,
      [a, { ...b, photoAssetId: a.photoAssetId }, first],
      source.text,
      '王大毛',
    ),
    null,
  );
});

test('photo composition captures the clicked caption and allows an empty caption without network effects', () => {
  const file = { size: 1024, type: 'image/png' };
  let nextDraft = '  这是小芳  ';
  const composed = capturePhotoComposition(file, nextDraft);
  nextDraft = '下一条草稿';
  assert.equal(composed.file, file);
  assert.equal(composed.caption, '这是小芳');
  assert.equal(nextDraft, '下一条草稿');
  assert.equal(capturePhotoComposition(file, '').caption, '');
  assert.throws(() =>
    capturePhotoComposition({ size: 5 * 1024 * 1024, type: 'image/png' }, '说明'),
  );
  assert.throws(() => capturePhotoComposition({ size: 100, type: 'application/pdf' }, '说明'));
});

test('completion label requires one saved photo binding, never provisional messages or guessed names', () => {
  const asset = randomUUID(),
    saved = { id: randomUUID(), role: 'user' as const, text: '这是小芳', photoAssetId: asset },
    people = [{ name: '小芳', assetId: asset }];
  assert.equal(savedPhotoPersonLabel(saved, people), '小芳');
  assert.equal(savedPhotoPersonLabel({ ...saved, id: 'temp-' + randomUUID() }, people), null);
  assert.equal(savedPhotoPersonLabel(saved, []), null);
  assert.equal(
    savedPhotoPersonLabel(saved, [...people, { name: '同名的人', assetId: asset }]),
    null,
  );
  assert.equal(savedPhotoPersonLabel(saved, [{ name: '小芳', assetId: randomUUID() }]), null);
  assert.equal(savedPhotoPersonLabel({ ...saved, role: 'assistant' }, people), null);
});

test('repeated grounded captions preserve the group without recursive history expansion', () => {
  const a = message('照片', randomUUID()),
    b = message('照片', randomUUID());
  const history = [a, b, ...Array.from({ length: 30 }, () => message('第一张是小芳'))];
  const current = message('第二张是王大毛');
  assert.equal(resolvePhotoReference(current, history, current.text, '王大毛')?.id, b.id);
  const conflict = message('第一张是小红');
  assert.equal(resolvePhotoReference(conflict, history, conflict.text, '小红'), null);
});

test('unpunctuated questions, negated instructions and reported words cannot assert photo identity, including clipped model quotes', () => {
  const image = message('照片', randomUUID());
  for (const [text, quote] of [
    ['这是小芳的照片吗', '这是小芳的照片'],
    ['这张是小芳吗', '这张是小芳'],
    ['别把这张说成小芳', '这张说成小芳'],
    ['不要说这张是小芳', '这张是小芳'],
    ['他说这是小芳的照片', '这是小芳的照片'],
  ] as const) {
    const source = message(text);
    assert.deepEqual(explicitPhotoPeople(text, source.id), [], text);
    assert.equal(resolvePhotoReference(source, [image], text, '小芳'), null, text);
    assert.equal(
      groundPersonProposal(
        { subject: '小芳', messageId: source.id, quote, associatePhoto: true },
        text,
        [],
      ),
      null,
      text,
    );
  }
  for (const text of [
    '这是小芳的照片',
    '这张是小芳',
    '第一张是小芳',
    '故事里第一张是小芳',
    '刚才第一张是小芳',
  ]) {
    const source = message(text),
      proposal = explicitPhotoPeople(text, source.id)[0]!;
    assert(proposal, text);
    assert(groundPersonProposal(proposal, text, [], true), text);
    assert.equal(
      resolvePhotoReference(source, [image], proposal.quote, proposal.subject)?.id,
      image.id,
      text,
    );
  }
});

test('a failed pre-upload composition retries its original caption and keeps later drafts separate', () => {
  const file = { size: 100, type: 'image/png' };
  const failed = capturePhotoComposition(file, '这是小芳');
  const retry = capturePhotoSubmission(file, '下一条独立草稿', failed);
  assert.equal(retry.file, file);
  assert.equal(retry.caption, '这是小芳');
  assert.equal(retry.clearDraft, false);
  assert.equal(capturePhotoSubmission(file, '这是小芳', failed).clearDraft, true);
  const replaced = { size: 100, type: 'image/png' };
  const fresh = capturePhotoSubmission(replaced, '新的照片说明', failed);
  assert.equal(fresh.caption, '新的照片说明');
  assert.equal(fresh.clearDraft, true);
  assert.equal(
    capturePhotoSubmission(file, '用户明确开始的新组合', null).caption,
    '用户明确开始的新组合',
  );
});
