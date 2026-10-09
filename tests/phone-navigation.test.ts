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
  for (const panel of ['schedule', 'timeline', 'time', 'management'] as const) {
    const route = { app: 'messages' as const, target: 'record-24', panel };
    assert.deepEqual(readRoute(routeHash('life', route), 'life'), route);
    assert.deepEqual(parentRoute(route), { app: 'messages', target: 'record-24' });
  }
  assert.deepEqual(parentRoute({ app: null, panel: 'time' }), { app: null });
});

test('desktop exposes shared apps plus an independent scene entrance', async () => {
  const { desktopApps } = await import('../src/features/phone/navigation.ts');
  assert.deepEqual(desktopApps, ['messages', 'calendar', 'photos', 'notes', 'scenes']);
});

test('new notification ids arrive once while reordered or repeated ids do not replay', async () => {
  const { arrivingIds } = await import('../src/features/phone/notification-state.ts');
  assert.deepEqual(arrivingIds(new Set(['old']), ['old', 'new', 'new']), ['new']);
  assert.deepEqual(arrivingIds(new Set(['a', 'b']), ['b', 'a']), []);
  assert.deepEqual(arrivingIds(new Set(), []), []);
});
test('unlock gesture accepts upward intent and rejects taps, downward and invalid gestures', async () => {
  const { isUnlockSwipe } = await import('../src/features/phone/notification-state.ts');
  assert.equal(isUnlockSwipe(400, 340), true);
  assert.equal(isUnlockSwipe(400, 380), false);
  assert.equal(isUnlockSwipe(400, 500), false);
  assert.equal(isUnlockSwipe(NaN, 0), false);
});

test('old director links open time management and scene links retain their saved ID', () => {
  assert.deepEqual(readRoute('#life=life&panel=director', 'life'), { app: null, panel: 'time' });
  const route = { app: null, panel: 'scene' as const, target: 'scene-id' };
  assert.deepEqual(readRoute(routeHash('life', route), 'life'), route);
  assert.deepEqual(parentRoute(route), { app: 'scenes' });
});
