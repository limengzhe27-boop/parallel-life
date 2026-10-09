import test from 'node:test';
import assert from 'node:assert/strict';
import {
  photoDisplayState,
  restoreCaptionIfUntouched,
  shouldSubmitComposerKey,
} from '../src/features/interview/photo-send-state.ts';

test('normal photo upload, save and reply wait are progress rather than errors', () => {
  for (const operation of ['uploading', 'saving', 'sending'] as const) {
    const state = photoDisplayState({
      operation,
      pendingAssetId: 'photo',
      error: '',
      saved: operation === 'sending',
    });
    assert.equal(state?.kind, 'progress');
    assert.equal(state?.actions, false);
  }
  assert.equal(
    photoDisplayState({ operation: 'idle', pendingAssetId: 'photo', error: '', saved: false })
      ?.kind,
    'pending',
  );
  assert.equal(
    photoDisplayState({
      operation: 'idle',
      pendingAssetId: 'photo',
      error: '无法确认',
      saved: false,
    })?.kind,
    'error',
  );
  assert.equal(
    photoDisplayState({ operation: 'idle', pendingAssetId: null, error: '', saved: false }),
    null,
  );
  assert.deepEqual(
    photoDisplayState({
      operation: 'idle',
      pendingAssetId: null,
      error: '',
      info: '已取消发送',
      saved: false,
    }),
    { kind: 'pending', text: '已取消发送', actions: false },
  );
});

test('a later draft is never erased by photo completion or failed upload recovery', () => {
  assert.equal(restoreCaptionIfUntouched('', '这是朋友周禾的照片'), '这是朋友周禾的照片');
  assert.equal(
    restoreCaptionIfUntouched('下一条我想说的话', '这是朋友周禾的照片'),
    '下一条我想说的话',
  );
});

test('IME confirmation and Shift Enter do not submit; plain Enter does', () => {
  assert.equal(
    shouldSubmitComposerKey({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13 }),
    true,
  );
  assert.equal(
    shouldSubmitComposerKey({ key: 'Enter', shiftKey: true, isComposing: false, keyCode: 13 }),
    false,
  );
  assert.equal(
    shouldSubmitComposerKey({ key: 'Enter', shiftKey: false, isComposing: true, keyCode: 13 }),
    false,
  );
  assert.equal(
    shouldSubmitComposerKey({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 229 }),
    false,
  );
});
