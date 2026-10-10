import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  photoAlbums,
  photoDateLabel,
  photoDay,
  photoGroups,
  photoSourceLabel,
  photoTarget,
  readPhotoView,
  sortedPhotos,
} from '../src/features/phone/apps/photo-library.ts';
import type { PhonePhoto, PhoneContact } from '../src/features/phone/apps/types.ts';
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
const { PhoneAppsProvider } = await import('../src/features/phone/apps/provider.tsx');
const { PhotosApp } = await import('../src/features/phone/apps/photos.tsx');
// Rendering fixtures, never world data or proof of generated images.
const photo = (id: string, extra: Partial<PhonePhoto> = {}): PhonePhoto => ({
  id,
  date: '2026-10-09T23:30:00Z',
  title: id,
  description: '',
  status: 'ready',
  url: '/api/v1/assets/private?worldId=owned&revision=2',
  ...extra,
});
const photos = [
  photo('portrait', { sourcePersonId: 'p1', tag: 'upload' }),
  photo('story', { title: '小芳在门口', tag: 'event', date: '2026-10-08T10:00:00Z' }),
  photo('unspecified', { date: 'unavailable' }),
  photo('recollection', { tag: 'memory' }),
];
const contacts: PhoneContact[] = [
  { id: 'a', name: '小芳', sourcePersonId: 'p1', relationship: '朋友', unread: 0 },
  { id: 'b', name: '小芳', relationship: '同事', unread: 0 },
  { id: 'c', name: '重复绑定', sourcePersonId: 'p1', relationship: '朋友', unread: 0 },
];
const albums = photoAlbums(photos, contacts);
function render(target?: string, items = photos, upload = false) {
  return renderToStaticMarkup(
    createElement(PhoneAppsProvider, {
      worldId: 'owned',
      data: { photos: items, contacts, messages: [], invitations: [], notes: [] },
      actions: upload ? { uploadPhoto: async () => ({ status: 'committed' as const }) } : {},
      children: createElement(PhotosApp, { app: 'photos', target, open() {} }),
    }),
  );
}
test('world-zone date grouping sorts newest first, preserves equal order, and puts unknown dates last without fabricating today', () => {
  assert.equal(photoDay(photos[0]!.date), '2026-10-10');
  assert.equal(photoDateLabel('invalid'), '日期未记录');
  const before = photos.map((p) => p.id);
  assert.deepEqual(
    sortedPhotos(photos).map((p) => p.id),
    ['portrait', 'recollection', 'story', 'unspecified'],
  );
  assert.deepEqual(
    photos.map((p) => p.id),
    before,
  );
  const groups = photoGroups(photos);
  assert.equal(groups[0]!.photos.length, 2);
  assert.equal(groups.at(-1)!.id, '日期未记录');
});
test('person albums only use explicit source references, deduplicate bindings and do not infer identity from captions or names', () => {
  const person = albums.filter((a) => a.id.startsWith('person:'));
  assert.equal(person.length, 1);
  assert.deepEqual(
    person[0]!.photos.map((p) => p.id),
    ['portrait'],
  );
  assert.equal(albums.find((a) => a.id === 'uploads')!.photos.length, 1);
  assert.equal(photoSourceLabel(photos[2]!), '相册记录');
  assert.equal(photoSourceLabel(photos[3]!), '相册记录');
});
test('legacy photo links, album return context and photo IDs containing reserved characters round-trip safely', () => {
  assert.equal(readPhotoView('portrait', photos, albums).kind, 'photo');
  const target = photoTarget('portrait', 'album:person:a');
  const view = readPhotoView(target, photos, albums);
  assert.equal(view.kind, 'photo');
  if (view.kind === 'photo') assert.equal(view.back, 'album:person:a');
  const punctuation = photo('photo & ? /');
  assert.equal(
    readPhotoView(photoTarget(punctuation.id, 'albums'), [punctuation], albums).kind,
    'photo',
  );
  assert.equal(photoTarget('portrait'), 'portrait');
});
test('unknown collection/photo stays missing; arbitrary return targets cannot navigate to another app or world', () => {
  assert.equal(readPhotoView('album:person:nonexistent', photos, albums).kind, 'missing');
  assert.equal(readPhotoView('not-a-photo', photos, albums).kind, 'missing');
  const view = readPhotoView('photo?id=portrait&back=https://private.invalid', photos, albums);
  assert.equal(view.kind, 'photo');
  if (view.kind === 'photo') assert.equal(view.back, undefined);
});
test('library exposes compact photo buttons and one upload picker, keeps authorized URLs verbatim and avoids duplicated title cards', () => {
  const html = render(undefined, photos, true);
  assert.equal((html.match(/type="file"/g) ?? []).length, 1);
  assert.equal((html.match(/aria-label="查看照片：/g) ?? []).length, 4);
  assert.ok(html.includes('/api/v1/assets/private?worldId=owned&amp;revision=2'));
  assert.ok(html.includes('aria-label="相册导航"'));
  assert.ok(!html.includes('剧情事件'));
  assert.ok(!html.includes('全部好友'));
});
test('albums use real counts; filtered viewer keeps return collection, and empty/missing photos retain honest recoverable pages', () => {
  assert.ok(render('albums').includes('添加的照片'));
  const filtered = render(photoTarget('portrait', 'album:person:a'));
  assert.ok(filtered.includes('返回小芳'));
  assert.ok(filtered.includes('原图上传时间'));
  assert.ok(filtered.includes('1 / 1'));
  const empty = render(undefined, [], true);
  assert.ok(empty.includes('暂无照片'));
  assert.equal((empty.match(/type="file"/g) ?? []).length, 1);
  assert.ok(render('missing').includes('找不到这张照片'));
});
test('pending or failed media never renders fake image successes, wallpaper controls or enabled neighboring photos', () => {
  for (const status of ['queued', 'generating', 'failed', 'unknown'] as const) {
    const html = render('x', [photo('x', { status })]);
    assert.ok(!html.includes('<img'));
    assert.ok(!html.includes('设为手机壁纸'));
    assert.match(html, /aria-label="上一张照片" disabled=""/);
    assert.match(html, /aria-label="下一张照片" disabled=""/);
    assert.ok(!html.includes('确认重试生成</button>'));
  }
  assert.ok(!render('x', [photo('x', { url: undefined })]).includes('<img'));
});
