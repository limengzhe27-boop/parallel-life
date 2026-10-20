import { npcChangeObject } from './helpers/npc-response-schema.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import type { AgentValidationContext } from '../src/modules/world/domain/agent-kernel.ts';
import { parseAgentProposal } from '../src/modules/world/infrastructure/agent-proposal-parser.ts';
import {
  decodeNpcWire,
  npcResponseFormat,
} from '../src/modules/world/infrastructure/npc-model-protocol.ts';
function fixture(review = true) {
  const state = emptyActorAgentState({ worldId: 'world', actorId: 'actor' }, 'def', 3);
  const c: AgentValidationContext = {
    state,
    viewState: structuredClone(state),
    worldVersion: 3,
    storyAt: '2026-10-19T10:00:00.000Z',
    input: {
      sourceId: 'input',
      origin: review ? 'wake' : 'player',
      text: review
        ? JSON.stringify({
            type: 'npc_agenda_review',
            grantId: 'grant',
            anchorAttemptId: 'prior',
            policyVersion: 'own-agenda-v1',
            family: 'own_agenda',
            basisSourceIds: ['definition:def'],
          })
        : 'How is the plan?',
    },
    sources: ['input', 'definition:def', 'episode-intent:own'].map((id) => ({
      id,
      kind: 'accepted_input',
      recordId: id,
      worldVersion: 3,
      at: '2026-10-19T10:00:00.000Z',
    })),
    channel: { kind: 'private', threadId: 'actor', allowedCapabilities: [] },
  };
  const wire = {
    protocol: 'npc-wire-v9',
    focusChange: { kind: 'keep' } as any,
    statements: [] as { text: string; dependsOnActionIds: string[] }[],
    executions: [],
    consideration: null,
    goals: [] as unknown[],
    planIntents: [] as unknown[],
    responsibilities: [] as unknown[],
    inputInterpretation: review
      ? null
      : { kind: 'uncertain', sourceId: 'source:1', quote: c.input.text },
    agendaReview: review
      ? {
          decision: 'quiet',
          reason: 'Own private evaluation, not a message.',
          basisSourceIds: ['source:2'],
        }
      : null,
  };
  return { c, wire };
}
function focused() {
  const f = fixture();
  f.c.state.focus = {
    channel: 'private',
    threadId: 'actor',
    subjectId: null,
    questionSourceId: 'definition:def',
    replyToActorId: null,
  };
  f.c.viewState = structuredClone(f.c.state);
  return f;
}
test('v9 quiet keep omits focus delta while retaining canonical existing focus and no forced contact', () => {
  const { c, wire } = focused(),
    before = structuredClone(c);
  const p = parseAgentProposal(c, wire);
  assert.equal(Object.hasOwn(p, 'focus'), false);
  assert.equal(p.statements.length, 0);
  assert.deepEqual(c, before);
});
test('v9 clear is explicit and does not reinterpret old v8 null as keep', () => {
  const { c, wire } = focused();
  assert.throws(
    () => parseAgentProposal(c, { ...wire, focusChange: { kind: 'clear' } }),
    /RESPONSE_WIRE_SHAPE/,
  );
  const { focusChange: _focusChange, ...old } = wire;
  assert.throws(
    () => parseAgentProposal(c, { ...old, protocol: 'npc-wire-v8', focus: null }),
    /RESPONSE_WIRE_SHAPE/,
  );
  c.input = { ...c.input, text: 'A non-review system trigger' };
  const p = parseAgentProposal(c, { ...wire, agendaReview: null, focusChange: { kind: 'clear' } });
  assert.equal(p.focus, null);
});
test('v9 set resolves nested short question source and keeps original focus authorization', () => {
  const { c, wire } = focused();
  c.input = { ...c.input, text: 'A non-review system trigger' };
  const value = {
    channel: 'private',
    threadId: 'actor',
    subjectId: null,
    questionSourceId: 'source:2',
    replyToActorId: null,
  };
  const p = parseAgentProposal(c, {
    ...wire,
    agendaReview: null,
    focusChange: { kind: 'set', value },
  });
  assert.equal(p.focus!.questionSourceId, 'definition:def');
  assert.throws(
    () =>
      parseAgentProposal(c, {
        ...wire,
        agendaReview: null,
        focusChange: { kind: 'set', value: { ...value, questionSourceId: 'source:99' } },
      }),
    /RESPONSE_WIRE_SHAPE/,
  );
  assert.throws(() =>
    parseAgentProposal(c, {
      ...wire,
      agendaReview: null,
      focusChange: { kind: 'set', value: { ...value, threadId: 'another' } },
    }),
  );
});
test('v9 rejects missing or contradictory focus syntax rather than inferring user intention', () => {
  const { c, wire } = focused();
  const { focusChange: _focusChange, ...missing } = wire;
  for (const raw of [
    missing,
    { ...wire, focus: null },
    { ...wire, focusChange: null },
    { ...wire, focusChange: { kind: 'keep', value: null } },
    { ...wire, focusChange: { kind: 'set', value: null } },
  ])
    assert.throws(() => parseAgentProposal(c, raw), /RESPONSE_WIRE_SHAPE/);
});
test('v9 schema has required discriminated focusChange and exact source-ref value grammar', () => {
  const { c } = focused();
  const f = npcResponseFormat(c.state, 'forbidden', c);
  if (f.format !== 'json_schema') throw Error('schema');
  const s: any = f.schema;
  assert.equal(s.properties.focus, undefined);
  const changes = npcChangeObject(s);
  assert(changes.required.includes('focusChange'));
  assert.equal(changes.properties.focus, undefined);
  assert.deepEqual(s.properties.protocol.enum, ['npc-wire-v15']);
  const set = changes.properties.focusChange.anyOf.find(
    (x: any) => x.properties.kind.enum[0] === 'set',
  );
  assert.equal(
    set.properties.value.properties.questionSourceId.anyOf[0].$ref,
    '#/$defs/npc_source_ref',
  );
});
