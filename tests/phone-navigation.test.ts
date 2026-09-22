import test from 'node:test';
import assert from 'node:assert/strict';
import { readRoute, routeHash, parentRoute, scrollKey } from '../src/features/phone/navigation.ts';

test('phone deep links preserve identifiers without interpreting them as URL parameters', () => {
  const route = { app: 'messages' as const, target: '消息 & /?#', panel: 'schedule' as const };
  assert.deepEqual(readRoute(routeHash('人生 & 2', route), '人生 & 2'), route);
});
test('foreign lives, unknown applications and orphan targets cannot leak into navigation', () => {
  assert.deepEqual(readRoute('#life=other&app=messages&target=private', 'mine'), { app: null });
  assert.deepEqual(readRoute('#life=mine&app=bogus&target=private&panel=bogus', 'mine'), {
    app: null,
  });
  assert.deepEqual(readRoute(`#life=mine&app=messages&target=${'x'.repeat(257)}`, 'mine'), {
    app: 'messages',
  });
});
test('direct links have a deterministic parent and panel closing preserves the selected record', () => {
  const detail = { app: 'messages' as const, target: 'message-24' };
  assert.deepEqual(parentRoute({ ...detail, panel: 'schedule' }), detail);
  assert.deepEqual(parentRoute(detail), { app: 'messages' });
  assert.deepEqual(parentRoute({ app: 'messages' }), { app: null });
});
test('scroll positions are isolated by life, application and record, not by auxiliary panel', () => {
  const route = { app: 'messages' as const };
  assert.equal(scrollKey('one', route), scrollKey('one', { ...route, panel: 'timeline' }));
  assert.notEqual(scrollKey('one', route), scrollKey('two', route));
  assert.notEqual(scrollKey('one', route), scrollKey('one', { app: 'photos' }));
  assert.notEqual(scrollKey('one', route), scrollKey('one', { ...route, target: '24' }));
});

test('phone internal auxiliary pages retain old deep links and return to their app record', () => {
  for (const panel of ['schedule', 'timeline', 'director', 'management'] as const) {
    const route = { app: 'messages' as const, target: 'record-24', panel };
    assert.deepEqual(readRoute(routeHash('life', route), 'life'), route);
    assert.deepEqual(parentRoute(route), { app: 'messages', target: 'record-24' });
  }
  assert.deepEqual(parentRoute({ app: null, panel: 'director' }), { app: null });
});
