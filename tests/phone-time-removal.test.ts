import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activePhoneRoute,
  homeRoute,
  parentRoute,
  readRoute,
  routeHash,
  scrollKey,
} from '../src/features/phone/navigation.ts';

test('retired time and director deep links return home without retaining private targets', () => {
  for (const panel of ['time', 'director']) {
    for (const extra of ['', '&app=messages&target=private', '&app=photos&target=photo']) {
      const next = activePhoneRoute(readRoute(`#life=life&panel=${panel}${extra}`, 'life'));
      assert.deepEqual(next, homeRoute);
      assert.equal(routeHash('life', next), '#life=life');
    }
  }
  assert.deepEqual(
    activePhoneRoute({ app: 'messages', target: 'private', panel: 'time' }),
    homeRoute,
  );
});

test('retired schedule summaries use real calendar without borrowing a chat or photo target', () => {
  for (const extra of ['', '&app=messages&target=private', '&app=photos&target=photo']) {
    const next = activePhoneRoute(readRoute(`#life=life&panel=schedule${extra}`, 'life'));
    assert.deepEqual(next, { app: 'calendar' });
    assert.equal(routeHash('life', next), '#life=life&app=calendar');
    assert.deepEqual(parentRoute(next), homeRoute);
  }
  assert.deepEqual(activePhoneRoute(readRoute('#life=other&panel=schedule', 'life')), homeRoute);
});

test('active app, identity and scene routes retain identifiers, parent and scroll identity', () => {
  for (const route of [
    { app: 'messages' as const, target: '消息 & /?#' },
    { app: 'calendar' as const, target: 'invitation_1' },
    { app: 'notes' as const, target: 'record_1' },
    { app: 'photos' as const, target: 'photo_1' },
    { app: null, panel: 'timeline' as const },
    { app: null, panel: 'scene' as const, target: 'scene_1' },
  ]) {
    const next = activePhoneRoute(readRoute(routeHash('人生 & 2', route), '人生 & 2'));
    assert.deepEqual(next, route);
    assert.deepEqual(parentRoute(next), parentRoute(route));
    assert.equal(scrollKey('人生 & 2', next), scrollKey('人生 & 2', route));
  }
  assert.deepEqual(
    activePhoneRoute(readRoute('#life=life&panel=management&target=private', 'life')),
    {
      app: 'notes',
    },
  );
});
