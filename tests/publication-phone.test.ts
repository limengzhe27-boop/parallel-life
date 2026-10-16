import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  PublicationSeedSchema,
  PublicationOpeningSchema,
} from '../src/contracts/publication-phone.ts';
import { projectPlayerActors } from '../src/modules/world/domain/player-projection.ts';
import { SignedSession } from '../src/modules/identity/infrastructure/signed-session.ts';
import { trialOwnerToken } from '../src/server/publisher-trial-request.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';
const origin = {
  workId: randomUUID(),
  publicationVersion: 1,
  draftVersion: 2,
  contentHash: 'a'.repeat(64),
};
test('publication metadata has its own source contract and rejects fake old story or backstage fields', () => {
  const seed = {
    id: randomUUID(),
    createdAt: '2026-10-12T01:00:00Z',
    source: { kind: 'published_work', ...origin },
    identity: '店长',
    situation: '门口有人等你',
    setting: '河边的一家店',
    experienceNote: '虚构人生',
  };
  assert.equal(PublicationSeedSchema.safeParse(seed).success, true);
  assert.equal(
    PublicationSeedSchema.safeParse({ ...seed, story: { tradeoff: '假造' } }).success,
    false,
  );
  const opening = {
    kind: 'publication_opening',
    schemaVersion: 1,
    origin,
    originKind: 'published',
    identity: seed.identity,
    situation: seed.situation,
    setting: seed.setting,
    experienceNote: seed.experienceNote,
    contacts: [
      { actorKey: 'a', actorId: randomUUID(), name: '阿宁', relationship: '旧同学', traits: [] },
      { actorKey: 'b', actorId: randomUUID(), name: '阿宁', relationship: '邻居', traits: [] },
    ],
    notes: [],
  };
  assert.equal(PublicationOpeningSchema.safeParse(opening).success, true);
  assert.equal(
    PublicationOpeningSchema.safeParse({ ...opening, hiddenContext: '不可公开' }).success,
    false,
  );
  assert.equal(
    PublicationOpeningSchema.safeParse({
      ...opening,
      contacts: [{ ...opening.contacts[0], persona: '私人幕后' }, opening.contacts[1]],
    }).success,
    false,
  );
});
test('authored public contact projection never uses backstage Persona as visible summary', () => {
  const [a, b] = [randomUUID(), randomUUID()];
  const state: WorldState = {
    schemaVersion: 1,
    id: randomUUID(),
    ownerId: randomUUID(),
    version: 0,
    title: '店铺',
    time: '2026-10-12T01:00:00Z',
    actors: [
      { id: a, name: '阿宁', persona: '秘密身份' },
      { id: b, name: '陌生人', persona: '另一个秘密' },
    ],
    actorTies: [],
    facts: [],
    messages: [],
    appointments: [],
    mediaRequests: [],
  };
  const visible = projectPlayerActors(
    state,
    [],
    [],
    [{ actorId: a, name: '阿宁', relationship: '开业伙伴', identity: '同学', traits: ['健谈'] }],
  );
  assert.deepEqual(visible, [
    {
      id: a,
      name: '阿宁',
      relationship: '开业伙伴',
      summary: '同学 · 健谈',
      publicProfile: {
        identity: '同学',
        traits: ['健谈'],
      },
    },
  ]);
  assert.equal(JSON.stringify(visible).includes('秘密'), false);
});
test('trusted private trial identity token retains existing owner and expires within two hours', () => {
  const owner = randomUUID(),
    secret = 's'.repeat(64),
    now = Date.now(),
    token = trialOwnerToken(owner, secret, now),
    sessions = new SignedSession(secret);
  assert.equal(sessions.verify(token, now), owner);
  assert.equal(sessions.verify(token, now + 7200001), null);
  assert.equal(sessions.verify(token, now)!.length, 36);
  assert.throws(() => trialOwnerToken('caller_arbitrary_owner', secret));
});

test('trial proxy admits real action/recovery methods, preserves bounded history pagination and denies unrelated paths', async () => {
  const { trialProxyTarget } = await import('../src/server/publisher-trial-request.ts');
  const world = randomUUID(),
    item = randomUUID(),
    none = new URLSearchParams();
  for (const [path, method] of [
    ['world/space/enter', 'POST'],
    ['world/space/receipt', 'POST'],
    ['world/scenes/' + item + '/view', 'POST'],
    ['world/scenes/' + item + '/leave', 'POST'],
    ['world/groups/' + item, 'PATCH'],
    ['world/groups/' + item + '/messages', 'PUT'],
  ])
    assert.ok(trialProxyTarget(path!.split('/'), method!, world, none));
  assert.equal(trialProxyTarget(['tasks', item, 'run'], 'POST', world, none)?.body, 'none');
  assert.equal(trialProxyTarget(['tasks', item, 'retry'], 'POST', world, none)?.body, 'json');
  assert.equal(
    trialProxyTarget(['world', 'scenes', 'history'], 'GET', world, new URLSearchParams('before=12'))
      ?.target,
    '/api/v1/worlds/' + world + '/scenes/history?before=12',
  );
  for (const path of [
    ['world', 'direction'],
    ['world', 'advance'],
    ['world', 'photos'],
    ['profile'],
    ['https:', 'other'],
  ])
    assert.equal(trialProxyTarget(path, 'POST', world, none), null);
  assert.equal(
    trialProxyTarget(
      ['world', 'scenes', 'history'],
      'GET',
      world,
      new URLSearchParams('before=12&ownerId=' + randomUUID()),
    ),
    null,
  );
  assert.equal(trialProxyTarget(['world'], 'DELETE', world, none), null);
});
