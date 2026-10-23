import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import {
  STICKER_CATALOG,
  STICKER_IDS,
  SELECTABLE_STICKERS,
  getSticker,
} from '../src/modules/world/domain/stickers.ts';
import { parseStickerText, STICKER_LABELS } from '../src/features/phone/stickers.ts';
test('shared catalogue resolves all historical assets without exposing unlicensed candidates', () => {
  assert.deepEqual(
    STICKER_CATALOG.map((s) => s.id),
    [...STICKER_IDS],
  );
  for (const s of SELECTABLE_STICKERS) {
    assert.ok(existsSync(new URL('../public' + s.src, import.meta.url)));
    assert.ok(s.description.length > 0);
    assert.equal(STICKER_LABELS[s.id], s.label);
    assert.deepEqual(parseStickerText(`[[sticker:${s.id}]]`), {
      id: s.id,
      label: s.label,
      src: s.src,
    });
  }
  assert.equal(getSticker('selected_aa'), null);
  assert.equal(parseStickerText('[[sticker:__proto__]]'), null);
});
