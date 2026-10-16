import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  addEmptyPlace,
  attachPlaceImage,
  detachPlaceImage,
  placeImageUrl,
} from '../src/features/publisher/publisher-place-image.ts';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.module.css'))
      return {
        format: 'module',
        shortCircuit: true,
        source: 'export default new Proxy({}, {get:(_t,k)=>String(k)})',
      };
    if (url.endsWith('publisher-space-editor.tsx'))
      return {
        format: 'module',
        shortCircuit: true,
        source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
            jsx: ts.JsxEmit.ReactJSX,
          },
        }).outputText,
      };
    return nextLoad(url, context);
  },
});
const { PublisherSpaceEditor } =
  await import('../src/features/publisher/publisher-space-editor.tsx');

const assetId = '11111111-2222-4333-8444-555555555555';
function fixture() {
  return {
    places: [
      {
        key: 'shop',
        name: '老店',
        description: '有一扇红门',
        knownAtStart: true,
        sceneMediaKey: 'curated',
      },
      { key: 'home', name: '家', description: '', knownAtStart: false },
    ],
    routes: [{ fromPlaceKey: 'shop', toPlaceKey: 'home', durationMinutes: 20 }],
    media: [{ key: 'curated', url: '/old-scene.jpg', asset: { namespace: 'publication' } }],
    world: { startPlaceKey: 'shop' },
  };
}

test('new place keeps routes and every older place field', () => {
  const source = fixture();
  const before = structuredClone(source);
  const added = addEmptyPlace(source);
  assert.equal(source.places.length, 2);
  assert.deepEqual(source, before);
  assert.deepEqual(added.routes, before.routes);
  assert.deepEqual(added.media, before.media);
  assert.deepEqual((added.places as typeof source.places)[0], before.places[0]);
  assert.equal((added.places as typeof source.places).length, 3);
});

test('uploaded image uses private asset reference and leaves old media untouched', () => {
  const source = fixture();
  const next = attachPlaceImage(source, 'shop', { assetId, kind: 'image', url: '/uploaded.jpg' });
  const selected = (next.places as Record<string, unknown>[])[0]!;
  assert.deepEqual(selected.sceneImage, { assetId });
  assert.equal('sceneMediaKey' in selected, false);
  assert.deepEqual(next.media, source.media);
  assert.deepEqual((next.places as Record<string, unknown>[])[1], source.places[1]);
  assert.deepEqual(next.routes, source.routes);
  assert.equal(
    placeImageUrl(next, selected, (id) => `/api/private/${id}`),
    `/api/private/${assetId}`,
  );
  assert.deepEqual(source, fixture());
});

test('detaching a scene image only removes this place reference', () => {
  const source = fixture();
  const withImage = attachPlaceImage(source, 'shop', { assetId, kind: 'image' });
  const detached = detachPlaceImage(withImage, 'shop');
  assert.equal('sceneImage' in (detached.places as Record<string, unknown>[])[0]!, false);
  assert.equal('sceneMediaKey' in (detached.places as Record<string, unknown>[])[0]!, false);
  assert.deepEqual(detached.media, source.media);
  assert.deepEqual(detached.routes, source.routes);
  assert.equal((detached.places as typeof source.places)[0]?.description, '有一扇红门');
  assert.equal((detached.places as typeof source.places)[0]?.knownAtStart, true);
  assert.equal(placeImageUrl(source, source.places[0]!), '/old-scene.jpg');
});

test('video and invalid asset are rejected without touching draft', () => {
  const source = fixture();
  assert.throws(() => attachPlaceImage(source, 'shop', { assetId, kind: 'video' }));
  assert.throws(() => attachPlaceImage(source, 'shop', { assetId: 'bad', kind: 'image' }));
  assert.deepEqual(source, fixture());
});

test('editor shows simple place list with optional image and no route form', () => {
  const html = renderToStaticMarkup(
    createElement(PublisherSpaceEditor, {
      content: fixture(),
      disabled: false,
      onChange: () => {},
      uploadSceneImage: async () => ({ assetId, kind: 'image' as const }),
    }),
  );
  assert.match(html, /老店/);
  assert.match(html, /替换图片/);
  assert.match(html, /取消图片/);
  assert.match(html, /添加图片/);
  assert.match(html, /场所说明（选填）/);
  assert.doesNotMatch(html, /路程|出发地点|开场时玩家知道|分钟|内部标识/);
});
