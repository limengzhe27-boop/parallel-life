import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PhoneNotification } from '../src/features/phone/phone-shell.tsx';

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
const { PhoneShell } = await import('../src/features/phone/phone-shell.tsx');

const notice = (id: string): PhoneNotification => ({
  id,
  title: `来信 ${id}`,
  summary: `内容 ${id}`,
  app: 'messages',
  target: id,
  at: '2026-10-20T18:00:00.000Z',
  timeLabel: '18:00',
});

test('the rendered lock screen honors the bounded projection and does not fall back to grouped flood', () => {
  const all = [notice('a'), notice('b'), notice('c'), notice('d')];
  const html = renderToStaticMarkup(
    createElement(PhoneShell, {
      worldId: '00000000-0000-4000-8000-000000000001',
      lifeName: '锁屏验收',
      dateLabel: '10 月 20 日',
      timeLabel: '18:00',
      notifications: all,
      lockNotifications: all.slice(0, 3),
    }),
  );
  assert.equal((html.match(/data-notification="/g) ?? []).length, 3);
  assert.doesNotMatch(html, /查看其余/);
  assert.doesNotMatch(html, /来信 d/);
});
