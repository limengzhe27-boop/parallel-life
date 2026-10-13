import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { isValidElement, type ReactElement } from 'react';
import {
  PublisherClient,
  PublisherClientError,
} from '../src/features/publisher/publisher-client.ts';
import type {
  PublisherPreparationInput,
  PublisherPreparationRecord,
} from '../src/contracts/publisher-preparation.ts';

// Isolated component handler harness, not a DOM/browser or real service acceptance test.
let active: Harness;
type Effect = { deps: unknown[]; cleanup?: () => void };
class Harness {
  values: unknown[] = [];
  cursor = 0;
  effects = new Map<number, Effect>();
  queued: Array<() => void> = [];
  useState(initial: unknown) {
    const index = this.cursor++;
    if (!(index in this.values))
      this.values[index] = typeof initial === 'function' ? initial() : initial;
    return [
      this.values[index],
      (next: unknown) => {
        this.values[index] = typeof next === 'function' ? next(this.values[index]) : next;
      },
    ];
  }
  useRef(initial: unknown) {
    const index = this.cursor++;
    if (!(index in this.values)) this.values[index] = { current: initial };
    return this.values[index];
  }
  useEffect(callback: () => (() => void) | undefined, deps: unknown[]) {
    const index = this.cursor++,
      old = this.effects.get(index);
    if (old && deps.every((value, i) => Object.is(value, old.deps[i]))) return;
    this.queued.push(() => {
      old?.cleanup?.();
      this.effects.set(index, { deps, cleanup: callback() });
    });
  }
  render(props: Props) {
    active = this;
    this.cursor = 0;
    const result = PublisherImportDialog(props);
    const effects = this.queued.splice(0);
    effects.forEach((effect) => effect());
    return walk(result);
  }
  unmount() {
    this.effects.forEach((effect) => effect.cleanup?.());
  }
}
const hookKey = '__publisherPreparationTestHooks';
Object.assign(globalThis, {
  [hookKey]: {
    useState: (value: unknown) => active.useState(value),
    useRef: (value: unknown) => active.useRef(value),
    useEffect: (callback: () => (() => void) | undefined, deps: unknown[]) =>
      active.useEffect(callback, deps),
  },
});
Object.assign(globalThis, { window: { innerHeight: 844 } });
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.module.css'))
      return {
        format: 'module',
        shortCircuit: true,
        source: 'export default new Proxy({}, {get:(_t,k)=>String(k)})',
      };
    if (
      url.endsWith('publisher-import-dialog.tsx') ||
      url.endsWith('publisher-source-review.tsx') ||
      url.endsWith('publisher-schedule-review.tsx')
    ) {
      const source = readFileSync(new URL(url), 'utf8');
      const original = url.endsWith('publisher-import-dialog.tsx')
        ? source.replace(
            "import { useEffect, useRef, useState } from 'react';",
            `const { useEffect, useRef, useState } = globalThis.${hookKey};`,
          )
        : source;
      return {
        format: 'module',
        shortCircuit: true,
        source: ts.transpileModule(original, {
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
  PublisherImportDialog,
  manuscriptFingerprint,
  preparationMatches,
  preparationChanges,
  preparationChangeSummary,
} = await import('../src/features/publisher/publisher-import-dialog.tsx');
type Props = Parameters<typeof PublisherImportDialog>[0];
type Native = ReactElement<Record<string, unknown>>;
function walk(value: unknown): Native[] {
  if (Array.isArray(value)) return value.flatMap(walk);
  if (!isValidElement(value)) return [];
  const element = value as Native;
  return [element, ...walk(element.props.children)];
}
function label(value: unknown): string {
  if (Array.isArray(value)) return value.map(label).join('');
  if (isValidElement(value)) return label((value.props as Record<string, unknown>).children);
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
function button(nodes: Native[], name: string) {
  const found = nodes.find((n) => n.type === 'button' && label(n) === name);
  assert.ok(found, name);
  return found;
}
function click(node: Native) {
  assert.ok(!node.props.disabled, label(node));
  (node.props.onClick as () => void)();
}
const settle = async () => {
  for (let n = 0; n < 8; n++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const workId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const commandId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const base = { world: { hiddenContext: '作者秘密', startAt: '' }, actors: [] };
const source = [{ filename: '粘贴文稿.md', content: '这是一个自由文稿，没有固定表格。' }];
function record(input?: PublisherPreparationInput): PublisherPreparationRecord {
  return {
    commandId: input?.commandId ?? commandId,
    workId,
    draftVersion: input?.expectedDraftVersion ?? 0,
    status: 'succeeded',
    material: {
      ...(input?.scope ? { scope: input.scope } : {}),
      currentContent: input?.currentContent ?? base,
      sources: input?.sources ?? source,
    },
    result: {
      updatedContent: {
        ...base,
        actors: [{ key: 'alice', name: '小林' }],
        history: [{ key: 'fact_a', text: '作者明确的过去' }],
        timeline: { stages: [{ key: 'stage_a', title: '初到' }] },
      },
      summary: '合成测试结果',
      notes: [{ kind: 'supplemented', text: '补充一位人物' }],
      issues: [{ path: ['world', 'startAt'], code: 'invalid_format' }],
    },
    errorCode: null,
    createdAt: '2026-10-13T01:00:00Z',
    updatedAt: '2026-10-13T01:00:00Z',
  };
}
function setup(overrides: Partial<Props> = {}) {
  const applied: unknown[] = [],
    posts: PublisherPreparationInput[] = [],
    queries: string[] = [];
  let closed = 0;
  const props: Props = {
    workId,
    version: 0,
    content: base,
    disabled: false,
    preparationClient: {
      latestPreparation: async () => {
        queries.push('latest');
        return { preparation: null };
      },
      getPreparation: async (_work, id) => {
        queries.push(id);
        return record();
      },
      prepareManuscript: async (_work, input) => {
        posts.push(input);
        return record(input);
      },
    },
    onApply: (...args) => applied.push(args),
    onClose: () => closed++,
    ...overrides,
  };
  const h = new Harness();
  return { h, props, applied, posts, queries, closed: () => closed, render: () => h.render(props) };
}
async function loadText(s: ReturnType<typeof setup>, value = source[0]!.content) {
  s.render();
  await settle();
  let nodes = s.render();
  const input = nodes.find((n) => n.type === 'textarea')!;
  (input.props.onChange as (e: unknown) => void)({ target: { value } });
  nodes = s.render();
  click(button(nodes, '读取粘贴内容'));
  await settle();
  return s.render();
}
function confirm(s: ReturnType<typeof setup>) {
  for (const box of s.render().filter((n) => n.type === 'input' && n.props.type === 'checkbox'))
    (box.props.onChange as (e: unknown) => void)({ target: { checked: true } });
}

test('semantic baseline survives JSONB property order but rejects version/work/content/source/command mismatch', () => {
  const r = record();
  assert.equal(
    manuscriptFingerprint(base),
    manuscriptFingerprint({ actors: [], world: { startAt: '', hiddenContext: '作者秘密' } }),
  );
  assert.ok(
    preparationMatches(
      r,
      workId,
      0,
      { actors: [], world: { startAt: '', hiddenContext: '作者秘密' } },
      source,
      commandId,
    ),
  );
  assert.ok(!preparationMatches(r, 'other', 0, base));
  assert.ok(!preparationMatches(r, workId, 1, base));
  assert.ok(!preparationMatches(r, workId, 0, { ...base, actors: [{}] }));
  assert.ok(!preparationMatches(r, workId, 0, base, [{ ...source[0]!, content: '新稿' }]));
  assert.ok(!preparationMatches(r, workId, 0, base, source, 'other'));
});
test('diff explains added people, established facts and timeline, retains complete changed sections', () => {
  const after = record().result!.updatedContent;
  assert.deepEqual(preparationChanges(base, after), ['actors', 'history', 'timeline']);
  const text = preparationChangeSummary(base, after).join('\n');
  assert.match(text, /人物 · 新增：小林/);
  assert.match(text, /已发生事实 · 新增：作者明确的过去/);
  assert.match(text, /时间线阶段 · 新增：初到/);
});
test('file/text reading never calls AI, consent and two review checks precede local apply', async () => {
  const s = setup();
  const before = JSON.stringify(base);
  let nodes = await loadText(s);
  assert.equal(s.posts.length, 0);
  assert.match(label(nodes), /发送给项目文字模型/);
  click(button(nodes, '让 AI 整理本批文稿'));
  await settle();
  nodes = s.render();
  assert.equal(s.posts.length, 1);
  assert.equal(s.applied.length, 0);
  const sourcePanel = nodes.find(
    (n) => n.type === 'details' && n.props.className === 'sourceInput',
  );
  assert.equal(sourcePanel?.props.open, false);
  const modelPanel = nodes.find(
    (n) => n.type === 'details' && label(n).includes('查看 AI 的整理说明与补充内容'),
  );
  assert.ok(modelPanel);
  assert.ok(!modelPanel.props.open);
  const problemPanel = nodes.find(
    (n) => n.type === 'section' && n.props['aria-label'] === '需要处理的问题',
  );
  assert.ok(problemPanel, 'validation problems remain outside the collapsed model explanation');

  assert.ok(button(nodes, '填入当前编辑稿').props.disabled);
  assert.match(label(nodes), /AI 补充的内容/);
  assert.doesNotMatch(label(nodes), /作者秘密/); // unchanged backstage content is not a change
  confirm(s);
  click(button(s.render(), '填入当前编辑稿'));
  assert.equal(s.applied.length, 1);
  assert.equal(s.closed(), 1);
  assert.equal(JSON.stringify(base), before);
});
test('one immediate double-click creates only one POST and stable command', async () => {
  const pending = deferred<PublisherPreparationRecord>();
  const s = setup();
  s.props.preparationClient!.prepareManuscript = async (_w, input) => {
    s.posts.push(input);
    return pending.promise;
  };
  const nodes = await loadText(s),
    start = button(nodes, '让 AI 整理本批文稿');
  click(start);
  click(start);
  assert.equal(s.posts.length, 1);
  pending.resolve(record(s.posts[0]));
  await settle();
  assert.match(label(s.render()), /核对整理结果/);
});
test('network uncertainty performs no automatic second POST; recovery queries original ID', async () => {
  const s = setup();
  s.props.preparationClient!.prepareManuscript = async (_w, input) => {
    s.posts.push(input);
    throw Error('lost');
  };
  s.props.preparationClient!.getPreparation = async (_w, id) => {
    s.queries.push(id);
    return record(s.posts[0]);
  };
  click(button(await loadText(s), '让 AI 整理本批文稿'));
  await settle();
  assert.equal(s.posts.length, 1);
  assert.match(label(s.render()), /尚未确认整理结果/);
  click(button(s.render(), '查询已有整理结果'));
  await settle();
  assert.equal(s.posts.length, 1);
  assert.ok(s.queries.includes(s.posts[0]!.commandId));
  assert.match(label(s.render()), /核对整理结果/);
});
test('explicit new preparation uses a new command ID, while failed/unknown cannot be applied', async () => {
  const s = setup();
  s.props.preparationClient!.prepareManuscript = async (_w, input) => {
    s.posts.push(input);
    return { ...record(input), status: 'unknown', result: null };
  };
  click(button(await loadText(s), '让 AI 整理本批文稿'));
  await settle();
  assert.ok(button(s.render(), '填入当前编辑稿').props.disabled);
  click(button(s.render(), '重新整理（新请求）'));
  await settle();
  assert.equal(s.posts.length, 2);
  assert.notEqual(s.posts[0]!.commandId, s.posts[1]!.commandId);
});
test('running status can be queried but cannot launch another model request', async () => {
  const s = setup();
  s.props.preparationClient!.prepareManuscript = async (_w, input) => {
    s.posts.push(input);
    return { ...record(input), status: 'running', result: null };
  };
  click(button(await loadText(s), '让 AI 整理本批文稿'));
  await settle();
  assert.ok(button(s.render(), '重新整理（新请求）').props.disabled);
  assert.ok(!button(s.render(), '查询已有整理结果').props.disabled);
});
test('changing manuscript invalidates a confirmed suggestion and clears apply', async () => {
  const s = setup();
  click(button(await loadText(s), '让 AI 整理本批文稿'));
  await settle();
  confirm(s);
  assert.ok(!button(s.render(), '填入当前编辑稿').props.disabled);
  const text = s.render().find((n) => n.type === 'textarea')!;
  (text.props.onChange as (e: unknown) => void)({ target: { value: '另一份原稿' } });
  assert.ok(button(s.render(), '填入当前编辑稿').props.disabled);
  assert.doesNotMatch(label(s.render()), /合成测试结果/);
});
test('old POST after work switch or permission loss cannot render or apply', async () => {
  for (const change of ['work', 'permission'] as const) {
    const pending = deferred<PublisherPreparationRecord>();
    const s = setup();
    s.props.preparationClient!.prepareManuscript = async (_w, input) => {
      s.posts.push(input);
      return pending.promise;
    };
    click(button(await loadText(s), '让 AI 整理本批文稿'));
    if (change === 'work') s.props.workId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    else s.props.disabled = true;
    s.render();
    pending.resolve(record(s.posts[0]));
    await settle();
    assert.doesNotMatch(label(s.render()), /合成测试结果/);
    assert.equal(s.applied.length, 0);
    assert.ok(button(s.render(), '填入当前编辑稿').props.disabled);
  }
});
test('stale captured apply handler rejects latest baseline before effects run', async () => {
  const s = setup();
  click(button(await loadText(s), '让 AI 整理本批文稿'));
  await settle();
  confirm(s);
  const oldApply = button(s.render(), '填入当前编辑稿');
  s.props.content = { ...base, edited: true };
  s.render();
  click(oldApply);
  assert.equal(s.applied.length, 0);
});
test('refresh restores matching staff latest result, never saves or calls AI', async () => {
  const s = setup();
  s.props.preparationClient!.latestPreparation = async () => ({ preparation: record() });
  s.render();
  await settle();
  const nodes = s.render();
  assert.match(label(nodes), /合成测试结果/);
  assert.match(label(nodes), /自由文稿/);
  assert.equal(s.posts.length, 0);
  assert.equal(s.applied.length, 0);
  assert.ok(button(nodes, '填入当前编辑稿').props.disabled);
});
test('refresh refuses saved draft differing from original unsaved currentContent', async () => {
  const s = setup({ content: { ...base, edited: true } });
  s.props.preparationClient!.latestPreparation = async () => ({ preparation: record() });
  s.render();
  await settle();
  assert.match(label(s.render()), /不同的作品、原稿或编辑版本/);
  assert.doesNotMatch(label(s.render()), /合成测试结果/);
});
test('late latest response after editing input and after unmount does not restore stale content', async () => {
  const pending = deferred<{ preparation: PublisherPreparationRecord | null }>();
  const s = setup();
  s.props.preparationClient!.latestPreparation = async () => pending.promise;
  s.render();
  s.h.unmount();
  pending.resolve({ preparation: record() });
  await settle();
  assert.doesNotMatch(label(s.render()), /合成测试结果/);
});
test('pure parsing remains available without model client and leaves missing fields honest', async () => {
  const s = setup({ preparationClient: undefined });
  const nodes = await loadText(s);
  assert.ok(button(nodes, '让 AI 整理本批文稿').props.disabled);
  click(button(nodes, '仅解析，不调用 AI'));
  assert.match(label(s.render()), /纯解析结果/);
  assert.equal(s.posts.length, 0);
  assert.equal(s.applied.length, 0);
});
test('client uses staff CSRF, 130 second preparation timeout, read-only 20 second queries', async () => {
  const calls: Array<{ path: string; options: RequestInit | undefined }> = [],
    timeouts: number[] = [];
  const timeout = AbortSignal.timeout;
  AbortSignal.timeout = (ms: number) => {
    timeouts.push(ms);
    return new AbortController().signal;
  };
  try {
    const client = new PublisherClient((async (path, options) => {
      calls.push({ path: String(path), options });
      if (String(path).endsWith('/session'))
        return Response.json({
          publisher: {
            id: commandId,
            username: 'writer',
            displayName: '合成员工',
            permissions: ['edit'],
          },
          csrfToken: 'a'.repeat(43),
        });
      if (options?.method === 'POST' || String(path).includes('?')) return Response.json(record());
      return Response.json({ preparation: record() });
    }) as typeof fetch);
    await client.session();
    const input = { commandId, expectedDraftVersion: 0, currentContent: base, sources: source };
    await client.prepareManuscript(workId, input);
    await client.getPreparation(workId, commandId);
    await client.latestPreparation(workId);
    assert.deepEqual(timeouts, [20000, 130000, 20000, 20000]);
    assert.equal(new Headers(calls[1]!.options!.headers).get('X-Publisher-CSRF'), 'a'.repeat(43));
    assert.deepEqual(JSON.parse(String(calls[1]!.options!.body)), input);
    assert.equal(calls[2]!.options!.method, 'GET');
    assert.equal(calls[3]!.options!.method, 'GET');
    assert.equal(calls[2]!.options!.body, undefined);
  } finally {
    AbortSignal.timeout = timeout;
  }
});
test('preparation client validates budget before transport and never automatically retries lost response', async () => {
  let calls = 0;
  const client = new PublisherClient((async () => {
    calls++;
    throw Error('lost');
  }) as typeof fetch);
  const input = { commandId, expectedDraftVersion: 0, currentContent: base, sources: source };
  assert.throws(() =>
    client.prepareManuscript(workId, {
      ...input,
      sources: [{ filename: 'large.md', content: 'a'.repeat(131073) }],
    }),
  );
  assert.equal(calls, 0);
  await assert.rejects(client.prepareManuscript(workId, input), { code: 'UNAVAILABLE' });
  assert.equal(calls, 1);
});

test('404 recovery offers explicit same-command resend without automatically calling model', async () => {
  const s = setup();
  let missing = true;
  s.props.preparationClient!.prepareManuscript = async (_w, input) => {
    s.posts.push(input);
    if (missing) throw Error('lost before server');
    return record(input);
  };
  s.props.preparationClient!.getPreparation = async () => {
    throw new PublisherClientError('NOT_FOUND');
  };
  click(button(await loadText(s), '让 AI 整理本批文稿'));
  await settle();
  click(button(s.render(), '查询已有整理结果'));
  await settle();
  assert.equal(s.posts.length, 1);
  missing = false;
  click(button(s.render(), '核对后重发本次请求'));
  await settle();
  assert.equal(s.posts.length, 2);
  assert.deepEqual(s.posts[0], s.posts[1]);
  assert.match(label(s.render()), /核对整理结果/);
});

test('definite API failures are not described as unknown or offered same-command resend', async () => {
  for (const [code, expected] of [
    ['RATE_LIMITED', /本小时整理次数/],
    ['INVALID_STATE', /已有整理任务/],
    ['FORBIDDEN', /没有这项操作/],
    ['VERSION_CONFLICT', /已被其他人更新/],
  ]) {
    const s = setup();
    s.props.preparationClient!.prepareManuscript = async () => {
      throw new PublisherClientError(code as string);
    };
    click(button(await loadText(s), '让 AI 整理本批文稿'));
    await settle();
    const text = label(s.render());
    assert.match(text, expected as RegExp);
    assert.doesNotMatch(text, /尚未确认整理结果|核对后重发本次请求/);
    assert.ok(button(s.render(), '填入当前编辑稿').props.disabled);
  }
});
test('server response from different source or command is never applied', async () => {
  for (const wrong of ['source', 'command']) {
    const s = setup();
    s.props.preparationClient!.prepareManuscript = async (_w, input) => {
      const value = record(input);
      if (wrong === 'source') value.material.sources = [{ filename: 'other', content: 'OTHER' }];
      else value.commandId = commandId;
      return value;
    };
    click(button(await loadText(s), '让 AI 整理本批文稿'));
    await settle();
    assert.doesNotMatch(label(s.render()), /合成测试结果/);
    assert.ok(button(s.render(), '填入当前编辑稿').props.disabled);
  }
});
test('failed and succeeded-without-result records never enable applying', async () => {
  for (const status of ['failed', 'succeeded'] as const) {
    const s = setup();
    s.props.preparationClient!.latestPreparation = async () => ({
      preparation: { ...record(), status, result: null },
    });
    s.render();
    await settle();
    assert.ok(button(s.render(), '填入当前编辑稿').props.disabled);
    assert.equal(s.posts.length, 0);
  }
});

test('adding explicit null and removing unknown keys remain visible changes', () => {
  assert.deepEqual(preparationChanges({}, { extra: null }), ['extra']);
  assert.deepEqual(preparationChanges({ extra: null }, {}), ['extra']);
  assert.deepEqual(preparationChanges({}, JSON.parse('{"__proto__":{"note":"preserve"}}')), [
    '__proto__',
  ]);
});

test('AI schedule metadata and actual content are displayed without re-planning against the UI anchor', async () => {
  const { PublisherScheduleReview } =
    await import('../src/features/publisher/publisher-schedule-review.tsx');
  const server = record();
  const value = '2003-03-04T05:06:07.000Z';
  server.result!.updatedContent = { ...server.result!.updatedContent, world: { startAt: value } };
  server.result!.schedule = {
    status: 'proposed',
    changes: [{ path: ['world', 'startAt'], value, reason: 'default_start' }],
    issues: [],
  };
  const s = setup({
    referenceAt: '2026-01-01T00:00:00Z',
    preparationClient: {
      latestPreparation: async () => ({ preparation: null }),
      getPreparation: async () => server,
      prepareManuscript: async (_work, input) => {
        server.commandId = input.commandId;
        server.material = {
          scope: input.scope,
          currentContent: input.currentContent,
          sources: input.sources,
        };
        return server;
      },
    },
  });
  const nodes = await loadText(s);
  click(button(nodes, '让 AI 整理本批文稿'));
  await settle();
  const view = s.render().find((n) => n.type === PublisherScheduleReview);
  assert.ok(view);
  assert.equal(view.props.schedule, server.result!.schedule);
  assert.equal(view.props.content, server.result!.updatedContent);
  assert.equal(s.applied.length, 0);
  assert.ok(button(s.render(), '填入当前编辑稿').props.disabled);
  confirm(s);
  click(button(s.render(), '填入当前编辑稿'));
  assert.equal((s.applied[0] as unknown[])[0], server.result!.updatedContent);
});
test('changing a stable reference invalidates the old staged proposal and confirmation', async () => {
  const s = setup({ referenceAt: '2026-01-01T00:00:00Z' });
  click(button(await loadText(s), '让 AI 整理本批文稿'));
  await settle();
  confirm(s);
  const old = button(s.render(), '填入当前编辑稿');
  s.props.referenceAt = '2026-02-01T00:00:00Z';
  s.render();
  click(old);
  assert.equal(s.applied.length, 0);
  await settle();
  assert.ok(button(s.render(), '填入当前编辑稿').props.disabled);
});

test('actual pure parser schedules before validation and applies the same displayed content without AI', async () => {
  const { PublisherScheduleReview } =
    await import('../src/features/publisher/publisher-schedule-review.tsx');
  const { PublisherReviewView } =
    await import('../src/features/publisher/publisher-review-view.ts');
  const referenceAt = '2030-02-01T01:00:00.000Z';
  const s = setup({ referenceAt });
  click(
    button(
      await loadText(s, '# 世界观\n世界名称：一段故事\n公开设定：海边小镇'),
      '仅解析，不调用 AI',
    ),
  );
  await settle();
  const nodes = s.render();
  const view = nodes.find((n) => n.type === PublisherScheduleReview)!;
  const preview = nodes.find((n) => n.type === PublisherReviewView)!;
  assert.ok(view);
  assert.ok(preview);
  assert.equal((view.props.schedule as { status: string }).status, 'proposed');
  assert.equal((view.props.content as typeof base).world.startAt, referenceAt);
  assert.equal(view.props.content, preview.props.content);
  assert.equal(button(nodes, '填入当前编辑稿').props.disabled, false);
  click(button(nodes, '填入当前编辑稿'));
  assert.equal((s.applied[0] as unknown[])[0], view.props.content);
  assert.equal(s.posts.length, 0);
});

test('single-character and uncertain manuscripts default to characters, with explicit whole-story override', async () => {
  const s = setup();
  let nodes = await loadText(s, '# 人物：小林\n姓名：小林\n性格：直率');
  assert.match(label(nodes), /只补充文稿明确写到的人物/);
  click(button(nodes, '让 AI 整理本批文稿'));
  await settle();
  s.render();
  assert.equal(s.posts[0]?.scope, 'characters');
  const select = s
    .render()
    .find((n) => n.type === 'select' && n.props['aria-label'] === '本批整理范围')!;
  (select.props.onChange as (e: unknown) => void)({ target: { value: 'world' } });
  nodes = s.render();
  assert.ok(button(nodes, '填入当前编辑稿').props.disabled);
  click(button(nodes, '让 AI 整理本批文稿'));
  await settle();
  assert.equal(s.posts[1]?.scope, 'world');
});

test('all uploaded manuscripts remain queued after applying one batch, without another model call', async () => {
  const s = setup();
  s.render();
  await settle();
  const files = Array.from({ length: 40 }, (_, i) => ({
    name: `人物${i}.md`,
    size: 4000,
    arrayBuffer: async () =>
      new TextEncoder().encode(`# 人物：小林${i}\n${'生活'.repeat(1500)}`).buffer,
  }));
  const upload = s.render().find((n) => n.type === 'input' && n.props.type === 'file')!;
  (upload.props.onChange as (e: unknown) => void)({ currentTarget: { files, value: 'files' } });
  for (let i = 0; i < 60; i++) await settle();
  let nodes = s.render();
  assert.match(label(nodes), /已读取 40/);
  click(button(nodes, '让 AI 整理本批文稿'));
  await settle();
  s.render();
  confirm(s);
  click(button(s.render(), '填入当前编辑稿'));
  const args = s.applied[0] as [Record<string, unknown>, unknown, { keepOpen: boolean }];
  assert.equal(args[2].keepOpen, true);
  assert.equal(s.closed(), 0);
  s.props.content = args[0];
  s.render();
  nodes = s.render();
  assert.match(label(nodes), /已读取 40/);
  assert.match(label(nodes), /尚有 26 份待填入/);
  assert.equal(s.posts.length, 1);
  assert.equal(s.queries.length, 1);
  assert.ok(!button(nodes, '让 AI 整理本批文稿').props.disabled);
});

test('overall setting starts as a private whole-world source without restoring unrelated records or automatically calling a model', async () => {
  const text = '总体设定：旧城小店。幕后秘密：店主准备转让，但朋友尚不知情。';
  const s = setup({ initialOverallText: text });
  s.render();
  await settle();
  const nodes = s.render();
  assert.equal(s.posts.length, 0);
  assert.equal(s.queries.length, 0);
  assert.equal(s.applied.length, 0);
  assert.ok(label(nodes).includes('总体设定.md'));
  click(button(nodes, '让 AI 整理本批文稿'));
  await settle();
  assert.equal(s.posts.length, 1);
  assert.equal(s.posts[0]?.scope, 'world');
  assert.deepEqual(s.posts[0]?.sources, [{ filename: '总体设定.md', content: text }]);
  assert.deepEqual(s.posts[0]?.currentContent, base);
  assert.equal(s.applied.length, 0);
});
