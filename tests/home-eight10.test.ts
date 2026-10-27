import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
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
          compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
        }).outputText,
      };
    return nextLoad(url, context);
  },
});
const { PhoneShell } = await import('../src/features/phone/phone-shell.tsx');
const { PhoneDesktop } = await import('../src/features/phone/phone-desktop.tsx');

test('home exposes exactly eight actual entries in rows three/two and dock three', () => {
  const html = renderToStaticMarkup(
    createElement(PhoneShell, {
      worldId: 'home-eight10',
      lifeName: '渣男体验',
      dateLabel: '10月27日 周二',
      timeLabel: '08:15',
      initiallyLocked: false,
    }),
  );
  const desktop = html.match(/<nav[^>]*aria-label="桌面应用"[^>]*>(.*?)<\/nav>/s)?.[1] ?? '';
  const dock = html.match(/<nav[^>]*aria-label="常用应用"[^>]*>(.*?)<\/nav>/s)?.[1] ?? '';
  assert.deepEqual(
    [...desktop.matchAll(/data-app="([^"]+)"/g)].map((m) => m[1]),
    ['calendar', 'photos', 'notes', 'records'],
  );
  assert.equal((desktop.match(/data-panel="timeline"/g) ?? []).length, 1);
  assert.deepEqual(
    [...desktop.matchAll(/data-home-row="([^"]+)"/g)].map((m) => m[1]),
    ['1', '2'],
  );
  assert.deepEqual(
    [...dock.matchAll(/data-app="([^"]+)"/g)].map((m) => m[1]),
    ['messages', 'scenes', 'map'],
  );
  assert.equal(
    (html.match(/data-app="/g) ?? []).length + (html.match(/data-panel="timeline"/g) ?? []).length,
    8,
  );
  assert.ok(!html.includes('data-app="moments"'));
});

test('custom desktop keeps the same eight shell-owned entries without old widgets', () => {
  const html = renderToStaticMarkup(
    createElement(PhoneShell, {
      worldId: 'home-eight10',
      lifeName: '渣男体验',
      dateLabel: '10月27日 周二',
      timeLabel: '08:15',
      initiallyLocked: false,
      renderHome: ({ open, openPanel }) =>
        createElement(PhoneDesktop, {
          title: '渣男体验',
          dateLabel: '10月27日 周二',
          timeLabel: '08:15',
          data: { contacts: [], messages: [], photos: [], invitations: [], notes: [] },
          open,
          openPanel,
        }),
    }),
  );
  assert.equal(
    (html.match(/data-app="/g) ?? []).length + (html.match(/data-panel="timeline"/g) ?? []).length,
    8,
  );
  assert.ok(html.includes('data-phone-desktop'));
  assert.ok(!html.includes('暂无待办日程'));
});
