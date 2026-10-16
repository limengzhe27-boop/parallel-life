import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { isValidElement, type ReactElement } from 'react';
import type { PublisherWorkbenchProps } from '../src/contracts/publisher-workbench.ts';
import {
  CHARACTER_MODULES,
  characterModuleText,
  characterIntroductionText,
  characterLegacyModuleText,
  updateCharacterField,
  characterPreview,
} from '../src/features/publisher/publisher-character-model.ts';
import { publicationCharacterPlanner } from '../src/server/publication-character-planner.ts';
import type { PostgresDatabase } from '../src/modules/storage/infrastructure/postgres.ts';
import type { ActorContext } from '../src/modules/world/application/ports.ts';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.module.css'))
      return {
        format: 'module',
        shortCircuit: true,
        source: 'export default new Proxy({}, {get:(_t,k)=>String(k)})',
      };
    if (url.endsWith('.tsx') && !url.includes('/node_modules/')) {
      let source = readFileSync(new URL(url), 'utf8');
      if (url.endsWith('publisher-workbench.tsx'))
        source = source.replace(
          "import React, { useState, useEffect, useMemo, useCallback } from 'react';",
          "import React from 'react'; const useState = v => globalThis.__canonicalHooks.useState(v); const useMemo = f => f(); const useCallback = f => f; const useEffect = () => {};",
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
const { PublisherWorkbench } = await import('../src/features/publisher/publisher-workbench.tsx');
const modules = Object.fromEntries(
  CHARACTER_MODULES.map((m, i) => [m.key, `  作者维度${i + 1}\n逐字原文；私密底线${i}  `]),
);
function fixture(): Record<string, any> {
  return {
    world: { publicSetting: '普通小镇', hiddenContext: '世界幕后原文' },
    actors: [
      {
        key: 'partner',
        name: '搭档',
        knownAtStart: true,
        lifeModules: { ...modules, future: false },
        publicCard: {
          identity: '职业身份',
          introduction: '  作者公开介绍\n独立于身份  ',
          traits: [],
          avatarMediaKey: 'avatar',
          extra: { original: true },
        },
        privatePersona: {
          background: '旧背景',
          voice: '旧语气',
          motivation: '旧动机',
          boundaries: '旧底线',
        },
        extra: { untouched: true },
      },
      {
        key: 'other',
        name: '别人',
        knownAtStart: false,
        privatePersona: { background: '别人的秘密' },
      },
    ],
    relationships: [
      {
        key: 'old_relation',
        description: '既有公开关系，不得覆盖',
        visibility: { kind: 'player' },
      },
    ],
    phone: {
      messages: [{ key: 'history', actorKey: 'partner', text: '原对话' }],
      moments: [{ text: '原动态' }],
    },
    initialKnowledge: [{ actorKey: 'partner', factKeys: ['original'] }],
    media: [{ key: 'avatar', future: { original: true } }],
    future: { retained: [false, 0, null] },
  };
}
function nodes(value: unknown): ReactElement<Record<string, any>>[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!isValidElement(value)) return [];
  const e = value as ReactElement<Record<string, any>>;
  return [e, ...nodes(e.props.children)];
}
function harness(content: Record<string, any>, patch: Partial<PublisherWorkbenchProps> = {}) {
  let cursor = 0;
  const states: any[] = ['actors'];
  const saved: any[] = [];
  Object.assign(globalThis, {
    __canonicalHooks: {
      useState(v: unknown) {
        const i = cursor++;
        if (!(i in states)) states[i] = typeof v === 'function' ? v() : v;
        return [
          states[i],
          (next: any) => {
            states[i] = typeof next === 'function' ? next(states[i]) : next;
          },
        ];
      },
    },
  });
  const work = {
    id: 'work',
    title: '通用故事',
    status: 'draft' as const,
    draftVersion: 1,
    metadataVersion: 0,
    publicationVersion: null,
    createdAt: '2026-10-14T00:00:00Z',
    updatedAt: '2026-10-14T00:00:00Z',
    draft: {
      version: 1,
      contentHash: 'hash',
      content,
      createdAt: '2026-10-14T00:00:00Z',
      createdBy: 'author',
    },
  };
  const props = {
    session: { displayName: '作者', canEdit: true, canPublish: false },
    works: [work],
    work,
    check: null,
    busy: false,
    error: null,
    onSelectWork() {},
    onCreateWork() {},
    onSaveDraft(value: unknown) {
      saved.push(value);
    },
    onCheck() {},
    onTrial() {},
    onPublish() {},
    onLogout() {},
    ...patch,
  };
  const render = () => {
    cursor = 0;
    return nodes(PublisherWorkbench(props));
  };
  const field = (id: string) => {
    const n = render().find((n) => n.props.id === id);
    assert.ok(n, id);
    return n;
  };
  return {
    saved,
    render,
    field,
    change(id: string, value: string) {
      field(id).props.onChange({ target: { value } });
    },
    save() {
      const button = render().find((n) => n.type === 'button' && n.props.children === '保存草稿');
      assert.ok(button);
      button.props.onClick();
    },
    close() {
      Reflect.deleteProperty(globalThis, '__canonicalHooks');
    },
  };
}

test('actual role inputs show canonical prose and save six exact fields without mutating identity, legacy or unrelated source', () => {
  const content = fixture(),
    before = structuredClone(content),
    h = harness(content);
  try {
    assert.equal(h.field('actor-identity-input').props.value, '职业身份');
    assert.equal(
      h.field('actor-introduction-input').props.value,
      before.actors[0].publicCard.introduction,
    );
    for (const [i, m] of CHARACTER_MODULES.entries())
      assert.equal(h.field(`actor-dimension-${i + 1}`).props.value, modules[m.key]);
    assert.equal(h.saved.length, 0);
    const intro = '  新公开介绍\n保持所有空格  ';
    h.change('actor-introduction-input', intro);
    for (const [i] of CHARACTER_MODULES.entries())
      h.change(`actor-dimension-${i + 1}`, `  修改后的维度${i}\n包括秘密，不公开  `);
    h.save();
    const next = h.saved[0].content;
    const expected = structuredClone(before);
    expected.actors[0].publicCard.introduction = intro;
    for (const [i, m] of CHARACTER_MODULES.entries())
      expected.actors[0].lifeModules[m.key] = `  修改后的维度${i}\n包括秘密，不公开  `;
    assert.deepEqual(next, expected);
    assert.deepEqual(content, before);
    assert.equal(characterPreview(next, 'partner')!.introduction, intro);
    assert.ok(!JSON.stringify(characterPreview(next, 'partner')).includes('包括秘密'));
    const reloaded = harness(JSON.parse(JSON.stringify(next)));
    try {
      assert.equal(
        reloaded.field('actor-dimension-5').props.value,
        expected.actors[0].lifeModules.relationships,
      );
      assert.equal(reloaded.saved.length, 0);
    } finally {
      reloaded.close();
    }
  } finally {
    h.close();
  }
});

test('legacy summary is reference only; a single canonical edit never migrates other summaries or exposes L5', () => {
  const content = fixture();
  delete content.actors[0].lifeModules;
  delete content.actors[0].publicCard.introduction;
  const before = structuredClone(content),
    h = harness(content);
  try {
    assert.equal(h.field('actor-introduction-input').props.value, '');
    for (let i = 1; i <= 5; i++) assert.equal(h.field(`actor-dimension-${i}`).props.value, '');
    assert.equal(characterLegacyModuleText(content, 'partner', 'lifeContext'), '旧背景');
    assert.equal(characterLegacyModuleText(content, 'partner', 'behavior'), '');
    h.change('actor-dimension-5', '幕后关系：不公开的猜疑');
    h.save();
    const expected = structuredClone(before);
    expected.actors[0].lifeModules = { relationships: '幕后关系：不公开的猜疑' };
    assert.deepEqual(h.saved[0].content, expected);
    assert.deepEqual(content, before);
    assert.equal(characterLegacyModuleText(expected, 'partner', 'relationships'), '');
    assert.ok(!JSON.stringify(characterPreview(expected, 'partner')).includes('猜疑'));
  } finally {
    h.close();
  }
});

test('read-only and busy block actual event callbacks as well as disabling the canonical controls', () => {
  for (const patch of [
    { busy: true },
    { session: { displayName: '只读', canEdit: false, canPublish: false } },
  ]) {
    const content = fixture(),
      h = harness(content, patch);
    try {
      for (const id of [
        'actor-introduction-input',
        ...CHARACTER_MODULES.map((_, i) => `actor-dimension-${i + 1}`),
      ]) {
        assert.equal(h.field(id).props.disabled, true);
        h.change(id, '不得写入');
      }
      assert.equal(h.field('actor-dimension-1').props.value, modules.lifeContext);
      assert.equal(
        h.field('actor-introduction-input').props.value,
        content.actors[0].publicCard.introduction,
      );
      assert.equal(h.saved.length, 0);
    } finally {
      h.close();
    }
  }
});

test('canonical helper clears only selected optional text, rejects opaque values and duplicate identities', () => {
  const c = fixture();
  const next = updateCharacterField(c, 'partner', 'traits', '');
  assert.equal(characterModuleText(next, 'partner', 'traits'), '');
  assert.equal(characterIntroductionText(next, 'partner'), c.actors[0].publicCard.introduction);
  assert.deepEqual((next.actors as any[])[0].privatePersona, c.actors[0].privatePersona);
  for (const raw of [null, [], 'future container']) {
    const malformed = fixture();
    malformed.actors[0].lifeModules = raw;
    assert.equal(updateCharacterField(malformed, 'partner', 'traits', 'overwrite'), malformed);
  }
  c.actors[0].lifeModules.traits = { future: 'do not overwrite' };
  assert.equal(updateCharacterField(c, 'partner', 'traits', 'overwrite'), c);
  c.actors.push(c.actors[0]);
  assert.equal(updateCharacterField(c, 'partner', 'introduction', 'overwrite'), c);
});

test('real character planner wrapper supplies only the saved speaker canonical dimensions to the model', async () => {
  let content = fixture();
  content = updateCharacterField(content, 'partner', 'behavior', '  新行动方式\n先核实再行动  ');
  const own = { ...(content.actors as any[])[0].lifeModules };
  delete own.future;
  const db = {
    async transaction(owner: string, run: (sql: any) => unknown) {
      assert.equal(owner, 'owner');
      return run({
        async query(sql: string, args: unknown[]) {
          if (sql.startsWith('SELECT version FROM parallel_life.worlds'))
            return { rows: [{ version: 0 }] };
          if (sql.includes('FROM parallel_life.publication_opening_deliveries d'))
            return { rows: [] };
          if (sql.includes('publication_actor_life_modules')) {
            assert.deepEqual(args, ['world', 'speaker-id']);
            return { rows: [{ document: own }] };
          }
          if (sql.includes('publication_social_opening'))
            return { rows: [{ document: { moments: [] } }] };
          assert.ok(sql.includes('SELECT m.document AS opening'));
          return { rows: [] };
        },
      });
    },
  } as unknown as PostgresDatabase;
  let calls = 0;
  const planner = publicationCharacterPlanner(db, 'owner', 'world', {
    async complete(messages) {
      calls++;
      const data = JSON.parse(messages[1]!.content);
      assert.deepEqual(data.ownCharacterSettings, own);
      assert.ok(!JSON.stringify(data).includes('别人的秘密'));
      return '我会先核实，再开始做。';
    },
  });
  const context: ActorContext = {
    worldId: 'world',
    worldVersion: 0,
    time: '2026-10-14T00:00:00.000Z',
    actor: { id: 'speaker-id', name: '搭档', relationship: '熟人', persona: '兼容摘要' },
    facts: [],
    messages: [],
    appointments: [],
  };
  await planner.propose({ context, userText: '你准备怎么做？' });
  assert.equal(calls, 1);
});
