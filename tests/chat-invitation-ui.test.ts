import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { worldAppData } from '../src/features/phone/world-app-data.ts';
import type { WorldPhone } from '../src/contracts/world-build.ts';

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
const { MessagesApp } = await import('../src/features/phone/apps/messages.tsx');
const { PhoneAppsProvider } = await import('../src/features/phone/apps/provider.tsx');

const world = (status: 'proposed' | 'confirmed'): WorldPhone => ({
  id: '00000000-0000-4000-8000-000000000001',
  seedId: 'seed',
  title: '邀约验收',
  identity: '玩家',
  setting: '小镇',
  time: '2026-10-20T21:00:00.000Z',
  actors: [{ id: '00000000-0000-4000-8000-000000000002', name: '林澈', relationship: '朋友' }],
  messages: [],
  notes: [],
  photos: [],
  invitations: [
    {
      id: 'apt-1',
      title: '今晚一起吃饭',
      at: '2026-10-20T20:00:00.000Z',
      participantIds: ['00000000-0000-4000-8000-000000000002'],
      status,
      links: [{ app: 'map', target: 'place-1', label: '小馆' }],
    },
  ],
});

function render(status: 'proposed' | 'confirmed') {
  const w = world(status);
  return renderToStaticMarkup(
    createElement(PhoneAppsProvider, {
      worldId: w.id,
      data: { ...worldAppData(w), referenceTime: w.time },
      actions: {
        changeInvitation: async () => ({ status: 'committed' as const }),
        enterScene: async () => ({ status: 'committed' as const }),
      },
      children: createElement(MessagesApp, {
        app: 'messages',
        target: w.actors[0]!.id,
        open: () => {},
      }),
    }),
  );
}

test('a proposed invitation renders an actionable card inside the chat, not just a link chip', () => {
  const html = render('proposed');
  assert.match(html, /日程邀约/);
  assert.match(html, /今晚一起吃饭/);
  assert.match(html, /接受/);
  assert.match(html, /改期/);
  assert.match(html, /拒绝/);
});

test('an accepted invitation no longer keeps an actionable card in the chat', () => {
  const html = render('confirmed');
  assert.doesNotMatch(html, /日程邀约/);
  assert.doesNotMatch(html, /今晚一起吃饭/);
  assert.doesNotMatch(html, /接受/);
  assert.doesNotMatch(html, /改期/);
});
