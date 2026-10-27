import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  activePhoneRoute,
  readRoute,
  routeHash,
  desktopApps,
} from '../src/features/phone/navigation.ts';
import { sceneHomeEntry } from '../src/features/phone/scenes/index-state.ts';
import { WorldSpaceSchema } from '../src/contracts/world-space.ts';
import type { SceneHistory } from '../src/contracts/scenes.ts';
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
const { PhoneShell } = await import('../src/features/phone/phone-shell.tsx');
const { SceneIndexApp } = await import('../src/features/phone/scenes/scene-index.tsx');
const { PhoneAppsProvider } = await import('../src/features/phone/apps/provider.tsx');
const worldId = '11111111-1111-4111-8111-111111111111',
  sceneId = '22222222-2222-4222-8222-222222222222';
const source = {
  kind: 'system_policy' as const,
  policy: 'default_travel_v1' as const,
  snapshotVersion: 0 as const,
};
function map(
  data = WorldSpaceSchema.parse({
    worldId,
    worldVersion: 7,
    storyNow: '2026-10-10T15:45:00Z',
    paused: false,
    busy: false,
    currentPlaceId: 'office',
    currentSceneId: null,
    canEstablish: false,
    places: [
      {
        id: 'office',
        name: '当前办公室',
        description: '',
        source,
        contactActorIds: [],
        appointmentIds: [],
      },
      {
        id: 'park',
        name: '公园',
        description: '',
        source,
        contactActorIds: [],
        appointmentIds: [],
      },
    ],
    routes: [],
  }),
): PhoneMapContext {
  return {
    data,
    operation: null,
    checking: false,
    working: false,
    loading: false,
    error: null,
    refresh: async () => {},
    resubmitTravel: async () => {},
    checkTravel: async () => {},
    retryTravel: async () => {},
    clearTravel: () => {},
    travel: async () => {
      throw Error('NO_TRAVEL_IN_RENDER');
    },
    enterPlace: async () => {
      throw Error('NO_ENTRY_IN_RENDER');
    },
    establish: async () => {
      throw Error('NO_ESTABLISH_IN_RENDER');
    },
    recover: async (request) => ({ status: 'unconfirmed', worldId, commandId: request.commandId }),
  };
}
const history: SceneHistory = {
  worldId,
  worldVersion: 7,
  storyNow: '2026-10-10T15:45:00Z',
  paused: false,
  currentScene: null,
  scenes: [],
  appointmentScenes: [],
  nextBefore: null,
};
function renderIndex(controller: PhoneMapContext) {
  return renderToStaticMarkup(
    createElement(PhoneAppsProvider, {
      worldId,
      data: { contacts: [], messages: [], photos: [], notes: [], invitations: [] },
      children: createElement(SceneIndexApp, { map: controller }),
    }),
  );
}

test('home scene application remains an active route and is a real sixth launcher', () => {
  assert.deepEqual(activePhoneRoute(readRoute(routeHash(worldId, { app: 'scenes' }), worldId)), {
    app: 'scenes',
  });
  assert(desktopApps.includes('scenes'));
  const html = renderToStaticMarkup(
    createElement(PhoneShell, {
      worldId,
      lifeName: '隔离界面样例',
      dateLabel: '10月10日',
      timeLabel: '18:00',
      initiallyLocked: false,
    }),
  );
  assert.match(html, /data-app="scenes"/);
  assert.equal((html.match(/data-app="/g) ?? []).length, 6);
});

test('known current place can be entered explicitly without routing through travel or auto executing on app open', () => {
  const controller = map();
  assert.equal(sceneHomeEntry(history, controller).canEnterCurrentPlace, true);
  const html = renderIndex(controller);
  assert.match(html, /当前办公室/);
  assert.match(html, /进入这里的现场/);
  assert.match(html, /前往地点/);
  assert.match(html, /打开地图/);
  assert.match(html, /公园/);
});

test('existing current scene is a navigation destination even if paused or another operation is running', () => {
  const controller = map();
  controller.data = { ...controller.data!, currentSceneId: sceneId, paused: true };
  controller.working = true;
  const entry = sceneHomeEntry(history, controller);
  assert.equal(entry.currentSceneId, sceneId);
  assert.equal(entry.canEnterCurrentPlace, false);
  const html = renderIndex(controller);
  assert.match(html, /回到现场/);
  assert.doesNotMatch(html, /进入这里的现场/);
});

test('unknown position, busy travel, unconfirmed travel and paused time never authorize new entry', () => {
  for (const patch of [{ currentPlaceId: null }, { busy: true }, { paused: true }]) {
    const controller = map();
    controller.data = { ...controller.data!, ...patch };
    assert.equal(sceneHomeEntry(history, controller).canEnterCurrentPlace, false);
  }
  for (const status of ['pending', 'unknown'] as const) {
    const controller = map();
    controller.operation = {
      request: { commandId: sceneId, expectedVersion: 7, routeId: 'office_park' },
      fromLabel: '办公室',
      destinationLabel: '公园',
      status,
    };
    assert.equal(sceneHomeEntry(history, controller).canEnterCurrentPlace, false);
  }
  const missing = map();
  missing.data = null;
  assert.equal(sceneHomeEntry(history, missing).canEnterCurrentPlace, false);
});

test('newer map position prevents stale history from reopening a departed scene; newer history retains its actual current scene', () => {
  const previous = {
    ...history,
    worldVersion: 6,
    currentScene: { id: sceneId, title: '旧现场', status: 'active' as const, sourceVersion: 6 },
  };
  assert.equal(sceneHomeEntry(previous, map()).currentSceneId, null);
  const latest = { ...previous, worldVersion: 8 };
  assert.equal(sceneHomeEntry(latest, map()).currentSceneId, sceneId);
});
