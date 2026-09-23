import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyNoteEvent, type NoteEvent } from '../src/modules/world/domain/notes.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';

const world = (overrides: Partial<WorldState> = {}): WorldState => ({
  schemaVersion: 1,
  id: 'w1',
  ownerId: 'o1',
  version: 2,
  title: '世界',
  time: '2026-09-24T00:00:00.000Z',
  actors: [],
  facts: [],
  messages: [],
  appointments: [],
  mediaRequests: [],
  notes: [],
  ...overrides,
});
const event = (data: NoteEvent['data'], version = 3): NoteEvent => ({
  schemaVersion: 1,
  type: 'note.saved',
  id: 'e1',
  worldId: 'w1',
  version,
  commandId: 'c1',
  occurredAt: '2026-09-24T00:10:00.000Z',
  storyTime: '2026-09-24T00:00:00.000Z',
  data,
});

test('saving a new note appends it and advances the world version', () => {
  const next = applyNoteEvent(
    world(),
    event({ commandId: 'c1', worldId: 'w1', id: 'n1', title: '清单', text: '买菜', expectedVersion: 0 }),
  );
  assert.equal(next.version, 3);
  assert.deepEqual(
    next.notes!.map((note) => [note.id, note.title, note.version]),
    [['n1', '清单', 1]],
  );
  assert.equal(next.notes![0]!.sourceEventId, 'e1');
});

test('editing requires the note version and bumps only that note', () => {
  const before = world({
    notes: [
      { id: 'n1', title: '清单', text: '买菜', version: 1, updatedAt: before1(), sourceEventId: 'e0' },
    ],
  });
  const next = applyNoteEvent(
    before,
    event({ commandId: 'c1', worldId: 'w1', id: 'n1', title: '清单', text: '买菜和米', expectedVersion: 1 }),
  );
  assert.equal(next.notes![0]!.text, '买菜和米');
  assert.equal(next.notes![0]!.version, 2);
  assert.throws(
    () =>
      applyNoteEvent(
        before,
        event({ commandId: 'c1', worldId: 'w1', id: 'n1', title: '清单', text: 'x', expectedVersion: 2 }),
      ),
    { code: 'VERSION_CONFLICT' },
  );
});
function before1() {
  return '2026-09-24T00:00:00.000Z';
}

test('bad notes are rejected instead of stored', () => {
  const base = { commandId: 'c1', worldId: 'w1', id: 'n1', expectedVersion: 0 };
  assert.throws(() => applyNoteEvent(world(), event({ ...base, title: '   ', text: '' })), {
    code: 'INVALID_COMMAND',
  });
  assert.throws(
    () => applyNoteEvent(world(), event({ ...base, title: 'x'.repeat(81), text: '' })),
    { code: 'INVALID_COMMAND' },
  );
  assert.throws(
    () => applyNoteEvent(world(), event({ ...base, id: 'bad id!', title: 'ok', text: '' })),
    { code: 'INVALID_COMMAND' },
  );
});

test('the world version must advance by exactly one', () => {
  const data = { commandId: 'c1', worldId: 'w1', id: 'n1', title: 'ok', text: '', expectedVersion: 0 };
  assert.throws(() => applyNoteEvent(world(), event(data, 5)), { code: 'VERSION_CONFLICT' });
  assert.throws(() => applyNoteEvent(world({ id: 'other' }), event(data)), {
    code: 'VERSION_CONFLICT',
  });
});
