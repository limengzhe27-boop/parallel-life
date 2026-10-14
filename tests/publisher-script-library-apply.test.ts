import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseScriptLibraryMarkdown,
  reviseScriptLibraryPreview,
} from '../src/features/publisher/publisher-script-library.ts';
import { applyScriptLibraryPreview } from '../src/features/publisher/publisher-script-library-apply.ts';
const manuscript =
  '地址汇总：街边，餐厅。\n\n开场事件：意外来信\n场景：街边与手机聊天界面。\n原稿的开场。\n\n1.\n#### 同事约饭\n场景：餐厅与手机聊天页面。\n工作稳定后才考虑，拒绝不会自动赴约。';
const content = () => ({
  actors: [{ key: 'colleague', name: '同事' }],
  places: [{ key: 'street', name: '街边', description: '原有说明', knownAtStart: true }],
  candidates: [],
  world: { startPlaceKey: 'street' },
});
test('format import makes playable optional library events with unchanged prose and no synthetic conditions or messages', () => {
  const c = content(),
    p = parseScriptLibraryMarkdown(manuscript, c.places),
    r = applyScriptLibraryPreview(c, p);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.addedEvents, 2);
  assert.equal(r.addedPlaces, 1);
  assert.equal(c.candidates.length, 0);
  const events = r.content.candidates as Record<string, unknown>[];
  for (const e of events) {
    assert.deepEqual(e.intent, { kind: 'director_event' });
    assert.deepEqual(e.direction, { mode: 'optional' });
    assert.deepEqual(e.prerequisites, []);
    assert.ok(p.events.some((source) => source.body === e.script));
  }
  assert.equal(r.content.openingEventKey, events[0]!.key);
  assert.equal((r.content as Record<string, unknown>).phone, undefined);
  const again = applyScriptLibraryPreview(
    r.content,
    parseScriptLibraryMarkdown(manuscript, r.content.places as { key: string; name: string }[]),
  );
  assert.ok(again.ok);
  if (again.ok) {
    assert.equal(again.addedEvents, 0);
    assert.equal(again.addedPlaces, 0);
    assert.equal(again.unchanged, true);
  }
});
test('same event title preserves author edits by default and explicit replacement keeps authored hard arrangements', () => {
  const c = {
    ...content(),
    openingEventKey: 'authored',
    candidates: [
      {
        key: 'authored',
        title: '1. 同事约饭',
        editorialIntent: '作者已经修改的内容',
        intent: { kind: 'director_event', actorKey: 'colleague' },
        actorKeys: ['colleague'],
        prerequisites: [{ kind: 'at_place', placeKey: 'street' }],
        direction: { mode: 'required' },
      },
    ],
  };
  const p = parseScriptLibraryMarkdown(manuscript, c.places);
  const result = applyScriptLibraryPreview(c, p);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(
    (result.content.candidates as typeof c.candidates)[0]!.editorialIntent,
    '作者已经修改的内容',
  );
  assert.equal(result.content.openingEventKey, 'authored');
  const e = p.events[1]!;
  const replaced = applyScriptLibraryPreview(c, p, {
    [e.key]: { replace: true, targetKey: 'authored' },
  });
  assert.ok(replaced.ok);
  if (replaced.ok) {
    const row = (replaced.content.candidates as typeof c.candidates)[0]!;
    assert.equal(row.editorialIntent, e.body);
    assert.deepEqual(row.intent, c.candidates[0]!.intent);
    assert.deepEqual(row.prerequisites, c.candidates[0]!.prerequisites);
    assert.deepEqual(row.direction, c.candidates[0]!.direction);
  }
});
test('unknown text and ambiguous matches cannot silently overwrite existing work', () => {
  const c = content(),
    p = parseScriptLibraryMarkdown('未归属的原文。\n\n' + manuscript, c.places);
  assert.equal(applyScriptLibraryPreview(c, p).ok, false);
  const revised = reviseScriptLibraryPreview(p, {}, { [p.unassigned[0]!.key]: p.events[0]!.key });
  const r = applyScriptLibraryPreview(c, revised);
  assert.ok(r.ok);
  if (r.ok)
    assert.match(
      String((r.content.candidates as Record<string, unknown>[])[0]!.script),
      /未归属的原文。/,
    );
  const duplicated = {
    ...c,
    candidates: [
      { key: 'old1', title: '同事约饭' },
      { key: 'old2', title: '同事约饭' },
    ],
  };
  assert.equal(
    applyScriptLibraryPreview(duplicated, parseScriptLibraryMarkdown(manuscript, c.places)).ok,
    false,
  );
});
test('capacity failure is atomic and leaves every original character available', () => {
  const p = parseScriptLibraryMarkdown('1. 大事件\n' + '很长的原文'.repeat(4000));
  const c = content();
  assert.equal(applyScriptLibraryPreview(c, p).ok, false);
  assert.ok(p.events[0]!.body.endsWith('很长的原文'));
  assert.equal(c.candidates.length, 0);
});
