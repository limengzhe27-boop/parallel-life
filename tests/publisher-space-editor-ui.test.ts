import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

registerHooks({
  load(url, context, next) {
    if (url.endsWith('.module.css'))
      return {
        format: 'module',
        shortCircuit: true,
        source: 'export default new Proxy({},{get:(_t,k)=>String(k)})',
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
    return next(url, context);
  },
});

const { PublisherSpaceEditor } =
  await import('../src/features/publisher/publisher-space-editor.tsx');
const data = {
  places: [
    {
      key: 'internal_home',
      name: '小院',
      description: '完整旧描述'.repeat(80),
      knownAtStart: true,
      extra: '保留',
    },
  ],
  routes: [],
  extension: { value: '保留' },
};

test('existing places show their names with an optional collapsed description and preserve the source', () => {
  const before = JSON.stringify(data);
  const html = renderToStaticMarkup(
    createElement(PublisherSpaceEditor, { content: data, disabled: false, onChange: () => {} }),
  );
  assert.match(html, /小院/);
  assert.match(html, /场所说明（选填）/);
  assert.match(html, /完整旧描述/);
  assert.match(html, /<details/);
  assert.doesNotMatch(html, /<details[^>]* open/);
  assert.equal(JSON.stringify(data), before);
});

test('unfilled location uses the same compact editor and does not require a synopsis', () => {
  const html = renderToStaticMarkup(
    createElement(PublisherSpaceEditor, {
      content: { places: [{ key: 'new', name: '', description: '' }] },
      disabled: false,
      onChange: () => {},
    }),
  );
  assert.match(html, /添加地点/);
  assert.match(html, /场景图选填/);
  assert.doesNotMatch(html, /required|故事梗概|路线|分钟/);
});
