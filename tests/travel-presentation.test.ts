import test from 'node:test';
import assert from 'node:assert/strict';
import {
  travelPresentation,
  type TravelArrival,
} from '../src/features/phone/map/travel-presentation.ts';

const arrival: TravelArrival = {
  fromLabel: '摄影棚',
  destinationLabel: '医院',
  durationMinutes: 30,
  arrivedAtLabel: '10月10日 17:55',
};

test('a pending request is not proof of departure, elapsed travel or arrival', () => {
  const view = travelPresentation({ status: 'pending', destinationLabel: '医院' });
  assert.equal(view?.action, null);
  assert.equal(view?.arrivedAtLabel, undefined);
  assert.doesNotMatch(JSON.stringify(view), /已到达|过去了|17:55|30 分钟/);
});

test('unknown only offers checking the original journey, never a fresh retry', () => {
  const view = travelPresentation({ status: 'unknown', destinationLabel: '医院' });
  assert.equal(view?.action, 'check');
  assert.equal(view?.arrivedAtLabel, undefined);
  assert.doesNotMatch(JSON.stringify(view), /已到达|过去了/);
});

test('failure has local retry feedback without invented unchanged clock or arrived state', () => {
  const view = travelPresentation({
    status: 'failed',
    destinationLabel: '医院',
    message: '当前有其他事情正在处理，请稍后再试。',
  });
  assert.equal(view?.action, 'retry');
  assert.equal(view?.description, '当前有其他事情正在处理，请稍后再试。');
  assert.doesNotMatch(JSON.stringify(view), /已到达|过去了|时间没有变化/);
});

test('only a verified committed receipt displays the actual route and story duration', () => {
  const view = travelPresentation({ status: 'committed', arrival });
  assert.equal(view?.title, '已到达医院');
  assert.equal(view?.description, '过去了 30 分钟。');
  assert.equal(view?.fromLabel, '摄影棚');
  assert.equal(view?.arrivedAtLabel, '10月10日 17:55');
  assert.equal(view?.action, 'continue');
});

test('missing or corrupt arrival metadata cannot render a believable fake journey', () => {
  for (const patch of [
    { destinationLabel: ' ' },
    { arrivedAtLabel: '' },
    { durationMinutes: -1 },
    { durationMinutes: NaN },
    { durationMinutes: Infinity },
    { durationMinutes: 1.25 },
  ]) {
    const view = travelPresentation({ status: 'committed', arrival: { ...arrival, ...patch } });
    assert.equal(view?.status, 'unknown');
    assert.equal(view?.action, 'check');
    assert.equal(view?.arrivedAtLabel, undefined);
    assert.doesNotMatch(view?.title || '', /已到达/);
  }
});

test('zero duration is faithfully shown without claiming minutes have passed', () => {
  const view = travelPresentation({
    status: 'committed',
    arrival: { ...arrival, durationMinutes: 0 },
  });
  assert.equal(view?.description, '位置已更新。');
  assert.doesNotMatch(view?.description || '', /过去/);
  assert.equal(travelPresentation({ status: 'idle' }), null);
});
