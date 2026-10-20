import test from 'node:test';
import assert from 'node:assert/strict';
import { projectChatMediaMessages } from '../src/modules/world/domain/chat-media-projection.ts';
import type { Message, MediaRequest } from '../src/modules/world/domain/types.ts';
const messages: Message[] = [
  {
    id: 'u',
    actorId: 'a',
    role: 'user',
    text: '给我一张自拍',
    at: '2026-01-01T00:00:00Z',
    sourceEventId: 'e',
  },
  {
    id: 'a1',
    actorId: 'a',
    role: 'assistant',
    text: '等我整理一下头发。',
    at: '2026-01-01T00:00:00Z',
    sourceEventId: 'e',
  },
  {
    id: 'a2',
    actorId: 'a',
    role: 'assistant',
    text: '刚才风太大了。',
    at: '2026-01-01T00:00:00Z',
    sourceEventId: 'e',
  },
];
const request: MediaRequest = {
  id: 'r',
  sourceEventId: 'e',
  targetActorId: 'a',
  prompt: '肖像',
  status: 'pending',
};
const project = (m: Message) => ({ ...m });
test('pending task preserves ordinary text, ready produces exactly one separate image with stable identity', () => {
  const pending = projectChatMediaMessages(messages, [request], project);
  assert.equal(pending.length, 3);
  assert.equal(pending.filter((m) => m.mediaStatus === 'pending').length, 1);
  assert.equal(pending[2]!.text, messages[2]!.text);
  const ready = projectChatMediaMessages(
    messages,
    [{ ...request, status: 'ready', assetId: 'asset' }],
    project,
  );
  assert.deepEqual(ready.slice(0, 3), messages);
  assert.equal(ready[3]!.id, 'media_r');
  assert.equal(ready[3]!.text, '');
  assert.equal(ready[3]!.photoId, 'asset');
  assert.deepEqual(
    projectChatMediaMessages(
      messages,
      [{ ...request, status: 'ready', assetId: 'asset' }],
      project,
    ),
    ready,
  );
});
test('unknown does not invent an image; failed stays truthful; denied delivery and other actor never attach', () => {
  for (const status of ['unknown', 'failed'] as const) {
    const output = projectChatMediaMessages(messages, [{ ...request, status }], project);
    assert.equal(output.length, 3);
    assert.equal(
      output.some((m) => m.photoId),
      false,
    );
  }
  for (const extra of [
    { targetActorId: 'b' },
    { deliveryDecision: { deliverToChat: false, deliverToAlbum: true } },
  ]) {
    assert.deepEqual(
      projectChatMediaMessages(
        messages,
        [{ ...request, ...extra, status: 'ready', assetId: 'asset' }],
        project,
      ),
      messages,
    );
  }
});
