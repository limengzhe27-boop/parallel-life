import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublishedWorldContentSchema } from '../src/contracts/published-world-content.ts';
import {
  publicationPlayerPreview,
  type PublicationContent,
} from '../src/modules/settings/domain/publication-content.ts';
import { mergePublicationPreparation } from '../src/modules/settings/domain/publication-preparation.ts';
import {
  actorStageImageId,
  attachActorImage,
  detachActorImage,
} from '../src/features/publisher/publisher-actor-image.ts';
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
    if (url.endsWith('publisher-actor-image-editor.tsx'))
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
const { PublisherActorImageEditor } =
  await import('../src/features/publisher/publisher-actor-image-editor.tsx');
const assetId = '10000000-0000-4000-8000-000000000001';
const hiddenAssetId = '10000000-0000-4000-8000-000000000002';
function actor(key: string, knownAtStart = true) {
  return {
    key,
    name: key,
    knownAtStart,
    publicCard: { identity: '同事', traits: [], avatarMediaKey: 'avatar' },
    privatePersona: {
      background: '私人背景',
      motivation: '自己的安排',
      voice: '平静',
      boundaries: '尊重决定',
    },
  };
}
function fixture(): PublicationContent {
  return {
    schemaVersion: 1,
    work: {
      key: 'work',
      title: '现场图测试',
      hook: '一次见面',
      description: '合成资料',
      experienceNote: '虚构',
    },
    world: {
      publicSetting: '城市',
      tone: '日常',
      startAt: '2030-01-01T08:00:00Z',
      startPlaceKey: 'home',
      hiddenContext: '不公开',
    },
    protagonist: { identity: '玩家', situation: '在家', knownFactKeys: [] },
    actors: [actor('friend'), actor('unknown', false)],
    relationships: [],
    places: [{ key: 'home', name: '家', description: '屋内', knownAtStart: true }],
    routes: [],
    history: [],
    initialKnowledge: [],
    phone: { messages: [], notes: [], invitations: [], album: [] },
    media: [
      {
        key: 'avatar',
        asset: { namespace: 'publication', key: 'qingqing', revision: 1 },
        use: 'avatar',
        depiction: 'generated_image',
        label: '头像',
        visibility: { kind: 'world' },
      },
    ],
    candidates: [],
    extensions: [],
  };
}

test('stage image upload and removal preserve avatars, private persona, other people and prior assets', () => {
  const source = fixture();
  const before = structuredClone(source);
  const next = attachActorImage(source as unknown as Record<string, unknown>, 'friend', {
    assetId,
    kind: 'image',
    url: 'https://not-trusted.invalid/image.png',
  });
  assert.deepEqual(source, before);
  assert.equal(actorStageImageId(next, 'friend'), assetId);
  const updated = (next.actors as PublicationContent['actors'])[0]!;
  assert.equal(updated.publicCard.avatarMediaKey, 'avatar');
  assert.deepEqual(updated.privatePersona, before.actors[0]!.privatePersona);
  assert.deepEqual((next.actors as PublicationContent['actors'])[1], before.actors[1]);
  assert.equal(JSON.stringify(updated).includes('not-trusted'), false);
  assert.deepEqual(next.media, before.media);
  const removed = detachActorImage(next, 'friend');
  assert.equal(actorStageImageId(removed, 'friend'), undefined);
  assert.deepEqual(removed, before);
  assert.throws(() => attachActorImage(next, 'missing', { assetId, kind: 'image' }), /未找到/);
  assert.throws(() => attachActorImage(next, 'friend', { assetId, kind: 'video' }), /未完成/);
  assert.throws(
    () => attachActorImage(next, 'friend', { assetId: '../bad', kind: 'image' }),
    /未完成/,
  );
});

test('schema keeps a single optional UUID reference and public preview never exposes unknown actor images', () => {
  const source = fixture();
  source.actors[0]!.publicCard.stageImage = { assetId };
  source.actors[1]!.publicCard.stageImage = { assetId: hiddenAssetId };
  const parsed = PublishedWorldContentSchema.parse(source);
  assert.deepEqual(parsed.actors[0]!.publicCard.stageImage, { assetId });
  const preview = publicationPlayerPreview(source);
  assert.equal(preview.actors.length, 1);
  assert.deepEqual(preview.actors[0]!.publicCard.stageImage, { assetId });
  assert.equal(JSON.stringify(preview).includes(hiddenAssetId), false);
  source.actors[0]!.publicCard.stageImage = { assetId: 'https://public.invalid/image.png' };
  assert.equal(PublishedWorldContentSchema.safeParse(source).success, false);
});

test('ordinary actor edits and AI preparation preserve the authored stage image reference', () => {
  const source = fixture();
  source.actors[0]!.publicCard.stageImage = { assetId };
  const row = source as unknown as Record<string, unknown>;
  const form = parseActorEditor(source.actors[0]!, row);
  assert.ok(form);
  const changed = updateActorInContent(row, { ...form!, name: '改过的名字' });
  assert.equal(actorStageImageId(changed, 'friend'), assetId);
  const proposal = structuredClone(row);
  (proposal.actors as PublicationContent['actors'])[0]!.publicCard.stageImage = {
    assetId: hiddenAssetId,
  };
  const result = mergePublicationPreparation(row, proposal);
  assert.equal(actorStageImageId(result.updatedContent, 'friend'), assetId);
});

test('author controls are optional and upload uses private work asset route without claiming AI generation', () => {
  const source = fixture();
  source.actors[0]!.publicCard.stageImage = { assetId };
  const html = renderToStaticMarkup(
    createElement(PublisherActorImageEditor, {
      content: source as unknown as Record<string, unknown>,
      actorKey: 'friend',
      workId: assetId,
      disabled: false,
      onChange: () => {},
      uploadImage: async () => ({ assetId, kind: 'image' as const }),
    }),
  );
  assert.match(html, /现场形象（选填）/);
  assert.match(html, /<details[^>]*>/);
  assert.doesNotMatch(html, /<details[^>]*open/);
  assert.match(html, new RegExp(`/api/v1/publisher/works/${assetId}/media/${assetId}`));
  assert.match(html, /移除现场形象/);
  assert.doesNotMatch(html, /开始生成|生成成功/);
});
