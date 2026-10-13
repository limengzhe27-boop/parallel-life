import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createElement, isValidElement, type ReactNode, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  characterPreview,
  characterModuleText,
  updateCharacterField,
  characterPreviewTime,
} from '../src/features/publisher/publisher-character-model.ts';
import {
  parseActorEditor,
  updateActorInContent,
} from '../src/features/publisher/publisher-editor.ts';
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
function fixture(): Record<string, unknown> {
  return {
    world: { startAt: '2026-10-13T00:00:00Z', hiddenContext: 'WORLD_PRIVATE' },
    actors: [
      {
        key: 'guide',
        name: '向导',
        knownAtStart: true,
        publicCard: { identity: '勘探员', introduction: '会认真记录路线。', traits: [] },
        privatePersona: {
          background: 'PRIVATE_HISTORY',
          voice: 'PRIVATE_VOICE',
          motivation: 'PRIVATE_DRIVE',
          boundaries: 'PRIVATE_BOUNDARY',
        },
        lifeModules: {
          lifeContext: '长期带队勘探，熟悉天气变化',
          traits: 'MODULE_PRIVATE',
          drives: '想让队伍平安返回',
          behavior: '遇到风暴会先保护队伍',
          relationships: '与主角合作过多次，习惯提前确认路线',
          futureExtra: '保持原文',
        },
      },
      { key: 'stranger', name: '陌生人', knownAtStart: false, publicCard: { identity: '研究员' } },
    ],
    phone: {
      messages: [
        { key: 'later', actorKey: 'guide', text: '按昨天的路线走。', at: '2026-10-12T02:00:00Z' },
        {
          key: 'reply',
          actorKey: 'guide',
          speaker: 'player',
          text: '我带上地图。',
          at: '2026-10-12T01:00:00Z',
        },
        { key: 'other', actorKey: 'stranger', text: 'OTHER_PERSON', at: '2026-10-12T01:00:00Z' },
        { key: 'future', actorKey: 'guide', text: 'FUTURE_EVENT', at: '2026-10-14T01:00:00Z' },
        { key: 'malformed', actorKey: 'guide', text: 'INVALID_DATE', at: 'nonsense' },
        {
          key: 'unknown_speaker',
          actorKey: 'guide',
          speaker: 'director',
          text: 'UNKNOWN_SPEAKER',
          at: '2026-10-12T01:00:00Z',
        },
      ],
      moments: [
        {
          key: 'post_1',
          actorKey: 'guide',
          text: '今天修好了指南针。',
          at: '2026-10-11T01:00:00Z',
        },
        {
          key: 'post_2',
          actorKey: 'guide',
          text: '旧地图也有新发现。',
          at: '2026-10-12T01:00:00Z',
        },
        { key: 'post_other', actorKey: 'stranger', text: 'OTHER_POST', at: '2026-10-12T01:00:00Z' },
      ],
      notes: [{ text: 'OTHER_PHONE_CONTENT' }],
    },
    extensions: [{ data: 'EXTENSION_PRIVATE' }],
  };
}
test('preview selects the contact, defaults old message speaker, orders actual history and omits future or malformed entries', () => {
  const content = fixture(),
    before = JSON.stringify(content);
  const preview = characterPreview(content, 'guide')!;
  assert.deepEqual(
    preview.messages.map((m) => [m.key, m.speaker]),
    [
      ['reply', 'player'],
      ['later', 'actor'],
    ],
  );
  assert.deepEqual(
    preview.moments.map((m) => m.key),
    ['post_2', 'post_1'],
  );
  const rendered = JSON.stringify(preview);
  for (const hidden of [
    'WORLD_PRIVATE',
    'MODULE_PRIVATE',
    'PRIVATE_HISTORY',
    'PRIVATE_VOICE',
    'PRIVATE_DRIVE',
    'PRIVATE_BOUNDARY',
    'OTHER_PERSON',
    'OTHER_POST',
    'FUTURE_EVENT',
    'UNKNOWN_SPEAKER',
    'OTHER_PHONE_CONTENT',
    'EXTENSION_PRIVATE',
  ])
    assert.ok(!rendered.includes(hidden), hidden);
  assert.equal(JSON.stringify(content), before);
});
test('unknown contacts keep empty history and duplicate keys fail closed without choosing one identity', () => {
  const content = fixture();
  assert.deepEqual(characterPreview(content, 'stranger')!.messages, []);
  assert.deepEqual(characterPreview(content, 'stranger')!.moments, []);
  (content.actors as unknown[]).push((content.actors as unknown[])[0]);
  assert.equal(characterPreview(content, 'guide'), undefined);
  assert.equal(updateCharacterField(content, 'guide', 'introduction', '不能覆盖'), content);
});
test('editing one module preserves authored extensions, legacy persona, other people and phone content', () => {
  const content = fixture();
  (content.actors as unknown[]).push(null);
  const before = JSON.stringify(content);
  const changed = updateCharacterField(content, 'guide', 'traits', '谨慎但好奇');
  assert.equal(characterModuleText(changed, 'guide', 'traits'), '谨慎但好奇');
  const actor = (changed.actors as Record<string, unknown>[])[0]!;
  assert.deepEqual(
    actor.privatePersona,
    (content.actors as Record<string, unknown>[])[0]!.privatePersona,
  );
  assert.equal((actor.lifeModules as Record<string, unknown>).futureExtra, '保持原文');
  assert.equal((changed.actors as unknown[])[2], null);
  assert.equal(changed.phone, content.phone);
  assert.equal((changed.actors as unknown[])[1], (content.actors as unknown[])[1]);
  assert.equal(JSON.stringify(content), before);
  const introduction = updateCharacterField(changed, 'guide', 'introduction', '新的公开介绍');
  assert.equal(characterPreview(introduction, 'guide')!.introduction, '新的公开介绍');
  const form = parseActorEditor(
    (introduction.actors as Record<string, unknown>[])[0]!,
    introduction,
  );
  const legacyEdit = updateActorInContent(introduction, { ...form, name: '改名后的向导' });
  assert.equal(characterPreview(legacyEdit, 'guide')!.introduction, '新的公开介绍');
  assert.equal(characterModuleText(legacyEdit, 'guide', 'traits'), '谨慎但好奇');
});
test('character pane uses saved-trial guidance and universal author fields without manufacturing a phone conversation', () => {
  const html = renderToStaticMarkup(
    createElement(PublisherCharacterPreview, {
      content: fixture(),
      actorKey: 'guide',
      canEdit: true,
      busy: false,
      onChange() {},
    }),
  );
  assert.match(html, /aria-label="真实手机试演"/);
  assert.ok(!html.includes('我带上地图'));
  assert.ok(!html.includes('按昨天的路线走'));
  assert.ok(!html.includes('playerMessage'));
  assert.match(html, /向导 · 角色介绍/);
  assert.match(html, /朋友圈/);
  for (const field of [
    '人生背景',
    '人格特质',
    '动机与价值观',
    '行为模式',
    '关系模型',
    '给玩家看的角色介绍',
  ])
    assert.ok(html.includes(field), field);
  const phone = html.slice(html.indexOf('<section'), html.indexOf('</section>'));
  assert.ok(!phone.includes('MODULE_PRIVATE'));
  assert.ok(!phone.includes('PRIVATE_VOICE'));
  assert.ok(!phone.includes('PRIVATE_DRIVE'));
});
test('empty chat is honest, does not synthesize conversation, and read-only drafts cannot edit author fields', () => {
  const content = fixture();
  const html = renderToStaticMarkup(
    createElement(PublisherCharacterPreview, {
      content,
      actorKey: 'stranger',
      canEdit: false,
      busy: false,
      onChange() {},
    }),
  );
  assert.match(html, /保存后试演/);
  assert.ok(!html.includes('OTHER_PERSON'));
  assert.equal((html.match(/<textarea[^>]*disabled=""/g) ?? []).length, 6);
  assert.equal(characterPreviewTime('2026-10-12T20:30:00Z'), '10月13日 04:30');
});

test('author field edits use the real onChange draft callback with full modules and original private persona retained', () => {
  const content = fixture();
  let saved: Record<string, unknown> = content;
  let result: ReactNode;
  function Capture() {
    result = PublisherCharacterPreview({
      content,
      actorKey: 'guide',
      canEdit: true,
      busy: false,
      onChange(next) {
        saved = next;
      },
    });
    return null;
  }
  renderToStaticMarkup(createElement(Capture));
  function walk(node: ReactNode): ReactElement<Record<string, unknown>>[] {
    if (Array.isArray(node)) return node.flatMap(walk);
    if (!isValidElement(node)) return [];
    const element = node as ReactElement<Record<string, unknown>>;
    return [element, ...walk(element.props.children as ReactNode)];
  }
  const field = walk(result).find(
    (node) => node.type === 'textarea' && node.props.value === '遇到风暴会先保护队伍',
  );
  assert.ok(field);
  (field.props.onChange as (e: { target: { value: string } }) => void)({
    target: { value: '遇到压力会先确认队伍安全，再尝试新路线' },
  });
  assert.equal(
    characterModuleText(saved, 'guide', 'behavior'),
    '遇到压力会先确认队伍安全，再尝试新路线',
  );
  assert.equal(characterModuleText(saved, 'guide', 'lifeContext'), '长期带队勘探，熟悉天气变化');
  assert.equal(characterModuleText(saved, 'guide', 'drives'), '想让队伍平安返回');
  assert.equal(
    characterModuleText(saved, 'guide', 'relationships'),
    '与主角合作过多次，习惯提前确认路线',
  );
  assert.equal(characterPreview(saved, 'guide')!.introduction, '会认真记录路线。');
  assert.deepEqual(
    (saved.actors as Record<string, unknown>[])[0]!.privatePersona,
    (content.actors as Record<string, unknown>[])[0]!.privatePersona,
  );
});
