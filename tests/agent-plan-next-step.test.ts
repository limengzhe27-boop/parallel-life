import test from 'node:test';
import assert from 'node:assert/strict';
import { agentPlanNextStep } from '../src/modules/world/domain/agent-plan-next-step.ts';
import type { AgentPlan, AgentAction } from '../src/modules/world/domain/agent-runtime.ts';
test('plan next step reports honest missing/waiting/unsupported intent without creating actions', () => {
  const p: AgentPlan = {
    id: 'p',
    goalId: 'g',
    summary: 'Own intention',
    status: 'active',
    sourceIds: ['s'],
    actionIds: [],
    nextActionId: null,
    triggers: [],
    missingConditions: [],
  };
  const original = structuredClone(p);
  assert.equal(agentPlanNextStep(p, [], []), 'missing_next_step');
  assert.deepEqual(p, original);
  assert.equal(
    agentPlanNextStep(
      { ...p, missingConditions: ['No registered ability to check physical stock'] },
      [],
      [],
    ),
    'waiting',
  );
  assert.equal(
    agentPlanNextStep({ ...p, triggers: [{ kind: 'observation', sourceId: 's' }] }, [], []),
    'reconsider',
  );
  const action: AgentAction = {
    id: 'a',
    goalId: 'g',
    capability: 'plan.record',
    targetIds: [],
    parameters: {},
    preconditions: [],
    dependsOnActionIds: [],
    handlesResponsibilityIds: [],
    sourceIds: ['s'],
    status: 'waiting',
  };
  const next = { ...p, nextActionId: 'a', actionIds: ['a'] };
  assert.equal(agentPlanNextStep(next, [action], []), 'unsupported');
  assert.equal(agentPlanNextStep(next, [action], ['plan.record']), 'action');
  assert.equal(agentPlanNextStep(next, [], []), 'missing_next_step');
  assert.equal(agentPlanNextStep({ ...p, status: 'finished' }, [], []), 'closed');
});
