import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlayerRecordsSchema } from '../src/contracts/world-records.ts';
import {
  projectPlayerRecords,
  type PlayerRecordsInput,
} from '../src/modules/world/domain/player-records.ts';
import { progressionFixture, resolveProgressionFixture } from './fixtures/matter-progression.ts';
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
const { NotesRecords, NotesRecordDetail, searchRecords } =
  await import('../src/features/phone/apps/notes-records.tsx');
function fixture(): PlayerRecordsInput {
  const f = progressionFixture('county-yellow-hair');
  const result = resolveProgressionFixture(f, f.world, f.trigger.id, f.texts[0], f.texts[1]);
  const trigger = result.world.matters!.find((m) => m.id === f.trigger.id)!;
  const pursuit = result.world.matters!.find((m) => m.id === f.pursuit.id)!;
  const opportunity = result.world.matters!.find((m) => m.opportunity)!;
  return {
    worldId: result.world.id,
    worldVersion: result.world.version,
    actors: result.world.actors.map((a) => ({ id: a.id, name: a.name })),
    choices: [],
    appointments: [],
    messages: [],
    events: [],
    initial: f.initial,
    matters: [trigger, pursuit, opportunity],
    progressionEvents: [result.event],
  };
}
test('phone links verified success to pursuit and a separate unaccepted opportunity', () => {
  const view = PlayerRecordsSchema.parse(projectPlayerRecords(fixture()));
  const pursuit = view.about.find((r) => r.span === 'pursuit')!;
  assert.equal(pursuit.progress?.milestones.length, 1);
  assert.equal(pursuit.state, 'in_progress');
  assert.equal(view.current[0]!.state, 'not_started');
  assert.equal(view.current[0]!.opportunity?.pursuitRecordId, pursuit.id);
  assert.equal(pursuit.progress?.opportunities[0]!.recordId, view.current[0]!.id);
  assert.equal(view.history[0]!.relatedLinks?.at(-1)?.target, view.current[0]!.id);
});
test('snapshot labels alone do not expose milestones or unlock linkage', () => {
  for (const mutate of [
    (f: PlayerRecordsInput) => (f.progressionEvents = []),
    (f: PlayerRecordsInput) => (f.progressionEvents![0]!.worldId = 'another-world'),
    (f: PlayerRecordsInput) => (f.progressionEvents![0]!.version = 5),
    (f: PlayerRecordsInput) =>
      (f.progressionEvents![0]!.data.worldResults!.action!.resolution!.outcome = 'failed'),
    (f: PlayerRecordsInput) => (f.matters![0]!.assertion = 'player_statement'),
    (f: PlayerRecordsInput) => (f.matters![0]!.visibility = 'hidden'),
    (f: PlayerRecordsInput) =>
      (f.progressionEvents![0]!.data.worldResults!.action!.intent = 'plan'),
    (f: PlayerRecordsInput) =>
      (f.progressionEvents![0]!.data.worldResults!.action!.ownerId = 'another-owner'),
    (f: PlayerRecordsInput) => (f.matters![1]!.title = '伪造的另一追求'),
  ]) {
    const f = fixture();
    mutate(f);
    const view = projectPlayerRecords(f);
    assert.equal(view.about.find((r) => r.span === 'pursuit')?.progress, undefined);
    assert.ok(view.current.every((r) => !r.opportunity));
  }
});
test('forged opportunity owner/source/prerequisite is not promoted as a continuation', () => {
  for (const mutate of [
    (f: PlayerRecordsInput) => (f.matters![2]!.worldId = 'another-world'),
    (f: PlayerRecordsInput) => (f.matters![2]!.source = { kind: 'genesis', seedId: 'fake' }),
    (f: PlayerRecordsInput) => (f.matters![2]!.prerequisites = ['unrelated']),
    (f: PlayerRecordsInput) => (f.matters![2]!.opportunity!.pursuitId = 'unrelated'),
    (f: PlayerRecordsInput) => (f.matters![2]!.opportunity!.key = 'invented-next-plot'),
    (f: PlayerRecordsInput) => (f.matters![2]!.id = 'forged-next-id'),
    (f: PlayerRecordsInput) => (f.matters![2]!.description = '未发生的预算与收入'),
  ]) {
    const f = fixture();
    mutate(f);
    const view = projectPlayerRecords(f);
    assert.ok(view.current.every((r) => !r.opportunity));
    assert.deepEqual(view.about[0]!.progress?.opportunities, []);
  }
});
test('rendered records expose a real choice and source, without edit or reward buttons', () => {
  const data = PlayerRecordsSchema.parse(projectPlayerRecords(fixture()));
  const open = () => {};
  const list = renderToStaticMarkup(createElement(NotesRecords, { data, open }));
  const detail = renderToStaticMarkup(
    createElement(NotesRecordDetail, { data, target: data.about[0]!.id, open }),
  );
  assert.match(list, /接下来可以试试/);
  assert.match(list, /已走过 1 步/);
  assert.match(detail, /已经走过的路/);
  assert.match(detail, /不代表这段追求已经完成/);
  const next = renderToStaticMarkup(
    createElement(NotesRecordDetail, { data, target: data.current[0]!.id, open }),
  );
  assert.match(next, /还没有替你作决定/);
  assert.match(next, /看看它从哪里来/);
  assert.doesNotMatch(detail + next, />领取奖励<|>编辑<|>完成任务</);
  assert.equal(searchRecords(data.about, 'R17').length, 1);
});
function buttons(node: ReactNode): Array<{ children: ReactNode; onClick?: () => void }> {
  if (Array.isArray(node)) return node.flatMap(buttons);
  if (!isValidElement(node)) return [];
  const props = node.props as { children: ReactNode; onClick?: () => void };
  return [...(node.type === 'button' ? [props] : []), ...buttons(props.children)];
}
test('pursuit steps navigate to the exact source record and next opportunity', () => {
  const data = PlayerRecordsSchema.parse(projectPlayerRecords(fixture())),
    calls: string[] = [];
  const tree = NotesRecordDetail({
    data,
    target: data.about[0]!.id,
    open: (app, target) => calls.push(app + ':' + target),
  });
  for (const b of buttons(tree)) {
    const text = renderToStaticMarkup(createElement('span', {}, b.children));
    if (text.includes('查看这一步') || text.includes(data.current[0]!.title)) b.onClick?.();
  }
  assert.deepEqual(calls, ['notes:' + data.history[0]!.id, 'notes:' + data.current[0]!.id]);
});
