import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import ts from 'typescript';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WorldPhone } from '../src/contracts/world-build.ts';
import type { PhoneContact } from '../src/features/phone/apps/types.ts';
import { worldAppData } from '../src/features/phone/world-app-data.ts';
import { avatarPresentation, resolveAvatarArt } from '../src/features/phone/avatar-art.ts';
import { OFFICIAL_LIFE_PACKS } from '../src/modules/settings/infrastructure/official-presets/index.ts';

registerHooks({
  load(url, ctx, next) {
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
    return next(url, ctx);
  },
});
const { PersonCard } = await import('../src/features/phone/apps/person-card.tsx');
const { Avatar } = await import('../src/features/phone/apps/common.tsx');
const world = (): WorldPhone => ({
  id: 'world/id',
  seedId: 'seed',
  title: '个人世界',
  identity: '玩家',
  setting: '小镇',
  time: '2026-10-12T00:00:00Z',
  actors: [
    {
      id: 'one',
      name: '同名',
      relationship: '',
      sourcePersonId: 'person-a',
      photo: { assetId: 'asset/id', revision: 2 },
    },
    { id: 'two', name: '同名', relationship: '搭档', sourcePersonId: 'person-b' },
  ],
  messages: [],
  notes: [],
  photos: [],
});

test('precise actor/revision and all three actual art fields reach contact views, with no image in album', () => {
  const w = world(),
    before = structuredClone(w),
    contacts = worldAppData(w).contacts;
  assert.equal(contacts[0]?.id, 'one');
  assert.equal(contacts[1]?.id, 'two');
  assert.deepEqual(contacts[0], {
    id: 'one',
    sourcePersonId: 'person-a',
    name: '同名',
    relationship: '',
    summary: undefined,
    avatarUrl: '/api/v1/assets/asset%2Fid?worldId=world%2Fid&revision=2',
    avatarKind: 'authorized-photo',
    avatarLabel: '用户授权照片',
    unread: 0,
  });
  assert.equal(contacts[1]?.avatarKind, 'generic-illustration');
  assert.match(contacts[1]!.avatarLabel!, /不表示实际外貌/);
  assert.deepEqual(w, before);
  assert.deepEqual(worldAppData(w).photos, []);
});
test('latest photo revision and world-scoped URL change without changing actor or mutating prior snapshot', () => {
  const w = world(),
    old = worldAppData(w).contacts[0]!;
  w.actors[0]!.photo = { assetId: 'new', revision: 7 };
  const current = worldAppData(w).contacts[0]!;
  assert.equal(current.id, old.id);
  assert.match(current.avatarUrl!, /new\?worldId=world%2Fid&revision=7$/);
  assert.match(old.avatarUrl!, /revision=2$/);
  assert.match(worldAppData({ ...w, id: 'other' }).contacts[0]!.avatarUrl!, /worldId=other/);
});
test('explicitly absent/cleared brought-in picture never falls back to old authorized or official image', () => {
  const w = world();
  delete w.actors[0]!.photo;
  const c = worldAppData(w).contacts[0]!;
  assert.equal(c.avatarKind, 'generic-illustration');
  assert.equal(c.avatarUrl, '/art/lives/avatar-contact.svg');
  assert.doesNotMatch(c.avatarLabel!, /授权图片/);
});
test('editorial art retains non-real likeness provenance; matching name alone does not grant identity', () => {
  const p = OFFICIAL_LIFE_PACKS[0]!,
    w = { ...world(), title: p.card.title, identity: p.opening.identity };
  const actor = { id: 'laozhou', name: '老周', relationship: '修车铺师傅' };
  assert.equal(resolveAvatarArt(w, actor).kind, 'character-illustration');
  assert.match(resolveAvatarArt(w, actor).label, /非真实肖像/);
  assert.equal(resolveAvatarArt({ ...w, identity: '自创' }, actor).kind, 'generic-illustration');
});
for (const kind of ['authorized-photo', 'character-illustration', 'generic-illustration'] as const)
  test(`${kind} image failure never retains its successful-image claim`, () => {
    const c = { avatarUrl: '/failed', avatarKind: kind, avatarLabel: 'original source' },
      a = avatarPresentation(c, new Set(['/failed']));
    assert.equal(a.kind, 'generic-illustration');
    assert.equal(a.url, '/art/lives/avatar-contact.svg');
    assert.match(a.label, /未能显示.*通用插画/);
    assert.doesNotMatch(a.label, /original source|授权图片|真实肖像/);
  });
test('failed fallback stops at an explicitly named text marker and never retries a URL automatically', () => {
  const c = { avatarUrl: '/failed', avatarKind: 'authorized-photo' as const };
  const a = avatarPresentation(c, new Set(['/failed', '/art/lives/avatar-contact.svg']));
  assert.equal(a.url, undefined);
  assert.equal(a.kind, undefined);
  assert.match(a.label, /未能显示.*姓名标记/);
});
test('new revision after failure is displayed with its actual label rather than the old failure', () => {
  const failures = new Set(['/old', '/art/lives/avatar-contact.svg']);
  const a = avatarPresentation(
    { avatarUrl: '/new?revision=3', avatarKind: 'authorized-photo', avatarLabel: '用户授权图片' },
    failures,
  );
  assert.equal(a.url, '/new?revision=3');
  assert.equal(a.label, '用户授权图片');
  assert.equal(failures.size, 2);
});
test('legacy missing source metadata is unknown, not asserted authorized or a generated likeness', () => {
  assert.equal(avatarPresentation({ avatarUrl: '/legacy' }).label, '形象图片 · 来源未标注');
  assert.match(avatarPresentation({}).label, /不表示实际外貌/);
});
const render = (c: PhoneContact) => renderToStaticMarkup(createElement(PersonCard, { contact: c }));
test('shared card omits unknown relationship/biography and fake online status, with native expandable image', () => {
  const html = render(worldAppData(world()).contacts[0]!);
  assert.match(html, /查看形象/);
  assert.match(html, /用户授权图片/);
  assert.match(html, /revision=2/);
  assert.doesNotMatch(html, /在线|紧密相连|你的朋友|生平与性格|人物介绍|共同回忆/);
  assert.match(html, /<details class="portrait"/);
});
test('only provided biography and relationship render fully and safely escaped', () => {
  const html = render({
    ...worldAppData(world()).contacts[1]!,
    summary: '公开介绍<script>秘密不会执行</script>\n' + '长'.repeat(500),
  });
  assert.match(html, /搭档/);
  assert.match(html, /人物介绍/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script/);
  assert.match(html, new RegExp('长'.repeat(500)));
});
test('whitespace-only public fields remain omitted', () => {
  const html = render({
    ...worldAppData(world()).contacts[1]!,
    relationship: '  ',
    summary: '\n ',
  });
  assert.doesNotMatch(html, /人物介绍|朋友|紧密相连/);
});
test('close handler and original action children pass through without inventing a call or writing a world', () => {
  let closed = 0;
  const c = worldAppData(world()).contacts[0]!;
  const tree = PersonCard({
    contact: c,
    onClose: () => closed++,
    children: createElement('a', { href: '#chat-one' }, '发微信'),
  });
  function walk(e: unknown): ReactElement<Record<string, unknown>>[] {
    if (!e || typeof e !== 'object' || !('props' in e)) return [];
    const el = e as ReactElement<Record<string, unknown>>,
      children = el.props.children;
    return [el, ...(Array.isArray(children) ? children : [children]).flatMap(walk)];
  }
  const btn = walk(tree).find((e) => e.type === 'button' && e.props['aria-label'] === '关闭名片');
  assert.ok(btn);
  (btn.props.onClick as () => void)();
  assert.equal(closed, 1);
  const html = renderToStaticMarkup(tree);
  assert.match(html, /href="#chat-one"/);
  assert.doesNotMatch(html, /通话已接通|在线/);
});
test('old avatar consumers still render a fallback and precise revised URL without requiring metadata', () => {
  const html = renderToStaticMarkup(
    createElement(Avatar, { url: '/api/v1/assets/x?revision=5', name: '同名' }),
  );
  assert.match(html, /revision=5/);
  assert.match(html, /来源未标注/);
});

test('actual chat renderer keeps the actor photo revision, message and unavailable-send behavior', async () => {
  const { MessagesApp } = await import('../src/features/phone/apps/messages.tsx');
  const { PhoneAppsProvider } = await import('../src/features/phone/apps/provider.tsx');
  const w = world();
  w.messages = [
    { id: 'saved-message', actorId: 'one', text: '真实已保存消息', at: w.time, role: 'assistant' },
  ];
  const html = renderToStaticMarkup(
    createElement(PhoneAppsProvider, {
      worldId: w.id,
      data: worldAppData(w),
      children: createElement(MessagesApp, { app: 'messages', target: 'one', open: () => {} }),
    }),
  );
  assert.match(html, /真实已保存消息/);
  assert.match(html, /asset%2Fid\?worldId=world%2Fid&amp;revision=2/);
  assert.match(html, /用户授权图片/);
  assert.match(html, /聊天尚未接通，可先写草稿/);
  assert.doesNotMatch(html, /通话已接通|● 在线/);
});
