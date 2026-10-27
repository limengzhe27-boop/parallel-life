import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PlayerRecords } from '../src/contracts/world-records.ts';
import type { PhoneInvitation, PhonePhoto } from '../src/features/phone/apps/types.ts';
import {
  selectDesktopTask,
  selectDesktopSchedule,
  selectDesktopPhoto,
} from '../src/features/phone/desktop-widget-selection.ts';
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
          compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
        }).outputText,
      };
    return nextLoad(url, context);
  },
});
const { PhoneDesktop } = await import('../src/features/phone/phone-desktop.tsx');
type RecordItem = PlayerRecords['current'][number];
const record = (id: string, changes: Partial<RecordItem> = {}): RecordItem => ({
  id: `sys/${id}`,
  kind: 'world_matter',
  span: 'near_term',
  title: id,
  text: '',
  state: 'in_progress',
  stateLabel: '进行中',
  assertion: 'world_verified',
  source: {
    kind: 'world_matter',
    matterId: id,
    span: 'near_term',
    at: '2026-10-27T00:00:00Z',
    timeBasis: 'story',
  },
  ...changes,
});
const records = (current: RecordItem[], more: Partial<PlayerRecords> = {}) => ({
  status: 'ready' as const,
  data: {
    schemaVersion: 1 as const,
    worldId: '11111111-1111-4111-8111-111111111111',
    worldVersion: 1,
    coverage: 'recent' as const,
    current,
    about: [],
    history: [],
    ...more,
  },
});
const invitation = (
  id: string,
  status: PhoneInvitation['status'],
  at = '2026-10-27T02:00:00Z',
): PhoneInvitation => ({ id, title: id, at, status, participantIds: [], version: 1 });
const photo = (id: string, changes: Partial<PhonePhoto> = {}): PhonePhoto => ({
  id,
  title: id,
  date: '2026-10-27T01:00:00Z',
  status: 'ready',
  url: `/private/${id}`,
  description: '',
  ...changes,
});

test('task prioritizes active near-term work, then not-started, then explicit player choices', () => {
  const choice = record('choice', { kind: 'player_choice', state: 'planned' }),
    later = record('later', { state: 'not_started' }),
    active = record('active', { state: 'blocked' });
  assert.equal(selectDesktopTask(records([choice, later, active]))?.id, active.id);
  assert.equal(selectDesktopTask(records([choice, later]))?.id, later.id);
  assert.equal(selectDesktopTask(records([choice]))?.id, choice.id);
  assert.equal(
    selectDesktopTask(
      records([record('blocked-choice', { kind: 'player_choice', state: 'blocked' })]),
    )?.id,
    'sys/blocked-choice',
  );
});
test('task never borrows suggestions, proposed appointments, pursuits, history or closed work', () => {
  const rejected: RecordItem[] = [
    record('suggestion', { kind: 'actor_suggestion' }),
    record('appointment', { kind: 'invitation', state: 'proposed' }),
    record('pursuit', { span: 'pursuit' }),
    ...(['completed', 'abandoned', 'superseded', 'reported_done', 'cancelled'] as const).map(
      (state) => record(state, { state }),
    ),
    record('pending-choice', { kind: 'player_choice', state: 'suggested' }),
  ];
  assert.equal(
    selectDesktopTask(
      records(rejected, { about: [record('about')], history: [record('history')] }),
    ),
    undefined,
  );
  assert.equal(selectDesktopTask({ status: 'error', error: 'not loaded' }), undefined);
  assert.equal(selectDesktopTask({ status: 'loading' }), undefined);
  assert.equal(selectDesktopTask(undefined), undefined);
});
test('schedule prioritizes real confirmed future arrangements and identifies remaining proposals', () => {
  const input = [
    invitation('early-proposal', 'proposed', '2026-10-27T00:30:00Z'),
    invitation('confirmed', 'confirmed'),
    invitation('past', 'confirmed', '2026-10-26T23:00:00Z'),
    invitation('cancelled', 'cancelled'),
  ];
  const before = JSON.stringify(input);
  assert.equal(selectDesktopSchedule(input, '2026-10-27T00:00:00Z')?.id, 'confirmed');
  assert.equal(selectDesktopSchedule([input[0]!], '2026-10-27T00:00:00Z')?.status, 'proposed');
  assert.equal(selectDesktopSchedule(input, undefined), undefined);
  assert.equal(JSON.stringify(input), before);
});
test('photo uses latest ready image with a real URL, excluding videos and pending media', () => {
  const input = [
    photo('image'),
    photo('later', { date: '2026-10-27T02:00:00Z' }),
    photo('video', { mediaType: 'video', date: '2026-10-28T00:00:00Z' }),
    photo('mime-video', { mimeType: 'video/mp4', date: '2026-10-29T00:00:00Z' }),
    photo('pending', { status: 'generating' }),
    photo('missing', { url: undefined }),
  ];
  const before = JSON.stringify(input);
  assert.equal(selectDesktopPhoto(input)?.id, 'later');
  assert.equal(selectDesktopPhoto([photo('failed', { status: 'failed' })]), undefined);
  assert.equal(JSON.stringify(input), before);
});
const render = (input: Partial<Parameters<typeof PhoneDesktop>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(PhoneDesktop, {
      title: '渣男体验',
      dateLabel: '10月27日 周二',
      timeLabel: '08:15',
      data: {
        contacts: [{ id: 'a', name: '青青', relationship: '', unread: 8 }],
        messages: [],
        photos: [],
        invitations: [],
        notes: [
          {
            id: 'n',
            title: '不可充当任务的便签',
            text: '',
            version: 1,
            updatedAt: '2026-10-27T00:00:00Z',
          },
        ],
        referenceTime: '2026-10-27T00:15:00Z',
      },
      open: () => {},
      openPanel: () => {},
      ...input,
    }),
  );
test('compact widgets render actual task and photo, with no duplicate unread pill or notes summary', () => {
  const html = render({
    records: records([record('医院看母亲')]),
    data: {
      contacts: [],
      messages: [],
      notes: [],
      photos: [photo('真实照片')],
      invitations: [invitation('拟议会面', 'proposed')],
      referenceTime: '2026-10-27T00:15:00Z',
    },
  });
  assert.match(html, /眼下任务/);
  assert.match(html, /医院看母亲/);
  assert.match(html, /待确认/);
  assert.match(html, /最近照片/);
  assert.match(html, /src="\/private\/真实照片"/);
  assert.doesNotMatch(html, /未读|备忘录/);
});
test('empty and failed reads remain honest and never invent a task or image', () => {
  const empty = render({ records: records([]) }),
    failed = render({ records: { status: 'error', error: 'backend failed' } });
  assert.match(empty, /暂无眼下任务/);
  assert.match(empty, /暂无照片/);
  assert.doesNotMatch(empty, /不可充当任务|条未读|<img/);
  assert.match(failed, /任务暂未读取/);
  assert.doesNotMatch(failed, /backend failed|暂无眼下任务/);
});
