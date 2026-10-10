import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorldSpaceSchema, type WorldSpace } from '../src/contracts/world-space.ts';
import type { PhoneMapContext } from '../src/features/phone/map/context.ts';

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
          compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
        }).outputText,
      };
    return nextLoad(url, context);
  },
});
const { MapApp, mapSelection, mapFeedback, mapDiagram } =
  await import('../src/features/phone/apps/map.tsx');
const { PhoneAppsProvider } = await import('../src/features/phone/apps/provider.tsx');
// Explicit render fixtures, never a production world or database validation.
const worldId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const source = {
  kind: 'official_genesis' as const,
  presetId: 'ui_fixture',
  contentVersion: 1,
  snapshotVersion: 0 as const,
};
const space: WorldSpace = WorldSpaceSchema.parse({
  worldId,
  worldVersion: 7,
  storyNow: '2026-10-10T15:45:00Z',
  paused: false,
  busy: false,
  currentPlaceId: 'studio',
  currentSceneId: null,
  canEstablish: false,
  places: [
    {
      id: 'studio',
      name: '同名地点',
      description: '只用于界面测试的摄影工作区。',
      source,
      contactActorIds: [],
      appointmentIds: [],
    },
    {
      id: 'hospital',
      name: '同名地点',
      description: '只用于界面测试的可观察大厅。',
      source,
      contactActorIds: [actorId, '33333333-3333-4333-8333-333333333333'],
      appointmentIds: ['visible', 'not_visible'],
    },
    {
      id: 'park',
      name: '无路线的已知公园',
      description: '',
      source,
      contactActorIds: [],
      appointmentIds: [],
    },
  ],
  routes: [
    {
      id: 'studio_hospital',
      fromPlaceId: 'studio',
      toPlaceId: 'hospital',
      durationMinutes: 30,
      modeLabel: '乘车',
      source,
    },
  ],
});
function render(
  data: WorldSpace | null = space,
  options: Partial<PhoneMapContext> = {},
  target?: string,
  scope = worldId,
) {
  const map: PhoneMapContext = {
    data,
    operation: null,
    checking: false,
    working: false,
    resubmitTravel: async () => {},
    checkTravel: async () => {},
    retryTravel: async () => {},
    clearTravel: () => {},
    loading: false,
    error: null,
    refresh: async () => {},
    travel: async () => {
      throw Error('NO_PRODUCTION_TRAVEL');
    },
    enterPlace: async () => {},
    establish: async () => {},
    recover: async (request) => ({ status: 'unconfirmed', worldId, commandId: request.commandId }),
    ...options,
  };
  return renderToStaticMarkup(
    createElement(PhoneAppsProvider, {
      worldId: scope,
      data: {
        photos: [],
        messages: [],
        notes: [],
        contacts: [
          { id: actorId, name: '已知联系人', relationship: '朋友', unread: 0 },
          { id: 'secret', name: '隐藏人物秘密定位', relationship: '未知', unread: 0 },
        ],
        invitations: [
          {
            id: 'visible',
            title: '公开邀约',
            at: space.storyNow,
            participantIds: [],
            status: 'proposed' as const,
            version: 1,
          },
        ],
      },
      children: createElement(MapApp, { app: 'notes', map, target, open() {} }),
    }),
  );
}
test('selection is ID based even with identical labels; preview crosses day using world time policy', () => {
  const result = mapSelection(space, 'hospital');
  assert.equal(result.current?.id, 'studio');
  assert.equal(result.selected?.id, 'hospital');
  assert.equal(result.route?.id, 'studio_hospital');
  assert.equal(result.arrival, '2026-10-11 00:15');
  assert.deepEqual(space, WorldSpaceSchema.parse(space));
});
test('unbound physical position cannot be inferred from an existing scene or first known place', () => {
  const data = { ...space, currentPlaceId: null, currentSceneId: actorId };
  const result = mapSelection(data, 'hospital');
  assert.equal(result.current, null);
  assert.equal(result.route, undefined);
  assert.equal(result.arrival, '');
  const html = render(data, {}, 'hospital');
  assert.match(html, /位置尚未确认/);
  assert.doesNotMatch(html, /前往这里|已到达/);
});
test('unknown target falls back to current position and missing route never fabricates travel duration', () => {
  assert.equal(mapSelection(space, 'absent').selected?.id, 'studio');
  const result = mapSelection(space, 'park');
  assert.equal(result.route, undefined);
  assert.equal(result.arrival, '');
  const html = render(space, {}, 'park');
  assert.match(html, /暂时没有可用路线/);
  assert.doesNotMatch(html, /前往这里|约 .* 到达/);
});
test('invalid world timestamp never becomes device time or a fabricated arrival preview', () => {
  assert.equal(mapSelection({ ...space, storyNow: 'invalid' }, 'hospital').arrival, '');
});
test('read error is distinct from successful empty space and does not assert missing history', () => {
  const empty = render({ ...space, places: [], routes: [], currentPlaceId: null });
  assert.match(empty, /这段人生还没有可用地点/);
  assert.doesNotMatch(empty, /暂时读不到地点|前往这里/);
  const failed = render(null, { error: '读取失败测试' });
  assert.match(failed, /读取失败测试/);
  assert.match(failed, /暂时读不到地点/);
  assert.doesNotMatch(failed, /这段人生还没有可用地点/);
  assert.match(render(null, { loading: true }), /正在打开地图/);
});
test('world scope mismatch never renders another branch place names or opens travel', () => {
  const html = render(space, {}, 'hospital', actorId);
  assert.doesNotMatch(html, /同名地点|可观察大厅|前往这里|公开邀约/);
});
test('authored environment and source are visible; contact IDs do not claim presence and unknown IDs create no dead links', () => {
  const html = render(space, {}, 'hospital');
  assert.match(html, /可观察大厅/);
  assert.match(html, /作者设定/);
  assert.match(html, /联系已知联系人/);
  assert.match(html, /查看公开邀约/);
  assert.doesNotMatch(
    html,
    /隐藏人物秘密定位|not_visible|33333333|已知联系人.*在场|进入现场|已到达/,
  );
  assert.match(html, /地点示意/);
  assert.doesNotMatch(html, /GPS|实时定位|真实街道/);
});

test('legacy place establishment is offered only by authoritative capability, never guessed from labels or old history', () => {
  const empty = { ...space, currentPlaceId: null, places: [], routes: [] };
  assert.doesNotMatch(render(empty), /使用起点中的地点/);
  assert.match(render({ ...empty, canEstablish: true }), /使用起点中的地点/);
  const paused = render({ ...empty, canEstablish: true, paused: true });
  assert.match(paused, /disabled=""[^>]*>使用起点中的地点/);
});
test('place entry is confined to authoritative current place, and paused or busy state prevents entry', () => {
  assert.match(render(space), /看看这里/);
  assert.doesNotMatch(render(space, {}, 'hospital'), /看看这里/);
  assert.match(render({ ...space, busy: true }), /disabled=""[^>]*>看看这里/);
  assert.match(render({ ...space, paused: true }), /disabled=""[^>]*>看看这里/);
});

const request = {
  commandId: '44444444-4444-4444-8444-444444444444',
  expectedVersion: 7,
  routeId: 'studio_hospital',
};
const receipt = {
  status: 'committed' as const,
  commandId: request.commandId,
  worldId,
  version: 8,
  sourceEventId: actorId,
  routeId: request.routeId,
  fromPlaceId: 'studio',
  toPlaceId: 'hospital',
  fromLabel: '出发地点',
  destinationLabel: '目标地点',
  durationMinutes: 30,
  departedAt: space.storyNow,
  arrivedAt: '2026-10-10T16:15:00Z',
  leftSceneId: null,
};
test('only original matching committed receipt can render arrival, never a local resolved promise or unconfirmed operation', () => {
  const op = {
    request,
    fromLabel: '出发地点',
    destinationLabel: '目标地点',
    status: 'committed' as const,
    receipt,
  };
  assert.equal(mapFeedback(worldId, op).status, 'committed');
  assert.equal(mapFeedback(worldId, { ...op, receipt: undefined }).status, 'unknown');
  for (const bad of [
    { ...receipt, worldId: actorId },
    { ...receipt, commandId: actorId },
    { ...receipt, routeId: 'another_route' },
    { ...receipt, version: 7 },
    { ...receipt, arrivedAt: 'invalid' },
  ])
    assert.equal(mapFeedback(worldId, { ...op, receipt: bad }).status, 'unknown');
});
test('unknown persisted travel exposes only receipt check and cannot offer a fresh journey or clear it', () => {
  const html = render(
    space,
    {
      operation: {
        request,
        fromLabel: '出发地点',
        destinationLabel: '目标地点',
        status: 'unknown',
      },
    },
    'hospital',
  );
  assert.match(html, /查看行程结果/);
  assert.doesNotMatch(html, /前往这里|再试一次|重新选地点|已到达/);
});
test('pending operation never renders departure progress, elapsed minutes, or arrival', () => {
  const html = render(
    space,
    {
      operation: {
        request,
        fromLabel: '出发地点',
        destinationLabel: '目标地点',
        status: 'pending',
      },
    },
    'hospital',
  );
  assert.match(html, /正在确认行程/);
  assert.doesNotMatch(html, /前往这里|已到达|过去了|查看行程结果|重新选地点/);
});
test('committed receipt can show elapsed world minutes but stale position cannot expose continue or place entry', () => {
  const op = {
    request,
    fromLabel: '出发地点',
    destinationLabel: '目标地点',
    status: 'committed' as const,
    receipt,
  };
  const stale = render(space, { operation: op }, 'hospital');
  assert.match(stale, /已到达目标地点/);
  assert.match(stale, /过去了 30 分钟/);
  assert.match(stale, /正在更新当前位置/);
  assert.doesNotMatch(stale, /查看这个地点|>看看这里</);
  const fresh = render(
    { ...space, currentPlaceId: 'hospital', worldVersion: 8, storyNow: receipt.arrivedAt },
    { operation: op },
    'hospital',
  );
  assert.match(fresh, /查看这个地点/);
});

test('a mismatched world controller never leaks its persisted travel destination or receipt', () => {
  const html = render(
    space,
    {
      operation: {
        request,
        fromLabel: '私有出发地',
        destinationLabel: '私有目标地',
        status: 'committed',
        receipt,
      },
    },
    'hospital',
    actorId,
  );
  assert.doesNotMatch(html, /私有出发地|私有目标地|目标地点|前往这里|查看行程结果/);
});

test('original journey resubmission is exposed only after authoritative unconfirmed recovery; paused world keeps check available', () => {
  const unknown = {
    request,
    fromLabel: '出发地点',
    destinationLabel: '目标地点',
    status: 'unknown' as const,
  };
  assert.doesNotMatch(render(space, { operation: unknown }), /重新提交这次行程/);
  assert.match(
    render(space, { operation: { ...unknown, recoveryUnconfirmed: true } }),
    /重新提交这次行程/,
  );
  const paused = render(
    { ...space, paused: true },
    { operation: { ...unknown, recoveryUnconfirmed: true } },
  );
  assert.match(paused, /查看行程结果/);
  assert.doesNotMatch(paused, /重新提交这次行程/);
});
test('controller working state prevents a second travel and disables operation clearing while recovery is running', () => {
  assert.match(render(space, { working: true }, 'hospital'), /disabled=""[^>]*>前往这里/);
  const failed = render(space, {
    operation: { request, fromLabel: '出发地点', destinationLabel: '目标地点', status: 'failed' },
    checking: true,
  });
  assert.match(failed, /disabled=""[^>]*>重新选地点/);
});

test('logical map lines use only actual published routes with known stable endpoints; no ghost places or invented streets', () => {
  const diagram = mapDiagram({
    ...space,
    routes: [
      ...space.routes,
      { ...space.routes[0]!, id: 'hidden_route', toPlaceId: 'secret_place' },
    ],
  });
  assert.equal(diagram.edges.length, 1);
  assert.equal(diagram.edges[0]?.route.id, 'studio_hospital');
  assert.deepEqual(
    diagram.points.map((p) => p.place.id),
    ['studio', 'hospital', 'park'],
  );
  assert.equal(diagram.edges[0]?.from.place.id, 'studio');
  assert.equal(diagram.edges[0]?.to.place.id, 'hospital');
  const html = render(space, {}, 'hospital');
  assert.match(html, /data-known-route="studio_hospital"/);
  assert.match(html, /非地理距离/);
});
test('read failure hides previously cached place, environment, route and committed arrival even in the same world', () => {
  const html = render(
    space,
    {
      error: '无法核实当前读取',
      operation: {
        request,
        fromLabel: '缓存出发地',
        destinationLabel: '缓存目标地',
        status: 'committed',
        receipt,
      },
    },
    'hospital',
  );
  assert.match(html, /无法核实当前读取/);
  assert.match(html, /暂时读不到地点/);
  assert.doesNotMatch(html, /同名地点|可观察大厅|data-known-route|已到达|目标地点|前往这里/);
});
