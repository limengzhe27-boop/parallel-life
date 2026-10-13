import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PublisherSchedule } from '../src/contracts/publisher-preparation.ts';

// Actual presentation with synthetic metadata only: no planner, model, browser or DB.
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.module.css'))
      return {
        format: 'module',
        shortCircuit: true,
        source: 'export default new Proxy({},{get:(_t,k)=>String(k)})',
      };
    if (url.endsWith('publisher-schedule-review.tsx'))
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
const { PublisherScheduleReview, scheduleLocation, scheduleTime } =
  await import('../src/features/publisher/publisher-schedule-review.tsx');
const stamp = '2026-10-13T00:00:00.000Z';
const content = {
  world: { startAt: stamp },
  actors: [{ key: 'person-a', name: '小林' }],
  phone: { messages: [{ actorKey: 'person-a', text: '昨天留下的消息', at: stamp }] },
  history: [{ text: '曾约好见面', occurredAt: stamp }],
  candidates: [{ title: '去诊所谈谈', intent: { earliestAt: stamp } }],
  timeline: { stages: [{ title: '准备阶段', window: { notBefore: stamp } }] },
};
const plan: PublisherSchedule = {
  status: 'proposed',
  changes: [{ path: ['phone', 'messages', 0, 'at'], value: stamp, reason: '按开场之前的顺序安排' }],
  issues: [],
};
const render = (
  schedule = plan,
  c: Record<string, unknown> = content,
  context: 'draft' | 'import' = 'import',
) =>
  renderToStaticMarkup(createElement(PublisherScheduleReview, { schedule, content: c, context }));

test('actual scheduled content uses the sender and message with fixed Beijing time and no extra plan execution', () => {
  const html = render();
  assert.match(html, /小林：昨天留下的消息/);
  assert.match(html, /2026\/10\/13 08:00:00/);
  assert.match(html, /本次整理稿，填入后仍需保存/);
  assert.match(html, /不代表这些事件已经发生/);
  assert.doesNotMatch(html, /<button|<input|<textarea|已核实|已保存成功/);
});
test('draft and unchanged summaries describe local effects without pretending to save', () => {
  assert.match(render(plan, content, 'draft'), /当前编辑稿，尚未保存/);
  const html = render({ status: 'unchanged', changes: [], issues: [] });
  assert.match(html, /未新增时间安排/);
  assert.doesNotMatch(html, /完整保留原稿时序|全部验证通过/);
});
test('blocked plans show all issues and never present hypothetical values as applied', () => {
  const schedule: PublisherSchedule = {
    status: 'blocked',
    changes: [
      { path: ['world', 'startAt'], value: '2099-01-01T00:00:00Z', reason: '待讨论的起点' },
    ],
    issues: [
      { path: ['world', 'startAt'], code: 'explicit_time_conflict' },
      {
        path: ['history', 0, 'occurredAt'],
        code: 'UNKNOWN_RULE',
        source: { filename: '原稿.md', start: 0, end: 5, quote: '昨天已约好' },
      },
    ],
  };
  const html = render(schedule, content, 'draft');
  assert.match(html, /本次未修改草稿/);
  assert.match(html, /需要核对的时间/);
  assert.match(html, /明确时间存在冲突/);
  assert.match(html, /曾约好见面/);
  assert.match(html, /待核对的文稿线索/);
  assert.match(html, /当前稿件时间：2026\/10\/13/);
  assert.doesNotMatch(html, /安排时间：2099/);
});
test('metadata mismatch exposes actual current value and a stale-plan warning instead of an old scheduled time', () => {
  const html = render(plan, {
    ...content,
    phone: { messages: [{ actorKey: 'person-a', text: '当前新消息', at: '2026-10-14T00:00:00Z' }] },
  });
  assert.match(html, /排期记录与当前内容不一致/);
  assert.match(html, /当前稿件时间：2026\/10\/14/);
  assert.doesNotMatch(html, /安排时间：2026\/10\/13/);
});
test('labels use actual history, stages and future plot names; missing paths stay honest', () => {
  assert.match(scheduleLocation(content, ['history', 0, 'occurredAt']), /曾约好见面/);
  assert.match(
    scheduleLocation(content, ['timeline', 'stages', 0, 'window', 'notBefore']),
    /准备阶段/,
  );
  assert.match(scheduleLocation(content, ['candidates', 0, 'intent', 'earliestAt']), /去诊所谈谈/);
  assert.equal(scheduleLocation(content, ['unsupported', 'time']), '一项时间设置');
  const html = render({
    ...plan,
    changes: [{ ...plan.changes[0]!, path: ['phone', 'messages', 99, 'at'] }],
  });
  assert.match(html, /发送人待核对/);
  assert.match(html, /尚未安排/);
  assert.match(html, /不一致/);
});
test('unknown machine reasons stay out of author view and all author text is escaped', () => {
  const c = {
    ...content,
    phone: { messages: [{ actorKey: 'person-a', text: '<script>原文</script>', at: stamp }] },
  };
  const html = render(
    { ...plan, changes: [{ ...plan.changes[0]!, reason: 'SOME_FUTURE_REASON' }] },
    c,
  );
  assert.match(html, /按照本次排期规则/);
  assert.doesNotMatch(html, /SOME_FUTURE_REASON/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});
test('display does not mutate frozen plan/content and keeps non-date input literal', () => {
  const freeze = (v: unknown) => {
    if (v && typeof v === 'object') {
      Object.freeze(v);
      Object.values(v).forEach(freeze);
    }
  };
  const before = JSON.stringify([content, plan]);
  freeze(content);
  freeze(plan);
  render();
  assert.equal(JSON.stringify([content, plan]), before);
  assert.equal(scheduleTime('明天傍晚'), '明天傍晚');
  assert.equal(scheduleTime(undefined), '尚未安排');
});

test('large plans and issues default to collapsed summaries while preserving every detail', () => {
  const changes = Array.from({ length: 6 }, (_, i) => ({
    ...plan.changes[0]!,
    reason: `依据${i}`,
  }));
  const manyIssues = Array.from({ length: 6 }, (_, i) => ({
    path: ['world', 'startAt'],
    code: `问题${i}`,
  }));
  const html = render({ ...plan, changes, issues: manyIssues });
  assert.match(html, /<details class="changes"><summary>/);
  assert.match(html, /<details class="warning"><summary>/);
  assert.match(html, /依据5/);
  assert.doesNotMatch(html, /问题5/);
  assert.match(render(), /<details class="changes" open="">/);
});
test('blocked import distinguishes extracted material from a runnable publication', () => {
  const html = render({ status: 'blocked', changes: [], issues: [] });
  assert.match(html, /未自动安排时间，已有提取内容可核对/);
  assert.match(html, /不能直接发布/);
});
