import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseScriptLibraryMarkdown,
  reviseScriptLibraryPreview,
} from '../src/features/publisher/publisher-script-library.ts';
test('synthetic 18-event fixture recognizes opening, both numbering forms, full prose and multiple locations without presentation places', () => {
  const text =
    '未归类的创作说明。\n\n地址汇总：**城市街边**，西餐厅，医院走廊，母亲病房，酒馆，出租屋\n\n开场事件：开端\n场景：城市街边与手机聊天界面\n开场原文\n\n' +
    Array.from(
      { length: 17 },
      (_, i) =>
        `${i + 1}.${i % 2 ? ' 事件' + (i + 1) : '\n#### 事件' + (i + 1)}\n#### 场景：${i % 2 ? '医院走廊与母亲病房' : '酒馆与出租屋'}\n完成两次带孩后触发；拒绝则另行发展。\n\n第${i + 1}事件尾部。\n\n`,
    ).join('');
  const p = parseScriptLibraryMarkdown(text);
  assert.deepEqual(p.issues, []);
  assert.equal(p.events.length, 18);
  assert.equal(p.events.filter((e) => e.opening).length, 1);
  assert.deepEqual(
    p.places.map((v) => v.name),
    ['城市街边', '西餐厅', '医院走廊', '母亲病房', '酒馆', '出租屋'],
  );
  assert.equal(p.events[0]!.placeKeys.length, 1);
  assert.equal(p.events[1]!.placeKeys.length, 2);
  assert.equal(p.events[2]!.placeKeys.length, 2);
  assert.match(p.unassigned[0]!.source.text, /未归类的创作说明/);
  for (const e of p.events) {
    assert.equal(e.body, text.slice(e.source.start, e.source.end));
    assert.equal(e.source.text, e.body);
    assert.ok(!('prerequisites' in e));
    assert.ok(!('actorKey' in e));
    assert.ok(!('at' in e));
  }
  assert.match(p.events[17]!.body, /第17事件尾部/);
  assert.deepEqual(parseScriptLibraryMarkdown(text), p);
});
test('newline address list preserves order, exact names reuse existing keys, and different spellings only suggest merging', () => {
  const p = parseScriptLibraryMarkdown(
    '地址汇总：\n**医院走廊**\n- 医院的走廊\n出租屋\n\n开场事件：开端\n场景：医院走廊与出租屋\n正文',
    [{ key: 'hospital_old', name: '医院走廊' }],
  );
  assert.deepEqual(
    p.places.map((v) => v.name),
    ['医院走廊', '医院的走廊', '出租屋'],
  );
  assert.equal(p.places[0]!.key, 'hospital_old');
  assert.equal(p.places.length, 3);
  assert.equal(p.mergeSuggestions.length, 1);
  const revised = reviseScriptLibraryPreview(p, { [p.places[1]!.key]: p.places[0]!.key }, {});
  assert.equal(revised.places.length, 2);
  assert.equal(p.places.length, 3);
  assert.equal(revised.events[0]!.placeKeys.length, 2);
});
test('long prose, CRLF, Markdown and explicit trigger language remain exact without truncation or structure extraction', () => {
  const body =
    '1. 人物事件\r\n#### 场景：医院走廊与母亲病房\r\n\r\n' +
    '**完整原文**。完成两次带孩后触发，拒绝则……\r\n\r\n'.repeat(200) +
    '不可丢失尾部\r\n';
  const p = parseScriptLibraryMarkdown(body);
  assert.ok(body.length > 4000);
  assert.equal(p.events[0]!.body, body);
  assert.equal(p.events[0]!.placeKeys.length, 2);
  assert.deepEqual(p.issues, []);
});
test('unknown prefix is retained and explicit assignment adds it without changing the original input or proposal', () => {
  const raw = '# 世界背景\n这是尚未归入的原文。\n\n1. 事件\n场景：出租屋\n事件正文';
  const p = parseScriptLibraryMarkdown(raw);
  assert.equal(p.unassigned.length, 1);
  const revised = reviseScriptLibraryPreview(p, {}, { [p.unassigned[0]!.key]: p.events[0]!.key });
  assert.equal(revised.unassigned.length, 0);
  assert.ok(revised.events[0]!.body.endsWith(p.unassigned[0]!.source.text));
  assert.equal(revised.original, raw);
  assert.equal(p.unassigned.length, 1);
});
test('numbers are display labels; reordering does not turn them into dependencies or change stable event identifiers', () => {
  const a = parseScriptLibraryMarkdown('1. 第一件\n正文甲\n2. 第二件\n正文乙');
  const b = parseScriptLibraryMarkdown('1. 第二件\n正文乙\n2. 第一件\n正文甲');
  for (const e of a.events) assert.equal(e.key, b.events.find((v) => v.title === e.title)!.key);
  const nested = parseScriptLibraryMarkdown(
    '1. 事件\n正文\n  1. 缩进的列表不是事件\n  2. 仍是正文',
  );
  assert.equal(nested.events.length, 1);
  assert.match(nested.events[0]!.body, /2. 仍是正文/);
});
test('duplicate opening and ambiguous existing names report original; merge loops never mutate source', () => {
  const p = parseScriptLibraryMarkdown(
    '地址汇总：甲地，乙地\n开场事件：甲\n场景：甲地\n开场事件：乙\n正文',
    [
      { key: 'one', name: '甲地' },
      { key: 'two', name: '甲地' },
    ],
  );
  assert.ok(p.issues.some((v) => v.reason.includes('多个开场')));
  assert.ok(p.issues.some((v) => v.reason.includes('多个同名')));
  const b = parseScriptLibraryMarkdown('地址汇总：甲地，乙地\n1. 事件\n场景：甲地与乙地\n正文');
  const c = reviseScriptLibraryPreview(
    b,
    { [b.places[0]!.key]: b.places[1]!.key, [b.places[1]!.key]: b.places[0]!.key },
    {},
  );
  assert.ok(c.issues.length);
  assert.deepEqual(c.events, b.events);
});
