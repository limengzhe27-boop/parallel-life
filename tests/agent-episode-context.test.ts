import test from 'node:test';
import assert from 'node:assert/strict';
import { actorStateContextPayload } from '../src/modules/world/application/agent-state-context.ts';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import type { ActorEpisodeParticipation } from '../src/modules/world/domain/agent-narrative.ts';

function fixture() {
  const state = emptyActorAgentState({ worldId: 'world', actorId: 'actor' }, 'definition', 4);
  state.episodeParticipations = [
    {
      id: 'request',
      choice: 'decline',
      reason: '我已有自己的安排。',
      sourceIds: ['accepted-input', 'definition:definition'],
      recordedAtVersion: 4,
    },
  ];
  return state;
}

test('optional participation history preserves the exact old shape without unsolicited defaults', () => {
  const state = emptyActorAgentState({ worldId: 'world', actorId: 'actor' }, 'definition', 0);
  assert.deepEqual(actorStateContextPayload(state), state);
  assert.equal(Object.hasOwn(actorStateContextPayload(state), 'episodeParticipations'), false);
  state.episodeParticipations = [];
  assert.deepEqual(actorStateContextPayload(state).episodeParticipations, []);
});

test('all five own stance choices keep exact identifiers, reasons, sources and recorded versions', () => {
  const state = fixture();
  state.episodeParticipations = (
    ['engage', 'decline', 'defer', 'need_information', 'quiet'] as const
  ).map((choice, index) => ({
    ...state.episodeParticipations![0]!,
    id: `request-${index}`,
    choice,
  }));
  const payload = actorStateContextPayload(state);
  assert.deepEqual(payload.episodeParticipations, state.episodeParticipations);
  assert.deepEqual(payload.decisions, []);
  assert.deepEqual(payload.responsibilities, []);
});

test('participation objects and source arrays are deeply detached in both directions', () => {
  const state = fixture(),
    before = structuredClone(state),
    payload = actorStateContextPayload(state);
  payload.episodeParticipations![0]!.sourceIds.push('new-source');
  payload.episodeParticipations![0]!.reason = 'changed';
  payload.episodeParticipations!.push({ ...payload.episodeParticipations![0]!, id: 'other' });
  assert.deepEqual(state, before);
  const detached = actorStateContextPayload(state);
  state.episodeParticipations![0]!.sourceIds.push('later-source');
  assert.deepEqual(detached, before);
});

test('only the five whitelisted fields survive and unknown getters are never evaluated', () => {
  const state = fixture();
  let reads = 0;
  const extra = (value: object) => {
    Object.assign(value, { interview: 'PRIVATE_TRANSCRIPT', directorAudit: 'DIRECTOR_ONLY' });
    Object.defineProperty(value, 'privateGetter', {
      enumerable: true,
      get() {
        reads++;
        throw Error('MUST_NOT_READ');
      },
    });
  };
  extra(state.episodeParticipations!);
  extra(state.episodeParticipations![0]!);
  extra(state.episodeParticipations![0]!.sourceIds);
  const payload = actorStateContextPayload(state, {
    privateStrategySourceIds: new Set(['accepted-input']),
  });
  assert.equal(reads, 0);
  assert.deepEqual(Object.keys(payload.episodeParticipations![0]!), [
    'id',
    'choice',
    'reason',
    'sourceIds',
    'recordedAtVersion',
  ]);
  assert.equal(JSON.stringify(payload).includes('PRIVATE_TRANSCRIPT'), false);
  assert.equal(JSON.stringify(payload).includes('DIRECTOR_ONLY'), false);
  assert.equal(payload.episodeParticipations![0]!.reason, '我已有自己的安排。');
});

test('malformed participation fields fail closed without coercion', () => {
  for (const [field, value] of [
    ['id', {}],
    ['choice', 'player_accepted'],
    ['reason', null],
    ['sourceIds', ['source', {}]],
    ['sourceIds', new Array(1)],
    ['recordedAtVersion', -1],
    ['recordedAtVersion', 1.5],
    ['recordedAtVersion', Infinity],
  ] as const) {
    const state = fixture();
    (state.episodeParticipations![0]! as unknown as Record<string, unknown>)[field] = value;
    assert.throws(() => actorStateContextPayload(state), /INVALID_AGENT_CONTEXT/);
  }
  for (const value of [null, {}, [null], new Array(1)]) {
    const state = fixture();
    state.episodeParticipations = value as ActorEpisodeParticipation[];
    assert.throws(() => actorStateContextPayload(state), /INVALID_AGENT_CONTEXT/);
  }
});

test('known getters on optional history, items, fields and source entries reject without execution', () => {
  for (const target of ['history', 'item', 'reason', 'source'] as const) {
    const state = fixture();
    let reads = 0;
    const getter = {
      enumerable: true,
      get() {
        reads++;
        throw Error('PRIVATE_ACCESSOR');
      },
    };
    if (target === 'history') Object.defineProperty(state, 'episodeParticipations', getter);
    if (target === 'item') Object.defineProperty(state.episodeParticipations!, '0', getter);
    if (target === 'reason')
      Object.defineProperty(state.episodeParticipations![0]!, 'reason', getter);
    if (target === 'source')
      Object.defineProperty(state.episodeParticipations![0]!.sourceIds, '0', getter);
    assert.throws(() => actorStateContextPayload(state), /INVALID_AGENT_CONTEXT/);
    assert.equal(reads, 0);
  }
});

test('participation validation preserves adapter-specific error identity', () => {
  const state = fixture();
  state.episodeParticipations![0]!.recordedAtVersion = -1;
  const expected = Error('ADAPTER_INVALID');
  assert.throws(
    () =>
      actorStateContextPayload(state, {}, () => {
        throw expected;
      }),
    (error) => error === expected,
  );
});
