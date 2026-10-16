import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { isValidElement, type ReactNode } from 'react';
import {
  createWorldMatter,
  transitionWorldMatter,
  claimMatterReward,
  type WorldMatter,
} from '../src/modules/world/domain/matters.ts';
import { projectPlayerRecords } from '../src/modules/world/domain/player-records.ts';
import { actorContext } from '../src/modules/world/application/actor-context.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';
import type { WorldPhone } from '../src/contracts/world-build.ts';
import { PlayerRecordsSchema } from '../src/contracts/world-records.ts';
import {
  readCoherentRecords,
  RecordsReadError,
  recordsReadError,
} from '../src/features/phone/records-loader.ts';
import { projectMessageNotifications } from '../src/features/phone/notification-projection.ts';

// Calls production rules/presenters and real callbacks using synthetic inputs only.
// No repository replacement, database, browser layout, model or production writes.
// Previously failing audit cases are mandatory regressions after integration.
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
const { NotesRecords, NotesRecordDetail, recordDestination } =
  await import('../src/features/phone/apps/notes-records.tsx');
const unresolved = (_reason: string) => false;
const worldId = '10000000-0000-4000-8000-000000000001';
const actorA = '20000000-0000-4000-8000-000000000001';
const actorB = '20000000-0000-4000-8000-000000000002';
const before = '2026-10-11T01:00:00.000Z';
const after = '2026-10-11T02:00:00.000Z';
function matter(extra: Partial<WorldMatter> = {}): WorldMatter {
  return {
    ...createWorldMatter({
      id: 'deliver_portfolio',
      worldId,
      span: 'near_term',
      title: '送交作品集',
      description: '亲手把作品集交给现场负责人。',
      source: { kind: 'genesis', seedId: 'seed_fixture' },
      relatedActorIds: [actorA],
      relatedPlaceId: 'studio',
      relatedInvitationId: 'invitation_fixture',
      now: before,
    }),
    ...extra,
  };
}
function sceneEvidence(outcome: 'succeeded' | 'failed' | 'partial' = 'succeeded') {
  return {
    kind: 'scene_action' as const,
    sceneId: 'scene_studio',
    actionId: 'action_delivery',
    outcome,
    eventId: 'event_scene',
    eventVersion: 8,
    at: after,
  };
}
function records(matters: WorldMatter[] = []) {
  return PlayerRecordsSchema.parse(
    projectPlayerRecords({
      worldId,
      worldVersion: 8,
      matters,
      choices: [],
      messages: [],
      appointments: [
        {
          id: 'invitation_fixture',
          title: '交作品集',
          at: after,
          participantIds: [actorA],
          sourceEventId: 'genesis:' + worldId,
          status: 'confirmed',
        },
      ],
      actors: [
        { id: actorA, name: '同名负责人' },
        { id: actorB, name: '同名负责人' },
      ],
      events: [],
    }),
  );
}
function world(matters: WorldMatter[]): WorldState {
  return {
    schemaVersion: 1,
    id: worldId,
    ownerId: 'owner_fixture',
    version: 8,
    title: '独立测试人生',
    time: after,
    actors: [
      { id: actorA, name: '同名负责人', persona: '导演' },
      { id: actorB, name: '同名负责人', persona: '摄影师' },
    ],
    matters,
    facts: [],
    messages: [],
    appointments: [],
    mediaRequests: [],
  };
}
function walk(
  node: ReactNode,
  visit: (type: string, props: Record<string, unknown>) => void,
): void {
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, visit));
    return;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return;
  if (typeof node.type === 'function') {
    walk((node.type as (props: Record<string, unknown>) => ReactNode)(node.props), visit);
    return;
  }
  if (typeof node.type === 'string') visit(node.type, node.props);
  walk(node.props.children as ReactNode, visit);
}

test('completed objective matters move to history while blocked/current and pursuits remain distinct', () => {
  const completed = transitionWorldMatter(matter(), {
    status: 'completed',
    evidence: sceneEvidence(),
    now: after,
  });
  const data = records([
    completed,
    matter({ id: 'blocked', status: 'blocked' }),
    matter({ id: 'pursuit', span: 'pursuit', title: '长期摄影展' }),
  ]);
  assert.deepEqual(
    data.current.map((r) => r.source.kind === 'world_matter' && r.source.matterId),
    ['blocked'],
  );
  assert.deepEqual(
    data.about.map((r) => r.span),
    ['pursuit'],
  );
  assert.equal(data.history[0]?.state, 'completed');
  assert.equal(data.history[0]?.assertion, 'world_verified');
  assert.equal(data.worldVersion, 8);
});
test('a reported completion stays player testimony and never earns an objective reward', () => {
  const reported = transitionWorldMatter(matter(), {
    status: 'completed',
    evidence: {
      kind: 'user_report',
      quote: '我说已经交好了',
      outcome: 'reported_done',
      eventId: 'report',
      eventVersion: 8,
      at: after,
    },
    now: after,
  });
  assert.equal(records([reported]).history[0]?.state, 'reported_done');
  assert.equal(records([reported]).history[0]?.assertion, 'player_statement');
  assert.throws(() => claimMatterReward(reported, after), /MATTER_NOT_COMPLETED/);
});
test('hidden and foreign-world matters never appear in phone records', () => {
  const data = records([
    matter({ id: 'hidden', visibility: 'hidden', title: 'PRIVATE_HIDDEN' }),
    matter({ id: 'foreign', worldId: 'other_world', title: 'PRIVATE_FOREIGN' }),
    matter(),
  ]);
  assert.equal(data.current.length, 1);
  assert.equal(data.current[0]?.title, '送交作品集');
  assert.deepEqual([data.about, data.history], [[], []]);
});
test('old worlds without matters stay empty rather than receiving invented tasks', () => {
  const data = records();
  assert.deepEqual([data.current, data.about, data.history], [[], [], []]);
});
test('system record buttons only navigate: actual callbacks cannot mark a matter done', () => {
  const data = records([matter()]);
  const original = structuredClone(data);
  const opened: unknown[][] = [];
  const open = (...args: unknown[]) => opened.push(args);
  const detail = NotesRecordDetail({ data, target: data.current[0]!.id, open });
  let buttons = 0;
  walk(detail, (type, props) => {
    assert.ok(!['form', 'input', 'textarea'].includes(type));
    if (type === 'button') {
      buttons++;
      (props.onClick as () => void)();
    }
  });
  assert.ok(buttons > 0);
  assert.ok(opened.some(([app, target]) => app === 'map' && target === 'studio'));
  assert.ok(
    opened.every(([app]) => ['map', 'messages', 'calendar', 'notes'].includes(String(app))),
  );
  assert.deepEqual(data, original);
});
test('active and completed list callbacks navigate by stable sys ID with no matter mutation', () => {
  const data = records([
    matter(),
    transitionWorldMatter(matter({ id: 'done' }), {
      status: 'completed',
      evidence: sceneEvidence(),
      now: after,
    }),
  ]);
  const original = structuredClone(data),
    opened: unknown[][] = [];
  walk(
    NotesRecords({ data, historyOpen: true, open: (...args: unknown[]) => opened.push(args) }),
    (type, props) => {
      if (type === 'button' && typeof props.onClick === 'function') (props.onClick as () => void)();
    },
  );
  assert.ok(opened.some(([app, target]) => app === 'notes' && target === data.current[0]!.id));
  assert.ok(opened.some(([app, target]) => app === 'notes' && target === data.history[0]!.id));
  assert.deepEqual(data, original);
});
test('an uninvolved same-name actor receives no matter, private fact or foreign conversation', () => {
  const state = world([matter()]);
  state.facts = [
    {
      id: 'private',
      text: 'PRIVATE_FACT',
      visibility: { kind: 'owner' },
      sourceEventId: 'private_event',
    },
  ];
  state.messages = [
    {
      id: 'private_message',
      actorId: actorA,
      text: 'PRIVATE_CHAT',
      role: 'user',
      at: before,
      sourceEventId: 'chat_event',
    },
  ];
  const context = actorContext(state, actorB, '作品集');
  assert.deepEqual(context.matters, []);
  assert.deepEqual(context.facts, []);
  assert.deepEqual(context.messages, []);
});
test('blocking a matter or its creation source removes it from actual NPC context', () => {
  const m = matter({
    source: { kind: 'director_proposal', eventId: 'proposal', eventVersion: 2, at: before },
  });
  for (const blocked of [m.id, 'proposal'])
    assert.deepEqual(actorContext(world([m]), actorA, '', [], new Set([blocked])).matters, []);
});
test('late records from an obsolete world request are ignored before reading phone', async () => {
  let current = true,
    phoneReads = 0;
  let deliver!: (value: ReturnType<typeof records>) => void;
  const pending = new Promise<ReturnType<typeof records>>((resolve) => {
    deliver = resolve;
  });
  const result = readCoherentRecords(
    {
      readWorldRecords: () => pending,
      world: async () => {
        phoneReads++;
        throw Error('MUST_NOT_READ');
      },
    },
    worldId,
    7,
    () => current,
  );
  current = false;
  deliver(records([matter()]));
  assert.equal(await result, undefined);
  assert.equal(phoneReads, 0);
});
test('records reconciliation refuses a foreign phone and a regression below displayed version', async () => {
  for (const response of [
    { id: 'other_world', version: 8 },
    { id: worldId, version: 6 },
  ]) {
    await assert.rejects(
      readCoherentRecords(
        {
          readWorldRecords: async () => records([matter()]),
          world: async () => response as WorldPhone,
        },
        worldId,
        7,
        () => true,
      ),
      RecordsReadError,
    );
  }
});
test('unreconciled versions stop after two reads rather than spinning or mixing applications', async () => {
  let reads = 0;
  await assert.rejects(
    readCoherentRecords(
      {
        readWorldRecords: async () => {
          reads++;
          return records();
        },
        world: async () => ({ id: worldId, version: 9 }) as WorldPhone,
      },
      worldId,
      7,
      () => true,
    ),
    RecordsReadError,
  );
  assert.equal(reads, 2);
  assert.equal(
    recordsReadError(new Error('PRIVATE_DATABASE_PASSWORD')),
    '这部分暂时无法读取，私人便签仍可使用。请重试。',
  );
});
test('only persisted unread NPC messages notify, and same-name contacts retain their actor IDs', () => {
  const reply = {
    id: 'scene_reply',
    actorId: actorA,
    role: 'assistant' as const,
    text: '已保存的有来源反馈',
    at: after,
  };
  const notifications = projectMessageNotifications(
    [
      reply,
      reply,
      { ...reply, id: 'user', role: 'user' },
      { ...reply, id: 'seen' },
      { ...reply, id: 'opening_read', initialRead: true },
    ],
    [
      { id: actorA, name: '同名负责人' },
      { id: actorB, name: '同名负责人' },
    ],
    new Set(['seen']),
    () => '10:00',
  );
  assert.deepEqual(
    notifications.map((n) => [n.id, n.target]),
    [['scene_reply', actorA]],
  );
  assert.equal(notifications[0]?.app, 'messages');
});

test(
  'failed or partial scene evidence must not complete an already verified matter or earn a reward',
  {
    todo: unresolved(
      'd2f8eb8: matters.ts retains world_verified on failed/partial evidence; I must fix the final domain gate',
    ),
  },
  () => {
    const outcomes = (['failed', 'partial'] as const).map((outcome) => {
      const verified = matter({
        assertion: 'world_verified',
        evidence: {
          kind: 'director_progression',
          reason: '已核实开始准备作品集',
          eventId: 'started',
          eventVersion: 3,
          at: before,
        },
      });
      let completed: WorldMatter;
      try {
        completed = transitionWorldMatter(verified, {
          status: 'completed',
          evidence: sceneEvidence(outcome),
          now: after,
        });
      } catch (error) {
        assert.equal((error as { code: string }).code, 'INVALID_PROPOSAL');
        return { outcome, rejected: true };
      }
      // A reward-only fix is insufficient: objective completion itself must be rejected.
      const reward = claimMatterReward(completed, after);
      return {
        outcome,
        status: completed.status,
        assertion: completed.assertion,
        rewardClaimed: reward.rewardClaimed,
      };
    });
    assert.ok(
      outcomes.every((result) => 'rejected' in result),
      JSON.stringify(outcomes),
    );
  },
);
test(
  'a revoked result source must not leak the completed matter into NPC context',
  {
    todo: unresolved('d2f8eb8: actorContext filters creation source but ignores evidence.eventId'),
  },
  () => {
    const completed = transitionWorldMatter(matter(), {
      status: 'completed',
      evidence: sceneEvidence(),
      now: after,
    });
    assert.deepEqual(
      actorContext(world([completed]), actorA, '', [], new Set(['event_scene'])).matters,
      [],
    );
  },
);
test(
  'a world-verified obstacle must not be labelled as the player merely saying it',
  { todo: unresolved('d2f8eb8: all blocked PlayerRecord rows share the player-statement label') },
  () => {
    const blocked = transitionWorldMatter(matter(), {
      status: 'blocked',
      evidence: {
        kind: 'world_event',
        reason: '片场负责人临时离开',
        eventId: 'blocked',
        eventVersion: 8,
        at: after,
      },
      now: after,
    });
    const row = records([blocked]).current[0]!;
    assert.equal(row.assertion, 'world_verified');
    assert.ok(!row.stateLabel.startsWith('你说'), row.stateLabel);
  },
);
test(
  'a place-linked matter must also expose its authorized contact and appointment feedback routes',
  { todo: unresolved('d2f8eb8: place navigation wins and all other matter links are discarded') },
  () => {
    const row = records([matter()]).current[0]!;
    assert.deepEqual(recordDestination(row), { app: 'map', target: 'studio' });
    const opened: unknown[][] = [];
    walk(
      NotesRecordDetail({
        data: records([matter()]),
        target: row.id,
        open: (...args: unknown[]) => opened.push(args),
      }),
      (type, props) => {
        if (type === 'button') (props.onClick as () => void)();
      },
    );
    assert.ok(
      opened.some(([app, target]) => app === 'messages' && target === actorA),
      'Missing authorized NPC contact shortcut',
    );
    assert.ok(
      opened.some(([app, target]) => app === 'calendar' && target === 'invitation_fixture'),
      'Missing authorized appointment shortcut',
    );
  },
);
test(
  'dangling relatedActorIds must not produce a dead source conversation route',
  {
    todo: unresolved(
      'd2f8eb8: matter projection selects relatedActorIds[0] without validating its membership',
    ),
  },
  () => {
    const row = records([
      matter({
        relatedPlaceId: undefined,
        relatedActorIds: ['20000000-0000-4000-8000-000000000099', actorA],
      }),
    ]).current[0]!;
    assert.deepEqual(recordDestination(row), { app: 'messages', target: actorA });
  },
);
