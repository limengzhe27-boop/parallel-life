import test from 'node:test';
import assert from 'node:assert/strict';
import { actorSelfAgendaContext } from '../src/modules/world/domain/actor-self-agenda-context.ts';

const base = () => ({
  input: { origin: 'wake', text: '{"type":"npc_agenda_review"}' },
  definitionRef: 'definition-hash',
  sources: [{ id: 'definition:definition-hash' }],
  state: { goals: [], plans: [], responsibilities: [] },
  persona: JSON.stringify({
    modules: {
      lifeContext: '合伙人，负责采购',
      drives: '想把有限预算用好',
      secrets: 'DO_NOT_COPY',
    },
    hiddenContext: 'DO_NOT_COPY',
    publicPremise: {
      identity: { sourceId: 'definition:definition-hash' },
      publicSetting: '共同筹备一家小店',
      secret: 'DO_NOT_COPY',
    },
  }),
});

test('self agenda projects authorized motivation as planning basis without seeding goals or copying secrets', () => {
  const input = base();
  const original = structuredClone(input);
  const c = actorSelfAgendaContext(input)!;
  assert.equal(c.authority, 'self_planning_only');
  assert.equal(c.ownMotivations, '想把有限预算用好');
  assert.equal(c.publicBackground, '共同筹备一家小店');
  assert.equal(c.existingAgenda.unfinishedGoals, 0);
  assert.equal(JSON.stringify(c).includes('DO_NOT_COPY'), false);
  assert.deepEqual(input, original);
  input.input.text = '{"type":"npc_agenda_initialize"}';
  assert.equal(actorSelfAgendaContext(input)?.trigger, 'initialize');
});

test('player JSON and unrelated wakes cannot gain self-agenda context; exact definition source is required', () => {
  const input = base();
  input.input.origin = 'player';
  assert.equal(actorSelfAgendaContext(input), undefined);
  input.input.origin = 'wake';
  input.input.text = '{"type":"other"}';
  assert.equal(actorSelfAgendaContext(input), undefined);
  input.input.text = '{"type":"npc_agenda_review"}';
  input.sources = [];
  assert.equal(actorSelfAgendaContext(input), undefined);
});

test('legacy fields remain planning material and long text stays bounded', () => {
  const input = base();
  input.persona = JSON.stringify({
    persona: JSON.stringify({
      background: '采购人',
      motivation: '目标。'.repeat(4000),
      secret: 'DO_NOT_COPY',
    }),
  });
  const c = actorSelfAgendaContext(input)!;
  assert.equal(c.ownRoleAndLifeContext, '采购人');
  assert.ok(c.ownMotivations!.length <= 600);
  assert.equal(JSON.stringify(c).includes('DO_NOT_COPY'), false);
});
