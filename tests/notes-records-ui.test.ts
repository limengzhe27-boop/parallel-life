import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlayerRecordsSchema, type PlayerRecords } from '../src/contracts/world-records.ts';
import { readRoute, routeHash, parentRoute, scrollKey } from '../src/features/phone/navigation.ts';

// Actual component SSR and callbacks, with synthetic contract fixtures only.
// These tests do not validate layout, browser interaction, API or PostgreSQL.
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
const {
  NotesRecords,
  NotesRecordDetail,
  NotesRecordsReadState,
  isSystemRecordTarget,
  recordDestination,
  searchRecords,
  recordText,
} = await import('../src/features/phone/apps/notes-records.tsx');
const { NotesApp } = await import('../src/features/phone/apps/notes.tsx');
const { PhoneAppsProvider } = await import('../src/features/phone/apps/provider.tsx');
const fixture: PlayerRecords = PlayerRecordsSchema.parse({
  schemaVersion: 1,
  worldId: '10000000-0000-4000-8000-000000000001',
  worldVersion: 3,
  coverage: 'recent',
  current: [
    {
      id: 'sys/choice/a',
      kind: 'player_choice',
      title: '你的计划',
      text: '我想先和小芳讨论改期。',
      state: 'planned',
      stateLabel: '你记录的计划',
      assertion: 'player_statement',
      source: {
        kind: 'world_event',
        eventId: 'event-a',
        eventVersion: 1,
        messageId: 'message-not-actor',
        at: '2026-10-10T00:00:00Z',
        timeBasis: 'story',
      },
      navigation: { app: 'wechat', actorId: '20000000-0000-4000-8000-000000000001' },
    },
    {
      id: 'sys/suggestion/b',
      kind: 'actor_suggestion',
      title: '小芳的建议',
      text: '可以周末再见。',
      state: 'suggested',
      stateLabel: '人物建议',
      assertion: 'actor_statement',
      source: {
        kind: 'world_event',
        eventId: 'event-b',
        eventVersion: 2,
        at: '2026-10-10T00:10:00Z',
        timeBasis: 'recorded',
      },
      navigation: { app: 'wechat', actorId: '20000000-0000-4000-8000-000000000002' },
    },
    {
      id: 'sys/invitation/c',
      kind: 'invitation',
      title: '一起喝咖啡',
      text: '周末咖啡店见。',
      state: 'proposed',
      stateLabel: '待回应的邀约',
      assertion: 'invitation_status',
      source: {
        kind: 'world_event',
        eventId: 'event-c',
        eventVersion: 3,
        at: '2026-10-10T00:20:00Z',
        timeBasis: 'story',
      },
      navigation: { app: 'calendar', invitationId: 'invite & /?#' },
    },
  ],
  about: [
    {
      id: 'sys/opening/identity',
      kind: 'opening_context',
      title: '身份',
      text: '这段人生从摄影师开始。',
      state: 'starting_point',
      stateLabel: '人生起点',
      assertion: 'starting_context',
      source: {
        kind: 'opening_field',
        seedId: '30000000-0000-4000-8000-000000000001',
        field: 'identity',
      },
    },
  ],
  history: [
    {
      id: 'sys/choice/old',
      kind: 'player_choice',
      title: '此前的计划',
      text: '我说自己已经处理了。',
      state: 'reported_done',
      stateLabel: '你说已完成',
      assertion: 'player_statement',
      source: {
        kind: 'world_event',
        eventId: 'event-a',
        eventVersion: 1,
        at: '2026-10-10T00:00:00Z',
        timeBasis: 'recorded',
      },
    },
  ],
});
const empty: PlayerRecords = { ...fixture, current: [], about: [], history: [] };
const noop = () => {};
function buttons(node: ReactNode): { onClick?: () => void; children?: ReactNode }[] {
  if (Array.isArray(node)) return node.flatMap(buttons);
  if (!isValidElement<{ onClick?: () => void; children?: ReactNode }>(node)) return [];
  return [...(node.type === 'button' ? [node.props] : []), ...buttons(node.props.children)];
}

test('sourced sections preserve server text, attribution, recent coverage and starting context', () => {
  const html = renderToStaticMarkup(createElement(NotesRecords, { data: fixture, open: noop }));
  for (const text of [
    '眼下要做的事',
    '关于这段人生',
    '此前记录',
    '近期计划、建议和邀约',
    '人生起点的身份与处境',
    '你记录的计划',
    '人物建议',
    '待回应的邀约',
    '你说已完成',
  ])
    assert.ok(html.includes(text));
  assert.doesNotMatch(html, /完整任务|奖励|硬编码账单/);
  assert.equal(searchRecords(fixture.current, ' 小芳 ').length, 2);
  assert.deepEqual(searchRecords(fixture.current, 'message-not-actor'), []);
});
test('same-name contacts and invitation IDs navigate by server IDs; missing target is never guessed', () => {
  assert.deepEqual(recordDestination(fixture.current[0]!), {
    app: 'messages',
    target: '20000000-0000-4000-8000-000000000001',
  });
  assert.deepEqual(recordDestination(fixture.current[1]!), {
    app: 'messages',
    target: '20000000-0000-4000-8000-000000000002',
  });
  assert.deepEqual(recordDestination(fixture.current[2]!), {
    app: 'calendar',
    target: 'invite & /?#',
  });
  assert.equal(recordDestination({ ...fixture.current[0]!, navigation: undefined }), undefined);
  for (const record of fixture.current) {
    const opened: unknown[] = [];
    const tree = NotesRecordDetail({
      data: fixture,
      target: record.id,
      open: (...args) => opened.push(args),
    });
    buttons(tree)[0]!.onClick!();
    const destination = recordDestination(record)!;
    assert.deepEqual(opened, [[destination.app, destination.target]]);
  }
});
test('system details are read only and retain speaker and source-time meaning', () => {
  for (const record of [...fixture.current, ...fixture.about, ...fixture.history]) {
    const html = renderToStaticMarkup(
      createElement(NotesRecordDetail, { data: fixture, target: record.id, open: noop }),
    );
    assert.doesNotMatch(html, /<(?:form|input|textarea|select)\b|contenteditable=/i);
    assert.ok(html.includes(record.stateLabel));
    assert.doesNotMatch(html, /定位到|源版本|event-a|message-not-actor|seed-ui/);
  }
  const story = renderToStaticMarkup(
    createElement(NotesRecordDetail, { data: fixture, target: fixture.current[0]!.id, open: noop }),
  );
  const recorded = renderToStaticMarkup(
    createElement(NotesRecordDetail, { data: fixture, target: fixture.current[1]!.id, open: noop }),
  );
  assert.match(story, /故事时间|查看对话/);
  assert.match(recorded, /记录时间/);
});
test('empty and no-match views remain distinct from loading and read error', () => {
  const blank = renderToStaticMarkup(createElement(NotesRecords, { data: empty, open: noop }));
  assert.match(blank, /暂时没有已记录的事项/);
  assert.match(blank, /人生起点的信息还未记录/);
  const searched = renderToStaticMarkup(
    createElement(NotesRecords, { data: fixture, query: '不存在的词', open: noop }),
  );
  assert.match(searched, /没有找到相关事项/);
  assert.doesNotMatch(searched, /暂时没有已记录的事项/);
  const loading = renderToStaticMarkup(createElement(NotesRecordsReadState, { status: 'loading' }));
  const failure = renderToStaticMarkup(
    createElement(NotesRecordsReadState, {
      status: 'error',
      error: '暂时无法读取人生记录',
      reload: noop,
    }),
  );
  assert.match(loading, /role="status"/);
  assert.match(failure, /role="alert"|重新读取/);
  assert.doesNotMatch(failure, /暂时没有已记录的事项/);
  let retries = 0;
  const tree = NotesRecordsReadState({
    status: 'error',
    reload: () => {
      retries += 1;
    },
  });
  buttons(tree)[0]!.onClick!();
  assert.equal(retries, 1);
});
test('unknown system details never fall back to an editor and text is escaped', () => {
  assert.equal(isSystemRecordTarget('sys/unknown'), true);
  assert.equal(isSystemRecordTarget('new-note'), false);
  assert.equal(isSystemRecordTarget('world:opening-note:0'), false);
  const missing = renderToStaticMarkup(
    createElement(NotesRecordDetail, { data: fixture, target: 'sys/unknown', open: noop }),
  );
  assert.match(missing, /暂时无法打开|返回备忘录/);
  assert.doesNotMatch(missing, /<(?:form|input|textarea)\b/);
  const escaped = {
    ...fixture,
    current: [{ ...fixture.current[0]!, text: '<script>synthetic()</script>' }],
  };
  const html = renderToStaticMarkup(
    createElement(NotesRecordDetail, { data: escaped, target: fixture.current[0]!.id, open: noop }),
  );
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});
test('system deep links use the existing world-scoped route and deterministic parent', () => {
  const route = { app: 'notes' as const, target: fixture.current[0]!.id };
  assert.deepEqual(readRoute(routeHash(fixture.worldId, route), fixture.worldId), route);
  assert.deepEqual(parentRoute(route), { app: 'notes' });
  assert.deepEqual(readRoute(routeHash(fixture.worldId, route), 'different-world'), { app: null });
  assert.notEqual(scrollKey(fixture.worldId, route), scrollKey('different-world', route));
});

function renderNotes(
  target?: string,
  state?: import('../src/features/phone/apps/types.ts').PhoneRecordsState,
  collision = false,
) {
  return renderToStaticMarkup(
    createElement(PhoneAppsProvider, {
      worldId: fixture.worldId,
      data: {
        contacts: [{ id: 'test-contact', name: '测试同伴', relationship: '朋友', unread: 0 }],
        messages: [],
        photos: [],
        invitations: [],
        notes: [
          {
            id: collision ? fixture.current[0]!.id : 'note-private',
            title: '我的私人笔记',
            text: 'PRIVATE_NOTE_TEXT',
            version: 1,
            updatedAt: '2026-10-10T00:00:00Z',
          },
        ],
        choices: [
          {
            id: 'old-choice',
            actorName: '小芳',
            intent: 'LEGACY_CHOICE_MARKER',
            quote: '我打算看看天气。',
            at: '2026-10-10T00:00:00Z',
            status: 'pending',
          },
        ],
      },
      records: state,
      children: createElement(NotesApp, { app: 'notes', target, open: noop }),
    }),
  );
}
test('notes entry uses real ready records and keeps private notes during independent read failure', () => {
  const ready = renderNotes(undefined, { status: 'ready', data: fixture });
  assert.match(ready, /眼下要做的事|关于这段人生|我的便签|PRIVATE_NOTE_TEXT/);
  assert.doesNotMatch(ready, /LEGACY_CHOICE_MARKER/);
  const failure = renderNotes(undefined, { status: 'error', error: '人生记录暂时无法读取' });
  assert.match(failure, /role="alert"|PRIVATE_NOTE_TEXT|已有选择记录|LEGACY_CHOICE_MARKER/);
  assert.doesNotMatch(failure, /暂时没有已记录的事项/);
  const unavailable = renderNotes(undefined);
  assert.match(unavailable, /这部分暂时无法读取/);
});
test('system routes cannot reach private forms even with a colliding note ID or absent data', () => {
  const ready = renderNotes(fixture.current[0]!.id, { status: 'ready', data: fixture }, true);
  assert.doesNotMatch(ready, /<(?:form|input|textarea)\b|PRIVATE_NOTE_TEXT/);
  assert.match(ready, /data-system-record|查看对话/);
  assert.match(ready, /aria-label="返回备忘录"/);
  for (const state of [
    { status: 'loading' } as const,
    { status: 'error', error: '正在恢复读取' } as const,
  ]) {
    const html = renderNotes('sys/unknown', state, true);
    assert.match(html, /aria-label="返回备忘录"/);
    assert.doesNotMatch(html, /<(?:form|input|textarea)\b|PRIVATE_NOTE_TEXT/);
  }
  const personal = renderNotes('note-private', { status: 'error', error: '人生记录读取失败' });
  assert.match(personal, /<form|PRIVATE_NOTE_TEXT/);
  assert.doesNotMatch(personal, /分享到微信|分享便签|与身边的人讨论|一键把便签|选择好友|发给TA/);
  assert.doesNotMatch(personal, /人生记录读取失败/);
});

test('invitation timestamps use world display time without changing source semantics or other text', () => {
  const invitation = { ...fixture.current[2]!, text: '2026-10-11T00:00:00.000Z' };
  assert.equal(recordText(invitation), '约定时间：2026-10-11 08:00');
  const data = { ...fixture, current: [invitation] };
  const list = renderToStaticMarkup(createElement(NotesRecords, { data, open: noop }));
  const detail = renderToStaticMarkup(
    createElement(NotesRecordDetail, { data, target: invitation.id, open: noop }),
  );
  assert.match(list, /约定时间：2026-10-11 08:00/);
  assert.match(detail, /约定时间：2026-10-11 08:00/);
  assert.doesNotMatch(list + detail, /2026-10-11T00:00:00.000Z/);
  assert.match(detail, /故事时间.*2026-10-10 08:20/);
  assert.equal(invitation.text, '2026-10-11T00:00:00.000Z');
  assert.equal(searchRecords([invitation], '2026-10-11 08:00').length, 1);
  assert.equal(recordText({ ...invitation, text: '2026-02-30T00:00:00Z' }), '2026-02-30T00:00:00Z');
  assert.equal(recordText({ ...invitation, text: '周末咖啡店见。' }), '周末咖啡店见。');
  assert.equal(recordText({ ...fixture.current[0]!, text: invitation.text }), invitation.text);
});
