import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { OfficialLifeCardView } from '../src/features/discovery/official-lives.tsx';
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
const { OfficialLivesView } = await import('../src/features/discovery/official-lives.tsx');
// Explicit rendering fixtures only: these are not a production catalog or saved worlds.
const cards: OfficialLifeCardView[] = [
  {
    id: 'county-yellow-hair',
    title: '县城黄毛',
    hook: '她坚持带你回家。',
    artwork: 'garage',
    hasSave: false,
  },
  {
    id: 'only-child',
    title: '江浙沪独生子',
    hook: '爸妈让你接班。',
    artwork: 'lake',
    hasSave: true,
  },
  {
    id: 'returned-daughter',
    title: '刚回家的真千金',
    hook: '今晚却还是她的生日宴。',
    artwork: 'house',
    hasSave: false,
  },
  {
    id: 'retired-star',
    title: '退圈后的顶流',
    hook: '今晚所有人又在等你出现。',
    artwork: 'stage',
    hasSave: false,
  },
];
const render = (extra = {}) =>
  renderToStaticMarkup(
    createElement(OfficialLivesView, { cards, onOpen() {}, onReload() {}, ...extra }),
  );
test('four real view cards have complete titles, original illustration labels, and open/continue semantics', () => {
  const html = render();
  assert.equal((html.match(/<article /g) ?? []).length, 4);
  assert.equal((html.match(/原创插画/g) ?? []).length, 4);
  for (const card of cards) assert.ok(html.includes(card.title));
  assert.ok(html.includes('江浙沪独生子，继续'));
  assert.ok(html.includes('县城黄毛，打开这部手机'));
  assert.ok(!html.includes('未读'));
  assert.ok(!html.includes('生日<input'));
});
test('preparation disables all card commands; failure stays with its own card and full text', () => {
  const preparing = render({ pendingId: 'county-yellow-hair' });
  assert.ok(preparing.includes('aria-busy="true"'));
  assert.ok(preparing.includes('正在准备这部手机'));
  assert.equal((preparing.match(/disabled=""/g) ?? []).length, 5);
  const failed = render({ errors: { 'county-yellow-hair': '准备未确认，原操作保留。' } });
  assert.equal((failed.match(/role="alert"/g) ?? []).length, 1);
  const article = failed.split('</article>')[0];
  assert.ok(article);
  assert.ok(article.includes('准备未确认，原操作保留。'));
  assert.ok(article.includes('县城黄毛，重新尝试'));
  assert.ok(failed.includes('江浙沪独生子，继续'));
});
test('unavailable directory has honest read retry, no fabricated cards, and note text is escaped', () => {
  const unavailable = render({ cards: [], loadError: '目录暂时打不开' });
  assert.ok(unavailable.includes('重新加载'));
  assert.ok(!unavailable.includes('<article'));
  const note = render({
    cards: [{ ...cards[0], experienceNote: '部分现场未开放 <script>private</script>' }],
  });
  assert.ok(note.includes('部分现场未开放'));
  assert.ok(note.includes('<summary>体验说明</summary>'));
  assert.ok(note.includes('<details class="experienceDetails">'));
  assert.ok(!note.includes('<details open'));
  assert.ok(!note.includes('<script>'));
});
