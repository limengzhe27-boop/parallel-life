import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SceneReadSchema, type SceneRead } from '../src/contracts/scenes.ts';
import {
  sceneArtwork,
  visibleSceneEntries,
  scenePhotoUrl,
} from '../src/features/phone/scenes/stage-presentation.ts';
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.module.css'))
      return {
        format: 'module',
        shortCircuit: true,
        source: 'export default new Proxy({}, {get:(_t,k)=>String(k)})',
      };
    if (url.endsWith('.tsx') && !url.includes('/node_modules/'))
      return {
        format: 'module',
        shortCircuit: true,
        source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            jsx: ts.JsxEmit.ReactJSX,
          },
        }).outputText,
      };
    return nextLoad(url, context);
  },
});
const { SceneStage, SceneMedia } = await import('../src/features/phone/scenes/scene-stage.tsx');
const ownerId = randomUUID(),
  worldId = randomUUID(),
  sceneId = randomUUID(),
  actorId = randomUUID();
const base = {
  ownerId,
  worldId,
  sceneId,
  sourceEventId: randomUUID(),
  sourceVersion: 2,
  observableTo: [{ kind: 'player' as const }],
};
function photo(
  assetId: string,
  url = '/api/v1/assets/' + assetId + '?worldId=' + worldId + '&revision=3',
) {
  return {
    id: assetId,
    date: '2026-10-12',
    title: '场景',
    description: '',
    status: 'ready' as const,
    url,
  };
}
function read(): SceneRead {
  return SceneReadSchema.parse({
    worldVersion: 6,
    storyNow: '2026-10-12T01:00:00.000Z',
    paused: false,
    experience: { ownerId, worldId, currentSceneId: sceneId, view: { kind: 'scene', sceneId } },
    scene: {
      ownerId,
      worldId,
      id: sceneId,
      sourceEventId: randomUUID(),
      sourceVersion: 1,
      title: '晚餐',
      placeId: 'lin_home',
      status: 'active',
      presence: [
        {
          participant: { kind: 'player' },
          sourceEventId: randomUUID(),
          sourceVersion: 1,
          joinedVersion: 1,
        },
        {
          participant: { kind: 'actor', actorId },
          sourceEventId: randomUUID(),
          sourceVersion: 1,
          joinedVersion: 1,
        },
      ],
    },
    entries: [
      {
        ...base,
        id: randomUUID(),
        kind: 'time_place',
        location: '客厅',
        storyAt: '2026-10-12T01:00:00.000Z',
      },
    ],
    actions: [],
    matters: [],
    task: null,
  });
}
function media(
  version = 3,
  purpose = 'scene_illustration' as 'scene_illustration' | 'scene_reference',
) {
  return {
    ...base,
    id: randomUUID(),
    sourceVersion: version,
    kind: 'media_reference' as const,
    media: {
      ownerId,
      worldId,
      sourceEventId: randomUUID(),
      sourceVersion: version,
      assetId: randomUUID(),
      purpose,
    },
  };
}
test('scene without saved image explicitly renders original illustration and real participant profile', () => {
  const r = read();
  const html = renderToStaticMarkup(
    createElement(SceneStage, {
      read: r,
      contacts: [
        {
          id: actorId,
          name: '林悦',
          relationship: '朋友',
          summary: '公开介绍',
          unread: 0,
          avatarUrl: '/api/v1/assets/' + randomUUID(),
        },
      ],
    }),
  );
  assert.match(html, /场景示意/);
  assert.match(html, /原创场地示意/);
  assert.match(html, /客厅/);
  assert.match(html, /林悦/);
  assert.match(html, /公开介绍/);
  assert.doesNotMatch(html, /在线|好感/);
});
test('only current-scene, player-visible, owned persisted entries can provide stage images', () => {
  const r = read(),
    good = media();
  r.entries.push(
    good,
    { ...media(4), sceneId: randomUUID() },
    { ...media(4), worldId: randomUUID() },
    { ...media(4), ownerId: randomUUID() },
    { ...media(4), observableTo: [{ kind: 'actor', actorId }] },
    media(7),
  );
  assert.equal(visibleSceneEntries(r).length, 2);
  assert.equal(sceneArtwork(r, [photo(good.media.assetId)]).url, photo(good.media.assetId).url);
  assert.equal(sceneArtwork(r, [photo(good.media.assetId)]).illustration, false);
});
test('reference pictures never become the current scene background', () => {
  const r = read();
  r.entries.push(media(4, 'scene_reference'));
  assert.equal(sceneArtwork(r).illustration, true);
});
test('a location change does not carry its old illustration into the new place', () => {
  const r = read();
  r.entries.push(media(3), {
    ...base,
    id: randomUUID(),
    sourceVersion: 5,
    kind: 'time_place',
    location: '门外',
    storyAt: r.storyNow,
  });
  assert.equal(sceneArtwork(r).illustration, true);
});
test('cross-owner and cross-world media metadata are not displayed as current stage', () => {
  for (const key of ['ownerId', 'worldId'] as const) {
    const r = read(),
      m = media();
    m.media[key] = randomUUID();
    r.entries.push(m);
    assert.equal(sceneArtwork(r).illustration, true);
  }
});
test('departed participants are absent and missing portraits are not invented', () => {
  const r = read();
  r.scene!.presence[1]!.leftVersion = 5;
  let html = renderToStaticMarkup(
    createElement(SceneStage, {
      read: r,
      contacts: [{ id: actorId, name: '已离开', relationship: '朋友', unread: 0 }],
    }),
  );
  assert.doesNotMatch(html, /已离开/);
  r.scene!.presence[1]!.leftVersion = undefined;
  html = renderToStaticMarkup(createElement(SceneStage, { read: r, contacts: [] }));
  assert.match(html, /在场的人/);
  assert.equal(html.includes('/api/v1/assets'), false);
});
test('media entries have distinct reference labels and authorized image URL', () => {
  const assetId = randomUUID();
  const html = renderToStaticMarkup(
    createElement(SceneMedia, { url: photo(assetId).url, reference: true }),
  );
  assert.match(html, /参考图片/);
  assert.ok(html.includes('/api/v1/assets/' + assetId));
});
test('absent scene cannot expose a retained previous-scene image', () => {
  const r = read();
  r.entries.push(media());
  r.scene = null;
  assert.equal(visibleSceneEntries(r).length, 0);
  assert.equal(sceneArtwork(r).illustration, true);
});

test('missing revisions, owner-only images, wrong world and unavailable assets are never loaded', () => {
  const r = read(),
    id = randomUUID();
  for (const url of [
    '/api/v1/assets/' + id,
    '/api/v1/assets/' + id + '?worldId=' + worldId + '&revision=0',
    '/api/v1/assets/' + id + '?worldId=' + randomUUID() + '&revision=3',
    'https://example.com/a',
  ]) {
    assert.equal(scenePhotoUrl(r, id, [photo(id, url)]), undefined);
  }
  assert.equal(scenePhotoUrl(r, id, [{ ...photo(id), status: 'failed' }]), undefined);
  assert.equal(scenePhotoUrl(r, id, [photo(id)]), photo(id).url);
  const html = renderToStaticMarkup(createElement(SceneMedia, { reference: true }));
  assert.match(html, /暂时无法查看/);
  assert.doesNotMatch(html, /<img/);
});
