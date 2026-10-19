import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentValidationError } from '../src/modules/world/domain/agent-kernel.ts';
import {
  classifyAgentRejection,
  type AgentRejectionAuditEvidence,
} from '../src/modules/world/application/agent-rejection-classification.ts';

const audited: AgentRejectionAuditEvidence = {
  caseId: 'v6_missing_current_input_anchor',
  protocol: 'npc-wire-v6',
  evidenceDigest: 'a'.repeat(64),
  semanticSourcesAuthorized: true,
  onlyMechanicalInputAnchorMissing: true,
};

test('actual domain error structured reasons distinguish shape, business, source and resource rejection', () => {
  for (const [reason, category] of [
    ['RESPONSE_JSON', 'mechanical_format'],
    ['UNKNOWN_GOAL', 'business_precondition'],
    ['UNCONFIRMED_RESPONSIBILITY_RESULT', 'business_precondition'],
    ['UNKNOWN_SOURCE', 'permission_source'],
    ['DECISION_NOT_PLAYER_INPUT', 'permission_source'],
    ['FUTURE_STATE', 'version_resource'],
  ]) {
    const r = classifyAgentRejection(new AgentValidationError(reason!));
    assert.equal(r.code, 'INVALID_AGENT_PROPOSAL');
    assert.equal(r.reason, reason);
    assert.equal(r.category, category);
    assert.equal(r.basis, 'known_code');
  }
});
test('schema detail is reduced to a fixed reason without copying private issue text', () => {
  const e = new AgentValidationError('RESPONSE_SHAPE:statements.0.text=PRIVATE_SECRET_INPUT');
  const r = classifyAgentRejection(e);
  assert.equal(r.reason, 'RESPONSE_SHAPE');
  assert.equal(r.category, 'mechanical_format');
  assert.ok(!JSON.stringify(r).includes('PRIVATE_SECRET_INPUT'));
});
test('coarse wire and director errors do not pretend to identify a missing shape or a legitimate intent', () => {
  for (const e of [
    new AgentValidationError('RESPONSE_WIRE_SHAPE'),
    { code: 'INVALID_DIRECTOR_PROPOSAL' },
    { code: 'INVALID_DIRECTOR_RESULT' },
    { code: 'ATTEMPT_INVALID' },
  ]) {
    const r = classifyAgentRejection(e);
    assert.equal(r.category, 'unclassified');
    assert.equal(r.basis, 'unclassified');
  }
  assert.equal(
    classifyAgentRejection(new Error('NPC_PLAN_INTENT_SOURCE')).category,
    'unclassified',
  );
});
test('explicit compiler, context, adapter and upstream codes classify without reading exception text', () => {
  for (const [code, category] of [
    ['NPC_EXECUTION_INTENT_SHAPE', 'mechanical_format'],
    ['DIRECTOR_RESPONSE_SCHEMA_LIMIT', 'protocol_adapter'],
    ['NPC_AGENT_INVALID_SNAPSHOT', 'context_missing'],
    ['DIRECTOR_CONTEXT_LIMIT', 'context_missing'],
    ['INPUT_SCOPE_FORBIDDEN', 'permission_source'],
    ['VERSION_CONFLICT', 'version_resource'],
    ['UPSTREAM_FAILED', 'upstream_or_unknown'],
    ['ATTEMPT_UNKNOWN', 'upstream_or_unknown'],
  ])
    assert.equal(classifyAgentRejection({ code, message: 'PRIVATE_TOKEN' }).category, category);
});
test('budget waits, focus deferrals and request-local preflight are resource outcomes, not invalid AI output', () => {
  for (const code of [
    'OWN_AGENDA_BUDGET_WAIT',
    'NPC_DELIVERY_DEFERRED',
    'EPISODE_DELIVERY_DEFERRED',
    'ATTEMPT_PENDING',
  ])
    assert.equal(classifyAgentRejection({ code }).category, 'version_resource');
  const r = classifyAgentRejection({
    code: 'INVALID_CONFIG',
    stage: 'request',
    responseOutcome: 'not_sent',
    batchYield: true,
  });
  assert.equal(r.category, 'version_resource');
  assert.equal(
    classifyAgentRejection({
      code: 'INVALID_CONFIG',
      stage: 'request',
      responseOutcome: 'not_sent',
    }).category,
    'upstream_or_unknown',
  );
  assert.deepEqual(
    Object.keys(r).sort(),
    ['category', 'code', 'reason', 'basis', 'auditCase'].sort(),
  );
});
test('verified audit of the original v6 mechanical-anchor case can distinguish legitimate-intent rejection', () => {
  for (const e of [
    { code: 'INVALID_PROPOSAL', reason: 'NPC_PLAN_INTENT_SOURCE' },
    new AgentValidationError('RESPONSE_WIRE_SHAPE'),
  ]) {
    const r = classifyAgentRejection(e, audited);
    assert.equal(r.category, 'legitimate_intent_blocked');
    assert.equal(r.basis, 'audited_case');
    assert.equal(r.auditCase, 'v6_missing_current_input_anchor');
    assert.ok(!JSON.stringify(r).includes(audited.evidenceDigest));
  }
});
test('a source denial alone is never evidence of a legitimate intent', () => {
  const e = { code: 'INVALID_PROPOSAL', reason: 'NPC_PLAN_INTENT_SOURCE' };
  assert.equal(classifyAgentRejection(e).category, 'permission_source');
  for (const patch of [
    { protocol: 'npc-wire-v8' },
    { caseId: 'made-up' },
    { evidenceDigest: '' },
    { evidenceDigest: 'A'.repeat(64) },
    { semanticSourcesAuthorized: false },
    { onlyMechanicalInputAnchorMissing: false },
  ])
    assert.equal(
      classifyAgentRejection(e, { ...audited, ...patch } as AgentRejectionAuditEvidence).category,
      'permission_source',
    );
});
test('an audited case cannot relabel an actual dangling reference, unauthorized source or unknown request', () => {
  for (const [e, category] of [
    [new AgentValidationError('UNKNOWN_GOAL'), 'business_precondition'],
    [new AgentValidationError('UNKNOWN_SOURCE'), 'permission_source'],
    [{ code: 'INPUT_SCOPE_FORBIDDEN' }, 'permission_source'],
    [{ code: 'ATTEMPT_UNKNOWN' }, 'upstream_or_unknown'],
    [{ code: 'INVALID_DIRECTOR_PROPOSAL' }, 'unclassified'],
  ] as const)
    assert.equal(classifyAgentRejection(e, audited).category, category);
});
test('unknown symbols and arbitrary SQL errors remain unclassified without echoing code or reason', () => {
  for (const e of [
    { code: 'PRIVATE_SECRET_CODE', reason: 'PRIVATE_SECRET_REASON' },
    { code: '23505', detail: 'PRIVATE_SQL_VALUES' },
    { code: 'VERSION_CONFLICT PRIVATE_SECRET' },
    { code: 'version_conflict' },
    { code: '__proto__', reason: 'UNKNOWN_SOURCE' },
  ])
    assert.deepEqual(classifyAgentRejection(e), {
      category: 'unclassified',
      code: null,
      reason: null,
      basis: 'unclassified',
      auditCase: null,
    });
  const known = classifyAgentRejection({
    code: 'INVALID_AGENT_PROPOSAL',
    reason: 'PRIVATE_SECRET_REASON',
  });
  assert.equal(known.code, 'INVALID_AGENT_PROPOSAL');
  assert.equal(known.reason, null);
  assert.equal(known.category, 'unclassified');
});
test('getters, arbitrary coercion, causes, upstream details and inherited properties are never inspected', () => {
  let invoked = 0;
  const throwGetter = () => {
    invoked++;
    throw Error('PRIVATE_DATA');
  };
  const withPrivate = { code: 'VERSION_CONFLICT' };
  for (const name of [
    'message',
    'stack',
    'cause',
    'raw',
    'snapshot',
    'context',
    'privateInterview',
  ])
    Object.defineProperty(withPrivate, name, { get: throwGetter });
  assert.equal(classifyAgentRejection(withPrivate).category, 'version_resource');
  assert.equal(
    classifyAgentRejection(Object.defineProperty({}, 'code', { get: throwGetter })).category,
    'unclassified',
  );
  const reasonGetter = Object.defineProperty({ code: 'INVALID_AGENT_PROPOSAL' }, 'reason', {
    get: throwGetter,
  });
  assert.equal(classifyAgentRejection(reasonGetter).category, 'unclassified');
  const auditGetter = Object.defineProperty({ ...audited }, 'evidenceDigest', { get: throwGetter });
  assert.equal(
    classifyAgentRejection(
      { code: 'INVALID_PROPOSAL', reason: 'NPC_PLAN_INTENT_SOURCE' },
      auditGetter,
    ).category,
    'permission_source',
  );
  const badCode = { toString: throwGetter };
  assert.equal(classifyAgentRejection({ code: badCode }).category, 'unclassified');
  assert.equal(
    classifyAgentRejection(Object.create({ code: 'VERSION_CONFLICT' })).category,
    'unclassified',
  );
  assert.equal(
    classifyAgentRejection({ cause: { code: 'VERSION_CONFLICT' } }).category,
    'unclassified',
  );
  assert.equal(invoked, 0);
});
test('frozen errors and audited evidence remain immutable and replay-stable', () => {
  const e = Object.freeze(new AgentValidationError('RESPONSE_WIRE_SHAPE'));
  const proof = Object.freeze({ ...audited });
  const first = classifyAgentRejection(e, proof),
    second = classifyAgentRejection(e, proof);
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.equal(e.reason, 'RESPONSE_WIRE_SHAPE');
  assert.equal(proof.evidenceDigest, audited.evidenceDigest);
});
test('primitives, revoked proxies and mismatched wrapper/reason pairs fail safely', () => {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  for (const e of [null, undefined, false, 0, 'UNKNOWN_SOURCE', Symbol('private'), proxy])
    assert.equal(classifyAgentRejection(e).category, 'unclassified');
  assert.equal(
    classifyAgentRejection({ code: 'UPSTREAM_FAILED', reason: 'UNKNOWN_GOAL' }).reason,
    null,
  );
  assert.equal(
    classifyAgentRejection({ code: 'PRIVATE_CODE', reason: 'UNKNOWN_SOURCE' }).reason,
    null,
  );
});
