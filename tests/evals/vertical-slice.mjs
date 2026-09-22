// Explicit paid check against the running local Web + Worker. Not part of npm test.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const storageOnly = process.argv.includes('--storage-only');
if (!storageOnly && !process.argv.includes('--live'))
  throw Error('Pass --live to authorize two real model calls with synthetic data.');
const origin = process.env.EVAL_ORIGIN ?? 'http://127.0.0.1:3218';
assert.equal(
  new URL(origin).hostname,
  '127.0.0.1',
  'This evaluator only targets the isolated local instance.',
);

async function guest() {
  const response = await fetch(`${origin}/api/v1/session`, {
    method: 'POST',
    headers: { Origin: origin },
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  const { csrfToken } = await response.json();
  assert.ok(cookie && csrfToken);
  return async (path, options = {}, status = 200) => {
    const headers = new Headers(options.headers);
    headers.set('Cookie', cookie);
    headers.set('Origin', origin);
    if (!headers.has('X-CSRF-Token')) headers.set('X-CSRF-Token', csrfToken);
    if (options.body && !(options.body instanceof FormData))
      headers.set('Content-Type', 'application/json');
    const response = await fetch(`${origin}/api/v1${path}`, {
      ...options,
      headers,
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.status, status, `${path} returned ${response.status}`);
    return response.headers.get('content-type')?.includes('application/json')
      ? response.json()
      : response.arrayBuffer();
  };
}

const first = await guest(),
  second = await guest();
const results = [];
for (const [request, text, relevant, excluded] of [
  [
    first,
    '我叫小林，在杭州做产品设计，喜欢摄影。2022年换工作时有些迷茫，最近希望去海边住一段时间。',
    /摄影|海边/,
    /修自行车|维修店/,
  ],
  [
    second,
    '我叫阿远，在西安修自行车，喜欢机械和修复老物件。我不喜欢旅行，也不想拍电影，最大的愿望是开一家自己的自行车维修店。',
    /自行车|维修|修复/,
    /小林|杭州|去海边住/,
  ],
].filter(() => !storageOnly)) {
  const before = await request('/interview');
  const command = { commandId: randomUUID(), expectedVersion: before.interview.version, text };
  const started = Date.now();
  const sent = await request(
    '/interview/messages',
    { method: 'POST', body: JSON.stringify(command) },
    202,
  );
  const duplicate = await request(
    '/interview/messages',
    { method: 'POST', body: JSON.stringify(command) },
    202,
  );
  assert.equal(
    duplicate.task.id,
    sent.task.id,
    'A duplicate request must not enqueue another paid task.',
  );
  let task = sent.task;
  while (['queued', 'running'].includes(task.status) && Date.now() - started < 110000) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    task = await request(`/tasks/${task.id}`);
  }
  assert.equal(task.status, 'succeeded', 'Live model task must finish; no simulated success.');
  const restored = await request('/interview');
  assert.equal(restored.interview.messages.length, 2);
  assert.match(restored.profile.facts.map((f) => f.value).join(' '), relevant);
  assert.doesNotMatch(JSON.stringify(restored.profile), excluded);
  for (const fact of restored.profile.facts) {
    assert.equal(fact.status, 'suggested');
    assert.ok(fact.sourceMessageIds.includes(restored.interview.messages[0].id));
  }
  assert.ok(restored.profile.events.every((event) => event.feeling === null));
  const other = request === first ? second : first;
  await other(`/tasks/${task.id}`, {}, 404);
  results.push({
    durationMs: Date.now() - started,
    facts: restored.profile.facts.map((f) => f.value),
    reply: restored.interview.messages[1].text,
  });
  console.log({ case: results.length, status: task.status, durationMs: results.at(-1).durationMs });
}

const bytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#10263a' } })
  .png()
  .toBuffer();
const form = new FormData();
form.set('image', new File([bytes], 'synthetic.png', { type: 'image/png' }));
const asset = await first('/assets/uploads', { method: 'POST', body: form }, 201);
assert.ok((await first(`/assets/${asset.id}`)).byteLength > 0);
await second(`/assets/${asset.id}`, {}, 404);
const profile = (await first('/interview')).profile;
const operation = { kind: 'set-portrait', assetId: asset.id };
const edited = await first('/profile', {
  method: 'PATCH',
  body: JSON.stringify({ expectedVersion: profile.version, operation }),
});
assert.equal((await first('/interview')).profile.portraitAssetId, asset.id);
await first(
  '/profile',
  { method: 'PATCH', body: JSON.stringify({ expectedVersion: profile.version, operation }) },
  409,
);
await first(
  '/profile',
  {
    method: 'PATCH',
    headers: { 'X-CSRF-Token': 'invalid-test-token' },
    body: JSON.stringify({ expectedVersion: edited.version, operation }),
  },
  401,
);
await first(`/assets/${asset.id}`, { method: 'DELETE' }, 204);
assert.equal((await first('/interview')).profile.portraitAssetId, null);
await first(`/assets/${asset.id}`, {}, 404);

await mkdir('.local', { recursive: true });
await writeFile(
  `.local/vertical-slice-${storageOnly ? 'storage' : 'live'}.json`,
  JSON.stringify(
    {
      at: new Date().toISOString(),
      results,
      checks: [
        ...(storageOnly ? [] : ['personalized profiles', 'idempotency']),
        'restore',
        'private upload/read/delete',
        'cross-guest isolation',
        'version conflict',
        'CSRF',
      ],
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(
  `V-01 ${storageOnly ? 'storage-only' : 'live'} HTTP checks passed. Results saved locally; no credentials logged.`,
);
