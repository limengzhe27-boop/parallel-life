import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readOverallSetting,
  updateOverallSetting,
  OVERALL_SETTING_NAMESPACE,
} from '../src/features/publisher/publisher-overall-setting.ts';
import { PublishedWorldContentSchema } from '../src/contracts/published-world-content.ts';
import { PublisherDraftContentSchema } from '../src/contracts/world-publisher.ts';
const extension = (text: string) => ({
  namespace: OVERALL_SETTING_NAMESPACE,
  version: 1,
  purpose: 'editorial',
  description: '作者总体设定原稿',
  data: { text },
});
const base = {
  world: { publicSetting: '公开故事', hiddenContext: '幕后秘密', tone: '写实' },
  work: { title: '标题', description: '旧简介' },
  protagonist: { identity: '主角', situation: '待出发' },
  extensions: [
    {
      namespace: 'author.other',
      version: 1,
      purpose: 'editorial',
      description: '别的资料',
      data: { secret: '不动' },
    },
  ],
};
test('legacy recap is labelled existing and empty draft has no invented template', () => {
  const before = JSON.stringify(base),
    r = readOverallSetting(base);
  assert.equal(r.source, 'existing');
  assert.match(r.text, /幕后背景（不公开）\n幕后秘密/);
  assert.equal(JSON.stringify(base), before);
  assert.deepEqual(readOverallSetting({}), { text: '', source: 'empty' });
});
test('first edit stores exact author text privately and preserves every other field and extension', () => {
  const before = JSON.stringify(base),
    text = '  原稿\n秘密😀\n';
  const r = updateOverallSetting(base, text);
  assert.ok(r.ok);
  assert.equal(readOverallSetting(r.content).text, text);
  assert.equal(readOverallSetting(r.content).source, 'authored');
  assert.deepEqual(r.content, { ...base, extensions: [...base.extensions, extension(text)] });
  assert.equal(JSON.stringify(base), before);
  assert.ok(PublisherDraftContentSchema.safeParse(r.content).success);
  const next = updateOverallSetting(r.content, '');
  assert.ok(next.ok);
  assert.deepEqual(readOverallSetting(next.content), { text: '', source: 'authored' });
  assert.equal((next.content.extensions as unknown[]).length, 2);
});
test('namespace matches published schema envelope rather than adding a new public field', () => {
  const parsed = PublishedWorldContentSchema.safeParse({ extensions: [extension('原稿')] });
  assert.ok(!parsed.success);
  assert.equal(parsed.error.issues.filter((i) => i.path[0] === 'extensions').length, 0);
});
test('duplicate, malformed and future authored envelopes never get overwritten', () => {
  for (const rows of [
    [extension('a'), extension('b')],
    [{ ...extension('a'), version: 2 }],
    [{ ...extension('a'), purpose: 'runtime_required' }],
    [{ ...extension('a'), data: { text: 'a', future: '保留' } }],
  ]) {
    const c = { extensions: rows },
      before = JSON.stringify(c);
    assert.ok(readOverallSetting(c).problem);
    assert.equal(updateOverallSetting(c, '新稿').ok, false);
    assert.equal(JSON.stringify(c), before);
  }
  assert.equal(updateOverallSetting({ extensions: {} }, '新稿').ok, false);
});
test('UTF8 and escaped JSON budgets reject without truncating text and accept their exact boundary', () => {
  const size = (s: string) => new TextEncoder().encode(JSON.stringify({ text: s })).length;
  for (const unit of ['中', '😀', '"', '\n']) {
    let text = '';
    while (size(text + unit) <= 8192) text += unit;
    const r = updateOverallSetting({}, text);
    assert.ok(r.ok);
    assert.equal(readOverallSetting(r.content).text, text);
    assert.deepEqual(updateOverallSetting({}, text + unit), {
      ok: false,
      reason: 'extension_budget',
    });
  }
});
test('extension count, combined budget and whole draft budget obey actual storage bounds', () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({
    ...extension('x'),
    namespace: `author.part_${i}`,
  }));
  assert.deepEqual(updateOverallSetting({ extensions: rows }, 'x'), {
    ok: false,
    reason: 'extension_limit',
  });
  rows[0] = extension('old');
  assert.ok(updateOverallSetting({ extensions: rows }, 'new').ok);
  const other = Array.from({ length: 2 }, (_, i) => ({
    ...extension('x'.repeat(8000)),
    namespace: `author.part_${i}`,
  }));
  assert.deepEqual(updateOverallSetting({ extensions: other }, 'x'.repeat(400)), {
    ok: false,
    reason: 'extensions_budget',
  });
  const roomy = { large: 'x'.repeat(1_048_000) };
  assert.ok(updateOverallSetting(roomy, 'a').ok);
  assert.deepEqual(updateOverallSetting(roomy, 'a'.repeat(1000)), {
    ok: false,
    reason: 'content_budget',
  });
});
test('invalid JSON objects fail closed without rewriting the original', () => {
  const c: Record<string, unknown> = {};
  c.circular = c;
  assert.deepEqual(updateOverallSetting(c, 'x'), { ok: false, reason: 'invalid_content' });
  assert.equal(c.circular, c);
});
