import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleSavedSeeds } from '../src/features/discovery/branch-catalog.ts';
import type { ApprovedSeed } from '../src/contracts/seeds.ts';
import type { OfficialLifeCard } from '../src/contracts/official-lives.ts';
import type { WorldBuild } from '../src/contracts/world-build.ts';
const seed = (id: string, official = true): ApprovedSeed => ({
  id,
  createdAt: '2026-10-12T00:00:00Z',
  story: { title: '相同标题', premise: '起点', opening: '开场', tradeoff: '取舍' },
  facts: [],
  events: [],
  people: [],
  portraitAssetId: null,
  assets: [],
  ...(official
    ? {
        source: {
          kind: 'official_life' as const,
          presetId: 'county-yellow-hair' as const,
          version: 1,
        },
      }
    : { profileVersion: 0, discoveryVersion: 0, directionId: id }),
});
const catalog: OfficialLifeCard[] = [
  {
    id: 'county-yellow-hair',
    version: 3,
    title: '相同标题',
    hook: '开场',
    identityLabel: '角色',
    experienceNote: '说明',
    worldId: 'new',
    legacyWorldId: 'old',
    currentVersionWorldId: 'new',
    hasNewVersion: false,
  },
];
const build = (seedId: string, worldId: string, ready = true): WorldBuild => ({
  seedId,
  worldId,
  createdAt: '2026-10-12T00:00:00Z',
  ready,
  task: null,
});
test('only exact official saves already reachable from catalog are removed, including retained legacy', () => {
  const seeds = [seed('new-seed'), seed('old-seed'), seed('older-seed'), seed('personal', false)];
  assert.deepEqual(
    visibleSavedSeeds(
      seeds,
      [
        build('new-seed', 'new'),
        build('old-seed', 'old'),
        build('older-seed', 'older'),
        build('personal', 'new'),
      ],
      catalog,
    ).map((s) => s.id),
    ['older-seed', 'personal'],
  );
});
test('directory failure, incomplete build and unknown source cannot hide a saved life', () => {
  const seeds = [seed('save')];
  assert.equal(visibleSavedSeeds(seeds, [build('save', 'new')], []).length, 1);
  assert.equal(visibleSavedSeeds(seeds, [build('save', 'new', false)], catalog).length, 1);
  assert.equal(visibleSavedSeeds(seeds, [], catalog).length, 1);
  assert.equal(
    visibleSavedSeeds(
      [
        {
          ...seed('save'),
          source: { kind: 'official_life', presetId: 'retired-star', version: 1 },
        },
      ],
      [build('save', 'new')],
      catalog,
    ).length,
    1,
  );
});
