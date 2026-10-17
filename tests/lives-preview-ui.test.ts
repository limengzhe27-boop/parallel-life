import { test } from 'node:test';
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
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            jsx: ts.JsxEmit.ReactJSX,
          },
        }).outputText,
      };
    return nextLoad(url, context);
  },
});

const { LivesPreview } = await import('../src/app/ui-preview/lives/preview.tsx');

test('LivesPreview renders title and status bar with current life and story date', () => {
  const html = renderToStaticMarkup(createElement(LivesPreview));
  assert(html.includes('多人生与时间 · 界面验收样板'));
  assert(html.includes('L-05 验收夹具'));
  assert(html.includes('当前人生：县城修车青年'));
  assert(html.includes('故事时刻：2026-09-24 08:30 (星期四)'));
  assert(html.includes('12× 流逝中'));
});

test('LivesPreview renders all four main navigation tabs', () => {
  const html = renderToStaticMarkup(createElement(LivesPreview));
  assert(html.includes('多人生与分支'));
  assert(html.includes('现实与平行轨迹'));
  assert(html.includes('导演面板'));
  assert(html.includes('时间界面'));
});

test('LivesPreview renders life selector chips for switching among multiple lives', () => {
  const html = renderToStaticMarkup(createElement(LivesPreview));
  assert(html.includes('县城修车青年'));
  assert(html.includes('江浙沪独生子'));
  assert(html.includes('海边咖啡馆店主'));
});

test('LivesPreview default view displays official life cards and personal branch proposals', () => {
  const html = renderToStaticMarkup(createElement(LivesPreview));
  assert(html.includes('官方预设与多人生副本'));
  assert(html.includes('县城黄毛'));
  assert(html.includes('平行分支列表与提议'));
  assert(html.includes('如果我开一家海边咖啡馆'));
});
