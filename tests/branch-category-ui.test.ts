import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApprovedSeedSchema, type ApprovedSeed } from '../src/contracts/seeds.ts';
import { WorldBuildSchema, type WorldBuild } from '../src/contracts/world-build.ts';
import { OfficialLifeCardSchema, type OfficialLifeCard } from '../src/contracts/official-lives.ts';
import type { Task } from '../src/contracts/api.ts';
import type { BranchCategory } from '../src/features/discovery/branch-list.tsx';
import type { OfficialLifeCardView } from '../src/features/discovery/official-lives.tsx';

// Execute production React components, replacing only Node-incompatible CSS/TSX loading.
// Contract fixtures and server markup do not verify database ownership or browser layout.
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
const {
  BranchCategoryTabs,
  categorySavedSeeds,
  savedWorldIds,
  branchBuildLabel,
  savedBranchEntry,
  BranchList,
} = await import('../src/features/discovery/branch-list.tsx');
const { officialSavedWorlds, OfficialLivesView } =
  await import('../src/features/discovery/official-lives.tsx');
const { DiscoveryApp } = await import('../src/features/discovery/discovery-app.tsx');
const { PublicationController } =
  await import('../src/features/settings/publication-controller.tsx');
const at = '2026-10-12T00:00:00.000Z';
const world = randomUUID(),
  oldWorld = randomUUID(),
  otherWorld = randomUUID();
function seed(official = false, title = '相同标题'): ApprovedSeed {
  const common = {
    id: randomUUID(),
    createdAt: at,
    story: { title, premise: '保留原来的起点', opening: '用户自己的开场', tradeoff: '自己的取舍' },
    facts: [],
    people: [],
    portraitAssetId: null,
    assets: [],
  };
  return ApprovedSeedSchema.parse(
    official
      ? {
          ...common,
          events: [],
          source: { kind: 'official_life', presetId: 'county-yellow-hair', version: 1 },
        }
      : { ...common, profileVersion: 0, discoveryVersion: 0, directionId: randomUUID() },
  );
}
function build(
  s: ApprovedSeed,
  worldId = world,
  ready = true,
  status: Task['status'] | null = null,
): WorldBuild {
  return WorldBuildSchema.parse({
    seedId: s.id,
    worldId,
    ready,
    createdAt: at,
    task:
      status === null
        ? null
        : {
            id: randomUUID(),
            scope: { kind: 'world-build', proposalId: s.id },
            status,
            createdAt: at,
            updatedAt: at,
            errorCode: null,
            resultVersion: null,
          },
  });
}
function catalog(extra: Partial<OfficialLifeCard> = {}): OfficialLifeCard {
  return OfficialLifeCardSchema.parse({
    id: 'county-yellow-hair',
    version: 2,
    title: '新版目录标题',
    hook: '新版开场不属于旧存档',
    identityLabel: '新版身份',
    experienceNote: '实际体验说明',
    worldId: null,
    ...extra,
  });
}
function view(extra: Partial<OfficialLifeCardView> = {}): OfficialLifeCardView {
  return {
    id: 'county-yellow-hair',
    title: '精选人生',
    hook: '新版本开场',
    identity: '新版本身份',
    artwork: 'garage',
    hasSave: false,
    ...extra,
  };
}
function renderMine(extra: Partial<Parameters<typeof OfficialLivesView>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(OfficialLivesView, {
      cards: [],
      category: 'mine',
      onOpen() {},
      onReload() {},
      ...extra,
    }),
  );
}

test('all three categories render accessible exclusive selection', () => {
  for (const category of ['all', 'featured', 'mine'] as const) {
    const html = renderToStaticMarkup(
      createElement(BranchCategoryTabs, { selected: category, onSelect() {} }),
    );
    assert.match(html, /aria-label="分支分类"/);
    assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
    assert.equal((html.match(/aria-pressed="false"/g) ?? []).length, 2);
    for (const label of ['全部', '精选', '我的']) assert.ok(html.includes(label));
  }
});
test('category buttons dispatch selection alone even when clicked repeatedly', () => {
  const selections: BranchCategory[] = [];
  const nav = BranchCategoryTabs({ selected: 'all', onSelect: (next) => selections.push(next) });
  const buttons = nav.props.children as ReactElement<{ onClick: () => void }>[];
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls++;
    throw new Error('category must not request');
  };
  try {
    for (const button of buttons) button.props.onClick();
    const mineButton = buttons[2];
    assert.ok(mineButton);
    mineButton.props.onClick();
    assert.deepEqual(selections, ['all', 'featured', 'mine', 'mine']);
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test('featured contains no owned seeds; mine includes official, personal and unbuilt seeds', () => {
  const a = seed(true),
    b = seed(),
    c = seed();
  const builds = [build(a), build(b, otherWorld)];
  const directory = [catalog({ worldId: world })];
  assert.deepEqual(categorySavedSeeds([a, b, c], builds, directory, 'featured'), []);
  assert.deepEqual(categorySavedSeeds([a, b, c], builds, directory, 'mine'), [a, b, c]);
});
test('mine deduplicates a ready world across seeds without merging same-title different worlds', () => {
  const a = seed(true),
    b = seed(),
    c = seed();
  assert.deepEqual(
    categorySavedSeeds([a, b, c], [build(a), build(b), build(c, otherWorld)], [], 'mine'),
    [a, c],
  );
});
test('unready reserved world IDs are not saves and cannot suppress separate pending seeds', () => {
  const a = seed(),
    b = seed(),
    builds = [build(a, world, false, 'unknown'), build(b, world, false, 'failed')];
  assert.deepEqual(savedWorldIds([a, b], builds), []);
  assert.deepEqual(categorySavedSeeds([a, b], builds, [catalog({ worldId: world })], 'all'), [
    a,
    b,
  ]);
});
test('all deduplicates only exact current and legacy IDs, independently of title and source', () => {
  const a = seed(false, '非目录标题'),
    b = seed(true),
    c = seed(true);
  const builds = [build(a), build(b, oldWorld), build(c, otherWorld)];
  const directory = [
    catalog({ worldId: world, currentVersionWorldId: world, legacyWorldId: oldWorld }),
  ];
  assert.deepEqual(categorySavedSeeds([a, b, c], builds, directory, 'all'), [c]);
  assert.deepEqual(categorySavedSeeds([a, b, c], builds, [], 'all'), [a, b, c]);
});
test('duplicate unbuilt seed rows are filtered by seed identity without merging separate seeds', () => {
  const a = seed(),
    b = seed();
  assert.deepEqual(categorySavedSeeds([a, a, b], [], [], 'mine'), [a, b]);
});
test('official supplement deduplicates aliases and parent IDs but preserves different old/new saves', () => {
  const a = view({
    hasSave: true,
    worldId: world,
    currentVersionWorldId: world,
    legacyWorldId: oldWorld,
  });
  const b = view({ id: 'only-child', worldId: oldWorld, currentVersionWorldId: otherWorld });
  const saves = officialSavedWorlds([a, b], [world]);
  assert.deepEqual(
    saves.map((s) => [s.worldId, s.legacy]),
    [
      [oldWorld, true],
      [otherWorld, false],
    ],
  );
});
test('hasSave and catalog version metadata alone never fabricate an owned world', () => {
  assert.deepEqual(
    officialSavedWorlds([view({ hasSave: true, hasNewVersion: true, version: 3 })]),
    [],
  );
  assert.ok(!renderMine({ cards: [view({ hasSave: true })] }).includes('/worlds/'));
});
test('mine real React cards link both saved versions and do not offer template creation', () => {
  const html = renderMine({
    cards: [
      view({
        hasSave: true,
        worldId: world,
        currentVersionWorldId: world,
        legacyWorldId: oldWorld,
      }),
    ],
  });
  assert.equal((html.match(/<article /g) ?? []).length, 2);
  for (const id of [world, oldWorld]) assert.match(html, new RegExp('href="/worlds/' + id + '"'));
  assert.ok(html.includes('继续体验') && html.includes('继续原存档'));
  assert.ok(html.includes('体验说明') && html.includes('原创插画'));
  assert.ok(!html.includes('新版本身份') && !html.includes('新版本开场'));
  assert.ok(!html.includes('开启新版') && !html.includes('打开这部手机'));
});
test('parent represented official save renders once with owned story through shared LifeCard', () => {
  const a = seed(true),
    b = build(a);
  const personal = renderToStaticMarkup(
    createElement(BranchList, { items: [savedBranchEntry(a, b, [])], onOpen() {} }),
  );
  const supplement = renderMine({
    cards: [view({ worldId: world })],
    representedWorldIds: savedWorldIds([a], [b]),
  });
  assert.equal((personal.match(/<article /g) ?? []).length, 1);
  assert.ok(personal.includes(a.story.opening) && personal.includes('继续体验'));
  assert.ok(!supplement.includes('<article '));
  assert.ok(supplement.includes('精选存档已列在下方'));
});
test('unrelated personal save cannot imply an owned official template', () => {
  const html = renderMine({ cards: [view()], representedWorldIds: [world] });
  assert.ok(html.includes('还没有保存的精选人生'));
  assert.ok(!html.includes('精选存档已列在下方'));
});
test('initial connection/catalog loading never renders a successfully empty mine list', () => {
  const html = renderMine({ loading: true });
  assert.match(html, /role="status"/);
  assert.ok(html.includes('正在核对'));
  assert.ok(!html.includes('还没有保存') && !html.includes('/worlds/'));
});
test('catalog reload pending cannot publish stale cards as current authenticated saved data', () => {
  const html = renderMine({ cards: [view({ worldId: world })], loading: true });
  assert.ok(!html.includes('/worlds/') && !html.includes('<article '));
  assert.ok(html.includes('正在核对'));
});
test('catalog read failure keeps the real error/reload and suppresses stale save or empty claims', () => {
  const html = renderMine({
    cards: [view({ worldId: world })],
    loadError: '会话未连接 <script>secret</script>',
  });
  assert.match(html, /role="alert"/);
  assert.ok(html.includes('重新加载') && html.includes('暂时无法核对'));
  assert.ok(html.includes('&lt;script&gt;') && !html.includes('<script>'));
  assert.ok(!html.includes('/worlds/') && !html.includes('还没有保存'));
});
test('only successfully loaded empty catalog permits the empty saved state', () => {
  const html = renderMine();
  assert.ok(html.includes('还没有保存的精选人生'));
  assert.ok(!html.includes('role="alert"') && !html.includes('正在核对'));
});
test('unknown start and a pending start keep recovery visible in mine without a fake save', () => {
  for (const extra of [
    { errors: { 'county-yellow-hair': '上次打开的结果还未确认' } },
    { pendingId: 'county-yellow-hair' },
  ]) {
    const html = renderMine({ cards: [view()], onShowFeatured() {}, ...extra });
    assert.ok(html.includes('查看精选中的恢复操作'));
    assert.ok(!html.includes('还没有保存') && !html.includes('/worlds/'));
  }
});
test('featured/all keep explicit newer-version creation and retained old save disclosure', () => {
  for (const category of ['all', 'featured'] as const) {
    const html = renderToStaticMarkup(
      createElement(OfficialLivesView, {
        category,
        cards: [
          view({ hasSave: true, worldId: oldWorld, legacyWorldId: oldWorld, hasNewVersion: true }),
        ],
        onOpen() {},
        onStartNewVersion() {},
        onOpenLegacy() {},
        onReload() {},
      }),
    );
    assert.ok(html.includes('精选 · 人生设定目录'));
    assert.ok(html.includes('继续原存档') && html.includes('开启新版'));
    assert.ok(html.includes('原存档已保留'));
  }
});
test('old seed title/opening/tradeoff and identity never borrow a newer catalog version', () => {
  const a = seed(true, '原存档标题');
  const entry = savedBranchEntry(a, build(a), [catalog()]);
  assert.equal(entry.title, '原存档标题');
  assert.equal(entry.description, '用户自己的开场');
  assert.equal(entry.tradeoff, '自己的取舍');
  assert.equal(entry.identity, undefined);
  assert.equal(savedBranchEntry(a, build(a), [catalog({ version: 1 })]).identity, '新版身份');
  a.setup = { identity: '保存的身份', place: '', tone: '' };
  assert.equal(savedBranchEntry(a, build(a), [catalog({ version: 1 })]).identity, '保存的身份');
});
test('build status cards preserve progress/failed/unknown/cancelled/conflict without claiming ready', () => {
  const expected = {
    queued: '正在准备',
    running: '正在准备',
    failed: '查看恢复',
    unknown: '待确认',
    cancelled: '已停止',
    conflict: '需要更新',
    succeeded: '查看人生起点',
  } as const;
  for (const [status, label] of Object.entries(expected)) {
    const a = seed(),
      pending = build(a, world, false, status as Task['status']);
    const entry = savedBranchEntry(a, pending, []);
    assert.equal(entry.ready, false);
    assert.equal(entry.worldId, undefined);
    assert.ok(branchBuildLabel(pending).includes(label));
    const html = renderToStaticMarkup(createElement(BranchList, { items: [entry], onOpen() {} }));
    assert.ok(html.includes(label));
    assert.ok(!html.includes('继续体验'));
    assert.ok(html.includes('体验说明'));
  }
  assert.equal(branchBuildLabel(), '查看人生起点');
});
test('repeated category rendering preserves saved IDs/data and never dispatches start or retry', () => {
  const cards = [
    Object.freeze(
      view({ worldId: world, legacyWorldId: oldWorld, hasSave: true, hasNewVersion: true }),
    ),
  ];
  Object.freeze(cards);
  const invoked: string[] = [];
  for (const category of ['all', 'mine', 'featured', 'mine', 'all'] as const)
    renderToStaticMarkup(
      createElement(OfficialLivesView, {
        category,
        cards,
        onOpen: (id) => {
          invoked.push('open:' + id);
        },
        onStartNewVersion: (id) => {
          invoked.push('start:' + id);
        },
        onOpenLegacy: (id) => {
          invoked.push('old:' + id);
        },
        onReload: () => {
          invoked.push('reload');
        },
      }),
    );
  assert.deepEqual(invoked, []);
  assert.deepEqual(
    officialSavedWorlds(cards).map((s) => s.worldId),
    [world, oldWorld],
  );
});
test('actual DiscoveryApp initial render retains bottom navigation and loading without network writes', () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error('SSR must not contact backend');
  };
  try {
    const html = renderToStaticMarkup(createElement(DiscoveryApp));
    assert.ok(html.includes('aria-label="分支分类"'));
    assert.ok(html.includes('aria-label="已发布的世界"'));
    assert.ok(html.includes('正在读取已发布的世界'));
    assert.ok(html.includes('data-published-worlds=""'));
    assert.ok(!html.includes('href="/published"'));
    assert.ok(!html.includes('返回分支'));
    assert.ok(html.includes('正在打开人生目录') && html.includes('正在翻开你的故事'));
    assert.match(html, /aria-label="主导航"/);
    assert.ok(html.includes('href="/"') && html.includes('href="/#profile"'));
    assert.ok(html.includes('href="/possibilities" aria-current="page"'));
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('embedded publication catalogue shares primary navigation while standalone route preserves its return link', () => {
  const embedded = renderToStaticMarkup(
    createElement<{ embedded?: boolean }>(PublicationController, { embedded: true }),
  );
  const standalone = renderToStaticMarkup(createElement(PublicationController));
  assert.match(embedded, /aria-label="已发布的世界"/);
  assert(!embedded.includes('返回分支'));
  assert(!embedded.includes('min-height:100dvh'));
  assert(standalone.includes('返回分支'));
  assert(standalone.includes('href="/possibilities"'));
});
