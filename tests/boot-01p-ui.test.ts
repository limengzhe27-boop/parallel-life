import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlayerRecordsSchema, type PlayerRecords } from '../src/contracts/world-records.ts';
import type { PhoneAppsData } from '../src/features/phone/apps/types.ts';

// Actual components and callbacks with explicit contract fixtures. No layout, PG or AI claim.
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
const { NotesRecordDetail, NotesRecords, recordAttribution, searchRecords } =
  await import('../src/features/phone/apps/notes-records.tsx');
const { NotesApp } = await import('../src/features/phone/apps/notes.tsx');
const { MessagesApp } = await import('../src/features/phone/apps/messages.tsx');
const { CalendarApp } = await import('../src/features/phone/apps/calendar.tsx');
const { PhotosApp } = await import('../src/features/phone/apps/photos.tsx');
const { PhoneAppsProvider } = await import('../src/features/phone/apps/provider.tsx');
const worldId = '10000000-0000-4000-8000-000000000001',
  actorId = '20000000-0000-4000-8000-000000000001',
  messageId = '30000000-0000-4000-8000-000000000001',
  photoId = '40000000-0000-4000-8000-000000000001',
  invitationId = '50000000-0000-4000-8000-000000000001';
const recordId = `sys/history/${worldId}/a`;
const source = {
  kind: 'world_genesis' as const,
  worldId,
  seedId: '60000000-0000-4000-8000-000000000001',
  messageId,
  snapshotVersion: 0 as const,
  at: '2026-10-09T04:00:00.000Z',
  timeBasis: 'story' as const,
};
const fixture: PlayerRecords = PlayerRecordsSchema.parse({
  schemaVersion: 1,
  worldId,
  worldVersion: 0,
  coverage: 'recent',
  about: [],
  history: [],
  current: [
    {
      id: recordId,
      kind: 'history_message',
      title: '小芳的来信',
      text: '周末可以一起讨论场地。',
      state: 'starting_point',
      stateLabel: '虚构起点来信',
      assertion: 'actor_statement',
      source,
      origin: source,
      navigation: { app: 'wechat', actorId },
      relatedLinks: [
        { app: 'messages', target: actorId, label: '查看来源对话' },
        { app: 'calendar', target: invitationId, label: '查看日程' },
        { app: 'photos', target: photoId, label: '人物照片' },
      ],
    },
  ],
});
const data: PhoneAppsData = {
  contacts: [{ id: actorId, name: '小芳', relationship: '搭档', unread: 1 }],
  messages: [
    {
      id: messageId,
      actorId,
      role: 'assistant',
      text: '周末可以一起讨论场地。',
      at: source.at,
      status: 'sent',
      initialRead: true,
      links: [
        { app: 'notes', target: recordId, label: '查看来信记录' },
        { app: 'calendar', target: invitationId, label: '查看日程' },
      ],
    },
    {
      id: 'current',
      actorId,
      role: 'assistant',
      text: '今天要不要先聊聊？',
      at: '2026-10-10T04:00:00.000Z',
      status: 'sent',
      initialRead: false,
    },
  ],
  invitations: [
    Object.assign(
      {
        id: invitationId,
        title: '讨论场地',
        at: '2026-10-11T04:00:00.000Z',
        participantIds: [actorId],
        status: 'proposed' as const,
        version: 0,
        links: [
          { app: 'messages' as const, target: actorId, label: '查看来源对话' },
          { app: 'notes' as const, target: recordId, label: '查看来信记录' },
        ],
      },
      { origin: source },
    ),
  ],
  photos: [
    {
      id: photoId,
      date: '2026-09-20T01:00:00.000Z',
      title: '用户带入的照片 · 小芳',
      description: '用户带入的原图 · 日期为上传时间，不代表拍摄或共同经历',
      sourcePersonId: '70000000-0000-4000-8000-000000000001',
      url: '/real-authorized-image',
      status: 'ready',
      tag: 'upload',
      links: [{ app: 'notes', target: recordId, label: '查看相关来信记录' }],
    },
  ],
  notes: [
    {
      id: 'private',
      title: '私人便签',
      text: 'PRIVATE_NOTE_NOT_IN_SYS_DETAIL',
      version: 1,
      updatedAt: source.at,
    },
  ],
  referenceTime: '2026-10-10T04:00:00.000Z',
};
const noop = () => {};
function buttons(node: ReactNode): { onClick?: () => void; children?: ReactNode }[] {
  if (Array.isArray(node)) return node.flatMap(buttons);
  if (!isValidElement<{ onClick?: () => void; children?: ReactNode }>(node)) return [];
  return [...(node.type === 'button' ? [node.props] : []), ...buttons(node.props.children)];
}
function renderApp(
  component: typeof PhotosApp | typeof CalendarApp | typeof MessagesApp | typeof NotesApp,
  app: 'photos' | 'calendar' | 'messages' | 'notes',
  target: string,
  apps = data,
) {
  return renderToStaticMarkup(
    createElement(PhoneAppsProvider, {
      worldId,
      data: apps,
      records: { status: 'ready', data: fixture },
      children: createElement(component, { app, target, open: noop }),
    }),
  );
}
test('history records stay sourced and readonly; related targets use IDs and a conversation label', () => {
  const opened: unknown[] = [];
  const tree = NotesRecordDetail({
    data: fixture,
    target: recordId,
    open: (...args) => opened.push(args),
  });
  const html = renderToStaticMarkup(tree);
  assert(html.includes('虚构起点来信'));
  assert(html.includes('来信时间'));
  assert(html.includes('查看来源对话'));
  assert(html.includes('相关人物带入素材'));
  assert.doesNotMatch(
    html,
    /定位气泡|你的讲述|私人便签|PRIVATE_NOTE|textarea|contenteditable|编辑记录/,
  );
  const actions = buttons(tree);
  assert.equal(actions.length, 3);
  for (const button of actions) button.onClick!();
  assert.deepEqual(opened, [
    ['messages', actorId],
    ['calendar', invitationId],
    ['photos', photoId],
  ]);
  assert.equal(searchRecords(fixture.current, '虚构起点').length, 1);
  assert.equal(recordAttribution(fixture.current[0]!), '虚构起点来信');
  const notes = renderApp(NotesApp, 'notes', recordId);
  assert(notes.includes('虚构起点来信'));
  assert.doesNotMatch(notes, /textarea|PRIVATE_NOTE_NOT_IN_SYS_DETAIL/);
});
test('invitation source time, activity time and later owner response retain distinct provenance', () => {
  const invitation = PlayerRecordsSchema.parse({
    ...fixture,
    current: [
      {
        ...fixture.current[0],
        id: 'sys/invitation/a',
        kind: 'invitation',
        state: 'proposed',
        stateLabel: '待回应的邀约',
        assertion: 'invitation_status',
        text: data.invitations[0]!.at,
        navigation: { app: 'calendar', invitationId },
      },
    ],
  });
  const original = renderToStaticMarkup(
    createElement(NotesRecordDetail, { data: invitation, target: 'sys/invitation/a', open: noop }),
  );
  assert(original.includes('约定时间'));
  assert(original.includes('来信时间'));
  assert(original.includes('待回应的邀约'));
  assert(original.includes('源自虚构起点来信'));
  const replied = PlayerRecordsSchema.parse({
    ...invitation,
    worldVersion: 1,
    current: [
      {
        ...invitation.current[0],
        state: 'confirmed',
        stateLabel: '已确认的日程',
        source: {
          kind: 'world_event',
          eventId: 'accepted',
          eventVersion: 1,
          at: '2026-10-10T05:00:00.000Z',
          timeBasis: 'story',
        },
      },
    ],
  });
  const after = renderToStaticMarkup(
    createElement(NotesRecordDetail, { data: replied, target: 'sys/invitation/a', open: noop }),
  );
  assert(after.includes('回应时间'));
  assert(after.includes('源自虚构起点来信'));
  assert(after.includes('已确认的日程'));
  const calendar = renderApp(CalendarApp, 'calendar', invitationId);
  assert(calendar.includes('源自虚构起点来信'));
  assert(calendar.includes('邀约仍待你回应'));
  assert(calendar.includes('查看来源对话'));
  assert.doesNotMatch(calendar, /已确认的日程|已约好/);
});
test('chat links preserve an initially read history without adding a label to current messages', () => {
  const html = renderApp(MessagesApp, 'messages', actorId);
  assert.equal((html.match(/虚构起点来信/g) || []).length, 1);
  assert(html.includes('查看来信记录'));
  assert(html.includes('查看日程'));
  assert(html.includes('今天要不要先聊聊？'));
});
test('authorized reference photo preserves upload date and renders only supplied record links', () => {
  const html = renderApp(PhotosApp, 'photos', photoId);
  assert(html.includes('相关人物带入素材'));
  assert(html.includes('上传于'));
  assert(html.includes('2026-09-20'));
  assert(html.includes('不代表拍摄或共同经历'));
  assert(html.includes('查看相关来信记录'));
  assert(html.includes('/real-authorized-image'));
  assert.doesNotMatch(html, /2026-10-11|新生成|现场实拍/);
  const noLinks = renderApp(PhotosApp, 'photos', photoId, {
    ...data,
    photos: data.photos.map((photo) => ({ ...photo, links: undefined })),
  });
  assert(!noLinks.includes('查看相关来信记录'));
  assert(noLinks.includes('照片来源'));
  const noPhoto = renderApp(PhotosApp, 'photos', photoId, { ...data, photos: [] });
  assert(noPhoto.includes('找不到这张照片'));
  assert.doesNotMatch(noPhoto, /real-authorized-image|查看相关来信记录/);
});
test('legacy record without genesis origin keeps its old text and source navigation', () => {
  const legacy = PlayerRecordsSchema.parse({
    ...fixture,
    current: [
      {
        ...fixture.current[0],
        kind: 'actor_suggestion',
        source: {
          kind: 'world_event',
          eventId: 'old',
          eventVersion: 1,
          at: source.at,
          timeBasis: 'recorded',
        },
        origin: undefined,
        relatedLinks: undefined,
      },
    ],
  });
  const html = renderToStaticMarkup(
    createElement(NotesRecordDetail, { data: legacy, target: recordId, open: noop }),
  );
  assert(html.includes('人物建议'));
  assert(html.includes('记录时间'));
  assert(!html.includes('虚构起点来信</p>'));
  const list = renderToStaticMarkup(createElement(NotesRecords, { data: legacy, open: noop }));
  assert(list.includes('眼下要做的事'));
  assert(list.includes('人生起点的身份与处境'));
});
