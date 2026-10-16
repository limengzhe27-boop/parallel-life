import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolveOfficialLifeArt, resolveWorldLifeArt } from '../src/features/discovery/life-art.ts';
import { resolveDefaultWallpaper } from '../src/features/phone/wallpaper.ts';
import { resolveAvatarArt } from '../src/features/phone/avatar-art.ts';
import { worldAppData } from '../src/features/phone/world-app-data.ts';
import { OFFICIAL_LIFE_PACKS } from '../src/modules/settings/infrastructure/official-presets/index.ts';
import type { WorldPhone } from '../src/contracts/world-build.ts';

function phone(index = 0): WorldPhone {
  const p = OFFICIAL_LIFE_PACKS[index]!;
  return {
    id: 'test-world',
    seedId: 'test-seed',
    title: p.card.title,
    identity: p.opening.identity,
    setting: p.opening.setting,
    time: p.opening.startAt,
    actors: p.opening.actors.map((a, i) => ({
      id: `actor-${i}`,
      name: a.name,
      relationship: a.relationship,
    })),
    messages: [],
    notes: [],
    photos: [],
  };
}

test('all four official public pairs resolve existing editorial assets with explicit provenance', () => {
  for (let i = 0; i < 4; i++) {
    const w = phone(i),
      p = OFFICIAL_LIFE_PACKS[i]!;
    const art = resolveOfficialLifeArt(p.card.id)!;
    assert.equal(art.label, '原创插画');
    assert.deepEqual(resolveWorldLifeArt(w), art);
    assert.equal(resolveDefaultWallpaper(w.title, w.identity), art.wallpaperUrl);
    for (const url of [art.coverUrl, art.wallpaperUrl]) {
      const path = new URL(`../public${url}`, import.meta.url);
      assert.ok(existsSync(path));
      const svg = readFileSync(path, 'utf8');
      assert.match(svg, /原创意境插画/);
      assert.match(svg, /不是照片或已发生的世界事件/);
      assert.doesNotMatch(svg, /<script|<foreignObject|<image|href=|<text\b/i);
    }
  }
});

test('title alone, similar title, changed identity and personal keywords never bind an official life', () => {
  const w = phone();
  assert.equal(resolveWorldLifeArt({ title: w.title }), null);
  assert.equal(resolveWorldLifeArt({ identity: w.identity }), null);
  assert.equal(resolveWorldLifeArt({ ...w, identity: '这是我的个人修车人生' }), null);
  assert.equal(resolveWorldLifeArt({ ...w, title: `我的${w.title}` }), null);
  assert.equal(resolveOfficialLifeArt('__proto__'), null);
  assert.equal(resolveOfficialLifeArt(), null);
  assert.equal(resolveDefaultWallpaper('县城修车的个人生活'), '/art/open-door.webp');
  assert.equal(resolveDefaultWallpaper('自己的归来'), '/art/meadow-door.webp');
  assert.equal(resolveDefaultWallpaper(), '/art/first-window.webp');
});

test('mapping callers cannot mutate later asset resolution', () => {
  const first = resolveOfficialLifeArt('county-yellow-hair')!;
  (first as { coverUrl: string }).coverUrl = '/untrusted';
  assert.equal(
    resolveOfficialLifeArt('county-yellow-hair')!.coverUrl,
    '/art/lives/county-yellow-hair-cover.svg',
  );
});

test('all editorial character illustrations require an exact official world and role pair', () => {
  for (let i = 0; i < 4; i++) {
    const w = phone(i);
    for (const actor of w.actors) {
      const art = resolveAvatarArt(w, actor);
      assert.equal(art.kind, 'character-illustration');
      assert.match(art.label, /非真实肖像/);
      assert.ok(existsSync(new URL(`../public${art.url}`, import.meta.url)));
      assert.equal(
        resolveAvatarArt({ ...w, identity: '个人世界' }, actor).kind,
        'generic-illustration',
      );
      assert.equal(
        resolveAvatarArt(w, { ...actor, relationship: '同名陌生人' }).kind,
        'generic-illustration',
      );
    }
  }
});

test('authorized photo always wins and its world/revision are retained', () => {
  const w = phone();
  const actor = {
    ...w.actors[0]!,
    sourcePersonId: 'source-person',
    photo: { assetId: 'asset/with space', revision: 9 },
  };
  assert.deepEqual(resolveAvatarArt(w, actor), {
    url: '/api/v1/assets/asset%2Fwith%20space?worldId=test-world&revision=9',
    kind: 'authorized-photo',
    label: '用户授权照片',
  });
  assert.equal(
    resolveAvatarArt({ ...w, id: 'other-world' }, actor).url.includes('worldId=other-world'),
    true,
  );
});

test('photo absent or explicitly cleared on a brought-in person never invents an official likeness', () => {
  const w = phone();
  const brought = { ...w.actors[0]!, sourcePersonId: 'source-person' };
  assert.equal(resolveAvatarArt(w, brought).kind, 'generic-illustration');
  assert.equal(resolveAvatarArt(w, { ...brought, photo: undefined }).kind, 'generic-illustration');
  assert.equal(
    resolveAvatarArt(w, { ...brought, photo: { assetId: 'new-photo', revision: 2 } }).kind,
    'authorized-photo',
  );
});

test('unknown contacts get an abstract symbol independent of name, not a random face or guessed gender', () => {
  const w = { ...phone(), title: '自创人生', identity: '个人设定' };
  const a = resolveAvatarArt(w, { id: 'a', name: '老周', relationship: '修车铺师傅' });
  const b = resolveAvatarArt(w, { id: 'b', name: '另一人', relationship: '家人' });
  assert.deepEqual(a, b);
  assert.equal(a.url, '/art/lives/avatar-contact.svg');
  assert.match(a.label, /不表示实际外貌/);
});

test('display projection neither mutates world nor turns editorial artwork into album/story records', () => {
  const w = phone(),
    before = structuredClone(w);
  const data = worldAppData(w);
  assert.ok(data.contacts.every((c) => c.avatarUrl?.startsWith('/art/lives/avatar-')));
  assert.deepEqual(data.photos, []);
  assert.deepEqual(data.messages, []);
  assert.deepEqual(data.notes, []);
  assert.deepEqual(w, before);
  assert.equal('avatarArt' in w.actors[0]!, false);
});

test('editorial portraits distinguish the six authored contacts within each official world', () => {
  for (let i = 0; i < 4; i++) {
    const w = phone(i);
    const urls = w.actors.map((a) => resolveAvatarArt(w, a).url);
    assert.equal(new Set(urls).size, 6);
  }
});
