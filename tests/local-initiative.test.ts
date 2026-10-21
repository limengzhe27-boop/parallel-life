import test from 'node:test';
import assert from 'node:assert/strict';
import { selectLocalInitiativeActor } from '../src/modules/world/domain/local-initiative.ts';

const at = '2026-10-18T12:00:00.000Z';
test('local initiative waits for global spacing then rotates to the least recent actor', () => {
  assert.equal(
    selectLocalInitiativeActor({
      storyAt: at,
      actors: [{ id: 'a', lastAssistantAt: '2026-10-18T11:59:30.000Z' }],
    }),
    undefined,
  );
  assert.equal(
    selectLocalInitiativeActor({
      storyAt: at,
      actors: [
        { id: 'a', lastAssistantAt: '2026-10-18T11:40:00.000Z' },
        { id: 'b', lastAssistantAt: '2026-10-18T10:00:00.000Z' },
        { id: 'c' },
      ],
    }),
    'c',
  );
  assert.equal(
    selectLocalInitiativeActor({
      storyAt: at,
      actors: [
        { id: 'a', lastAssistantAt: '2026-10-18T11:40:00.000Z' },
        { id: 'b', lastAssistantAt: '2026-10-18T11:00:00.000Z' },
      ],
    }),
    'b',
  );
  assert.equal(
    selectLocalInitiativeActor({
      storyAt: at,
      actors: [{ id: 'a', lastAssistantAt: '2026-10-18T11:50:00.000Z' }],
    }),
    undefined,
  );
});
