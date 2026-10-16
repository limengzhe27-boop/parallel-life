import test from 'node:test';
import assert from 'node:assert/strict';
import { ensurePublishableDefaults } from '../src/modules/settings/domain/publication-defaults.ts';
import { PublishedWorldContentSchema } from '../src/contracts/published-world-content.ts';
import { readFileSync } from 'node:fs';
import { trialMomentImageUrl } from '../src/modules/settings/domain/moment-media-url.ts';

function source() {
  const base = PublishedWorldContentSchema.parse(
    JSON.parse(
      /```json\n([\s\S]*?)\n```/.exec(
        readFileSync(
          new URL('../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
          'utf8',
        ),
      )![1]!,
    ),
  );
  return {
    ...base,
    relationships: [],
    history: [],
    initialKnowledge: [],
    routes: [],
    candidates: [],
    protagonist: { ...base.protagonist, knownFactKeys: [] },
    world: { ...base.world, startAt: '2026-10-14T08:00:00.000Z' },
    actors: [
      {
        ...base.actors[0],
        key: 'shu',
        name: '舒雅婷',
        knownAtStart: true,
        publicCard: { traits: [], momentsVisibility: 'three_days' },
      },
    ],
    phone: {
      notes: [],
      invitations: [],
      album: [],
      messages: [],
      moments: [
        {
          key: 'child_photo',
          actorKey: 'shu',
          text: '家庭相册',
          at: '2022-05-11T04:00:00.000Z',
          images: ['first', 'second', 'third'],
          visibility: {
            kind: 'after_statement',
            actorKey: 'shu',
            statement: '你照看的这个孩子是我的儿子。',
          },
        },
      ],
    },
  };
}
test('publication normalization and validation preserve all photographs and both visibility policies', () => {
  const parsed = PublishedWorldContentSchema.parse(ensurePublishableDefaults(source()));
  assert.equal(parsed.actors[0]!.publicCard.momentsVisibility, 'three_days');
  assert.deepEqual(parsed.phone.moments![0]!.images, ['first', 'second', 'third']);
  assert.deepEqual(parsed.phone.moments![0]!.visibility, source().phone.moments[0]!.visibility);
});
test('invalid confirmation, unknown actor and invalid range fail validation instead of opening a private post', () => {
  for (const change of ['rule', 'actor', 'mode']) {
    const raw = source() as Record<string, any>;
    if (change === 'rule') raw.phone.moments[0].visibility.kind = 'invalid';
    if (change === 'actor') raw.phone.moments[0].visibility.actorKey = 'absent';
    if (change === 'mode') raw.actors[0].publicCard.momentsVisibility = 'invalid';
    assert.equal(
      PublishedWorldContentSchema.safeParse(ensurePublishableDefaults(raw)).success,
      false,
    );
  }
});
test('native trial pictures map only exact bound-world media URLs, preserving external and legacy sources', () => {
  const world = '11111111-1111-4111-8111-111111111111',
    trial = '22222222-2222-4222-8222-222222222222',
    asset = '33333333-3333-4333-8333-333333333333';
  assert.equal(
    trialMomentImageUrl(`/api/v1/worlds/${world}/media/${asset}`, world, trial),
    `/api/v1/publisher/trials/${trial}/world/media/${asset}`,
  );
  assert.equal(
    trialMomentImageUrl('data:image/png;base64,pixel', world, trial),
    'data:image/png;base64,pixel',
  );
  assert.equal(
    trialMomentImageUrl(`/api/v1/worlds/other/media/${asset}`, world, trial),
    `/api/v1/worlds/other/media/${asset}`,
  );
});
