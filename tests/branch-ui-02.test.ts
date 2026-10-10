import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Profile } from '../src/contracts/api.ts';
import type { LifeDraft } from '../src/contracts/life-drafts.ts';
import type { LifeClient } from '../src/features/api/client.ts';

// Execute the actual UI components in Node. CSS is irrelevant to server markup;
// browser acceptance independently checks layout and interactions.
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
const { DraftEditor } = await import('../src/features/discovery/draft-editor.tsx');
const { ProposalThread } = await import('../src/features/interview/proposal-thread.tsx');
const profile: Profile = {
  id: randomUUID(),
  version: 0,
  facts: [],
  events: [],
  people: [],
  portraitAssetId: null,
  referenceAssetIds: [],
  updatedAt: new Date().toISOString(),
};
const draft = (status: 'draft' | 'confirmed'): LifeDraft => ({
  id: randomUUID(),
  version: 1,
  profileVersion: 0,
  discoveryVersion: 1,
  directionId: randomUUID(),
  status,
  story: {
    title: 'My immutable title',
    premise: 'Choice',
    opening: 'Opening scene',
    tradeoff: 'Cost',
  },
  setup: { identity: '', place: '', tone: '' },
  selection: { factIds: [], eventIds: [], personIds: [], assetIds: [], portraitAssetId: null },
  assets: [],
  seedId: status === 'confirmed' ? randomUUID() : null,
  createdAt: profile.updatedAt,
  updatedAt: profile.updatedAt,
});
const client = new Proxy(
  {},
  {
    get() {
      throw Error('SSR must never call a backend');
    },
  },
) as LifeClient;
function render(d: LifeDraft, p = profile) {
  return renderToStaticMarkup(
    createElement(DraftEditor, { draft: d, profile: p, client, onClose() {}, onConfirmed() {} }),
  );
}
test('confirmed legacy draft is an immutable summary without fake editable fields or director placeholder', () => {
  const html = render(draft('confirmed'));
  assert(html.includes('My immutable title'));
  assert(html.includes('Opening scene'));
  assert(!html.includes('<input'));
  assert(!html.includes('<textarea'));
  assert(!html.includes('导演'));
  assert(!html.includes('保存草案'));
});
test('confirmed draft continue control does not depend on fetching current photo roles', () => {
  const html = render(draft('confirmed'));
  const match = html.match(/<button[^>]*>继续准备手机<\/button>/);
  assert(match);
  assert(!match[0].includes('disabled'));
});
test('editing remains a real form with original saved values and explicit save action', () => {
  const html = render(draft('draft'));
  assert(html.includes('<input'));
  assert(html.includes('<textarea'));
  assert(html.includes('My immutable title'));
  assert(html.includes('保存草案'));
  assert(!html.includes('正在筹拍第一部电影的导演'));
  assert(html.includes('其他照片 · 已选'));
  assert(!html.includes('已选人物的原图'));
  assert(html.includes('没有照片也可以选择'));
  assert(html.includes('最多8位'));
});
test('confirmed material count must remain its recorded snapshot despite current people photos', () => {
  const personId = randomUUID(),
    assetId = randomUUID(),
    d = draft('confirmed');
  d.selection.personIds = [personId];
  const p = {
    ...profile,
    people: [{ id: personId, name: 'Person', relationship: 'Friend', assetId }],
  };
  const html = render(d, p);
  assert(!html.includes('/api/v1/assets/' + assetId));
  assert.match(html, /0 张照片/);
});
test('conversation proposal is a shortcut and detail dialog stays closed until explicit interaction', () => {
  const html = renderToStaticMarkup(
    createElement(ProposalThread, {
      client,
      revision: 1,
      ready: true,
      profileVersion: 0,
      confirmedCount: 0,
      pendingCandidates: 0,
      messages: [
        { role: 'user', text: '我想经营一家小小的咖啡店' },
        { role: 'assistant', text: 'Synthetic UI context' },
      ],
      externalTrigger: 1,
      externalIntent: 'create',
    }),
  );
  assert(html.includes('人生构思快捷入口'));
  assert(!/<dialog[^>]*\sopen(?:[\s=>])/.test(html));
  assert(!html.includes('proposal-featured-card'));
});
test('empty conversation does not expose a generation shortcut before readiness', () => {
  assert.equal(
    renderToStaticMarkup(
      createElement(ProposalThread, {
        client,
        revision: 0,
        ready: false,
        profileVersion: 0,
        confirmedCount: 0,
        pendingCandidates: 0,
        messages: [],
      }),
    ),
    '',
  );
});
