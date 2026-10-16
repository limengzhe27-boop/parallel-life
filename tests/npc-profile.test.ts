import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublicProfileSchema, type WorldPhone } from '../src/contracts/world-build.ts';
import type { PhoneContact } from '../src/features/phone/apps/types.ts';
import { worldAppData } from '../src/features/phone/world-app-data.ts';
import { projectPlayerActors } from '../src/modules/world/domain/player-projection.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';

registerHooks({
  load(url, ctx, next) {
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
    return next(url, ctx);
  },
});

const { PersonCard } = await import('../src/features/phone/apps/person-card.tsx');

test('PublicProfileSchema strictly validates identity, traits, appearance and rejects backstage fields', () => {
  const valid = {
    identity: '图书管理员',
    traits: ['安静', '敏锐'],
    appearance: '戴着细黑框眼镜，穿着整洁的针织衫',
  };
  assert.equal(PublicProfileSchema.safeParse(valid).success, true);

  // Rejects extra / backstage fields
  const invalidExtra = {
    ...valid,
    persona: '秘密行动特工',
  };
  assert.equal(PublicProfileSchema.safeParse(invalidExtra).success, false);

  // Rejects more than 3 traits
  const tooManyTraits = {
    ...valid,
    traits: ['一', '二', '三', '四'],
  };
  assert.equal(PublicProfileSchema.safeParse(tooManyTraits).success, false);
});

test('projectPlayerActors populates publicProfile from authored contacts and strictly hides private persona', () => {
  const actorId = randomUUID();
  const state: WorldState = {
    schemaVersion: 1,
    id: randomUUID(),
    ownerId: randomUUID(),
    version: 0,
    title: '海边书店',
    time: '2026-10-17T00:00:00Z',
    actors: [
      { id: actorId, name: '林澈', persona: '【绝密】其实是来调查失踪案件的私家侦探，对任何人抱有戒心' },
    ],
    actorTies: [],
    facts: [],
    messages: [],
    appointments: [],
    mediaRequests: [],
  };

  const visible = projectPlayerActors(
    state,
    [],
    [],
    [
      {
        actorId,
        name: '林澈',
        relationship: '常客',
        identity: '自由撰稿人',
        traits: ['内向', '观察力强'],
        appearance: '身穿深灰色风衣',
        introduction: '每周二下午都会来店里靠窗的位置坐着写东西。',
      },
    ],
  );

  assert.equal(visible.length, 1);
  const actor = visible[0]!;
  assert.equal(actor.name, '林澈');
  assert.equal(actor.relationship, '常客');
  assert.deepEqual(actor.publicProfile, {
    identity: '自由撰稿人',
    traits: ['内向', '观察力强'],
    appearance: '身穿深灰色风衣',
  });
  // Ensure private persona and secret keywords never appear
  const serialized = JSON.stringify(actor);
  assert.equal(serialized.includes('绝密'), false);
  assert.equal(serialized.includes('侦探'), false);
  assert.equal(serialized.includes('调查失踪'), false);
});

test('projectPlayerActors leaves publicProfile undefined when authored details are absent', () => {
  const actorId = randomUUID();
  const state: WorldState = {
    schemaVersion: 1,
    id: randomUUID(),
    ownerId: randomUUID(),
    version: 0,
    title: '普通世界',
    time: '2026-10-17T00:00:00Z',
    actors: [{ id: actorId, name: '老周', persona: '普通店员' }],
    actorTies: [],
    facts: [],
    messages: [],
    appointments: [],
    mediaRequests: [],
  };

  const visible = projectPlayerActors(state, [], [actorId]);
  assert.equal(visible.length, 1);
  assert.equal(visible[0]!.publicProfile, undefined);
  assert.equal(visible[0]!.summary, undefined);
});

test('worldAppData correctly maps publicProfile from WorldPhone actors to PhoneContact', () => {
  const dummyWorld: WorldPhone = {
    id: 'world-1',
    seedId: 'seed-1',
    title: '世界',
    identity: '玩家',
    setting: '背景',
    time: '2026-10-17T00:00:00Z',
    actors: [
      {
        id: 'actor-1',
        name: '小安',
        relationship: '向导',
        summary: '热心的城市向导',
        publicProfile: {
          identity: '向导',
          traits: ['热情', '细心'],
          appearance: '戴着蓝色帽子',
        },
      },
      {
        id: 'actor-2',
        name: '路人',
        relationship: '',
      },
    ],
    messages: [],
    notes: [],
    photos: [],
  };

  const appData = worldAppData(dummyWorld);
  assert.equal(appData.contacts.length, 2);

  const c1 = appData.contacts.find((c) => c.id === 'actor-1')!;
  assert.deepEqual(c1.publicProfile, {
    identity: '向导',
    traits: ['热情', '细心'],
    appearance: '戴着蓝色帽子',
  });

  const c2 = appData.contacts.find((c) => c.id === 'actor-2')!;
  assert.equal(c2.publicProfile, undefined);
});

test('PersonCard renders structured public profile details when present', () => {
  const contact: PhoneContact = {
    id: 'c1',
    name: '林澈',
    relationship: '常客',
    publicProfile: {
      identity: '自由撰稿人',
      traits: ['内向', '观察力强'],
      appearance: '身穿深灰色风衣',
    },
    summary: '常客简介',
    unread: 0,
  };

  const html = renderToStaticMarkup(createElement(PersonCard, { contact }));
  assert.match(html, /自由撰稿人/);
  assert.match(html, /内向/);
  assert.match(html, /观察力强/);
  assert.match(html, /身穿深灰色风衣/);
  assert.match(html, /人物介绍/);
  assert.match(html, /常客简介/);
});

test('PersonCard omits profile details container when publicProfile is absent', () => {
  const contact: PhoneContact = {
    id: 'c2',
    name: '路人甲',
    relationship: '',
    unread: 0,
  };

  const html = renderToStaticMarkup(createElement(PersonCard, { contact }));
  assert.doesNotMatch(html, /profileDetails/);
  assert.doesNotMatch(html, /traitTag/);
  assert.doesNotMatch(html, /人物介绍/);
});
