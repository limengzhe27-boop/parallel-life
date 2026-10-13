import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlayerRecordsSchema, type PlayerRecords } from '../src/contracts/world-records.ts';

// Actual component rendering with schema-checked synthetic projections. No API, DB or model.
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
const { NotesRecords, NotesRecordDetail, RecordsApp } =
  await import('../src/features/phone/apps/notes-records.tsx');
const { NotesApp } = await import('../src/features/phone/apps/notes.tsx');
const { PhoneAppsProvider } = await import('../src/features/phone/apps/provider.tsx');
const at = '2026-10-09T09:53:00.000Z';
const worldId = '10000000-0000-4000-8000-000000000001';
const actorId = '20000000-0000-4000-8000-000000000001';
const target = 'sys/matter/repair';
const definitions = [
  ['order_reviewed', '核对维修单', true, 'player'],
  ['repair_explained', '说明检修情况', true, 'player'],
  ['handed_over', '交出钥匙与维修单', true, 'player'],
  ['received', '实际接收钥匙与维修单', true, 'actor'],
  ['connector_checked', '复检接头', false, 'player'],
  ['record_written', '写下检修记录', false, 'player'],
  ['receiver_inspected', '接收人物检查', false, 'actor'],
] as const;
function fixture(
  completed: readonly string[] = ['order_reviewed'],
  actorName?: string,
): PlayerRecords {
  return PlayerRecordsSchema.parse({
    schemaVersion: 1,
    worldId,
    worldVersion: 6,
    coverage: 'recent',
    current: [
      {
        id: target,
        kind: 'world_matter',
        title: '交接维修结果',
        text: '请把维修情况说明清楚。',
        state: 'in_progress',
        stateLabel: '进行中',
        assertion: 'world_verified',
        source: {
          kind: 'world_event',
          eventId: 'saved-result',
          eventVersion: 5,
          at,
          timeBasis: 'story',
        },
        navigation: { app: 'wechat', actorId },
        stepChecklist: {
          ruleVersion: 'r17-delivery-v1',
          requiredTotal: 4,
          completedRequired: definitions.filter(
            ([id, , required]) => required && completed.includes(id),
          ).length,
          steps: definitions.map(([id, title, required, performer]) => ({
            id,
            title,
            required,
            performer,
            state: completed.includes(id) ? 'completed' : 'pending',
            ...(completed.includes(id)
              ? { at, ...(performer === 'actor' && actorName ? { actorName } : {}) }
              : {}),
          })),
        },
      },
    ],
    about: [],
    history: [],
  });
}
const noop = () => {};
function detail(data: PlayerRecords) {
  return renderToStaticMarkup(createElement(NotesRecordDetail, { data, target, open: noop }));
}
function list(data: PlayerRecords) {
  return renderToStaticMarkup(createElement(NotesRecords, { data, open: noop }));
}
function step(html: string, id: string) {
  const found = html.match(new RegExp(`<li data-step-id="${id}">([\\s\\S]*?)</li>`));
  assert.ok(found, `missing step ${id}`);
  return found[1]!;
}
for (let count = 0; count <= 4; count++) {
  test(`saved ${count}/4 renders the server fraction in detail and accessible list`, () => {
    const data = fixture(
      definitions.slice(0, count).map(([id]) => id),
      '老周',
    );
    const html = detail(data);
    assert.match(html, new RegExp(`已完成 ${count}/4`));
    assert.equal((html.match(/class="completedMark"/g) ?? []).length, count);
    assert.equal((html.match(/<time /g) ?? []).length, count);
    assert.match(list(data), new RegExp(`aria-label="交接维修结果，进行中，已完成 ${count}/4"`));
    // Even all required children do not authorize the UI to change the parent's state.
    assert.match(html, /class="state">进行中/);
    assert.doesNotMatch(html, /领奖|自动重试|解锁/);
  });
}
test('required and optional records are separate; optional credit does not increase denominator', () => {
  const data = fixture(['order_reviewed', 'connector_checked', 'receiver_inspected'], '老周');
  const html = detail(data);
  const required = html.split('aria-label="必需步骤">')[1]!.split('<details')[0]!;
  assert.equal((required.match(/data-step-id=/g) ?? []).length, 4);
  assert.doesNotMatch(required, /connector_checked|record_written|receiver_inspected/);
  const optional = html.match(/<details class="optionalSteps">([\s\S]*?)<\/details>/)![1]!;
  assert.equal((optional.match(/data-step-id=/g) ?? []).length, 3);
  assert.match(optional, /可选记录|不计入必需步骤|老周已检查/);
  assert.match(html, /已完成 1\/4/);
});
test('handed over is not actually received; pending actor does not fabricate an actor name or time', () => {
  const html = detail(fixture(['order_reviewed', 'repair_explained', 'handed_over']));
  assert.match(step(html, 'handed_over'), /✓|你已完成/);
  assert.match(step(html, 'received'), /○|等待人物接收/);
  assert.doesNotMatch(step(html, 'received'), /✓|<time|已接收|老周/);
  assert.match(html, /已完成 3\/4/);
});
test('only saved actor action displays actual receiver, escaped name and persisted timestamp', () => {
  const html = detail(fixture(['order_reviewed', 'received'], '<script>接收人</script>'));
  assert.match(step(html, 'received'), /&lt;script&gt;接收人&lt;\/script&gt;已接收/);
  assert.match(step(html, 'received'), /datetime="2026-10-09T09:53:00.000Z"/i);
  assert.doesNotMatch(html, /<script>/);
  assert.match(detail(fixture(['received'])), /人物已接收/);
});
test('checklist is readonly and status is readable without icons or color', () => {
  const html = detail(fixture());
  assert.doesNotMatch(
    html,
    /<(?:input|textarea|form)\b|role="checkbox"|aria-checked|contenteditable/,
  );
  assert.match(step(html, 'order_reviewed'), /你已完成/);
  assert.match(step(html, 'repair_explained'), /待你继续/);
  assert.match(step(html, 'received'), /等待人物接收/);
  assert.doesNotMatch(
    html.split('aria-label="这件事的进展">')[1]!.split('</section>')[0]!,
    /<button/,
  );
});
test('legacy records keep their existing detail, without inferred zeros, checks or checklist from text', () => {
  const data = fixture();
  delete data.current[0]!.stepChecklist;
  data.current[0]!.text = '我核对说明交出都完成了，人物答应接收。';
  const html = detail(data);
  assert.match(html, /我核对说明交出都完成了/);
  assert.doesNotMatch(html + list(data), /这件事的进展|必需步骤|completedMark|pendingMark/);
});
test('long-term milestones coexist without being counted as required child steps', () => {
  const data = fixture();
  data.current[0]!.progress = {
    milestones: [{ title: '此前的阶段成果', at, recordId: 'sys/matter/earlier' }],
    opportunities: [{ title: '下一种可能', recordId: 'sys/matter/next' }],
  };
  const html = detail(data);
  assert.match(html, /这件事的进展|已经走过的路|此前的阶段成果|下一种可能/);
  assert.match(list(data), /已完成 1\/4/);
  assert.doesNotMatch(list(data), /已完成 2\/4/);
});
function buttons(node: ReactNode): { onClick?: () => void; children?: ReactNode }[] {
  if (Array.isArray(node)) return node.flatMap(buttons);
  if (!isValidElement<{ onClick?: () => void; children?: ReactNode }>(node)) return [];
  return [...(node.type === 'button' ? [node.props] : []), ...buttons(node.props.children)];
}
test('existing source navigation retains the exact authorized actor target', () => {
  const data = fixture();
  const calls: unknown[] = [];
  const tree = NotesRecordDetail({ data, target, open: (...args) => calls.push(args) });
  buttons(tree)[0]!.onClick!();
  assert.deepEqual(calls, [['messages', actorId]]);
});
for (const status of ['unknown', 'failed', 'pending'] as const) {
  test(`${status} message feedback cannot erase or promote saved checklist credit`, () => {
    const data = fixture();
    const html = renderToStaticMarkup(
      createElement(PhoneAppsProvider, {
        worldId,
        records: { status: 'ready', data },
        data: {
          contacts: [],
          notes: [],
          photos: [],
          invitations: [],
          choices: [],
          messages: [
            {
              id: 'unconfirmed-message',
              actorId,
              role: 'user',
              text: '我已经全做完了',
              at,
              status,
            },
          ],
        },
        children: createElement(RecordsApp, { app: 'records', target, open: noop }),
      }),
    );
    assert.match(html, /已完成 1\/4/);
    assert.equal((html.match(/class="completedMark"/g) ?? []).length, 1);
    assert.doesNotMatch(html, /我已经全做完了|已完成 4\/4/);
    assert.match(html, /aria-label="返回人生记录"/);
  });
}
