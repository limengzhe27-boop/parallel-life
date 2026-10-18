import { trialClockProtocolHeaders } from '../src/server/publisher-trial-request.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  clockResponse,
  WorldClockSchema,
  WORLD_TIME_PROTOCOL_HEADER,
  WORLD_TIME_PROTOCOL,
} from '../src/contracts/world-clock.ts';
import { LifeClient } from '../src/features/api/client.ts';
const clock = {
  storyNow: '2026-10-18T00:00:00.000Z',
  lastTickAt: '2026-10-18T00:00:00.000Z',
  speed: 1,
  paused: false,
  missedBeats: 0,
  summary: null,
  managed: true,
  activeUntil: null,
  continuityMode: 'continuous' as const,
  pauseReason: null,
};
test('clock protocol preserves old strict shape without changing underlying run-state', () => {
  const legacy = clockResponse(clock, false);
  assert(!('continuityMode' in legacy));
  assert(!('pauseReason' in legacy));
  assert.equal(legacy.paused, false);
  assert.equal(legacy.storyNow, clock.storyNow);
  assert.equal(WorldClockSchema.parse(clockResponse(clock, true)).continuityMode, 'continuous');
  assert.equal(clock.continuityMode, 'continuous');
});
test('normal clock read, presence and explicit control negotiate the same protocol without extra requests', async () => {
  const paths: { path: string; headers: Headers }[] = [];
  const client = new LifeClient(async (url, options) => {
    paths.push({ path: String(url), headers: new Headers(options?.headers) });
    return Response.json(
      String(url).endsWith('/session') ? { kind: 'guest', csrfToken: 's'.repeat(32) } : clock,
    );
  });
  const id = randomUUID();
  assert.equal((await client.readWorldClock(id)).continuityMode, 'continuous');
  await client.updateClockActivity(id, { clientId: randomUUID(), sequence: 1, mode: 'away' });
  await client.setWorldClock(id, { paused: true });
  assert.equal(paths.length, 4);
  for (const call of paths.filter((x) => !x.path.endsWith('/session')))
    assert.equal(call.headers.get(WORLD_TIME_PROTOCOL_HEADER), WORLD_TIME_PROTOCOL);
});

test('staff trial proxy forwards only the recognized clock representation, not privileges or arbitrary headers', () => {
  const headers = new Headers({
    [WORLD_TIME_PROTOCOL_HEADER]: WORLD_TIME_PROTOCOL,
    Cookie: 'never forward',
    Authorization: 'never forward',
  });
  assert.deepEqual(trialClockProtocolHeaders(['world', 'clock'], headers), {
    [WORLD_TIME_PROTOCOL_HEADER]: WORLD_TIME_PROTOCOL,
  });
  assert.deepEqual(trialClockProtocolHeaders(['world', 'clock', 'activity'], headers), {
    [WORLD_TIME_PROTOCOL_HEADER]: WORLD_TIME_PROTOCOL,
  });
  assert.deepEqual(trialClockProtocolHeaders(['world', 'messages'], headers), {});
  assert.deepEqual(
    trialClockProtocolHeaders(
      ['world', 'clock'],
      new Headers({ [WORLD_TIME_PROTOCOL_HEADER]: 'unknown' }),
    ),
    {},
  );
});
