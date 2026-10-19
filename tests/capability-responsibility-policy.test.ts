import test from 'node:test';
import assert from 'node:assert/strict';
import { canHandleExternalResponsibility } from '../src/modules/world/domain/capability-responsibility-policy.ts';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import type { AgentValidationContext } from '../src/modules/world/domain/agent-kernel.ts';
import { npcResponseFormat } from '../src/modules/world/infrastructure/npc-model-protocol.ts';
import { parseAgentProposal } from '../src/modules/world/infrastructure/agent-proposal-parser.ts';

const originalHandling = [
  'appointment.fulfill',
  'appointment.cancel',
  'appointment.accept',
  'appointment.reschedule',
  'item.deliver',
  'item.use',
  'activity.participate',
  'relationship.bond',
  'moment.publish',
  'moment.interact',
];
const nonHandling = [
  'appointment.propose',
  'media.generate_image',
  'media.generate_video',
  'media.share',
  'plan.record',
  'travel.start',
  'unregistered.capability',
];
function context(): AgentValidationContext {
  const at = '2026-10-19T09:00:00.000Z';
  const state = emptyActorAgentState({ worldId: 'world', actorId: 'actor' }, 'definition', 0);
  state.responsibilities = [
    {
      id: 'waiting-request',
      subject: { kind: 'request', id: 'request' },
      summary: '等待回复',
      status: 'waiting',
      waitingOn: 'player',
      sourceIds: ['input'],
      nextCheck: [],
    },
  ];
  return {
    state,
    viewState: structuredClone(state),
    worldVersion: 0,
    storyAt: at,
    sources: [{ id: 'input', kind: 'accepted_input', recordId: 'input', worldVersion: 0, at }],
    input: { sourceId: 'input', origin: 'player', text: '请先发出见面邀请，我再决定。' },
    channel: { kind: 'private', threadId: 'actor', allowedCapabilities: ['appointment.propose'] },
  };
}

test('shared handling policy preserves exactly the original kernel capability boundary', () => {
  for (const capability of originalHandling)
    assert.equal(canHandleExternalResponsibility(capability), true, capability);
  for (const capability of nonHandling)
    assert.equal(canHandleExternalResponsibility(capability), false, capability);
  assert.equal(canHandleExternalResponsibility('appointment.fulfill.extra'), false);
  assert.equal(canHandleExternalResponsibility('APPOINTMENT.FULFILL'), false);
});

test('native schema and kernel contract agree for all offered supported handling and nonhandling capabilities', () => {
  const c = context();
  c.state.responsibilities.push({
    id: 'appointment:existing',
    subject: { kind: 'appointment', id: 'existing' },
    summary: 'Existing actor-owned appointment',
    status: 'waiting',
    waitingOn: 'player',
    sourceIds: ['input'],
    nextCheck: [],
  });
  c.viewState = structuredClone(c.state);
  c.channel.allowedCapabilities = [
    ...originalHandling,
    ...nonHandling.filter(
      (cap) => !['media.share', 'plan.record', 'unregistered.capability'].includes(cap),
    ),
  ];
  const format = npcResponseFormat(c.state, 'forbidden', c);
  if (format.format !== 'json_schema') throw Error('schema');
  const found = new Map<string, number | undefined>();
  const visit = (v: unknown) => {
    if (Array.isArray(v)) {
      v.forEach(visit);
      return;
    }
    if (!v || typeof v !== 'object') return;
    const n = v as any;
    if (n.properties?.capability?.enum && n.properties?.handlesResponsibilityIds)
      for (const capability of n.properties.capability.enum)
        found.set(capability, n.properties.handlesResponsibilityIds.maxItems);
    Object.values(n).forEach(visit);
  };
  visit(format.schema);
  for (const capability of c.channel.allowedCapabilities) {
    assert(found.has(capability), capability);
    if (canHandleExternalResponsibility(capability))
      assert.notEqual(found.get(capability), 0, capability);
    else assert.equal(found.get(capability), 0, capability);
  }
});

test('invitation-only native schema forbids handling old responsibility without removing it from context', () => {
  const c = context();
  const format = npcResponseFormat(c.state, 'forbidden', c);
  if (format.format !== 'json_schema') throw Error('schema');
  const schema = format.schema as any;
  const action = schema.properties.executions.anyOf.find((n: any) => n.type === 'array').items
    .properties.action;
  assert.deepEqual(action.properties.capability.enum, ['appointment.propose']);
  assert.equal(action.properties.handlesResponsibilityIds.maxItems, 0);
  assert.equal(c.viewState!.responsibilities.length, 1);
});

test('existing paid native responses retain nonempty handles for the unchanged kernel to reject, never silently cleared', () => {
  const c = context();
  const raw = {
    protocol: 'npc-wire-v11',
    focusChange: { kind: 'keep' },
    statements: [{ text: '我先提出邀请，再等你决定。', dependsOnActionIds: [] }],
    consideration: null,
    goals: [],
    planIntents: [],
    responsibilities: [],
    agendaReview: null,
    inputInterpretation: { kind: 'uncertain', sourceId: 'source:1', quote: c.input.text },
    executions: [
      {
        ref: 'action_1',
        goal: { kind: 'new', summary: '商量见面', sourceIds: ['source:1'] },
        plan: {
          summary: '发出邀请，等待真实答复',
          sourceIds: ['source:1'],
          supersedesPlanId: null,
        },
        action: {
          capability: 'appointment.propose',
          targetIds: [],
          parameters: [
            { name: 'title', value: '见面安排' },
            { name: 'at', value: '2026-10-19T10:00:00.000Z' },
          ],
          preconditions: [],
          dependsOnActionIds: [],
          handlesResponsibilityIds: ['waiting-request'],
          sourceIds: ['source:1'],
        },
      },
    ],
  };
  const before = structuredClone(raw);
  for (const protocol of ['npc-wire-v11', 'npc-wire-v10', 'npc-wire-v9']) {
    const p = parseAgentProposal(c, { ...raw, protocol });
    assert.deepEqual(p.actions[0]!.handlesResponsibilityIds, ['waiting-request']);
    assert.equal(canHandleExternalResponsibility(p.actions[0]!.capability), false);
    assert.equal(c.state.responsibilities[0]!.status, 'waiting');
  }
  assert.deepEqual(raw, before);
});

test('reschedule is still a handling capability but is offered only when an existing appointment identity is available', () => {
  const c = context();
  c.channel.allowedCapabilities = ['appointment.reschedule'];
  assert.equal(canHandleExternalResponsibility('appointment.reschedule'), true);
  const absent = npcResponseFormat(c.state, 'forbidden', c);
  if (absent.format !== 'json_schema') throw Error('schema');
  assert.deepEqual(
    (absent.schema as any).properties.executions,
    { type: 'null' },
    'generic request does not invent an appointment identity',
  );
  c.sources.push({
    id: 'appointment:available',
    recordId: 'event',
    kind: 'world_event',
    worldVersion: 0,
    at: c.storyAt,
  });
  const present = npcResponseFormat(c.state, 'forbidden', c);
  if (present.format !== 'json_schema') throw Error('schema');
  const nodes = (value: any): any[] =>
    value && typeof value === 'object' ? [value, ...Object.values(value).flatMap(nodes)] : [];
  const action = nodes(present.schema).find((n) =>
    n.properties?.capability?.enum?.includes('appointment.reschedule'),
  );
  assert(action, 'authenticated actor-visible source makes rescheduling offerable');
  assert.notEqual(action.properties.handlesResponsibilityIds.maxItems, 0);
  assert.deepEqual(action.properties.parameters.properties.appointmentId.enum, ['available']);
  assert.equal(
    c.state.responsibilities[0]!.subject.kind,
    'request',
    'offering a capability does not consume or rewrite existing responsibility',
  );
});
