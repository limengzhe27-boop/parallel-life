import test from 'node:test';
import assert from 'node:assert/strict';
import { runDirectorAgent } from '../src/modules/world/application/run-director-agent.ts';
import type {
  DirectorAttemptStore,
  DirectorDecisionModel,
} from '../src/modules/world/application/director-runtime-ports.ts';
import type {
  DirectorAttempt,
  DirectorDecision,
  DirectorSnapshot,
} from '../src/modules/world/domain/director-runtime.ts';
import {
  transitionAgentAttempt,
  type AgentAttemptStatus,
} from '../src/modules/world/domain/agent-runtime.ts';

const error = (code: string) => Object.assign(Error(code), { code });
const knownConflicts = [
  'VERSION_CONFLICT',
  'ENGINE_EPOCH_CONFLICT',
  'DIRECTOR_REVISION_CONFLICT',
  'DIRECTOR_CURSOR_CONFLICT',
  'DIRECTOR_PENDING_RANGE_INCOMPLETE',
  'DIRECTOR_ACTOR_STATE_CONFLICT',
  'DIRECTOR_BOUNDARY_CONFLICT',
  'DIRECTOR_EPISODE_CONFLICT',
  'DIRECTOR_CANDIDATE_CONFLICT',
  'DIRECTOR_CLOCK_CONFLICT',
  'DIRECTOR_CAST_CONFLICT',
  'DIRECTOR_ATTEMPT_STALE',
];
function fixture(
  options: {
    previous?: AgentAttemptStatus;
    race?: AgentAttemptStatus;
    savedStatus?: 'response_received' | 'invalid_output' | 'stale_discarded';
    preflightError?: Error;
    sentError?: Error;
    modelError?: Error;
    saveError?: Error;
    parseError?: Error;
    commitError?: Error;
    completionMissing?: boolean;
    decisionMissing?: boolean;
    recoveredRaw?: unknown;
  } = {},
) {
  const calls: string[] = [];
  const snapshot: DirectorSnapshot = {
    schemaVersion: 1,
    worldId: 'world',
    engineEpoch: 2,
    worldVersion: 7,
    storyAt: '2026-10-15T08:00:00.000Z',
    observedThroughVersion: 7,
    evaluatedThroughVersion: 4,
    boundary: {
      worldId: 'world',
      actorIds: [],
      placeIds: [],
      capabilityIds: [],
      extensionPermission: 'none',
      createdFromVersion: 7,
      sourceEventId: 'event-7',
    },
    worldSetting: 'CURRENT_CALLER_VIEW',
    actorStates: [],
    episodes: [],
    candidates: [],
    blockers: [],
    changes: [],
    observations: [],
    focus: [],
  };
  const protectedSnapshot = {
    ...structuredClone(snapshot),
    worldSetting: 'ORIGINAL_PROTECTED_VIEW',
  };
  const claim = {
    id: 'director-attempt',
    worldId: 'world',
    commandId: 'director-command',
    engineEpoch: 2,
    expectedWorldVersion: 7,
    inputHash: 'original-input-hash',
    token: 'original-token',
    leaseUntil: '2026-10-15T08:02:00.000Z',
  };
  let attempt: DirectorAttempt = {
    ...claim,
    status: options.previous ?? options.race ?? 'reserved',
    ...(options.previous === 'committed' || options.race === 'committed'
      ? { decisionId: 'immutable-decision' }
      : {}),
  };
  const receipt: DirectorDecision = {
    schemaVersion: 1,
    id: 'immutable-decision',
    worldId: 'world',
    engineEpoch: 2,
    worldVersion: 7,
    inputHash: claim.inputHash,
    evaluatedThroughVersion: 7,
    mode: 'quiet',
    selectedCandidateIds: [],
    deferred: [],
    nudges: [],
    opportunities: [],
    audit: { reason: 'PRIVATE_GLOBAL_AUDIT', basisSourceIds: [] },
  };
  const freshRaw = { kind: 'new-response' },
    recoveredRaw = Object.hasOwn(options, 'recoveredRaw')
      ? options.recoveredRaw
      : { kind: 'original-protected-response' };
  const parses: { snapshot: DirectorSnapshot; raw: unknown; attempt: DirectorAttempt }[] = [];
  const commits: {
    snapshot: DirectorSnapshot;
    attempt: DirectorAttempt;
    decision: DirectorDecision;
  }[] = [];
  const attempts: DirectorAttemptStore = {
    async lookup(owner, world, command) {
      calls.push('lookup');
      assert.deepEqual([owner, world, command], ['owner', 'world', 'director-command']);
      return options.previous ? { ...attempt } : null;
    },
    async claim(_owner, input, read) {
      calls.push('claim');
      assert.equal(input.worldId, 'world');
      assert.equal(read.worldId, 'world');
      return { attempt: { ...attempt }, replay: !!(options.previous || options.race) };
    },
    async mark(_owner, expected, status) {
      calls.push('mark:' + status);
      assert.equal(expected.token, claim.token);
      if (status === 'request_sent' && options.sentError) throw options.sentError;
      transitionAgentAttempt(attempt.status, status);
      attempt = { ...attempt, status };
      return { ...attempt };
    },
    async saveResponse(_owner, expected, raw) {
      calls.push('saveResponse');
      assert.equal(expected.status, 'request_sent');
      if (
        options.modelError &&
        'responseOutcome' in options.modelError &&
        options.modelError.responseOutcome === 'rejected'
      )
        assert.deepEqual(raw, {
          kind: 'model_request_rejection',
          schemaVersion: 1,
          httpStatus: 400,
        });
      else if (
        options.modelError &&
        'responseOutcome' in options.modelError &&
        options.modelError.responseOutcome === 'not_sent'
      )
        assert.deepEqual(raw, { kind: 'model_preflight_rejection', schemaVersion: 1 });
      else assert.equal(raw, freshRaw);
      if (options.saveError) throw options.saveError;
      attempt = { ...attempt, status: options.savedStatus ?? 'response_received' };
      return { ...attempt };
    },
    async readCompletion() {
      calls.push('readCompletion');
      return options.completionMissing
        ? { found: false }
        : { found: true, snapshot: protectedSnapshot, response: recoveredRaw };
    },
    async readDecision(_owner, world, id) {
      calls.push('readDecision');
      assert.equal(world, 'world');
      assert.equal(id, 'immutable-decision');
      return options.decisionMissing ? null : receipt;
    },
    async commit(_owner, expected, read, decision) {
      calls.push('commit');
      commits.push({ snapshot: structuredClone(read), attempt: { ...expected }, decision });
      if (options.commitError) throw options.commitError;
      assert.equal(attempt.status, 'response_received');
      attempt = { ...attempt, status: 'committed', decisionId: receipt.id };
      return receipt;
    },
  };
  const model: DirectorDecisionModel = {
    validateInput() {
      calls.push('preflight');
      if (options.preflightError) throw options.preflightError;
    },
    async decide() {
      calls.push('model');
      if (options.modelError) throw options.modelError;
      return freshRaw;
    },
  };
  const parse = (read: DirectorSnapshot, raw: unknown, expected: DirectorAttempt) => {
    calls.push('parse');
    parses.push({ snapshot: structuredClone(read), raw, attempt: { ...expected } });
    if (options.parseError) throw options.parseError;
    return receipt;
  };
  return {
    calls,
    snapshot,
    protectedSnapshot,
    claim,
    receipt,
    freshRaw,
    recoveredRaw,
    parses,
    commits,
    deps: { attempts, model, parse },
    state: () => attempt,
    run: (signal?: AbortSignal) =>
      runDirectorAgent({ attempts, model, parse }, 'owner', claim, snapshot, signal),
  };
}

test('fresh director call reserves and records send/raw before parsing and one atomic commit', async () => {
  const f = fixture(),
    before = structuredClone(f.snapshot);
  assert.equal(await f.run(), f.receipt);
  assert.deepEqual(f.calls, [
    'lookup',
    'preflight',
    'claim',
    'mark:request_sent',
    'model',
    'saveResponse',
    'parse',
    'commit',
  ]);
  assert.equal(f.parses[0]!.raw, f.freshRaw);
  assert.deepEqual(f.snapshot, before);
  assert.equal(f.state().status, 'committed');
});
test('committed lookup returns immutable receipt with no preflight, claim, parse, model or mutable snapshot reinterpretation', async () => {
  const f = fixture({
    previous: 'committed',
    preflightError: error('MUST_NOT_PREFLIGHT'),
    parseError: error('MUST_NOT_PARSE'),
    modelError: error('MUST_NOT_PAY'),
  });
  f.snapshot.worldVersion = 999;
  f.snapshot.worldSetting = 'DIFFERENT_CURRENT_CONTEXT';
  assert.equal(await f.run(), f.receipt);
  assert.deepEqual(f.calls, ['lookup', 'readDecision']);
});
test('committed replay cannot silently accept a changed request input hash', async () => {
  const f = fixture({ previous: 'committed' });
  f.claim.inputHash = 'different-request-hash';
  await assert.rejects(f.run(), { code: 'DIRECTOR_COMMAND_CONFLICT' });
  assert.ok(!f.calls.includes('model'));
  assert.ok(!f.calls.includes('parse'));
  assert.ok(!f.calls.includes('commit'));
});
test('cached identity conflict is checked before reading any prior status receipt or protected raw', async () => {
  for (const previous of ['committed', 'response_received', 'unknown_after_send'] as const)
    for (const field of ['inputHash', 'engineEpoch', 'expectedWorldVersion'] as const) {
      const f = fixture({ previous });
      if (field === 'inputHash') f.claim.inputHash = 'new-body';
      else f.claim[field]++;
      await assert.rejects(f.run(), { code: 'DIRECTOR_COMMAND_CONFLICT' });
      assert.deepEqual(f.calls, ['lookup']);
    }
});
test('recovery uses original protected snapshot/raw, not new caller context, and never calls preflight or model', async () => {
  const f = fixture({
    previous: 'response_received',
    modelError: error('MUST_NOT_PAY'),
    preflightError: error('MUST_NOT_PREFLIGHT'),
  });
  assert.equal(await f.run(), f.receipt);
  assert.ok(!f.calls.includes('model'));
  assert.ok(!f.calls.includes('preflight'));
  assert.equal(f.parses[0]!.raw, f.recoveredRaw);
  assert.deepEqual(f.parses[0]!.snapshot, f.protectedSnapshot);
  assert.deepEqual(f.commits[0]!.snapshot, f.protectedSnapshot);
  assert.equal(f.state().status, 'committed');
});
test('a found protected JSON null is not treated as a missing completion or new paid request', async () => {
  const f = fixture({ previous: 'response_received', recoveredRaw: null });
  await f.run();
  assert.equal(f.parses[0]!.raw, null);
  assert.ok(!f.calls.includes('model'));
});
test('missing protected completion or committed decision is explicit and never repaid', async () => {
  for (const setup of [
    { previous: 'response_received' as const, completionMissing: true },
    { previous: 'committed' as const, decisionMissing: true },
  ]) {
    const f = fixture(setup);
    await assert.rejects(f.run(), { code: 'UNKNOWN' });
    assert.ok(!f.calls.includes('model'));
    assert.ok(!f.calls.includes('parse'));
    assert.ok(!f.calls.includes('commit'));
  }
});
for (const status of [
  'reserved',
  'request_sent',
  'unknown_after_send',
  'invalid_output',
  'stale_discarded',
  'cancelled_before_send',
] as const)
  test(`existing ${status} is never automatically retried or parsed`, async () => {
    const f = fixture({ previous: status });
    await assert.rejects(f.run(), {
      code: status === 'unknown_after_send' ? 'UNKNOWN' : 'INVALID_STATE',
    });
    assert.deepEqual(f.calls, ['lookup']);
    assert.equal(f.state().status, status);
  });
test('abort before sending persists cancelled_before_send and makes no model request', async () => {
  const f = fixture(),
    controller = new AbortController(),
    reason = error('EXPLICIT_CANCEL');
  controller.abort(reason);
  await assert.rejects(f.run(controller.signal), (e) => e === reason);
  assert.deepEqual(f.calls, ['lookup', 'preflight', 'claim', 'mark:cancelled_before_send']);
  assert.equal(f.state().status, 'cancelled_before_send');
});
test('preflight input/budget failures occur before reserve, send or model and cannot become unknown', async () => {
  for (const code of [
    'DIRECTOR_CONTEXT_LIMIT',
    'INVALID_DIRECTOR_PROPOSAL',
    'DIRECTOR_INPUT_TOO_LARGE',
  ]) {
    const f = fixture({ preflightError: error(code) });
    await assert.rejects(f.run(), { code });
    assert.deepEqual(f.calls, ['lookup', 'preflight']);
  }
});
for (const code of knownConflicts) {
  test(`known ${code} before send discards stale attempt without paid call`, async () => {
    const f = fixture({ sentError: error(code) });
    await assert.rejects(f.run(), { code });
    assert.equal(f.state().status, 'stale_discarded');
    assert.ok(!f.calls.includes('model'));
    assert.ok(!f.calls.includes('mark:unknown_after_send'));
    assert.ok(!f.calls.includes('parse'));
  });
  test(`known ${code} after protected raw commit conflict becomes stale, never unknown`, async () => {
    const f = fixture({ commitError: error(code) });
    await assert.rejects(f.run(), { code });
    assert.equal(f.state().status, 'stale_discarded');
    assert.ok(f.calls.indexOf('saveResponse') < f.calls.indexOf('parse'));
    assert.ok(!f.calls.includes('mark:unknown_after_send'));
  });
}
test('unobserved result after send is the unknown state, without parse/commit or hidden retry', async () => {
  for (const failure of ['model', 'persistence'] as const) {
    const f = fixture(
      failure === 'model'
        ? { modelError: error('UPSTREAM_TIMEOUT') }
        : { saveError: error('RAW_WRITE_LOST') },
    );
    await assert.rejects(f.run());
    assert.equal(f.state().status, 'unknown_after_send');
    assert.ok(!f.calls.includes('parse'));
    assert.ok(!f.calls.includes('commit'));
    assert.equal(f.calls.filter((c) => c === 'model').length, 1);
  }
});
test('known invalid/oversize stored response is invalid_output, not unknown and not parsed again', async () => {
  const f = fixture({ savedStatus: 'invalid_output' });
  await assert.rejects(f.run(), { code: 'INVALID_DIRECTOR_PROPOSAL' });
  assert.equal(f.state().status, 'invalid_output');
  assert.ok(!f.calls.includes('mark:unknown_after_send'));
  assert.ok(!f.calls.includes('parse'));
  assert.ok(!f.calls.includes('commit'));
});
test('stored late stale raw is not reinterpreted or paid again', async () => {
  const f = fixture({ savedStatus: 'stale_discarded' });
  await assert.rejects(f.run(), { code: 'VERSION_CONFLICT' });
  assert.ok(!f.calls.includes('parse'));
  assert.ok(!f.calls.includes('mark:unknown_after_send'));
});
test('known parse failure after durable raw records invalid_output and never unknown', async () => {
  const f = fixture({ parseError: error('INVALID_DIRECTOR_PROPOSAL') });
  await assert.rejects(f.run(), { code: 'INVALID_DIRECTOR_PROPOSAL' });
  assert.equal(f.state().status, 'invalid_output');
  assert.ok(!f.calls.includes('commit'));
  assert.ok(!f.calls.includes('mark:unknown_after_send'));
});
test('store-known invalid decision after parse is invalid_output and never unknown', async () => {
  const f = fixture({ commitError: error('INVALID_DIRECTOR_DECISION') });
  await assert.rejects(f.run(), { code: 'INVALID_DIRECTOR_DECISION' });
  assert.equal(f.state().status, 'invalid_output');
  assert.ok(!f.calls.includes('mark:unknown_after_send'));
});
test('claim race to committed reads immutable decision without parse/model/commit', async () => {
  const f = fixture({
    race: 'committed',
    parseError: error('MUST_NOT_PARSE'),
    modelError: error('MUST_NOT_PAY'),
  });
  assert.equal(await f.run(), f.receipt);
  assert.deepEqual(f.calls, ['lookup', 'preflight', 'claim', 'readDecision']);
});
test('claim race to response_received reloads durable original completion instead of parsing undefined/new context', async () => {
  const f = fixture({ race: 'response_received', modelError: error('MUST_NOT_PAY') });
  assert.equal(await f.run(), f.receipt);
  assert.deepEqual(f.parses[0]!.snapshot, f.protectedSnapshot);
  assert.equal(f.parses[0]!.raw, f.recoveredRaw);
  assert.ok(!f.calls.includes('model'));
  assert.ok(!f.calls.includes('saveResponse'));
  assert.ok(!f.calls.includes('mark:request_sent'));
});
for (const status of [
  'reserved',
  'request_sent',
  'unknown_after_send',
  'invalid_output',
  'stale_discarded',
  'cancelled_before_send',
] as const)
  test(`claim race to ${status} cannot fall through to undefined parse or a second request`, async () => {
    const f = fixture({ race: status });
    await assert.rejects(f.run(), {
      code: status === 'unknown_after_send' ? 'UNKNOWN' : 'INVALID_STATE',
    });
    assert.deepEqual(f.calls, ['lookup', 'preflight', 'claim']);
    assert.equal(f.state().status, status);
  });
test('claim race without persisted completion is unknown evidence, not permission to regenerate', async () => {
  const f = fixture({ race: 'response_received', completionMissing: true });
  await assert.rejects(f.run(), { code: 'UNKNOWN' });
  assert.ok(!f.calls.includes('model'));
  assert.ok(!f.calls.includes('parse'));
  assert.ok(!f.calls.includes('commit'));
});
test('claim race to committed with a missing immutable decision never parses or regenerates it', async () => {
  const f = fixture({ race: 'committed', decisionMissing: true });
  await assert.rejects(f.run(), { code: 'UNKNOWN' });
  assert.deepEqual(f.calls, ['lookup', 'preflight', 'claim', 'readDecision']);
});
test('episode id already owned by another real decision is a known stale conflict rather than ambiguous model outcome', async () => {
  const f = fixture({ commitError: error('DIRECTOR_EPISODE_ID_CONFLICT') });
  await assert.rejects(f.run(), { code: 'DIRECTOR_EPISODE_ID_CONFLICT' });
  assert.equal(f.state().status, 'stale_discarded');
  assert.ok(!f.calls.includes('mark:unknown_after_send'));
});

test('Director stores explicit provider rejection as known invalid, not a lost result', async () => {
  const f = fixture({
    modelError: Object.assign(Error('rejected'), { responseOutcome: 'rejected', httpStatus: 400 }),
  });
  await assert.rejects(f.run(), /rejected/);
  assert.equal(f.state().status, 'invalid_output');
  assert.equal(f.calls.filter((x) => x === 'model').length, 1);
  assert.equal(f.parses.length, 0);
  assert.equal(f.commits.length, 0);
});

test('Director local gateway preflight failure does not fence as an unknown paid result', async () => {
  const f = fixture({
    modelError: Object.assign(Error('INVALID_CONFIG'), {
      code: 'INVALID_CONFIG',
      stage: 'request',
      responseOutcome: 'not_sent',
    }),
  });
  await assert.rejects(f.run(), /INVALID_CONFIG/);
  assert.equal(f.state().status, 'invalid_output');
  assert.equal(f.commits.length, 0);
});
