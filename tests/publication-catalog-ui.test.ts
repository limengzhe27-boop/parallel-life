import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import ts from 'typescript';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  PublicationPlayerCatalogSchema,
  type PublicationPlayerCatalog,
} from '../src/contracts/publication-worlds.ts';
import type { PublishedCatalogProps } from '../src/features/settings/published-catalog.tsx';
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
const { PublishedCatalog } = await import('../src/features/settings/published-catalog.tsx');
const id = '10000000-0000-4000-8000-000000000001',
  other = '10000000-0000-4000-8000-000000000002',
  worldId = '20000000-0000-4000-8000-000000000001';
function catalog(): PublicationPlayerCatalog {
  return PublicationPlayerCatalogSchema.parse({
    works: [
      {
        id,
        version: 1,
        title: '车站的一天',
        hook: '开班前一起商量',
        identityLabel: '值班员',
        description: '你已经来到车站。完整的公开开场介绍。',
        experienceNote: '是否接受安排由你选择。',
        worldId: null,
      },
      {
        id: other,
        version: 9,
        title: '另一段人生',
        hook: '从上次停下的地方继续',
        identityLabel: '自己的角色',
        description: '保留之前的来信和选择。',
        experienceNote: '继续已有存档，不重新创建。',
        worldId,
      },
    ],
    nextCursor: null,
  });
}
function props(extra: Partial<PublishedCatalogProps> = {}): PublishedCatalogProps {
  return {
    catalog: catalog(),
    loading: false,
    error: null,
    startingWorkId: null,
    onStart() {},
    onReload() {},
    ...extra,
  };
}
const render = (extra: Partial<PublishedCatalogProps> = {}) =>
  renderToStaticMarkup(createElement(PublishedCatalog, props(extra)));
type ElementProps = {
  children?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  'aria-label'?: string;
};
function elements(node: ReactNode): ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<ElementProps>(node)) return [];
  return [node, ...elements(node.props.children)];
}
function buttons(p: PublishedCatalogProps) {
  return elements(PublishedCatalog(p)).filter((e) => e.type === 'button');
}
function clickAction(p: PublishedCatalogProps, label: string) {
  const button = buttons(p).find((e) => e.props['aria-label']?.endsWith(label));
  assert.ok(button);
  button.props.onClick?.();
}

test('real React renders only actual safe public fields, no preset stories, covers or internal versions', () => {
  const data = catalog(),
    html = render({ catalog: data });
  assert.match(html, /已发布的世界/);
  for (const card of data.works)
    for (const text of [
      card.title,
      card.hook,
      card.identityLabel,
      card.description,
      card.experienceNote,
    ])
      assert.ok(html.includes(text));
  assert.equal((html.match(/<article /g) ?? []).length, 2);
  assert.equal((html.match(/<details /g) ?? []).length, 2);
  assert.ok(!html.includes('<img') && !html.includes('/art/') && !html.includes('县城黄毛'));
  assert.ok(
    !html.includes('privatePersona') && !html.includes('contentHash') && !html.includes('第 9 版'),
  );
});
test('existing world says continue, new world says enter, with no direct navigation or creation effects', () => {
  const html = render();
  assert.ok(html.includes('车站的一天，进入体验'));
  assert.ok(html.includes('另一段人生，继续这段人生'));
  assert.ok(!html.includes('href="/worlds/') && !html.includes('onclick="'));
});
test('callbacks receive actual schema-validated card values for both enter and resume', () => {
  const called: PublicationPlayerCatalog['works'][number][] = [];
  const p = props({
    onStart: (card) => {
      called.push(card);
    },
  });
  clickAction(p, '进入体验');
  clickAction(p, '继续这段人生');
  assert.deepEqual(called, p.catalog!.works);
  assert.equal(called[1]?.worldId, worldId);
});
test('pending own card has real busy label while every start and refresh stays disabled', () => {
  const p = props({ startingWorkId: id }),
    html = render({ startingWorkId: id });
  assert.ok(html.includes('车站的一天，正在打开'));
  assert.ok(html.includes('正在打开这段人生'));
  assert.ok(!html.includes('%'));
  const list = buttons(p);
  assert.ok(list.every((b) => b.props.disabled));
  let called = 0;
  const blocked = props({
    startingWorkId: id,
    onStart() {
      called++;
    },
    onReload() {
      called++;
    },
  });
  for (const b of buttons(blocked)) b.props.onClick?.();
  assert.equal(called, 0);
});
test('a pending ID absent from current catalog still prevents duplicate actions and does not fabricate a card', () => {
  const html = render({ startingWorkId: '30000000-0000-4000-8000-000000000099' });
  assert.equal((html.match(/<article /g) ?? []).length, 2);
  assert.ok(html.includes('正在打开这段人生'));
  assert.ok(
    buttons(props({ startingWorkId: '30000000-0000-4000-8000-000000000099' })).every(
      (b) => b.props.disabled,
    ),
  );
});
test('initial loading does not claim the directory is empty or unconfigured', () => {
  const html = render({ catalog: null, loading: true });
  assert.ok(html.includes('正在读取已发布的世界'));
  assert.ok(!html.includes('还没有') && !html.includes('暂未开放') && !html.includes('<article'));
});
test('refresh loading keeps previous actual cards readable and disables commands', () => {
  const p = props({ loading: true }),
    html = render({ loading: true });
  assert.ok(html.includes('正在刷新'));
  assert.equal((html.match(/<article /g) ?? []).length, 2);
  assert.ok(buttons(p).every((b) => b.props.disabled));
});
test('null ready catalog and a successful empty result are distinct honest states', () => {
  const missing = render({ catalog: null }),
    empty = render({ catalog: { works: [], nextCursor: null } });
  assert.ok(missing.includes('暂未开放') && !missing.includes('还没有已发布'));
  assert.ok(empty.includes('还没有已发布的世界') && !empty.includes('暂未开放'));
  assert.ok(!missing.includes('<article') && !empty.includes('<article'));
});
test('unknown start in an empty/unconnected catalog does not assert successful emptiness', () => {
  for (const data of [null, { works: [], nextCursor: null }]) {
    const html = render({ catalog: data, startingWorkId: id });
    assert.ok(html.includes('正在打开'));
    assert.ok(!html.includes('还没有已发布') && !html.includes('暂未开放'));
  }
});
test('failed reads retain exact user-facing error, retry callback, and no fabricated success/empty', () => {
  const html = render({ catalog: null, error: '目录暂时无法读取' });
  assert.match(html, /role="alert"/);
  assert.ok(html.includes('目录暂时无法读取') && html.includes('重新读取'));
  assert.ok(!html.includes('还没有') && !html.includes('<article'));
  let reload = 0;
  const p = props({
    catalog: null,
    error: '失败',
    onReload() {
      reload++;
    },
  });
  const button = buttons(p).find((b) => b.props.children === '重新读取');
  assert.ok(button);
  button.props.onClick?.();
  assert.equal(reload, 1);
});
test('failed refresh does not let stale cards enter while current availability is unconfirmed', () => {
  const html = render({ error: '刚才刷新失败' });
  assert.ok(html.includes('上次读取的目录'));
  const p = props({ error: '刚才刷新失败' });
  assert.ok(
    buttons(p)
      .filter((b) => b.props['aria-label'])
      .every((b) => b.props.disabled),
  );
});
test('HTML in public fields and error remains escaped, not executed', () => {
  const data = catalog();
  data.works[0]!.title = '<script>card</script>';
  data.works[0]!.description = '<img src=x onerror=bad>';
  const html = render({ catalog: data, error: '<script>failure</script>' });
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>') && !html.includes('<img src=x'));
});
test('unknown backstage fields fail the actual strict response schema and are never dumped in UI', () => {
  const data = catalog();
  const raw = {
    ...data,
    works: [
      {
        ...data.works[0],
        privatePersona: { background: 'SECRET_BACKSTAGE' },
        contentHash: 'SECRET_HASH',
      },
    ],
  };
  assert.equal(PublicationPlayerCatalogSchema.safeParse(raw).success, false);
  const html = render({ catalog: raw as unknown as PublicationPlayerCatalog });
  assert.ok(html.includes('暂时无法显示'));
  assert.ok(
    !html.includes('SECRET_BACKSTAGE') &&
      !html.includes('SECRET_HASH') &&
      !html.includes('<article'),
  );
});
test('malformed world identity never becomes a continue/enter affordance', () => {
  const data = catalog();
  const raw = { ...data, works: [{ ...data.works[0], worldId: 'other-owner-url' }] };
  const html = render({ catalog: raw as unknown as PublicationPlayerCatalog });
  assert.ok(!html.includes('<article'));
});
test('optional pagination requires both a real next cursor and a provided controller callback', () => {
  const data = catalog();
  data.nextCursor = other;
  let next = 0;
  assert.ok(!render({ catalog: data }).includes('查看更多世界'));
  const p = props({
    catalog: data,
    onNext() {
      next++;
    },
  });
  const b = buttons(p).find((e) => e.props.children === '查看更多世界');
  assert.ok(b);
  b.props.onClick?.();
  assert.equal(next, 1);
  assert.ok(!render({ onNext() {} }).includes('查看更多世界'));
});
test('pagination/refresh cannot run during loading or pending start, even if callbacks are called directly', () => {
  const data = catalog();
  data.nextCursor = other;
  for (const flags of [{ loading: true }, { startingWorkId: id }]) {
    let calls = 0;
    const p = props({
      catalog: data,
      ...flags,
      onNext() {
        calls++;
      },
      onReload() {
        calls++;
      },
      onStart() {
        calls++;
      },
    });
    for (const b of buttons(p)) b.props.onClick?.();
    assert.equal(calls, 0);
  }
});
test('rendering and category data updates never fetch or invoke the supplied callbacks automatically', () => {
  const original = globalThis.fetch;
  let fetches = 0,
    actions = 0;
  globalThis.fetch = async () => {
    fetches++;
    throw Error('controlled view must not fetch');
  };
  try {
    for (const flags of [{}, { loading: true }, { error: '失败' }, { startingWorkId: id }])
      renderToStaticMarkup(
        createElement(
          PublishedCatalog,
          props({
            ...flags,
            onStart() {
              actions++;
            },
            onReload() {
              actions++;
            },
            onNext() {
              actions++;
            },
          }),
        ),
      );
    assert.equal(fetches, 0);
    assert.equal(actions, 0);
  } finally {
    globalThis.fetch = original;
  }
});
test('long approved titles/identity/description remain in real output without static truncation', () => {
  const data = catalog();
  data.works[0]!.title = '标题'.repeat(40);
  data.works[0]!.identityLabel = '身份'.repeat(150);
  data.works[0]!.description = '正文'.repeat(800);
  const html = render({ catalog: data });
  assert.ok(
    html.includes(data.works[0]!.title) &&
      html.includes(data.works[0]!.identityLabel) &&
      html.includes(data.works[0]!.description),
  );
});
