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
const { PhoneShell } = await import('../src/features/phone/phone-shell.tsx');

test('unread badge is anchored to the icon and caps text while preserving the actual count', () => {
  const notifications = Array.from({ length: 104 }, (_, i) => ({
    id: 'message-' + i,
    title: '来信',
    summary: '新消息',
    app: 'messages' as const,
  }));
  notifications.push(notifications[0]!);
  const html = renderToStaticMarkup(
    createElement(PhoneShell, {
      worldId: 'badge12',
      lifeName: '布局测试',
      dateLabel: '10月27日',
      timeLabel: '16:30',
      initiallyLocked: false,
      notifications,
    }),
  );
  assert.match(
    html,
    /class="appIconAnchor">[\s\S]*?class="appIcon messages"[\s\S]*?class="badge" aria-label="104 条未读通知">99\+<\/span><\/span><span class="appLabel">微信/,
  );
  assert.doesNotMatch(html, /105 条未读通知/);
  const empty = renderToStaticMarkup(
    createElement(PhoneShell, {
      worldId: 'badge12',
      lifeName: '布局测试',
      dateLabel: '10月27日',
      timeLabel: '16:30',
      initiallyLocked: false,
    }),
  );
  assert.doesNotMatch(empty, /class="badge"/);
});
