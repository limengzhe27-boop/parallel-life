import { readInvalidAuthoredEpisodeIds } from '../src/modules/world/infrastructure/authored-episode-scope-read.ts';
import {
  authoredOpportunityActorIds,
  validAuthoredOpportunityCast,
} from '../src/modules/world/domain/authored-opportunity-cast.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import type {
  DirectorSnapshot,
  DirectorAttempt,
} from '../src/modules/world/domain/director-runtime.ts';
import { compileAuthoredAgentMaterials } from '../src/modules/world/domain/authored-agent-material.ts';
import { parseDirectorDecision } from '../src/modules/world/infrastructure/director-agent-model.ts';
import {
  directorResponseFormat,
  directorOpeningInformationCatalog,
  directorOpeningActorCatalog,
  directorOpeningOwnerCatalog,
  decodeDirectorWire,
  directorWireCatalog,
} from '../src/modules/world/infrastructure/director-model-protocol.ts';
function fixture() {
  const s: DirectorSnapshot = {
    schemaVersion: 1,
    worldId: 'world',
    engineEpoch: 2,
    worldVersion: 5,
    storyAt: '2026-10-19T10:00:00.000Z',
    observedThroughVersion: 5,
    evaluatedThroughVersion: 0,
    boundary: {
      worldId: 'world',
      actorIds: ['a', 'b'],
      placeIds: ['home'],
      capabilityIds: ['plan.record'],
      extensionPermission: 'none',
      createdFromVersion: 5,
      sourceEventId: 'e5',
    },
    worldSetting: 'An existing small shop',
    cast: [{ id: 'a', name: 'A', persona: 'A fictional partner with an independent position.' }],
    actorStates: ['a', 'b'].map((actorId) =>
      emptyActorAgentState({ worldId: 'world', actorId }, 'definition', 5),
    ),
    episodes: [],
    candidates: [],
    blockers: [],
    changes: [],
    observations: [
      { sourceId: 'known', kind: 'fact', text: 'Known fictional context.', knownByActorIds: ['a'] },
    ],
    focus: [],
  };
  s.authoredMaterials = compileAuthoredAgentMaterials(
    {
      scope: { worldId: 'world', engineEpoch: 2, worldVersion: 5 },
      actualActorIds: ['a', 'b'],
      actualPlaceIds: ['home'],
      source: {
        origin: {
          workId: 'work',
          publicationVersion: 1,
          draftVersion: 0,
          contentHash: 'a'.repeat(64),
        },
        timeline: null,
        conditions: [],
        actorKeys: ['ak', 'bk'],
        contacts: [
          { actorKey: 'ak', actorId: 'a' },
          { actorKey: 'bk', actorId: 'b' },
        ],
        initialActorIds: ['a', 'b'],
        initialPlaceKeys: ['home'],
        places: [{ key: 'home', name: 'Home' }],
        history: [],
        openingEventKey: 'opening',
        nodes: ['opening', 'next'].map((key) => ({
          key,
          kind: 'candidate',
          title: key,
          editorialIntent: 'A future optional authored opportunity.',
          actorKeys: key === 'opening' ? ['ak'] : ['bk'],
          prerequisites: [],
          mutuallyExclusiveNodeKeys: [],
          intent: { kind: 'director_event' },
        })),
      },
    },
    (x) => createHash('sha256').update(x).digest('hex'),
  );
  s.authoredEligibility = s.authoredMaterials.materials.map((m) => ({
    nodeKey: m.ref.nodeKey,
    nodeHash: m.ref.nodeHash,
    status: 'eligible',
    reasons: [],
    basisSourceIds: [],
    qualificationKey: 'b'.repeat(64),
  }));
  s.occupiedAuthoredEventKeys = [];
  const a: DirectorAttempt = {
    id: 'attempt',
    worldId: 'world',
    commandId: 'command',
    engineEpoch: 2,
    expectedWorldVersion: 5,
    inputHash: 'a'.repeat(64),
    token: 'token',
    leaseUntil: '2026-10-19T10:03:00.000Z',
    status: 'response_received',
  };
  const events = directorWireCatalog(s).events;
  const wire = {
    protocol: 'director-wire-v8',
    candidates: [] as any[],
    authoredChoices: Object.fromEntries(
      events.map((e) => [e.ref, { kind: 'defer', reason: 'Wait for a relevant basis.' }]),
    ) as Record<string, any>,
    opportunities: [] as any[],
    audit: { reason: 'An explicit bounded decision.', sourceRefs: [] as string[] },
  };
  return { s, a, wire, events, parse: (raw: unknown) => parseDirectorDecision(s, raw, a) };
}

const interaction = {
  topic: '本人的具体想法',
  personalObjective: '提出可选择的安排',
  proposedInteraction: '与玩家讨论并等待本人判断',
};
function selected(f: ReturnType<typeof fixture>, wrong = false) {
  return {
    ...f.wire,
    protocol: 'director-wire-v14',
    openingContext: null,
    authoredChoices: {
      ...f.wire.authoredChoices,
      [f.events[0]!.ref]: {
        kind: 'consider',
        opportunity: {
          title: '本人机会',
          description: '未来建议，不是已发生的事实',
          playerImpact: '玩家可决定',
          places: [],
          activity: 'conversation',
          actorTasks: {
            'actor:1': wrong ? null : interaction,
            'actor:2': wrong ? interaction : null,
          },
        },
      },
    },
  };
}
test('author event cast binds the source schema and canonical parser to the same scoped actor', () => {
  const f = fixture();
  const schema: any = (directorResponseFormat(f.s) as any).schema;
  const resolve = (v: any): any => (v?.$ref ? schema.$defs[v.$ref.split('/').at(-1)] : v);
  const first = resolve(schema.properties.authoredChoices.properties[f.events[0]!.ref]);
  const author = resolve(
    first.anyOf.find((v: any) => v.properties?.kind?.enum?.includes('consider')).properties
      .opportunity,
  );
  assert.equal(author.properties.actorTasks.properties['actor:2'].type, 'null');
  assert.ok(author.properties.actorTasks.properties['actor:1'].anyOf);
  assert.deepEqual(f.parse(selected(f)).opportunities[0]!.participantActorIds, ['a']);
  assert.throws(() => f.parse(selected(f, true)), /authorized boundary/);
  const second = resolve(schema.properties.authoredChoices.properties[f.events[1]!.ref]);
  const secondAuthor = resolve(
    second.anyOf.find((v: any) => v.properties?.kind?.enum?.includes('consider')).properties
      .opportunity,
  );
  assert.equal(secondAuthor.properties.actorTasks.properties['actor:1'].type, 'null');
});
test('unconfigured legacy cast stays open; explicitly unresolved cast cannot become everybody', () => {
  const f = fixture(),
    m = f.s.authoredMaterials!.materials[0]!;
  m.node.actorKeys = [];
  m.participantRefs = [];
  assert.deepEqual(authoredOpportunityActorIds(m, ['a', 'b']), ['a', 'b']);
  assert.deepEqual(f.parse(selected(f, true)).opportunities[0]!.participantActorIds, ['b']);
  m.node.actorKeys = ['missing'];
  m.participantRefs = [{ actorKey: 'missing', actorId: null, status: 'unknown_key' }];
  assert.deepEqual(authoredOpportunityActorIds(m, ['a', 'b']), []);
  assert.equal(
    validAuthoredOpportunityCast([m], ['a', 'b'], {
      authoredEventKey: 'opening',
      participantActorIds: ['a'],
    }),
    false,
  );
  const schema: any = (directorResponseFormat(f.s) as any).schema;
  assert.equal(
    schema.properties.authoredChoices.properties[f.events[0]!.ref].$ref,
    '#/$defs/director_author_defer',
  );
  assert.throws(() => f.parse(selected(f)));
});

test('scope certification never converts a database failure into an invalid-episode result', async () => {
  const failure = Object.assign(new Error('DB_DOWN'), { code: 'DB_DOWN' });
  await assert.rejects(
    readInvalidAuthoredEpisodeIds(
      {
        query: async () => {
          throw failure;
        },
      } as any,
      'owner',
      { worldId: 'world', engineEpoch: 2 },
    ),
    (e) => e === failure,
  );
});
