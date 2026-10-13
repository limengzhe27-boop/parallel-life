import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createElement, isValidElement, type ReactNode, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublisherWorkSchema } from '../src/contracts/world-publisher.ts';
import {
  phoneTrialFromResult,
  phoneTrialMatches,
  phoneTrialMount,
} from '../src/features/publisher/publisher-phone-trial.ts';
import type { PublicationWorldResult } from '../src/contracts/publication-worlds.ts';
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
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
            jsx: ts.JsxEmit.ReactJSX,
          },
        }).outputText,
      };
    return nextLoad(url, context);
  },
});
const { PublisherCharacterPreview } =
  await import('../src/features/publisher/publisher-character-preview.tsx');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const content = {
  actors: [
    {
      key: 'a',
      name: '观察员',
      knownAtStart: true,
      publicCard: { identity: '同事', introduction: '公开介绍', traits: [] },
      privatePersona: { voice: 'PRIVATE_VOICE' },
      lifeModules: { traits: 'PRIVATE_TRAITS' },
    },
  ],
  phone: {
    messages: [
      {
        key: 'm',
        actorKey: 'a',
        text: 'SHOULD_ONLY_APPEAR_IN_REAL_APP',
        at: '2026-10-12T00:00:00Z',
      },
    ],
    moments: [
      {
        key: 'p',
        actorKey: 'a',
        text: 'SHOULD_ONLY_APPEAR_IN_REAL_APP_MOMENT',
        at: '2026-10-12T00:00:00Z',
      },
    ],
  },
};
const work = PublisherWorkSchema.parse({
  id: id(1),
  title: '保存的世界',
  draftVersion: 2,
  metadataVersion: 0,
  status: 'draft',
  publicationVersion: null,
  createdAt: '2026-10-13T00:00:00Z',
  updatedAt: '2026-10-13T00:00:00Z',
  draft: {
    version: 2,
    contentHash: 'a'.repeat(64),
    content,
    createdAt: '2026-10-13T00:00:00Z',
    createdBy: id(2),
  },
});
const result: PublicationWorldResult = {
  worldId: id(3),
  seedId: id(4),
  origin: {
    workId: work.id,
    publicationVersion: 0,
    draftVersion: 2,
    contentHash: work.draft.contentHash,
  },
  originKind: 'trial',
  trialId: id(5),
  resumed: false,
  replayed: false,
};
const trial = phoneTrialFromResult(work, result);
function props() {
  return { content, actorKey: 'a', canEdit: true, busy: false, onChange() {} };
}
function walk(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(walk);
  if (!isValidElement(node)) return [];
  const e = node as ReactElement<Record<string, unknown>>;
  return [e, ...walk(e.props.children as ReactNode)];
}
test('trial is tied to exact saved work, draft version and content hash; foreign or stale acknowledgements cannot be displayed', () => {
  assert.ok(phoneTrialMatches(work, trial));
  assert.ok(!phoneTrialMatches({ ...work, id: id(8) }, trial));
  assert.ok(
    !phoneTrialMatches({ ...work, draftVersion: 3, draft: { ...work.draft, version: 3 } }, trial),
  );
  assert.ok(
    !phoneTrialMatches({ ...work, draft: { ...work.draft, contentHash: 'b'.repeat(64) } }, trial),
  );
  assert.throws(() =>
    phoneTrialFromResult(work, {
      ...result,
      origin: { ...result.origin, contentHash: 'b'.repeat(64) },
    }),
  );
  assert.throws(() => phoneTrialFromResult(work, { ...result, originKind: 'published_work' }));
  assert.throws(() => phoneTrialFromResult(work, { ...result, trialId: null }));
});
test('the same trial mounts exclusively in the inline pane or drawer, or neither when stale/closed', () => {
  for (const placement of ['inline', 'drawer', null] as const) {
    const mount = phoneTrialMount(work, trial, placement);
    assert.ok(!(mount.inline && mount.drawer));
    assert.equal(mount.inline, placement === 'inline' ? trial : null);
    assert.equal(mount.drawer, placement === 'drawer' ? trial : null);
  }
  assert.deepEqual(phoneTrialMount({ ...work, id: id(8) }, trial, 'inline'), {
    inline: null,
    drawer: null,
  });
});
test('author pane embeds only the actual trial route and keeps draft messages/moments out of a fabricated phone', () => {
  const html = renderToStaticMarkup(
    createElement(PublisherCharacterPreview, { ...props(), trial }),
  );
  assert.equal((html.match(/<iframe/g) ?? []).length, 1);
  assert.match(html, new RegExp(`/workbench/trials/${id(5)}`));
  assert.match(html, /公开介绍/);
  assert.ok(!html.includes('SHOULD_ONLY_APPEAR_IN_REAL_APP'));
  assert.ok(!html.includes('PRIVATE_VOICE'));
  const phonePane = html.slice(html.indexOf('<section'), html.indexOf('</section>'));
  assert.ok(!phonePane.includes('PRIVATE_TRAITS'));
  assert.ok(!html.includes('bubble'));
});
test('unsaved content hides an existing trial and requires an explicit save; initial rendering never creates a trial', () => {
  let saves = 0,
    starts = 0;
  const dirty = {
    ...props(),
    trial,
    isDirty: true,
    onSave() {
      saves++;
    },
    onStartTrial() {
      starts++;
    },
  };
  const tree = PublisherCharacterPreview(dirty);
  const html = renderToStaticMarkup(tree);
  assert.ok(!html.includes('<iframe'));
  assert.match(html, /有未保存的修改/);
  assert.equal(starts, 0);
  const save = walk(tree).find((e) => e.type === 'button' && e.props.onClick === dirty.onSave)!;
  assert.ok(save);
  (save.props.onClick as () => void)();
  assert.equal(saves, 1);
  assert.equal(starts, 0);
  const unopened = PublisherCharacterPreview({
    ...props(),
    onStartTrial() {
      starts++;
    },
  });
  assert.ok(!renderToStaticMarkup(unopened).includes('<iframe'));
  assert.equal(starts, 0);
  const open = walk(unopened).find(
    (e) => e.type === 'button' && e.props.children === '试演这份草稿',
  )!;
  (open.props.onClick as () => void)();
  assert.equal(starts, 1);
});
test('the existing trial route continues through PublisherTrial and the actual WorldPhoneApp transport with automatic model progression disabled', () => {
  const trialSource = readFileSync(
    new URL('../src/features/publisher/publisher-trial.tsx', import.meta.url),
    'utf8',
  );
  assert.match(trialSource, /<WorldPhoneApp/);
  assert.match(trialSource, /transport=\{transport\}/);
  assert.match(trialSource, /automatic=\{false\}/);
  const character = readFileSync(
    new URL('../src/features/publisher/publisher-character-preview.tsx', import.meta.url),
    'utf8',
  );
  assert.ok(!character.includes('person.messages.map'));
  assert.ok(!character.includes('person.moments.map'));
});
