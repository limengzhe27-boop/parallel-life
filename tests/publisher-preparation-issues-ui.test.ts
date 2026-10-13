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
    if (url.endsWith('publisher-import-dialog.tsx'))
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
const { preparationIssueMessages, PublisherPreparationIssues } =
  await import('../src/features/publisher/publisher-import-dialog.tsx');
type Issue = { path: (string | number)[]; code: string };
const emptyWork = { work: { hook: '', description: '', experienceNote: '' } };
const duplicateIssues: Issue[] = ['hook', 'description', 'experienceNote'].flatMap((field) =>
  ['too_small', 'custom'].map((code) => ({ path: ['work', field], code })),
);
test('three empty work fields produce three concrete Chinese hints from six schema issues', () => {
  const messages = preparationIssueMessages(duplicateIssues, emptyWork);
  assert.equal(messages.length, 3);
  assert.deepEqual(
    messages.map((m) => m.field),
    ['作品介绍 · 一句话简介', '作品介绍 · 作品简介', '作品介绍 · 体验说明'],
  );
  assert.ok(
    messages.every((m) => m.reason === '内容尚不完整，请补充后再检查。' && m.details.length === 2),
  );
});
test('technical errors remain in collapsed details, absent from the main panel', () => {
  const html = renderToStaticMarkup(
    createElement(PublisherPreparationIssues, { issues: duplicateIssues, content: emptyWork }),
  );
  const main = html.replace(/<details>[\s\S]*?<\/details>/g, '');
  assert.doesNotMatch(main, /too_small|custom|experienceNote|work \/ hook/);
  assert.match(main, /一句话简介/);
  assert.equal((main.match(/<li>/g) ?? []).length, 3);
  assert.match(html, /<details><summary>查看详细定位<\/summary>/);
  assert.doesNotMatch(html, /<details open/);
  assert.match(html, /work \/ hook（too_small）/);
});
test('same field with different reasons and different rows do not lose distinct errors', () => {
  const messages = preparationIssueMessages([
    { path: ['actors', 0, 'name'], code: 'too_small' },
    { path: ['actors', 0, 'name'], code: 'too_big' },
    { path: ['actors', 1, 'name'], code: 'too_small' },
  ]);
  assert.equal(messages.length, 3);
  assert.equal(messages[0]!.field, '人物 · 第 1 项 · 姓名');
  assert.equal(messages[2]!.field, '人物 · 第 2 项 · 姓名');
});
test('known time and visibility failures give actionable causes', () => {
  const messages = preparationIssueMessages([
    { path: ['phone', 'messages', 0, 'at'], code: 'history_message_not_past' },
    { path: ['initialKnowledge', 1, 'factKeys'], code: 'fact_not_actor_visible' },
  ]);
  assert.equal(messages[0]!.field, '开场手机内容 · 消息 · 第 1 项 · 时间');
  assert.match(messages[0]!.reason, /早于世界开场/);
  assert.match(messages[1]!.reason, /人物不可见/);
});
test('unknown paths/codes remain reviewable, escaped and technically traceable without leaking raw names in main hint', () => {
  const issues = [
    { path: ['futureExtension', '<script>'], code: 'FUTURE_RULE' },
    { path: ['__proto__'], code: 'constructor' },
  ];
  const html = renderToStaticMarkup(createElement(PublisherPreparationIssues, { issues }));
  const main = html.replace(/<details>[\s\S]*?<\/details>/g, '');
  assert.equal(preparationIssueMessages(issues).length, 2);
  assert.match(main, /仍需核对/);
  assert.doesNotMatch(main, /futureExtension|FUTURE_RULE|__proto__|constructor|script/);
  assert.match(html, /futureExtension/);
  assert.match(html, /FUTURE_RULE/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});
test('custom does not claim nonempty content is missing; empty list produces no warning panel', () => {
  const messages = preparationIssueMessages([{ path: ['work', 'hook'], code: 'custom' }], {
    work: { hook: '作者原文' },
  });
  assert.doesNotMatch(messages[0]!.reason, /内容尚不完整/);
  assert.equal(renderToStaticMarkup(createElement(PublisherPreparationIssues, { issues: [] })), '');
});
