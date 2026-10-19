import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import type { AgentValidationContext } from '../src/modules/world/domain/agent-kernel.ts';
import { parseAgentProposal } from '../src/modules/world/infrastructure/agent-proposal-parser.ts';
import { npcResponseFormat } from '../src/modules/world/infrastructure/npc-model-protocol.ts';
import {
  mapNpcSourceFields,
  npcSourceReferences,
  npcPersonaSourceReferences,
} from '../src/modules/world/infrastructure/npc-source-reference.ts';
const definition = `definition:${'e'.repeat(64)}`;
function fixture() {
  const state = emptyActorAgentState({ worldId: 'w', actorId: 'a' }, 'd', 1);
  const c: AgentValidationContext = {
    state,
    viewState: structuredClone(state),
    worldVersion: 1,
    storyAt: '2026-10-19T10:00:00.000Z',
    input: { sourceId: 'input-uuid', origin: 'player', text: 'Hello source:1 ' + definition },
    sources: ['input-uuid', definition].map((id) => ({
      id,
      recordId: id,
      kind: 'accepted_input',
      worldVersion: 1,
      at: '2026-10-19T10:00:00.000Z',
    })),
    channel: { kind: 'private', threadId: 'a', allowedCapabilities: [] },
  };
  const wire = {
    protocol: 'npc-wire-v8',
    statements: [
      { text: 'I will consider a meeting, without assuming you agree.', dependsOnActionIds: [] },
    ],
    executions: [],
    consideration: null,
    goals: [],
    planIntents: [] as any[],
    responsibilities: [],
    agendaReview: null,
    inputInterpretation: { kind: 'uncertain', sourceId: 'source:1', quote: c.input.text },
  };
  return { c, wire };
}
test('source aliases bind exact immutable order and only structural fields, never prose or quoted words', () => {
  const { c } = fixture(),
    cat = npcSourceReferences(c.sources);
  const raw = {
    sourceId: 'source:1',
    questionSourceId: 'source:2',
    sourceIds: ['source:2', 'source:2'],
    basisSourceIds: ['source:1'],
    nested: { definitionSourceId: 'source:2' },
    quote: 'source:2',
    parameters: { value: 'source:2' },
  };
  const decoded = mapNpcSourceFields(raw, cat, 'decode') as any;
  assert.equal(decoded.sourceId, 'input-uuid');
  assert.equal(decoded.questionSourceId, definition);
  assert.deepEqual(decoded.sourceIds, [definition, definition]);
  assert.equal(decoded.quote, 'source:2');
  assert.equal(decoded.parameters.value, 'source:2');
  assert.deepEqual(mapNpcSourceFields(decoded, cat, 'encode'), raw);
  assert.throws(
    () => npcSourceReferences([...c.sources, c.sources[0]!]),
    /NPC_SOURCE_REFERENCE_INVALID/,
  );
  for (const bad of ['source:3', definition, definition.replace('e', 'a')])
    assert.throws(
      () => mapNpcSourceFields({ sourceId: bad }, cat, 'decode'),
      /NPC_SOURCE_REFERENCE_INVALID/,
    );
});
test('v8 decodes to fixed v7 and binds plan input source without granting missing or corrupt source rights', () => {
  const { c, wire } = fixture();
  wire.planIntents = [
    {
      kind: 'create',
      ref: 'future',
      goal: { kind: 'new', summary: 'Consider a future meeting', sourceIds: ['source:2'] },
      summary: 'Wait for relevant reply',
      sourceIds: ['source:2'],
      nextStep: { kind: 'wait', conditions: [], missing: ['Need reply'] },
    },
  ];
  const p = parseAgentProposal(c, wire);
  assert.deepEqual(p.goals[0]!.sourceIds, [definition, 'input-uuid']);
  assert.deepEqual(p.plans[0]!.sourceIds, [definition, 'input-uuid']);
  assert.equal(p.decisions.length, 0);
  assert.equal(parseAgentProposal(c, { ...wire, planIntents: [] }).goals.length, 0);
  for (const invalid of ['source:999', definition, definition.replace('e', 'a')]) {
    const bad = structuredClone(wire);
    bad.planIntents[0].sourceIds = [invalid];
    assert.throws(() => parseAgentProposal(c, bad), /RESPONSE_WIRE_SHAPE/);
  }
  const old = mapNpcSourceFields(wire, npcSourceReferences(c.sources), 'decode') as any;
  old.protocol = 'npc-wire-v7';
  assert.deepEqual(parseAgentProposal(c, old).plans, p.plans);
  assert.throws(
    () => parseAgentProposal(c, { ...wire, protocol: 'npc-wire-v7' }),
    /RESPONSE_WIRE_SHAPE/,
  );
});
test('v8 provider source grammar is short and current-input scoped; no full immutable source IDs are emitted', () => {
  const { c } = fixture();
  c.input.text = 'Hello';
  const format = npcResponseFormat(c.state, 'forbidden', c);
  assert.equal(format.format, 'json_schema');
  if (format.format !== 'json_schema') return;
  const body = JSON.stringify(format.schema);
  assert(!body.includes(definition));
  assert(!body.includes('input-uuid'));
  assert(body.includes('source:1'));
  assert(body.includes('npc_source_ref'));
});
test('input projection never authorizes unknown world-context pointers and parses only authored persona envelope', () => {
  const { c } = fixture(),
    cat = npcSourceReferences(c.sources);
  const encoded = mapNpcSourceFields(
    {
      definitionSourceId: 'not-visible',
      sourceIds: [definition, 'not-visible'],
      quote: definition,
    },
    cat,
    'encode',
  ) as any;
  assert.equal(encoded.definitionSourceId, null);
  assert.equal(encoded.definitionSourceIdUnavailable, true);
  assert.deepEqual(encoded.sourceIds, ['source:2']);
  assert.equal(encoded.sourceIdsUnavailableCount, 1);
  assert.equal(encoded.quote, definition);
  const persona = JSON.parse(
    npcPersonaSourceReferences(
      JSON.stringify({ publicPremise: { identity: { sourceId: definition } }, text: definition }),
      cat,
    ),
  );
  assert.equal(persona.publicPremise.identity.sourceId, 'source:2');
  assert.equal(persona.text, definition);
});

test('v8 goals null is an explicit empty delta even with an existing visible goal; v7 remains fixed', () => {
  const { c, wire } = fixture();
  c.state.goals.push({
    id: 'known-goal',
    summary: 'Keep this goal',
    status: 'active',
    sourceIds: ['input-uuid'],
    resultIds: [],
  });
  c.viewState = structuredClone(c.state);
  const next = { ...wire, goals: null };
  assert.equal(parseAgentProposal(c, next).goals.length, 0);
  assert.equal(c.state.goals[0]!.status, 'active');
  const old = mapNpcSourceFields(next, npcSourceReferences(c.sources), 'decode') as any;
  old.protocol = 'npc-wire-v7';
  assert.throws(() => parseAgentProposal(c, old), /RESPONSE_WIRE_SHAPE/);
});
