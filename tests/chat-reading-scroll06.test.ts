import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyChatReadingPosition,
  restoreVisibleChatPosition,
  captureVisibleChatPosition,
  chatIsAtLatest,
  type ChatReadingMetrics,
} from '../src/features/phone/apps/chat-reading-scroll.ts';
const scope = 'world-a:actor-a';
const visible = (scrollTop = 0, scrollHeight = 1500, clientHeight = 500): ChatReadingMetrics => ({
  scrollTop,
  scrollHeight,
  clientHeight,
  documentVisible: true,
});

test('lockscreen-mounted zero-height chat does not initialize saved position or override first visible bottom', () => {
  const initial = emptyChatReadingPosition(scope);
  const hidden = restoreVisibleChatPosition(
    initial,
    scope,
    { ...visible(), clientHeight: 0 },
    undefined,
  );
  assert.equal(hidden.scrollTo, null);
  assert.equal(hidden.position.initialized, false);
  const unlocked = restoreVisibleChatPosition(hidden.position, scope, visible(), undefined);
  assert.equal(unlocked.scrollTo, 1000);
  assert.equal(unlocked.position.nearBottom, true);
});

test('valid saved reading positions initialize only on actual visibility; corrupt values fall back to latest', () => {
  for (const bad of ['NaN', 'Infinity', '-1', '', 'not-a-number']) {
    const restored = restoreVisibleChatPosition(
      emptyChatReadingPosition(scope),
      scope,
      visible(),
      bad,
    );
    assert.equal(restored.scrollTo, 1000);
  }
  const hidden = restoreVisibleChatPosition(
    emptyChatReadingPosition(scope),
    scope,
    { ...visible(), clientHeight: 0 },
    '240',
  );
  const shown = restoreVisibleChatPosition(hidden.position, scope, visible(), '240');
  assert.equal(shown.scrollTo, 240);
  assert.equal(shown.position.nearBottom, false);
  assert.equal(
    restoreVisibleChatPosition(emptyChatReadingPosition(scope), scope, visible(), '0').scrollTo,
    0,
  );
});

test('returning from hidden at latest follows new messages; historical reading remains at its last actual position', () => {
  const latest = restoreVisibleChatPosition(
    emptyChatReadingPosition(scope),
    scope,
    visible(),
    undefined,
  ).position;
  const hiddenLatest = restoreVisibleChatPosition(
    latest,
    scope,
    { ...visible(), clientHeight: 0 },
    undefined,
  ).position;
  assert.equal(
    restoreVisibleChatPosition(hiddenLatest, scope, visible(0, 2100), undefined).scrollTo,
    1600,
  );
  const historical = captureVisibleChatPosition(latest, scope, visible(220));
  const hiddenHistory = restoreVisibleChatPosition(
    historical,
    scope,
    { ...visible(0, 2100), clientHeight: 0 },
    undefined,
  ).position;
  assert.equal(hiddenHistory.top, 220);
  assert.equal(
    restoreVisibleChatPosition(hiddenHistory, scope, visible(0, 2100), undefined).scrollTo,
    220,
  );
});

test('profile/list remount restores the same chat but world or actor changes use their own saved position', () => {
  const history = restoreVisibleChatPosition(
    emptyChatReadingPosition(scope),
    scope,
    visible(),
    '240',
  ).position;
  assert.equal(
    restoreVisibleChatPosition({ ...history, visible: false }, scope, visible(), undefined)
      .scrollTo,
    240,
  );
  assert.equal(
    restoreVisibleChatPosition(history, 'world-b:actor-a', visible(), undefined).scrollTo,
    1000,
  );
  assert.equal(
    restoreVisibleChatPosition(history, 'world-a:actor-b', visible(), '120').scrollTo,
    120,
  );
});

test('hidden scroll and background document events cannot overwrite reading intent', () => {
  const history = restoreVisibleChatPosition(
    emptyChatReadingPosition(scope),
    scope,
    visible(),
    '240',
  ).position;
  assert.equal(
    captureVisibleChatPosition(history, scope, { ...visible(), clientHeight: 0 }),
    history,
  );
  assert.equal(
    captureVisibleChatPosition(history, scope, { ...visible(), documentVisible: false }),
    history,
  );
  assert.equal(captureVisibleChatPosition(history, 'other-scope', visible()), history);
});

test('read receipts require actual visible latest messages, not just a visible old history viewport', () => {
  assert.equal(chatIsAtLatest(visible(1000)), true);
  assert.equal(chatIsAtLatest(visible(200)), false);
  assert.equal(chatIsAtLatest({ ...visible(1000), clientHeight: 0 }), false);
  assert.equal(chatIsAtLatest({ ...visible(1000), documentVisible: false }), false);
});

test('keyboard or media resize keeps latest aligned without dragging a historical reader to the end', () => {
  const latest = restoreVisibleChatPosition(
    emptyChatReadingPosition(scope),
    scope,
    visible(),
    undefined,
  ).position;
  assert.equal(
    restoreVisibleChatPosition(latest, scope, visible(1000, 1500, 300), undefined).scrollTo,
    1200,
  );
  const history = captureVisibleChatPosition(latest, scope, visible(240));
  assert.equal(
    restoreVisibleChatPosition(history, scope, visible(240, 1700, 300), undefined).scrollTo,
    null,
  );
});
