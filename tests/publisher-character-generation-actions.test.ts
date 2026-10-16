import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.module.css'))
      return {
        format: 'module',
        shortCircuit: true,
        source: 'export default new Proxy({}, {get:(_target,key)=>String(key)})',
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
const { PublisherCharacterPreview } =
  await import('../src/features/publisher/publisher-character-preview.tsx');
function fixture() {
  return {
    world: { startAt: '2026-10-14T12:00:00Z' },
    actors: [
      {
        key: 'lan',
        name: '程岚',
        knownAtStart: true,
        publicCard: { identity: '同事', introduction: '公开介绍', traits: [] },
        privatePersona: { boundaries: '不该出现在公开页面的秘密' },
      },
    ],
    phone: { messages: [], moments: [] },
  };
}
function walk(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(walk);
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...walk(element.props.children as ReactNode)];
}
function label(children: unknown): string {
  if (Array.isArray(children)) return children.map(label).join('');
  return typeof children === 'string' ? children : '';
}
function render(props: Record<string, unknown> = {}) {
  return PublisherCharacterPreview({
    content: fixture(),
    actorKey: 'lan',
    canEdit: true,
    busy: false,
    onChange() {},
    ...props,
  });
}

test('two independent buttons directly request only their selected content and no document dialog', () => {
  const calls: string[] = [];
  const tree = render({ onGenerate: (focus: string) => calls.push(focus) });
  const buttons = walk(tree).filter((node) => node.type === 'button');
  const history = buttons.find((node) => label(node.props.children) === 'AI 补历史聊天');
  const moments = buttons.find((node) => label(node.props.children) === 'AI 补朋友圈');
  assert.ok(history);
  assert.ok(moments);
  assert.equal(history.props.disabled, false);
  assert.equal(moments.props.disabled, false);
  assert.equal(calls.length, 0);
  (history.props.onClick as () => void)();
  (moments.props.onClick as () => void)();
  assert.deepEqual(calls, ['history', 'moments']);
  const html = renderToStaticMarkup(tree);
  assert.doesNotMatch(html, /一起补齐|导入文档|Markdown|再次核对/);
  assert.doesNotMatch(html, /不该出现在公开页面的秘密/);
});

test('the active generation disables both actions and reports live progress without inventing content', () => {
  const tree = render({
    onGenerate() {
      throw new Error('Busy buttons must not invoke a second request');
    },
    generatingFocus: 'moments',
    generationMessage: '正在准备朋友圈文字。',
  });
  const buttons = walk(tree).filter((node) => node.type === 'button');
  const history = buttons.find((node) => label(node.props.children) === 'AI 补历史聊天');
  const moments = buttons.find((node) => label(node.props.children) === '正在补朋友圈…');
  assert.equal(history?.props.disabled, true);
  assert.equal(moments?.props.disabled, true);
  const html = renderToStaticMarkup(tree);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /role="status"/);
  assert.match(html, /正在准备朋友圈文字/);
  assert.doesNotMatch(html, /朋友圈已生成/);
});

test('completion and failure messages are explicit and buttons recover after generation ends', () => {
  const complete = renderToStaticMarkup(
    render({
      onGenerate() {},
      generatingFocus: null,
      generationMessage: '已新增 2 条历史聊天，原有内容保留。',
    }),
  );
  assert.match(complete, /已新增 2 条历史聊天/);
  assert.match(complete, /AI 补朋友圈/);
  assert.doesNotMatch(complete, /aria-busy="true"/);
  const failed = renderToStaticMarkup(
    render({
      onGenerate() {},
      generationError: '这次没有生成成功，请稍后重试。',
    }),
  );
  assert.match(failed, /role="alert"/);
  assert.match(failed, /这次没有生成成功/);
});
