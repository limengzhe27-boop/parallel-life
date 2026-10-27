import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createElement, isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SELECTABLE_STICKERS } from '../src/modules/world/domain/stickers.ts';
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
const { StickerPicker, StickerImage } = await import('../src/features/phone/apps/sticker-ui.tsx');
const { stickerMessageContent } = await import('../src/features/phone/apps/sticker-content.ts');

test('caption and sticker coexist, legacy marker is image-only, invalid ID preserves words', () => {
  const caption = stickerMessageContent('我先去忙，晚上联系', 'hao');
  assert.equal(caption.text, '我先去忙，晚上联系');
  assert.equal(caption.sticker?.id, 'hao');
  assert.equal(caption.imageOnly, false);
  const legacy = stickerMessageContent('[[sticker:hao]]');
  assert.equal(legacy.text, '');
  assert.equal(legacy.imageOnly, true);
  assert.equal(stickerMessageContent('有效文字', 'not_valid').text, '有效文字');
  assert.equal(stickerMessageContent('有效文字', 'not_valid').sticker, null);
});

test('picker renders real catalog images with send labels; busy disables image send', () => {
  const html = renderToStaticMarkup(
    createElement(StickerPicker, {
      emojis: ['😊'],
      disabled: true,
      onEmoji: () => {},
      onSticker: () => {},
    }),
  );
  assert.match(html, /图片表情/);
  assert.match(html, /Emoji/);
  assert.match(html, /发送表情：指着你笑/);
  assert.match(html, /src="\/stickers\/candidates\/selected_aa.webp"/);
  assert.match(html, /disabled=""/);
});

test('picker renders every one of the 60 sendable catalog entries, not a truncated first page', () => {
  const html = renderToStaticMarkup(
    createElement(StickerPicker, {
      emojis: ['😊'],
      disabled: false,
      onEmoji: () => {},
      onSticker: () => {},
    }),
  );
  assert.equal(SELECTABLE_STICKERS.length, 60);
  assert.equal((html.match(/aria-label="发送表情：/g) ?? []).length, 60);
  assert.equal((html.match(/<img /g) ?? []).length, 60);
});

test('sticker preserves image alt text and does not gate neighboring text on image loading', () => {
  const html = renderToStaticMarkup(
    createElement(StickerImage, {
      sticker: {
        id: 'selected_aa',
        label: '指着你笑',
        src: '/stickers/candidates/selected_aa.webp',
      },
    }),
  );
  assert.match(html, /alt="指着你笑"/);
  assert.match(html, /loading="lazy"/);
});
