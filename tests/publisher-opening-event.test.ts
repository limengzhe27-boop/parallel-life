import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addOpeningEvent,
  chooseOpeningEvent,
  clearOpeningEvent,
  patchOpeningEvent,
  selectedOpeningEvent,
} from '../src/features/publisher/publisher-opening-event.ts';
import { deletePlotRow, plotRecord } from '../src/features/publisher/publisher-plot-model.ts';
const event = (key: string, kind = 'director_event') => ({
  key,
  kind: 'candidate',
  title: key,
  editorialIntent: '作者原文',
  actorKeys: ['a'],
  prerequisites: [],
  mutuallyExclusiveNodeKeys: [],
  intent: { kind, actorKey: 'a' },
  custom: { kept: false },
});
test('selection binds the existing director event and clearing keeps all authored content', () => {
  const content = {
    candidates: [event('first'), event('second')],
    unknown: { kept: 0 },
    phone: { messages: ['原稿'] },
  };
  const before = structuredClone(content);
  const chosen = chooseOpeningEvent(content, 'second');
  assert.equal(selectedOpeningEvent(chosen)?.key, 'second');
  assert.deepEqual(chosen.candidates, content.candidates);
  assert.deepEqual(clearOpeningEvent(chosen), content);
  assert.deepEqual(content, before);
});
test('one explicit add creates a real incomplete director event with no guessed person, dates or opening text', () => {
  const old = { candidates: [event('node_1')], world: { private: '保留' } };
  const added = addOpeningEvent(old);
  assert.equal((added.candidates as unknown[]).length, 2);
  const opening = selectedOpeningEvent(added)!;
  assert.equal(opening.key, 'node_2');
  assert.deepEqual(opening.intent, { kind: 'director_event', actorKey: '' });
  assert.equal(opening.editorialIntent, '');
  assert.deepEqual(opening.actorKeys, []);
  assert.deepEqual(added.world, old.world);
  assert.throws(() => addOpeningEvent(added), { code: 'OPENING_EVENT_ALREADY_SELECTED' });
});
test('editing opening updates the same candidate; unrelated unknown data and references remain exact', () => {
  const c = chooseOpeningEvent(
    { candidates: [event('first'), event('second')], custom: [false, 0, null] },
    'first',
  );
  const next = patchOpeningEvent(c, 'editorialIntent', '雨夜你刚到家，门外有人敲门。');
  assert.equal(
    plotRecord((next.candidates as unknown[])[0]).editorialIntent,
    '雨夜你刚到家，门外有人敲门。',
  );
  assert.deepEqual((next.candidates as unknown[])[1], (c.candidates as unknown[])[1]);
  assert.deepEqual(next.custom, c.custom);
  assert.equal(next.openingEventKey, 'first');
});
test('unresolved, duplicate or non-director references cannot be silently selected and bound events cannot be deleted', () => {
  assert.throws(
    () => chooseOpeningEvent({ candidates: [event('first', 'offer_message')] }, 'first'),
    { code: 'INVALID_OPENING_EVENT' },
  );
  assert.throws(
    () => chooseOpeningEvent({ candidates: [event('first'), event('first')] }, 'first'),
    { code: 'INVALID_OPENING_EVENT' },
  );
  assert.throws(
    () =>
      chooseOpeningEvent(
        { openingEventKey: { future: true }, candidates: [event('first')] },
        'first',
      ),
    { code: 'MALFORMED_BRANCH' },
  );
  const c = chooseOpeningEvent({ candidates: [event('first')] }, 'first');
  assert.throws(() => deletePlotRow(c, 'candidates', 'first'), { code: 'REFERENCED' });
  assert.equal(
    (deletePlotRow(clearOpeningEvent(c), 'candidates', 'first').candidates as unknown[]).length,
    0,
  );
});

test('opaque future opening text is preserved until the author resolves its format', () => {
  const c = chooseOpeningEvent(
    { candidates: [{ ...event('first'), editorialIntent: { future: '原稿' } }] },
    'first',
  );
  assert.throws(() => patchOpeningEvent(c, 'editorialIntent', '覆写'), {
    code: 'MALFORMED_BRANCH',
  });
  assert.deepEqual(selectedOpeningEvent(c)?.editorialIntent, { future: '原稿' });
});
