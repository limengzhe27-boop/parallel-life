import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  ManuscriptSource,
  SourceReview,
  SourceReviewRow,
  SourceReviewTarget,
} from '../src/modules/settings/domain/publication-source-review-types.ts';

// Contract-bound UI fixtures only: no production matcher replacement, network, model, DB or DOM.
let active: Harness;
let build: (
  sources: ManuscriptSource[],
  content: Record<string, unknown>,
  baseline?: Record<string, unknown>,
) => SourceReview;
let calls = 0;
class Harness {
  values: unknown[] = [];
  cursor = 0;
  useState(initial: unknown) {
    const i = this.cursor++;
    if (!(i in this.values)) this.values[i] = initial;
    return [
      this.values[i],
      (v: unknown) => {
        this.values[i] = typeof v === 'function' ? v(this.values[i]) : v;
      },
    ];
  }
  useMemo(fn: () => unknown, deps: unknown[]) {
    const i = this.cursor++,
      old = this.values[i] as { deps: unknown[]; value: unknown } | undefined;
    if (!old || !deps.every((v, n) => Object.is(v, old.deps[n])))
      this.values[i] = { deps, value: fn() };
    return (this.values[i] as { value: unknown }).value;
  }
  render(
    sources: ManuscriptSource[],
    content: Record<string, unknown> = {},
    baselineContent?: Record<string, unknown>,
  ) {
    active = this;
    this.cursor = 0;
    return PublisherSourceReview({ sources, content, baselineContent });
  }
}
Object.assign(globalThis, {
  __sourceReviewUiHooks: {
    useState: (v: unknown) => active.useState(v),
    useMemo: (f: () => unknown, d: unknown[]) => active.useMemo(f, d),
  },
  __sourceReviewUiBuilder: (
    s: ManuscriptSource[],
    c: Record<string, unknown>,
    b?: Record<string, unknown>,
  ) => {
    calls++;
    return build(s, c, b);
  },
});
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('/publication-source-review.ts'))
      return { url: 'source-review-test:builder', shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'source-review-test:builder')
      return {
        format: 'module',
        shortCircuit: true,
        source:
          'export const buildPublicationSourceReview=(s,c,b)=>globalThis.__sourceReviewUiBuilder(s,c,b)',
      };
    if (url.endsWith('.module.css'))
      return {
        format: 'module',
        shortCircuit: true,
        source: 'export default new Proxy({}, {get:(_t,k)=>String(k)})',
      };
    if (url.endsWith('publisher-source-review.tsx')) {
      const source = readFileSync(new URL(url), 'utf8').replace(
        "import { useMemo, useState } from 'react';",
        'const {useMemo,useState}=globalThis.__sourceReviewUiHooks;',
      );
      return {
        format: 'module',
        shortCircuit: true,
        source: ts.transpileModule(source, {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            jsx: ts.JsxEmit.ReactJSX,
          },
        }).outputText,
      };
    }
    return nextLoad(url, context);
  },
});
const {
  PublisherSourceReview,
  locateSourceReviewRow,
  sourceReviewNeedsAttention,
  sourceReviewAssessment,
} = await import('../src/features/publisher/publisher-source-review.tsx');
type Native = ReactElement<Record<string, unknown>>;
function walk(value: unknown): Native[] {
  if (Array.isArray(value)) return value.flatMap(walk);
  if (!isValidElement(value)) return [];
  const e = value as Native;
  if (typeof e.type === 'function')
    return walk((e.type as (props: Record<string, unknown>) => ReactNode)(e.props));
  return [e, ...walk(e.props.children)];
}
function label(value: unknown): string {
  if (Array.isArray(value)) return value.map(label).join('');
  if (isValidElement(value)) return label((value.props as Record<string, unknown>).children);
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
function click(nodes: Native[], prefix: string) {
  const b = nodes.find((n) => n.type === 'button' && label(n).startsWith(prefix));
  assert.ok(b, prefix);
  (b.props.onClick as () => void)();
}
const target = (value: string, id = 't'): SourceReviewTarget => ({
  id,
  section: '人物',
  label: '小林 · 人物背景',
  value,
});
function row(
  sources: ManuscriptSource[],
  quote: string,
  fileIndex = 0,
  status: SourceReviewRow['status'] = 'unmapped',
): SourceReviewRow {
  const start = sources[fileIndex]!.content.indexOf(quote);
  assert.ok(start >= 0);
  return {
    id: `row-${fileIndex}-${start}`,
    fileIndex,
    filename: sources[fileIndex]!.filename,
    start,
    end: start + quote.length,
    line: sources[fileIndex]!.content.slice(0, start).split('\n').length,
    quote,
    status,
    assessment: {
      kind:
        status === 'literal_match'
          ? 'covered'
          : status === 'possible_rewrite'
            ? 'possible_change'
            : 'possible_omission',
      reason: '测试夹具已提供分类依据',
    },
    matches: [],
    notices: [],
  };
}
function fixture() {
  const sources = [
    { filename: '人物.md', content: '前言\n小林26岁。\n昨天约好今晚讨论。\n只是相识三年。\n尾声' },
  ];
  const literal = row(sources, '小林26岁。', 0, 'literal_match');
  literal.matches = [
    { kind: 'literal', target: target('小林26岁。'), missingNumbers: [], addedNumbers: [] },
  ];
  const unmapped = row(sources, '昨天约好今晚讨论。');
  const rewrite = row(sources, '只是相识三年。', 0, 'possible_rewrite');
  rewrite.matches = [
    {
      kind: 'candidate',
      target: target('一起工作三年。', 'r'),
      missingNumbers: [],
      addedNumbers: [],
    },
  ];
  const report: SourceReview = {
    rows: [literal, unmapped, rewrite],
    unlinkedTargets: [],
    warnings: [],
  };
  return { sources, report };
}
function setup(report: SourceReview) {
  build = () => report;
  calls = 0;
  return new Harness();
}
function html(
  h: Harness,
  sources: ManuscriptSource[],
  content: Record<string, unknown> = {},
  baselineContent?: Record<string, unknown>,
) {
  return renderToStaticMarkup(h.render(sources, content, baselineContent));
}

test('default filter prioritizes assessed risks; all switch exposes covered text without verification claims', () => {
  const { sources, report } = fixture(),
    h = setup(report);
  let nodes = walk(h.render(sources));
  assert.equal(nodes.filter((n) => n.type === 'article').length, 2);
  assert.match(label(nodes), /可能遗漏 \/ 改错（2）/);
  assert.doesNotMatch(html(h, sources), /已核实完成|100%|未导入/);
  click(nodes, '全部片段');
  nodes = walk(h.render(sources));
  assert.equal(nodes.filter((n) => n.type === 'article').length, 3);
  assert.match(label(nodes), /文字已对应/);
  assert.equal(
    nodes.find((n) => n.type === 'button' && label(n).startsWith('全部片段'))!.props[
      'aria-pressed'
    ],
    true,
  );
});
test('numeric arrays and generic notices do not upgrade covered rows; their details stay accessible', () => {
  const { sources, report } = fixture();
  const literal = report.rows[0]!;
  literal.matches[0]!.missingNumbers = ['26'];
  literal.matches[0]!.addedNumbers = ['28'];
  literal.notices = ['同名人物需核对'];
  assert.equal(sourceReviewNeedsAttention(literal, sources), false);
  const h = setup(report);
  click(walk(h.render(sources)), '文字已对应');
  const markup = html(h, sources);
  assert.match(markup, /数字文字线索（不单独判定改错）/);
  assert.match(markup, /未在该内容出现：26/);
  assert.match(markup, /另含这些数字：28/);
  assert.match(markup, /同名人物需核对/);
});
test('UTF16 offsets including emoji and CRLF produce exact quote and real surrounding text', () => {
  const sources = [{ filename: '含表情.md', content: '前一行\r\n😀小林26岁。\r\n下一行' }];
  const r = row(sources, '小林26岁。');
  assert.equal(r.start, 7);
  assert.equal(r.line, 2);
  const located = locateSourceReviewRow(sources, r);
  assert.ok(located);
  assert.equal(located.quote, sources[0]!.content.slice(r.start, r.end));
  assert.equal(located.before + located.quote + located.after, sources[0]!.content);
  const markup = html(setup({ rows: [r], unlinkedTargets: [], warnings: [] }), sources);
  assert.match(markup, /😀<mark>小林26岁。<\/mark>/);
  assert.match(markup, /第 2 行/);
  assert.match(markup, /定位原文，展开上下文/);
  assert.doesNotMatch(markup, /href=/);
});
test('invalid or stale source offset, line, filename and quote never become located source evidence', () => {
  const { sources, report } = fixture(),
    original = report.rows[0]!;
  for (const patch of [
    { start: -1 },
    { end: 999 },
    { start: 0.5 },
    { line: 99 },
    { filename: '另一份.md' },
    { quote: '伪造的原文' },
    { fileIndex: 3 },
  ])
    assert.equal(locateSourceReviewRow(sources, { ...original, ...patch }), null);
  const r = { ...original, quote: '伪造的原文' };
  assert.equal(sourceReviewNeedsAttention(r, sources), false);
  const h = setup({ rows: [r], unlinkedTargets: [], warnings: [] });
  click(walk(h.render(sources)), '暂不能判断');
  const markup = html(h, sources);
  assert.match(markup, /无法|未能定位/);
  assert.doesNotMatch(markup, /伪造的原文|<mark>/);
});
test('surrogate halves are rejected even if their UTF16 slices match a malformed quote', () => {
  const sources = [{ filename: 'emoji.md', content: '😀甲' }];
  const valid = row(sources, '😀');
  assert.ok(locateSourceReviewRow(sources, valid));
  assert.equal(
    locateSourceReviewRow(sources, { ...valid, end: 1, quote: sources[0]!.content.slice(0, 1) }),
    null,
  );
  assert.equal(
    locateSourceReviewRow(sources, { ...valid, start: 1, quote: sources[0]!.content.slice(1, 2) }),
    null,
  );
});
test('same filenames stay distinct by file ordinal and show their own exact text', () => {
  const sources = [
    { filename: '人物.md', content: '小林26岁。' },
    { filename: '人物.md', content: '小林28岁。' },
  ];
  const report: SourceReview = {
    rows: [row(sources, '小林26岁。'), row(sources, '小林28岁。', 1)],
    unlinkedTargets: [],
    warnings: [],
  };
  const markup = html(setup(report), sources);
  assert.match(markup, /文稿 1 · 人物.md/);
  assert.match(markup, /文稿 2 · 人物.md/);
  assert.match(markup, /小林26岁/);
  assert.match(markup, /小林28岁/);
});
test('targets remain full length, with at most two candidates and visible note when more are supplied', () => {
  const { sources, report } = fixture(),
    r = report.rows[1]!;
  const long = '内容完整内容'.repeat(300) + '最后一句';
  r.matches = [target(long, 'a'), target('候选二', 'b'), target('候选三不在此显示', 'c')].map(
    (t) => ({ target: t, kind: 'candidate', missingNumbers: [], addedNumbers: [] }),
  );
  const markup = html(setup({ rows: [r], unlinkedTargets: [], warnings: [] }), sources);
  assert.match(markup, /最后一句/);
  assert.equal((markup.match(/aria-label="对照内容/g) ?? []).length, 2);
  assert.match(markup, /仅展示前两个候选/);
  assert.doesNotMatch(markup, /候选三不在此显示/);
});
test('all limitations remain visible even when the needs-review filter has no rows', () => {
  const { sources, report } = fixture();
  report.rows = report.rows.slice(0, 1);
  report.warnings = ['最多400个片段', '最多512个内容', '尚未支持扩展内容'];
  const markup = html(setup(report), sources);
  report.warnings.forEach((w) => assert.ok(markup.includes(w)));
  assert.match(markup, /不代表原稿全部正确带入/);
  assert.match(markup, /不是完整来源覆盖率/);
});
test('unlinked actual fields are collapsed and described as possible existing material or supplements, not errors', () => {
  const { sources, report } = fixture();
  report.unlinkedTargets = [target('已有草稿的背景', 'old')];
  const h = setup(report);
  const nodes = walk(h.render(sources));
  const details = nodes.find(
    (n) => n.type === 'details' && label(n.props.children).includes('实际内容中未找到原文线索'),
  );
  assert.ok(details);
  assert.ok(!details.props.open);
  assert.match(label(details), /新增不代表错误，也不代表已经合理/);
  assert.doesNotMatch(renderToStaticMarkup(h.render(sources)), /已有草稿的背景/);
  (details.props.onToggle as (e: unknown) => void)({ currentTarget: { open: true } });
  assert.match(html(h, sources), /已有草稿的背景/);
});
test('changes to final content recompute even when its object identity is reused and reset filter to needs', () => {
  const { sources, report } = fixture();
  const h = setup(report),
    content = { version: 1 };
  h.render(sources, content);
  assert.equal(calls, 1);
  click(walk(h.render(sources, content)), '全部片段');
  h.render(sources, content);
  assert.equal(calls, 1);
  content.version = 2;
  build = () => ({ rows: [], unlinkedTargets: [], warnings: ['新版限制'] });
  const markup = html(h, sources, content);
  assert.equal(calls, 2);
  assert.match(markup, /新版限制/);
  assert.doesNotMatch(markup, /一起工作三年/);
  assert.match(markup, /本次没有形成/);
  const activeButton = walk(h.render(sources, content)).find(
    (n) => n.type === 'button' && n.props['aria-pressed'],
  );
  assert.match(label(activeButton), /可能遗漏 \/ 改错/);
});
test('editing source text recomputes instead of keeping its old mapping/context', () => {
  const { sources, report } = fixture();
  const h = setup(report),
    content = {};
  h.render(sources, content);
  sources[0]!.content = '新的原稿';
  build = () => ({ rows: [row(sources, '新的原稿')], unlinkedTargets: [], warnings: [] });
  const markup = html(h, sources, content);
  assert.equal(calls, 2);
  assert.match(markup, /新的原稿/);
  assert.doesNotMatch(markup, /昨天约好今晚讨论|只是相识三年/);
});
test('calculation error clears old report rather than displaying stale success', () => {
  const { sources, report } = fixture();
  const h = setup(report);
  h.render(sources, { version: 1 });
  build = () => {
    throw Error('test-only failure');
  };
  const markup = html(h, sources, { version: 2 });
  assert.match(markup, /未显示旧结果/);
  assert.doesNotMatch(markup, /只是相识三年|找到相同文字/);
});
test('no fragments is not a success badge or a claim that no source exists', () => {
  const { sources } = fixture();
  const markup = html(
    setup({ rows: [], unlinkedTargets: [], warnings: ['拆分范围有限'] }),
    sources,
  );
  assert.match(markup, /本次没有形成可对照的原文片段/);
  assert.match(markup, /拆分范围有限/);
  assert.doesNotMatch(markup, /全部正确|已完成核验|没有原稿/);
});
test('source and target markup are escaped and UI contains no editing, save or confirmation controls', () => {
  const sources = [{ filename: '安全.md', content: '<script>原稿</script>' }],
    r = row(sources, sources[0]!.content);
  r.matches = [
    {
      kind: 'candidate',
      target: target('<img src=x onerror=bad()>'),
      missingNumbers: [],
      addedNumbers: [],
    },
  ];
  const h = setup({ rows: [r], unlinkedTargets: [], warnings: [] });
  const markup = html(h, sources);
  assert.match(markup, /&lt;script&gt;/);
  assert.match(markup, /&lt;img/);
  assert.doesNotMatch(markup, /<script>|<img|<input|<textarea|<form/);
  assert.equal(walk(h.render(sources)).filter((n) => n.type === 'button').length, 4);
});
test('reviewing and changing filters never mutate source, final draft or report', () => {
  const { sources, report } = fixture(),
    content = { actors: [{ name: '原有人物' }] };
  const before = JSON.stringify([sources, content, report]);
  function freeze(v: unknown) {
    if (v && typeof v === 'object') {
      Object.freeze(v);
      Object.values(v).forEach(freeze);
    }
  }
  freeze(sources);
  freeze(content);
  freeze(report);
  const h = setup(report);
  click(walk(h.render(sources, content)), '全部片段');
  html(h, sources, content);
  assert.equal(JSON.stringify([sources, content, report]), before);
});

test('long single-line context is bounded while exact quote stays complete and surrogate pairs stay intact', () => {
  const sources = [
    { filename: '长行.md', content: '😀'.repeat(12000) + '原句完整保留' + '😀'.repeat(12000) },
  ];
  const r = row(sources, '原句完整保留');
  const located = locateSourceReviewRow(sources, r)!;
  assert.equal(located.quote, '原句完整保留');
  assert.ok(located.before.length <= 200);
  assert.ok(located.after.length <= 200);
  assert.equal(
    located.before + located.quote + located.after,
    sources[0]!.content.slice(located.contextStart, located.contextEnd),
  );
  assert.ok(!/[\uD800-\uDBFF]$/.test(located.after));
  assert.ok(!/^[\uDC00-\uDFFF]/.test(located.before));
  const markup = html(setup({ rows: [r], unlinkedTargets: [], warnings: [] }), sources);
  assert.match(markup, /仅显示原句及邻近片段/);
  assert.ok(markup.length < 8000);
});
test('rows initially render 20, more appends 20, and switching filter or content resets paging', () => {
  const sources = [
    { filename: '长稿.md', content: Array.from({ length: 45 }, (_, i) => `第${i}句。`).join('\n') },
  ];
  const report: SourceReview = {
    rows: Array.from({ length: 45 }, (_, i) => row(sources, `第${i}句。`)),
    unlinkedTargets: [],
    warnings: [],
  };
  const h = setup(report),
    content = {};
  assert.equal(walk(h.render(sources, content)).filter((n) => n.type === 'article').length, 20);
  assert.match(html(h, sources, content), /全部片段（45）/);
  click(walk(h.render(sources, content)), '显示更多片段');
  assert.equal(walk(h.render(sources, content)).filter((n) => n.type === 'article').length, 40);
  click(walk(h.render(sources, content)), '全部片段');
  assert.equal(walk(h.render(sources, content)).filter((n) => n.type === 'article').length, 20);
  click(walk(h.render(sources, content)), '显示更多片段');
  assert.equal(
    walk(h.render(sources, { changed: true })).filter((n) => n.type === 'article').length,
    20,
  );
});
test('unlinked fields load only on expand in batches and reset on filter change', () => {
  const { sources, report } = fixture();
  report.unlinkedTargets = Array.from({ length: 45 }, (_, i) => target(`独立值${i}`, `u${i}`));
  const h = setup(report),
    content = {};
  assert.doesNotMatch(html(h, sources, content), /独立值/);
  const open = () => {
    const d = walk(h.render(sources, content)).find(
      (n) => n.type === 'details' && label(n).includes('实际内容中未找到原文线索'),
    )!;
    (d.props.onToggle as (e: unknown) => void)({ currentTarget: { open: true } });
  };
  open();
  let markup = html(h, sources, content);
  assert.match(markup, /独立值19/);
  assert.doesNotMatch(markup, /独立值20/);
  click(walk(h.render(sources, content)), '显示更多实际内容');
  markup = html(h, sources, content);
  assert.match(markup, /独立值39/);
  assert.doesNotMatch(markup, /独立值40/);
  click(walk(h.render(sources, content)), '全部片段');
  assert.doesNotMatch(html(h, sources, content), /独立值/);
  open();
  assert.doesNotMatch(html(h, sources, content), /独立值20/);
});

test('CR-only source line numbers match the domain scanner without treating the whole file as one line', () => {
  const sources = [{ filename: 'classic.md', content: 'before\ronly original\rafter' }];
  const start = sources[0]!.content.indexOf('only original');
  const r: SourceReviewRow = {
    id: 'cr',
    fileIndex: 0,
    filename: 'classic.md',
    start,
    end: start + 'only original'.length,
    line: 2,
    quote: 'only original',
    status: 'unmapped',
    matches: [],
    notices: [],
  };
  const located = locateSourceReviewRow(sources, r);
  assert.ok(located);
  assert.equal(located.line, 2);
  assert.equal(located.quote, 'only original');
  assert.equal(located.before + located.quote + located.after, sources[0]!.content);
});

test('legacy missing assessment remains unresolved even with literal status or numeric arrays', () => {
  const { sources, report } = fixture();
  for (const r of report.rows) delete r.assessment;
  report.rows[0]!.matches[0]!.missingNumbers = ['26'];
  const h = setup(report);
  assert.equal(walk(h.render(sources)).filter((n) => n.type === 'article').length, 0);
  assert.match(html(h, sources), /暂不能判断（3）/);
  click(walk(h.render(sources)), '暂不能判断');
  assert.equal(walk(h.render(sources)).filter((n) => n.type === 'article').length, 3);
  assert.match(html(h, sources), /未匹配不代表遗漏/);
  assert.equal(sourceReviewAssessment(report.rows[0]!, sources).kind, 'unresolved');
});
test('explicit changes precede omissions, while instructions only appear in all and count separately', () => {
  const { sources, report } = fixture();
  report.rows[0]!.assessment = { kind: 'instruction', reason: '格式要求' };
  const h = setup(report);
  const articles = walk(h.render(sources)).filter((n) => n.type === 'article');
  assert.match(label(articles[0]), /可能改错/);
  assert.match(label(articles[1]), /可能遗漏/);
  assert.match(html(h, sources), /暂不能判断（0）/);
  assert.match(html(h, sources), /格式 \/ 整理说明 1 条/);
  click(walk(h.render(sources)), '全部片段');
  assert.match(html(h, sources), /格式要求/);
});
test('baseline is the exact read-only third argument; its same-object value change recomputes and resets views', () => {
  const { sources, report } = fixture();
  report.unlinkedTargets = [{ ...target('旧稿'), origin: 'existing' }];
  const h = setup(report),
    content = { value: '新' },
    baseline = { value: '尚未保存的本地旧稿' };
  let seen: unknown;
  build = (_s, _c, b) => {
    seen = b;
    return report;
  };
  h.render(sources, content, baseline);
  assert.equal(seen, baseline);
  click(walk(h.render(sources, content, baseline)), '全部片段');
  const detail = walk(h.render(sources, content, baseline)).find(
    (n) => n.type === 'details' && label(n).includes('实际内容中未找到原文线索'),
  )!;
  (detail.props.onToggle as (e: unknown) => void)({ currentTarget: { open: true } });
  assert.match(
    renderToStaticMarkup(h.render(sources, content, baseline)),
    /原有内容已保留（1 项）/,
  );
  const before = calls;
  baseline.value = '本地编辑已经变化';
  const nodes = walk(h.render(sources, content, baseline));
  assert.equal(calls, before + 1);
  assert.match(
    label(nodes.find((n) => n.type === 'button' && n.props['aria-pressed'])),
    /可能遗漏/,
  );
  assert.equal(
    nodes.find((n) => n.type === 'details' && label(n).includes('实际内容中未找到原文线索'))!.props
      .open,
    false,
  );
  assert.equal(baseline.value, '本地编辑已经变化');
});
test('unlinked origins separate authored old content, added supplements, changed values, and unknown baseline', () => {
  const { sources, report } = fixture();
  report.unlinkedTargets = [
    { ...target('原有值', 'old'), origin: 'existing' },
    { ...target('新补充值', 'new'), origin: 'added' },
    { ...target('改后的值', 'modified'), origin: 'modified', previousValue: '改前的值' },
    target('不明值', 'unknown'),
  ];
  const h = setup(report);
  assert.doesNotMatch(html(h, sources), /原有值|新补充值|改前的值|不明值/);
  const detail = walk(h.render(sources)).find(
    (n) => n.type === 'details' && label(n).includes('实际内容中未找到原文线索'),
  )!;
  (detail.props.onToggle as (e: unknown) => void)({ currentTarget: { open: true } });
  const markup = html(h, sources);
  for (const word of [
    '原有内容已保留（1 项）',
    '新增补充，待核对合理性（1 项）',
    '原有内容有改动（1 项）',
    '来源基线未知（1 项）',
    '改前的值',
    '改后的值',
    '不算本次新增',
  ])
    assert.ok(markup.includes(word), word);
  assert.doesNotMatch(markup, /已验证合理|AI新增错误/);
});
test('missing baseline stays undefined instead of an invented empty draft', () => {
  const { sources, report } = fixture();
  const h = setup(report);
  let seen: unknown = 'unset';
  build = (_s, _c, b) => {
    seen = b;
    return report;
  };
  h.render(sources);
  assert.equal(seen, undefined);
});
