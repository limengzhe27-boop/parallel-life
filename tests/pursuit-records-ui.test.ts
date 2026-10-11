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
import { sceneMatterId } from '../src/modules/world/domain/scene-matter-policy.ts';
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
const worldId = '10000000-0000-4000-8000-000000000001',
  at = '2026-10-11T10:00:00.000Z';
function fixture(): PlayerRecordsInput {
  const source = {
    kind: 'preset',
    presetId: 'county-yellow-hair',
    version: 3,
    matterKey: 'deliver_r17',
  };
  const base = {
    worldId,
    visibility: 'player_visible',
    version: 2,
    createdAt: at,
    updatedAt: at,
    relatedActorIds: ['actor'],
    relatedPlaceId: 'repair_shop',
  };
  return {
    worldId,
    worldVersion: 4,
    actors: [{ id: 'actor', name: '老周' }],
    choices: [],
    appointments: [],
    messages: [],
    events: [],
    matters: [
      {
        ...base,
        id: 'trigger',
        span: 'near_term',
        title: '交付R17',
        description: '已完成核对与交接',
        status: 'completed',
        assertion: 'world_verified',
        source,
        evidence: {
          kind: 'scene_action',
          sceneId: 'scene',
          actionId: 'action',
          outcome: 'succeeded',
          eventId: 'event',
          eventVersion: 4,
          at,
        },
      },
      {
        ...base,
        id: 'pursuit',
        span: 'pursuit',
        title: '拥有独立工位',
        description: '慢慢靠手艺立足',
        status: 'in_progress',
        assertion: 'actor_statement',
        source: { ...source, matterKey: 'own_workshop' },
        pursuitProgress: {
          milestones: [
            { matterId: 'trigger', title: '交付R17', eventId: 'event', eventVersion: 4, at },
          ],
          nextOpportunityIds: ['next'],
        },
      },
      {
        ...base,
        id: 'next',
        span: 'near_term',
        title: '下一次独立接单的准备',
        description: '复盘交接，准备与老周讨论独立接单；没有代你同意',
        status: 'not_started',
        assertion: 'world_verified',
        source: { kind: 'director_proposal', eventId: 'event', eventVersion: 4, at },
        prerequisites: ['trigger'],
        opportunity: { pursuitId: 'pursuit', triggerMatterId: 'trigger', key: 'r17_review' },
        evidence: {
          kind: 'world_event',
          reason: '解锁可选机会',
          eventId: 'event',
          eventVersion: 4,
          at,
        },
      },
    ],
    progressionEvents: [
      {
        id: 'event',
        worldId,
        version: 4,
        storyAt: at,
        type: 'scene.action_resolved',
        data: {
          worldResults: {
            scene: { id: 'scene', worldId, ownerId: 'owner' },
            action: {
              id: 'action',
              worldId,
              ownerId: 'owner',
              sceneId: 'scene',
              status: 'resolved',
              sourceVersion: 3,
              relatedMatterIds: [sceneMatterId('scene', 'trigger')],
              resolution: { sourceEventId: 'event', sourceVersion: 4, outcome: 'succeeded' },
            },
            updates: [{ matterId: 'trigger', expectedMatterVersion: 1, status: 'completed' }],
            observerFacts: [],
          },
        },
      },
    ],
  } as unknown as PlayerRecordsInput;
}
test('phone links verified success to pursuit and a separate unaccepted opportunity', () => {
  const view = PlayerRecordsSchema.parse(projectPlayerRecords(fixture()));
  const pursuit = view.about.find((r) => r.span === 'pursuit')!;
  assert.equal(pursuit.progress?.milestones.length, 1);
  assert.equal(pursuit.state, 'in_progress');
  assert.equal(view.current[0].state, 'not_started');
  assert.equal(view.current[0].opportunity?.pursuitRecordId, pursuit.id);
  assert.equal(pursuit.progress?.opportunities[0].recordId, view.current[0].id);
  assert.equal(view.history[0].relatedLinks?.at(-1)?.target, view.current[0].id);
});
test('snapshot labels alone do not expose milestones or unlock linkage', () => {
  for (const mutate of [
    (f: PlayerRecordsInput) => (f.progressionEvents = []),
    (f: PlayerRecordsInput) => (f.progressionEvents![0].worldId = 'another-world'),
    (f: PlayerRecordsInput) => (f.progressionEvents![0].version = 5),
    (f: PlayerRecordsInput) =>
      (f.progressionEvents![0].data.worldResults!.action!.resolution!.outcome = 'failed'),
    (f: PlayerRecordsInput) => (f.matters![0].assertion = 'player_statement'),
    (f: PlayerRecordsInput) => (f.matters![0].visibility = 'hidden'),
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
    (f: PlayerRecordsInput) => (f.matters![2].worldId = 'another-world'),
    (f: PlayerRecordsInput) => (f.matters![2].source = { kind: 'genesis', seedId: 'fake' }),
    (f: PlayerRecordsInput) => (f.matters![2].prerequisites = ['unrelated']),
    (f: PlayerRecordsInput) => (f.matters![2].opportunity!.pursuitId = 'unrelated'),
  ]) {
    const f = fixture();
    mutate(f);
    const view = projectPlayerRecords(f);
    assert.ok(view.current.every((r) => !r.opportunity));
    assert.deepEqual(view.about[0].progress?.opportunities, []);
  }
});
test('rendered records expose a real choice and source, without edit or reward buttons', () => {
  const data = PlayerRecordsSchema.parse(projectPlayerRecords(fixture()));
  const open = () => {};
  const list = renderToStaticMarkup(createElement(NotesRecords, { data, open }));
  const detail = renderToStaticMarkup(
    createElement(NotesRecordDetail, { data, target: data.about[0].id, open }),
  );
  assert.match(list, /接下来可以试试/);
  assert.match(list, /已走过 1 步/);
  assert.match(detail, /已经走过的路/);
  assert.match(detail, /不代表这段追求已经完成/);
  const next = renderToStaticMarkup(
    createElement(NotesRecordDetail, { data, target: data.current[0].id, open }),
  );
  assert.match(next, /还没有替你作决定/);
  assert.match(next, /看看它从哪里来/);
  assert.doesNotMatch(detail + next, />领取奖励<|>编辑<|>完成任务</);
  assert.equal(searchRecords(data.about, '交付R17').length, 1);
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
    target: data.about[0].id,
    open: (app, target) => calls.push(app + ':' + target),
  });
  for (const b of buttons(tree)) {
    const text = renderToStaticMarkup(createElement('span', {}, b.children));
    if (text.includes('查看这一步') || text.includes('下一次独立接单')) b.onClick?.();
  }
  assert.deepEqual(calls, ['notes:' + data.history[0].id, 'notes:' + data.current[0].id]);
});
